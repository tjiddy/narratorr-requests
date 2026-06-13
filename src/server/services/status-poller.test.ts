import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { StatusPoller } from './status-poller.js';
import { RequestService } from './request.service.js';
import { NarratorrError, type INarratorrClient } from './narratorr-client.js';
import { createTestDb, insertUser } from '../test-support/db.js';
import { requests } from '../../db/schema.js';
import type { Db } from '../../db/client.js';
import type { FastifyBaseLogger } from 'fastify';
import type { V1Acquisition, AcquisitionStatus } from '../../shared/schemas/narratorr-v1.js';

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return noopLogger;
  },
  level: 'silent',
} as unknown as FastifyBaseLogger;

class PollClient implements INarratorrClient {
  status: AcquisitionStatus = 'downloading';
  error: NarratorrError | null = null;
  async searchMetadata() {
    return [];
  }
  async createAcquisition(asin: string): Promise<V1Acquisition> {
    return { id: 'aq_1', bookId: 'bk_1', asin, status: this.status, progress: 0, updatedAt: new Date(0).toISOString() };
  }
  async getAcquisition(id: string): Promise<V1Acquisition> {
    if (this.error) throw this.error;
    return { id, bookId: 'bk_1', asin: 'A', status: this.status, progress: 50, updatedAt: new Date(0).toISOString() };
  }
  async getBook(): Promise<never> {
    throw new Error('n/a');
  }
  async listBooks() {
    return { data: [], total: 0 };
  }
}

let db: Db;
let client: PollClient;
let svc: RequestService;
let poller: StatusPoller;

async function seedAcquiring(asin: string, acqId = 'aq_1') {
  const user = await insertUser(db);
  const [row] = await db
    .insert(requests)
    .values({
      publicId: `rq_${asin}`,
      userId: user.id,
      asin,
      title: 't',
      status: 'acquiring',
      narratorrAcquisitionId: acqId,
      narratorrBookId: 'bk_1',
    })
    .returning();
  return row!;
}

beforeEach(async () => {
  db = await createTestDb();
  client = new PollClient();
  svc = new RequestService(db, client, { defaultQuota: 10, windowDays: 30, autoApproveRoles: ['admin'] });
  poller = new StatusPoller({ requests: svc, client, logger: noopLogger, jitterMs: 0 });
});

describe('StatusPoller.pollOnce', () => {
  it('drives an acquiring request to available once the acquisition is imported', async () => {
    await seedAcquiring('A1');
    client.status = 'imported';
    const summary = await poller.pollOnce();
    expect(summary).toMatchObject({ checked: 1, transitioned: 1, upstreamErrors: 0 });
    const [row] = await db.select().from(requests).where(eq(requests.asin, 'A1'));
    expect(row?.status).toBe('available');
  });

  it('leaves a still-downloading request as acquiring (no spurious transition)', async () => {
    await seedAcquiring('A1');
    client.status = 'downloading';
    const summary = await poller.pollOnce();
    expect(summary.transitioned).toBe(0);
    const [row] = await db.select().from(requests).where(eq(requests.asin, 'A1'));
    expect(row?.status).toBe('acquiring');
  });

  it('marks a request failed when its acquisition 404s upstream', async () => {
    await seedAcquiring('A1');
    client.error = new NarratorrError(404, 'NOT_FOUND', 'gone');
    const summary = await poller.pollOnce();
    expect(summary.transitioned).toBe(1);
    const [row] = await db.select().from(requests).where(eq(requests.asin, 'A1'));
    expect(row?.status).toBe('failed');
  });

  it('recovers a stranded approved request (no acquisition) via idempotent handoff', async () => {
    const user = await insertUser(db);
    await db
      .insert(requests)
      .values({ publicId: 'rq_stranded', userId: user.id, asin: 'A9', title: 't', status: 'approved' });
    client.status = 'downloading';
    const summary = await poller.pollOnce();
    expect(summary.transitioned).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(requests).where(eq(requests.asin, 'A9'));
    expect(row?.status).toBe('acquiring');
    expect(row?.narratorrAcquisitionId).toBe('aq_1');
  });

  it('counts a transient upstream error without changing status', async () => {
    await seedAcquiring('A1');
    client.error = new NarratorrError(503, 'UPSTREAM', 'flaky');
    const summary = await poller.pollOnce();
    expect(summary).toMatchObject({ checked: 1, transitioned: 0, upstreamErrors: 1 });
    const [row] = await db.select().from(requests).where(eq(requests.asin, 'A1'));
    expect(row?.status).toBe('acquiring');
  });
});
