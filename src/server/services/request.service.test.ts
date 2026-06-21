import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { RequestService, type RequestPolicy } from './request.service.js';
import { NarratorrError, type INarratorrClient } from './narratorr-client.js';
import { createTestDb, insertUser } from '../test-support/db.js';
import { requests } from '../../db/schema.js';
import type { Db } from '../../db/client.js';
import type { V1Book } from '../../shared/schemas/v1/books.js';
import type { BookStatus } from '../../shared/schemas/book.js';
import type { CreateRequestBody } from '../../shared/schemas/request.js';

/** Configurable fake — controls the book status the handoff/poll observes. */
class FakeClient implements INarratorrClient {
  status: BookStatus = 'searching';
  throwOnAdd: Error | null = null;
  added: string[] = [];
  private seq = 0;

  async searchMetadata() {
    return [];
  }
  async addBook(asin: string): Promise<V1Book> {
    this.added.push(asin);
    if (this.throwOnAdd) throw this.throwOnAdd;
    this.seq += 1;
    return { id: `bk_${this.seq}`, title: 'A Book', authors: [], narrators: [], status: this.status };
  }
  async getBook(id: string): Promise<V1Book> {
    return { id, title: 'A Book', authors: [], narrators: [], status: this.status };
  }
}

const body = (asin: string, title = 'A Book'): CreateRequestBody => ({
  asin,
  title,
  author: 'Author',
  narrator: null,
  coverUrl: null,
  note: null,
});

const policy = (over: Partial<RequestPolicy> = {}): RequestPolicy => ({
  defaultQuota: 10,
  windowDays: 30,
  autoApproveRoles: ['admin'],
  ...over,
});

let db: Db;
let client: FakeClient;

beforeEach(async () => {
  db = await createTestDb();
  client = new FakeClient();
});

describe('RequestService.create', () => {
  it('creates a pending request for a normal user', async () => {
    const user = await insertUser(db, { role: 'user' });
    const svc = new RequestService(db, client, policy());
    const { row, created } = await svc.create(user.id, body('B1'));
    expect(created).toBe(true);
    expect(row.status).toBe('pending');
    expect(client.added).toHaveLength(0); // no handoff until approved
  });

  it('de-dupes an active request for the same (user, asin)', async () => {
    const user = await insertUser(db, { role: 'user' });
    const svc = new RequestService(db, client, policy());
    const first = await svc.create(user.id, body('B1'));
    const second = await svc.create(user.id, body('B1'));
    expect(second.created).toBe(false);
    expect(second.row.publicId).toBe(first.row.publicId);
  });

  it('auto-approves an admin and hands off immediately', async () => {
    const admin = await insertUser(db, { role: 'admin' });
    const svc = new RequestService(db, client, policy());
    const { row } = await svc.create(admin.id, body('B1'));
    expect(row.status).toBe('acquiring');
    expect(row.narratorrBookId).toBe('bk_1');
    expect(client.added).toEqual(['B1']); // idempotent by ASIN — no key needed
  });

  it('short-circuits to available when the book is already imported', async () => {
    const admin = await insertUser(db, { role: 'admin' });
    client.status = 'imported';
    const svc = new RequestService(db, client, policy());
    const { row } = await svc.create(admin.id, body('B1'));
    expect(row.status).toBe('available');
  });

  it('auto-approves a per-user flagged (non-admin) user and hands off', async () => {
    const user = await insertUser(db, { role: 'user', autoApprove: true });
    const svc = new RequestService(db, client, policy());
    const { row } = await svc.create(user.id, body('B1'));
    expect(row.status).toBe('acquiring'); // skipped pending → handed off (FakeClient → searching)
    expect(client.added).toEqual(['B1']);
  });

  it('still enforces quota for an auto-approve user (auto-approve ≠ unlimited)', async () => {
    const user = await insertUser(db, { role: 'user', autoApprove: true });
    const svc = new RequestService(db, client, policy({ defaultQuota: 1 }));
    await svc.create(user.id, body('B1'));
    await expect(svc.create(user.id, body('B2'))).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });
});

describe('insert-time unique-violation race', () => {
  // The preflight findActiveDuplicate() at create():154 returns before insertRequest(),
  // so a pre-seeded duplicate alone only retests preflight dedupe and never reaches the
  // catch at insertRequest():225-232. Simulate the race window explicitly: drive the DB
  // read seam (db.query.requests.findFirst) so preflight MISSES and the catch re-query
  // HITS, and make the insert throw the unique violation. (:memory: libSQL breaks across
  // db.transaction() per CLAUDE.md, so a spy is preferred over real concurrency.)
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the race to the existing duplicate — no new row, no handoff', async () => {
    // Drive an AUTO-APPROVE caller (admin) against an `approved` duplicate so the
    // no-handoff assertion is mutation-sensitive: create() returns at :163 (`!created`)
    // BEFORE the auto-approve handoff at :164. handoff() only acts on an `approved` row,
    // so if that early return were ever removed, handoff(dupe) would fire addBook here —
    // a `pending` duplicate would no-op in handoff() and mask the regression. `approved`
    // is an active status covered by the partial unique index.
    const admin = await insertUser(db, { role: 'admin' });
    // Seed the duplicate directly — direct db.insert does not touch FakeClient.added.
    const [seeded] = await db
      .insert(requests)
      .values({ publicId: 'rq_dupe', userId: admin.id, asin: 'B1', title: 't', status: 'approved' })
      .returning();

    // Preflight (create():154) misses; catch re-query (insertRequest():228) hits the seed.
    vi.spyOn(db.query.requests, 'findFirst')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(seeded);
    // The insert trips the partial unique index between preflight and write.
    vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('UNIQUE constraint failed: requests.user_id, requests.asin');
    });

    const svc = new RequestService(db, client, policy());
    const { row, created } = await svc.create(admin.id, body('B1'));

    expect(created).toBe(false);
    expect(row.publicId).toBe(seeded!.publicId); // returns the existing duplicate
    // No handoff for the raced call: an approved dupe handed to handoff() WOULD call
    // addBook, so length 0 proves create() short-circuited before handoff / re-charge.
    expect(client.added).toHaveLength(0);

    // No second row was written for the (user, asin) pair.
    vi.restoreAllMocks();
    const rows = await db
      .select()
      .from(requests)
      .where(and(eq(requests.userId, admin.id), eq(requests.asin, 'B1')));
    expect(rows).toHaveLength(1);
  });

  it('re-throws the original error when the catch re-query finds no duplicate (no silent null)', async () => {
    const user = await insertUser(db, { role: 'user' });
    // Both preflight and catch re-query miss; the unique violation must surface unchanged.
    vi.spyOn(db.query.requests, 'findFirst')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('UNIQUE constraint failed: requests.user_id, requests.asin');
    });

    const svc = new RequestService(db, client, policy());
    await expect(svc.create(user.id, body('B1'))).rejects.toThrow('UNIQUE constraint failed');
  });
});

describe('quota enforcement (rolling window)', () => {
  it('blocks a normal user past their limit but never an auto-approve admin', async () => {
    const user = await insertUser(db, { role: 'user' });
    const svc = new RequestService(db, client, policy({ defaultQuota: 1 }));
    await svc.create(user.id, body('B1'));
    await expect(svc.create(user.id, body('B2'))).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });

    const admin = await insertUser(db, { role: 'admin' });
    await expect(svc.create(admin.id, body('B3'))).resolves.toBeTruthy();
  });

  it('does not count denied or non-user-caused failures, but does count user-caused failures', async () => {
    const user = await insertUser(db, { role: 'user' });
    const svc = new RequestService(db, client, policy({ defaultQuota: 10 }));
    // Seed four requests in various terminal states.
    await db.insert(requests).values([
      { publicId: 'rq_open', userId: user.id, asin: 'A1', title: 't', status: 'pending' },
      { publicId: 'rq_denied', userId: user.id, asin: 'A2', title: 't', status: 'denied' },
      { publicId: 'rq_failrefund', userId: user.id, asin: 'A3', title: 't', status: 'failed', userCausedFailure: false },
      { publicId: 'rq_failcharged', userId: user.id, asin: 'A4', title: 't', status: 'failed', userCausedFailure: true },
    ]);
    const usage = await svc.quotaUsage(user.id, 10);
    expect(usage.used).toBe(2); // pending + user-caused failure only
    expect(usage.remaining).toBe(8);
  });

  it('reports unlimited (null) for auto-approve roles', async () => {
    const admin = await insertUser(db, { role: 'admin' });
    const svc = new RequestService(db, client, policy({ defaultQuota: 1 }));
    expect(svc.resolveLimit({ role: 'admin', requestQuota: 5 })).toBeNull();
    const usage = await svc.quotaUsage(admin.id, svc.resolveLimit({ role: 'admin', requestQuota: null }));
    expect(usage.limit).toBeNull();
    expect(usage.remaining).toBeNull();
  });
});

describe('admin decisions + handoff', () => {
  it('approve transitions pending → acquiring; deny → denied', async () => {
    const user = await insertUser(db, { role: 'user' });
    const admin = await insertUser(db, { role: 'admin' });
    const svc = new RequestService(db, client, policy());

    const a = await svc.create(user.id, body('B1'));
    const approved = await svc.decide(admin.id, a.row.publicId, { action: 'approve', note: null });
    expect(approved.status).toBe('acquiring');
    expect(approved.decidedBy).toBe(admin.id);

    const b = await svc.create(user.id, body('B2'));
    const denied = await svc.decide(admin.id, b.row.publicId, { action: 'deny', note: 'nope' });
    expect(denied.status).toBe('denied');
  });

  it('rejects deciding a non-pending request', async () => {
    const user = await insertUser(db, { role: 'user' });
    const admin = await insertUser(db, { role: 'admin' });
    const svc = new RequestService(db, client, policy());
    const a = await svc.create(user.id, body('B1'));
    await svc.decide(admin.id, a.row.publicId, { action: 'approve', note: null });
    await expect(svc.decide(admin.id, a.row.publicId, { action: 'deny', note: null })).rejects.toMatchObject({
      code: 'NOT_PENDING',
    });
  });

  it('serializes concurrent decisions — exactly one wins, the other gets NOT_PENDING', async () => {
    const user = await insertUser(db, { role: 'user' });
    const admin = await insertUser(db, { role: 'admin' });
    const svc = new RequestService(db, client, policy());
    const a = await svc.create(user.id, body('B1'));
    const results = await Promise.allSettled([
      svc.decide(admin.id, a.row.publicId, { action: 'approve', note: null }),
      svc.decide(admin.id, a.row.publicId, { action: 'deny', note: null }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'NOT_PENDING' });
  });

  it('fails a request (refundable) on a TERMINAL handoff error (422), and re-throws', async () => {
    const admin = await insertUser(db, { role: 'admin' });
    client.throwOnAdd = new NarratorrError(422, 'asin_not_resolved', 'unresolvable asin');
    const svc = new RequestService(db, client, policy());
    await expect(svc.create(admin.id, body('B1'))).rejects.toBeInstanceOf(NarratorrError);
    const [row] = await db.select().from(requests).where(eq(requests.asin, 'B1'));
    expect(row?.status).toBe('failed');
    expect(row?.userCausedFailure).toBe(false);
  });

  it('leaves a request `approved` on a TRANSIENT handoff error (5xx) for the poller to retry', async () => {
    const admin = await insertUser(db, { role: 'admin' });
    client.throwOnAdd = new NarratorrError(502, 'UPSTREAM', 'down');
    const svc = new RequestService(db, client, policy());
    await expect(svc.create(admin.id, body('B1'))).rejects.toBeInstanceOf(NarratorrError);
    const [row] = await db.select().from(requests).where(eq(requests.asin, 'B1'));
    expect(row?.status).toBe('approved'); // stranded — findApprovedAwaitingHandoff retries it
    expect(row?.narratorrBookId).toBeNull();
    expect(row?.failureReason).toBeNull(); // transient writes no reason
  });
});

describe('handoff failure reasons (friendly per-code add-handoff errors)', () => {
  // Each terminal code → its friendly reason on the persisted row, refundable, no book id,
  // and the error still re-throws. A fresh approved request starts with no book, so
  // `narratorrBookId` must remain null (untouched) on the failed row.
  const cases: Array<{ code: string; expected: string }> = [
    { code: 'edition_rejected', expected: "This edition is excluded by the library's filters." },
    { code: 'asin_not_resolved', expected: "Couldn't find this book in the catalog." },
    { code: 'invalid_record', expected: 'Incomplete book data from the provider.' },
  ];

  for (const { code, expected } of cases) {
    it(`maps a 422 ${code} to its friendly reason on the failed row`, async () => {
      const admin = await insertUser(db, { role: 'admin' });
      client.throwOnAdd = new NarratorrError(422, code, 'gate rejected');
      const svc = new RequestService(db, client, policy());
      await expect(svc.create(admin.id, body('B1'))).rejects.toBeInstanceOf(NarratorrError);
      const [row] = await db.select().from(requests).where(eq(requests.asin, 'B1'));
      expect(row?.status).toBe('failed');
      expect(row?.failureReason).toBe(expected);
      expect(row?.userCausedFailure).toBe(false);
      expect(row?.narratorrBookId).toBeNull();
    });
  }

  it('falls back to a readable `code: message` for an unknown terminal code (no crash)', async () => {
    const admin = await insertUser(db, { role: 'admin' });
    client.throwOnAdd = new NarratorrError(422, 'some_new_code', 'a brand new reason');
    const svc = new RequestService(db, client, policy());
    await expect(svc.create(admin.id, body('B1'))).rejects.toBeInstanceOf(NarratorrError);
    const [row] = await db.select().from(requests).where(eq(requests.asin, 'B1'));
    expect(row?.status).toBe('failed');
    expect(row?.failureReason).toBe('some_new_code: a brand new reason');
    expect(row?.userCausedFailure).toBe(false);
  });

  it('uses the generic fallback reason for a non-NarratorrError terminal throw', async () => {
    const admin = await insertUser(db, { role: 'admin' });
    client.throwOnAdd = new Error('db exploded');
    const svc = new RequestService(db, client, policy());
    await expect(svc.create(admin.id, body('B1'))).rejects.toThrow('db exploded');
    const [row] = await db.select().from(requests).where(eq(requests.asin, 'B1'));
    expect(row?.status).toBe('failed');
    expect(row?.failureReason).toBe('handoff failed');
    expect(row?.userCausedFailure).toBe(false);
  });

  it('writes a friendly reason when the added book itself comes back failed/missing', async () => {
    const admin = await insertUser(db, { role: 'admin' });
    client.status = 'missing'; // addBook resolves a book already in a terminal-failed state
    const svc = new RequestService(db, client, policy());
    const { row } = await svc.create(admin.id, body('B1'));
    expect(row.status).toBe('failed');
    const [fresh] = await db.select().from(requests).where(eq(requests.asin, 'B1'));
    expect(fresh?.failureReason).toBe('No source found upstream.');
  });
});

describe('toDto', () => {
  const requester = { publicId: 'us_x', username: 'x' };

  it('maps failureReason onto the DTO (friendly string and null)', async () => {
    const admin = await insertUser(db, { role: 'admin' });
    const svc = new RequestService(db, client, policy());

    const { row: pending } = await svc.create(admin.id, body('B1'));
    expect(svc.toDto(pending, requester).failureReason).toBeNull();

    client.throwOnAdd = new NarratorrError(422, 'edition_rejected', 'nope');
    await expect(svc.create(admin.id, body('B2'))).rejects.toBeInstanceOf(NarratorrError);
    const [failed] = await db.select().from(requests).where(eq(requests.asin, 'B2'));
    expect(svc.toDto(failed!, requester).failureReason).toBe("This edition is excluded by the library's filters.");
  });
});

describe('applyBook (poller reconciliation)', () => {
  const mkBook = (status: BookStatus): V1Book => ({
    id: 'bk_1',
    title: 't',
    authors: [],
    narrators: [],
    status,
  });

  it('drives acquiring → available on imported and acquiring → failed on missing', async () => {
    const user = await insertUser(db, { role: 'user' });
    const svc = new RequestService(db, client, policy());
    const { row } = await svc.create(user.id, body('B1'));

    const toAvailable = await svc.applyBook(row, mkBook('imported'));
    expect(toAvailable).toBe('available');

    const { row: row2 } = await svc.create(user.id, body('B2'));
    const toFailed = await svc.applyBook(row2, mkBook('missing'));
    expect(toFailed).toBe('failed');
  });

  it('writes the friendly book-status reason when a polled book goes failed/missing', async () => {
    const user = await insertUser(db, { role: 'user' });
    const svc = new RequestService(db, client, policy());

    const { row: r1 } = await svc.create(user.id, body('B1'));
    await svc.applyBook(r1, mkBook('failed'));
    const [failed] = await db.select().from(requests).where(eq(requests.asin, 'B1'));
    expect(failed?.failureReason).toBe('Download failed upstream.');

    const { row: r2 } = await svc.create(user.id, body('B2'));
    await svc.applyBook(r2, mkBook('missing'));
    const [missing] = await db.select().from(requests).where(eq(requests.asin, 'B2'));
    expect(missing?.failureReason).toBe('No source found upstream.');
  });

  it('leaves a `wanted` request acquiring indefinitely — no app-side timeout', async () => {
    const admin = await insertUser(db, { role: 'admin' });
    const svc = new RequestService(db, client, policy());
    const { row } = await svc.create(admin.id, body('B1')); // auto-approved → acquiring

    // A not-found book sits `wanted` upstream; we mirror that, never auto-fail on a timer.
    const result = await svc.applyBook(row, mkBook('wanted'));
    expect(result).toBeNull(); // no transition — still acquiring
    const [fresh] = await db.select().from(requests).where(eq(requests.asin, 'B1'));
    expect(fresh?.status).toBe('acquiring');
  });

  it('persists a late-arriving book id while status stays acquiring — returns null but updates narratorrBookId', async () => {
    const user = await insertUser(db, { role: 'user' });
    const svc = new RequestService(db, client, policy());
    const [row] = await db
      .insert(requests)
      .values({
        publicId: 'rq_late',
        userId: user.id,
        asin: 'L1',
        title: 't',
        status: 'acquiring',
        narratorrBookId: 'bk_old',
      })
      .returning();

    // `downloading` maps back to acquiring (status unchanged), but the book id differs:
    // the bookId !== row.narratorrBookId branch falls through the early-return guard,
    // persists the new id, then returns null because `next === row.status`.
    const book: V1Book = { id: 'bk_new', title: 't', authors: [], narrators: [], status: 'downloading' };
    const result = await svc.applyBook(row!, book);

    expect(result).toBeNull(); // no transition — still acquiring
    const [fresh] = await db.select().from(requests).where(eq(requests.id, row!.id));
    expect(fresh?.status).toBe('acquiring');
    expect(fresh?.narratorrBookId).toBe('bk_new'); // late id persisted despite the null return
  });
});
