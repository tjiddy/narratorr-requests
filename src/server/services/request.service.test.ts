import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { RequestService, type RequestPolicy } from './request.service.js';
import { NarratorrError, type INarratorrClient } from './narratorr-client.js';
import { createTestDb, insertUser } from '../test-support/db.js';
import { requests } from '../../db/schema.js';
import type { Db } from '../../db/client.js';
import type { V1Book, BookStatus } from '../../shared/schemas/narratorr-v1.js';
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
    client.throwOnAdd = new NarratorrError(422, 'not_found', 'unresolvable asin');
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
});
