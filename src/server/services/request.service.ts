import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { requests, users, type RequestRow } from '../../db/schema.js';
import type {
  CreateRequestBody,
  DecisionBody,
  RequestDto,
  RequestStatus,
} from '../../shared/schemas/request.js';
import { OPEN_REQUEST_STATUSES, ACTIVE_REQUEST_STATUSES } from '../../shared/schemas/request.js';
import type { Role } from '../../shared/schemas/user.js';
import type { V1Book } from '../../shared/schemas/narratorr-v1.js';
import type { INarratorrClient } from './narratorr-client.js';
import { NarratorrError } from './narratorr-client.js';
import { publicId } from '../util/ids.js';
import { conflict, notFound, tooManyRequests } from '../util/errors.js';

/**
 * Quota / approval policy. Built from app_settings + config at boot and handed
 * in (keeps the service free of the config singleton, so it's unit-testable).
 */
export interface RequestPolicy {
  /** App-wide default quota; per-user `requestQuota` overrides it. null = unlimited. */
  defaultQuota: number | null;
  windowDays: number;
  autoApproveRoles: Role[];
}

export interface QuotaUsage {
  limit: number | null;
  used: number;
  remaining: number | null;
  windowDays: number;
}

export class RequestService {
  constructor(
    private readonly db: Db,
    private readonly client: INarratorrClient,
    private readonly policy: RequestPolicy,
  ) {}

  // --- reads -----------------------------------------------------------------

  async getByPublicId(pid: string): Promise<RequestRow | undefined> {
    return this.db.query.requests.findFirst({ where: eq(requests.publicId, pid) });
  }

  async list(opts: {
    userId?: number;
    status?: RequestStatus;
    limit: number;
    offset: number;
  }): Promise<{ data: RequestDto[]; total: number }> {
    const conds = [
      opts.userId !== undefined ? eq(requests.userId, opts.userId) : undefined,
      opts.status !== undefined ? eq(requests.status, opts.status) : undefined,
    ].filter(Boolean);
    const where = conds.length ? and(...conds) : undefined;

    const rows = await this.db
      .select({ request: requests, requester: { publicId: users.publicId, plexUsername: users.plexUsername } })
      .from(requests)
      .innerJoin(users, eq(requests.userId, users.id))
      .where(where)
      .orderBy(desc(requests.requestedAt))
      .limit(opts.limit)
      .offset(opts.offset);

    const [{ n: total } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(requests)
      .where(where);

    return { data: rows.map((r) => this.toDto(r.request, r.requester)), total };
  }

  toDto(row: RequestRow, requester: { publicId: string; plexUsername: string }): RequestDto {
    return {
      publicId: row.publicId,
      asin: row.asin,
      title: row.title,
      author: row.author,
      narrator: row.narrator,
      coverUrl: row.coverUrl,
      status: row.status,
      note: row.note,
      requestedAt: row.requestedAt.toISOString(),
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      narratorrBookId: row.narratorrBookId,
      requester,
    };
  }

  // --- quota -----------------------------------------------------------------

  isAutoApprove(role: Role): boolean {
    return this.policy.autoApproveRoles.includes(role);
  }

  /**
   * Resolve a user's effective quota limit (null = unlimited). Auto-approve roles
   * are unlimited; everyone else gets their per-user override or the app default.
   */
  resolveLimit(user: { role: Role; requestQuota: number | null }): number | null {
    if (this.isAutoApprove(user.role)) return null;
    return user.requestQuota ?? this.policy.defaultQuota;
  }

  /**
   * Rolling-window usage (PLAN decision #5): count requests created in the last
   * `windowDays` whose status still occupies a slot — `pending`/`approved`/
   * `acquiring`/`available`, plus `failed` ONLY when the failure was user-caused
   * (otherwise `failed` is refunded). `denied` is never counted. `limit` is the
   * already-resolved effective limit (see `resolveLimit`); null = unlimited.
   */
  async quotaUsage(userId: number, limit: number | null): Promise<QuotaUsage> {
    const cutoff = new Date(Date.now() - this.policy.windowDays * 86_400_000);
    const [{ n: used } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(requests)
      .where(
        and(
          eq(requests.userId, userId),
          gte(requests.requestedAt, cutoff),
          or(
            inArray(requests.status, [...OPEN_REQUEST_STATUSES]),
            and(eq(requests.status, 'failed'), eq(requests.userCausedFailure, true)),
          ),
        ),
      );
    return {
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
      windowDays: this.policy.windowDays,
    };
  }

  // --- create ----------------------------------------------------------------

  /**
   * Create a request for the given user. Enforces the rolling quota (skipped for
   * auto-approve roles), de-dupes an existing active request for the same
   * (user, asin), and — when the role auto-approves — marks it approved and hands
   * it off to Narratorr immediately. Returns the row + whether it was newly created.
   */
  async create(userId: number, body: CreateRequestBody): Promise<{ row: RequestRow; created: boolean }> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw notFound('user not found');

    // De-dupe: an existing ACTIVE request for this (user, asin) is returned as-is.
    const existing = await this.db.query.requests.findFirst({
      where: and(
        eq(requests.userId, userId),
        eq(requests.asin, body.asin),
        inArray(requests.status, [...ACTIVE_REQUEST_STATUSES]),
      ),
    });
    if (existing) return { row: existing, created: false };

    const autoApprove = this.policy.autoApproveRoles.includes(user.role);

    if (!autoApprove) {
      const usage = await this.quotaUsage(userId, this.resolveLimit(user));
      if (usage.remaining !== null && usage.remaining <= 0) {
        throw tooManyRequests(
          'QUOTA_EXCEEDED',
          `Request quota reached (${usage.used}/${usage.limit} in the last ${usage.windowDays} days).`,
        );
      }
    }

    const now = new Date();
    let row: RequestRow;
    try {
      const [created] = await this.db
        .insert(requests)
        .values({
          publicId: publicId('rq'),
          userId,
          asin: body.asin,
          title: body.title,
          author: body.author ?? null,
          narrator: body.narrator ?? null,
          coverUrl: body.coverUrl ?? null,
          note: body.note ?? null,
          status: autoApprove ? 'approved' : 'pending',
          ...(autoApprove ? { decidedBy: userId, decidedAt: now } : {}),
        })
        .returning();
      if (!created) throw new Error('insert returned no row');
      row = created;
    } catch (err) {
      // Race: the partial unique index fired between our preflight and insert.
      if (isUniqueViolation(err)) {
        const dupe = await this.db.query.requests.findFirst({
          where: and(
            eq(requests.userId, userId),
            eq(requests.asin, body.asin),
            inArray(requests.status, [...ACTIVE_REQUEST_STATUSES]),
          ),
        });
        if (dupe) return { row: dupe, created: false };
      }
      throw err;
    }

    if (autoApprove) row = await this.handoff(row);
    return { row, created: true };
  }

  // --- admin decision --------------------------------------------------------

  async decide(adminId: number, pid: string, decision: DecisionBody): Promise<RequestRow> {
    const existing = await this.getByPublicId(pid);
    if (!existing) throw notFound('request not found');

    const now = new Date();
    const nextStatus = decision.action === 'deny' ? 'denied' : 'approved';
    // Atomic claim: transition ONLY while still pending. Two concurrent admins (or a
    // double-submit) can't both win — the loser's UPDATE matches zero rows. This
    // closes the check-then-update race and prevents approving a denied request.
    const [claimed] = await this.db
      .update(requests)
      .set({ status: nextStatus, decidedBy: adminId, decidedAt: now, note: decision.note ?? existing.note })
      .where(and(eq(requests.id, existing.id), eq(requests.status, 'pending')))
      .returning();
    if (!claimed) {
      const fresh = await this.getByPublicId(pid);
      throw conflict('NOT_PENDING', `request is ${fresh?.status ?? 'gone'}, not pending`);
    }
    return decision.action === 'approve' ? this.handoff(claimed) : claimed;
  }

  // --- Narratorr handoff -----------------------------------------------------

  /**
   * Hand an approved request to Narratorr's `POST /books` command. The client makes
   * the add idempotent by ASIN (a 409 "already exists" is resolved to the existing
   * book), so it's safe to retry and never double-adds — no idempotency key. An
   * already-imported book short-circuits straight to `available`. On failure we
   * re-throw either way, but only TERMINAL failures (unresolvable ASIN) mark the
   * request `failed`; TRANSIENT ones (429/5xx/network) leave it `approved` so the
   * poller's stranded-handoff retry self-heals instead of burning the request.
   */
  async handoff(row: RequestRow): Promise<RequestRow> {
    if (row.status !== 'approved') return row;
    try {
      const book = await this.client.addBook(row.asin);
      const next = this.mapBookStatus(book.status);
      const [updated] = await this.db
        .update(requests)
        .set({
          narratorrBookId: book.id,
          status: next,
          ...(next === 'failed' ? { userCausedFailure: false, failureReason: `book ${book.status}` } : {}),
        })
        .where(eq(requests.id, row.id))
        .returning();
      return updated ?? row;
    } catch (err) {
      if (!isTerminalHandoffError(err)) throw err; // transient — stays `approved`, poller retries
      const reason = err instanceof NarratorrError ? `${err.upstreamCode}: ${err.message}` : 'handoff failed';
      await this.db
        .update(requests)
        .set({ status: 'failed', userCausedFailure: false, failureReason: reason })
        .where(eq(requests.id, row.id));
      throw err;
    }
  }

  // --- reconciliation (poller) ----------------------------------------------

  /**
   * Requests currently mid-flight that the poller should refresh. Ordered oldest-first
   * and capped in SQL so a tick never does an unbounded read and the oldest in-flight
   * requests are always serviced (no starvation from an in-memory slice of an
   * unordered set). Strict per-row fair rotation (a `nextPollAt` cursor) is a follow-up.
   */
  async findAcquiring(limit = 100): Promise<RequestRow[]> {
    return this.db.query.requests.findMany({
      where: and(eq(requests.status, 'acquiring'), sql`${requests.narratorrBookId} IS NOT NULL`),
      orderBy: requests.requestedAt,
      limit,
    });
  }

  /**
   * Approved requests with no book yet — i.e. the process died between approval and
   * handoff. The poller re-runs the (idempotent) handoff to self-heal, so an
   * approved request is never permanently stranded.
   */
  async findApprovedAwaitingHandoff(limit = 100): Promise<RequestRow[]> {
    return this.db.query.requests.findMany({
      where: and(eq(requests.status, 'approved'), sql`${requests.narratorrBookId} IS NULL`),
      orderBy: requests.requestedAt,
      limit,
    });
  }

  /**
   * Apply a freshly-polled book to a request. Returns the new status if it changed,
   * else null (so the poller logs/notifies only on transitions). We mirror narratorr's
   * lifecycle and never invent a terminal state on a timer: a request stays `acquiring`
   * for as long as the book is pre-`imported` (a not-found book legitimately sits
   * `wanted` until narratorr's next scheduled search) and only goes terminal when
   * narratorr itself reports `imported` / `failed` / `missing`. Timing is narratorr's.
   */
  async applyBook(row: RequestRow, book: V1Book): Promise<RequestStatus | null> {
    const next = this.mapBookStatus(book.status);
    const bookId = book.id ?? row.narratorrBookId;
    if (next === 'acquiring' && bookId === row.narratorrBookId) return null; // no change worth persisting
    await this.db
      .update(requests)
      .set({
        status: next,
        narratorrBookId: bookId,
        ...(next === 'failed' ? { userCausedFailure: false, failureReason: `book ${book.status}` } : {}),
      })
      .where(eq(requests.id, row.id));
    return next === row.status ? null : next;
  }

  /** Mark a request failed when its book can no longer be found (404 on poll). */
  async markFailed(row: RequestRow, reason: string): Promise<void> {
    await this.db
      .update(requests)
      .set({ status: 'failed', userCausedFailure: false, failureReason: reason })
      .where(eq(requests.id, row.id));
  }

  private mapBookStatus(status: V1Book['status']): RequestStatus {
    switch (status) {
      case 'imported':
        return 'available';
      case 'failed':
      case 'missing':
        return 'failed';
      default:
        return 'acquiring'; // wanted | searching | downloading | importing
    }
  }
}

/**
 * Whether a handoff error is terminal (retrying can't fix it → fail the request) vs.
 * transient (429 rate-limit / 5xx / network → leave `approved` for the poller to
 * retry). A non-Narratorr error (e.g. a DB fault) is terminal so it can't loop forever.
 */
function isTerminalHandoffError(err: unknown): boolean {
  if (!(err instanceof NarratorrError)) return true;
  // 400 malformed, 409 with no usable existingId, 422 unresolvable ASIN.
  return err.upstreamStatus === 400 || err.upstreamStatus === 409 || err.upstreamStatus === 422;
}

/** libSQL surfaces a unique-constraint breach with this SQLite message fragment. */
function isUniqueViolation(err: unknown): boolean {
  if (err instanceof RangeError) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(msg) || /SQLITE_CONSTRAINT/i.test(msg);
}
