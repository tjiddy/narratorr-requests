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
import type { V1Acquisition } from '../../shared/schemas/narratorr-v1.js';
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
      narratorrAcquisitionId: row.narratorrAcquisitionId,
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
    const row = await this.getByPublicId(pid);
    if (!row) throw notFound('request not found');
    if (row.status !== 'pending') {
      throw conflict('NOT_PENDING', `request is ${row.status}, not pending`);
    }

    const now = new Date();
    if (decision.action === 'deny') {
      const [updated] = await this.db
        .update(requests)
        .set({ status: 'denied', decidedBy: adminId, decidedAt: now, note: decision.note ?? row.note })
        .where(eq(requests.id, row.id))
        .returning();
      return updated ?? row;
    }

    const [approved] = await this.db
      .update(requests)
      .set({ status: 'approved', decidedBy: adminId, decidedAt: now, note: decision.note ?? row.note })
      .where(eq(requests.id, row.id))
      .returning();
    return this.handoff(approved ?? row);
  }

  // --- Narratorr handoff -----------------------------------------------------

  /**
   * Hand an approved request to Narratorr's idempotent acquire command. Uses the
   * request's own publicId as the Idempotency-Key so retries never double-acquire
   * (Codex risk #1). An already-imported book short-circuits straight to
   * `available` (the "already available" retry path). A handoff failure marks the
   * request `failed` (refundable — not user-caused) and re-throws so the caller
   * surfaces a 502.
   */
  async handoff(row: RequestRow): Promise<RequestRow> {
    if (row.status !== 'approved') return row;
    try {
      const acq = await this.client.createAcquisition(row.asin, row.publicId);
      const next = this.mapAcquisitionToStatus(acq.status);
      const [updated] = await this.db
        .update(requests)
        .set({
          narratorrAcquisitionId: acq.id,
          narratorrBookId: acq.bookId,
          status: next === 'available' ? 'available' : 'acquiring',
        })
        .where(eq(requests.id, row.id))
        .returning();
      return updated ?? row;
    } catch (err) {
      const reason = err instanceof NarratorrError ? `${err.upstreamCode}: ${err.message}` : 'handoff failed';
      const [failed] = await this.db
        .update(requests)
        .set({ status: 'failed', userCausedFailure: false, failureReason: reason })
        .where(eq(requests.id, row.id))
        .returning();
      void failed;
      throw err;
    }
  }

  // --- reconciliation (poller) ----------------------------------------------

  /** Requests currently mid-flight that the poller should refresh. */
  async findAcquiring(): Promise<RequestRow[]> {
    return this.db.query.requests.findMany({
      where: and(eq(requests.status, 'acquiring'), sql`${requests.narratorrAcquisitionId} IS NOT NULL`),
    });
  }

  /**
   * Apply a fetched acquisition projection to a request. Returns the new status
   * if it changed, else null (so the poller can log/notify only on transitions).
   */
  async applyAcquisition(row: RequestRow, acq: V1Acquisition): Promise<RequestStatus | null> {
    const next = this.mapAcquisitionToStatus(acq.status);
    const bookId = acq.bookId ?? row.narratorrBookId;
    if (next === 'acquiring' && bookId === row.narratorrBookId) return null; // no change worth persisting
    await this.db
      .update(requests)
      .set({
        status: next,
        narratorrBookId: bookId,
        ...(next === 'failed' ? { userCausedFailure: false, failureReason: `acquisition ${acq.status}` } : {}),
      })
      .where(eq(requests.id, row.id));
    return next === row.status ? null : next;
  }

  /** Mark a request failed when its acquisition can no longer be found (404 on poll). */
  async markFailed(row: RequestRow, reason: string): Promise<void> {
    await this.db
      .update(requests)
      .set({ status: 'failed', userCausedFailure: false, failureReason: reason })
      .where(eq(requests.id, row.id));
  }

  private mapAcquisitionToStatus(acqStatus: V1Acquisition['status']): RequestStatus {
    switch (acqStatus) {
      case 'imported':
        return 'available';
      case 'failed':
      case 'missing':
        return 'failed';
      default:
        return 'acquiring';
    }
  }
}

/** libSQL surfaces a unique-constraint breach with this SQLite message fragment. */
function isUniqueViolation(err: unknown): boolean {
  if (err instanceof RangeError) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(msg) || /SQLITE_CONSTRAINT/i.test(msg);
}
