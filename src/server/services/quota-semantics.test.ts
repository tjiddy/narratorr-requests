import { describe, it, expect, beforeEach } from 'vitest';
import { RequestService, type RequestPolicy } from './request.service.js';
import type { INarratorrClient } from './narratorr-client.js';
import { createTestDb, insertUser } from '../test-support/db.js';
import type { Db } from '../../db/client.js';
import type { V1Book } from '../../shared/schemas/v1/books.js';
import type { CreateRequestBody } from '../../shared/schemas/request.js';
import { updateConnectorSettingsBodySchema } from '../../shared/schemas/connectors.js';
import { updateUserBodySchema } from '../../shared/schemas/user.js';
import { parseLimit } from '../../client/pages/settings-default-quota.js';
import { parseQuota } from '../../client/pages/parseQuota.js';

/**
 * THE LITERAL `0` MEANS OPPOSITE THINGS ON THE TWO QUOTA INPUTS — AND THAT IS INTENTIONAL.
 * (issue #77)
 *
 *   - App-wide DEFAULT quota (`updateConnectorSettingsBodySchema` → `defaultQuota.limit`,
 *     client `parseLimit`):  0 → null = UNLIMITED. A fat-fingered `0` on the default must
 *     not lock out every user; it inherits the old "blank/0 = no cap" semantics.
 *   - PER-USER override (`updateUserBodySchema` → `requestQuota`, client `parseQuota`):
 *     0 stays a literal 0 = BLOCK-ALL. A deliberate "suspend this user's requests" action.
 *
 * Same primitive (a request-count cap), same number-input affordance, opposite outcomes.
 * This test pins BOTH semantics in one place, threading each path schema → parser →
 * `resolveLimit` → `quotaUsage` → enforcement, so a future edit that "fixes" one side to
 * match the other (e.g. adding a 0→null collapse to `requestQuota`, or dropping the
 * transform on `defaultQuota.limit`) fails here. The divergence is documented in the two
 * schemas' comments and the two UI hints; this is its regression pin. DO NOT unify the two.
 */

class FakeClient implements INarratorrClient {
  async searchMetadata() {
    return [];
  }
  async addBook(asin: string): Promise<V1Book> {
    return { id: `bk_${asin}`, title: 'A Book', authors: [], narrators: [], status: 'searching' };
  }
  async getBook(id: string): Promise<V1Book> {
    return { id, title: 'A Book', authors: [], narrators: [], status: 'searching' };
  }
}

const body = (asin: string): CreateRequestBody => ({
  asin,
  title: 'A Book',
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

describe('quota `0` semantics — intentional divergence (issue #77)', () => {
  describe('DEFAULT quota path: 0 → null = UNLIMITED', () => {
    it('parses 0 to null at both the schema and the client parser', () => {
      const parsed = updateConnectorSettingsBodySchema.parse({ defaultQuota: { limit: 0, windowDays: 30 } });
      expect(parsed.defaultQuota?.limit).toBeNull();
      expect(parseLimit('0')).toEqual({ ok: true, value: null });
    });

    it('a default of 0 (→ null) resolves to unlimited and never blocks a request', async () => {
      // The configured default came from a `0` that the schema already collapsed to null.
      const limit = updateConnectorSettingsBodySchema.parse({ defaultQuota: { limit: 0, windowDays: 30 } })
        .defaultQuota?.limit;
      expect(limit).toBeNull();

      const svc = new RequestService(db, client, policy({ defaultQuota: limit ?? null }));
      const user = await insertUser(db, { role: 'user', requestQuota: null });

      expect(svc.resolveLimit({ role: 'user', requestQuota: null })).toBeNull();
      const usage = await svc.quotaUsage(user.id, svc.resolveLimit({ role: 'user', requestQuota: null }));
      expect(usage.remaining).toBeNull(); // unlimited

      // Enforcement (via create) must NOT throw — unlimited.
      await expect(svc.create(user.id, body('B1'))).resolves.toMatchObject({ created: true });
    });
  });

  describe('PER-USER override path: 0 stays 0 = BLOCK-ALL', () => {
    it('preserves a literal 0 at both the schema and the client parser (no collapse)', () => {
      const parsed = updateUserBodySchema.parse({ requestQuota: 0 });
      expect(parsed.requestQuota).toBe(0);
      expect(parseQuota('0')).toBe(0);
    });

    it('a per-user quota of 0 resolves to 0, leaves no remaining, and blocks every request', async () => {
      const quota = updateUserBodySchema.parse({ requestQuota: 0 }).requestQuota;
      expect(quota).toBe(0);

      const svc = new RequestService(db, client, policy());
      const user = await insertUser(db, { role: 'user', requestQuota: quota ?? null });

      expect(svc.resolveLimit({ role: 'user', requestQuota: 0 })).toBe(0);
      const usage = await svc.quotaUsage(user.id, svc.resolveLimit({ role: 'user', requestQuota: 0 }));
      expect(usage.remaining).toBe(0); // at-quota from the first request

      // Enforcement (via create) MUST throw — block-all.
      await expect(svc.create(user.id, body('B1'))).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    });
  });

  it('the two paths disagree on 0 ON PURPOSE — default unlimited, per-user blocked', async () => {
    const defaultLimit = updateConnectorSettingsBodySchema.parse({ defaultQuota: { limit: 0, windowDays: 30 } })
      .defaultQuota?.limit;
    const perUserQuota = updateUserBodySchema.parse({ requestQuota: 0 }).requestQuota;

    // Same typed `0`, opposite resolved meanings — this asymmetry is the whole point.
    expect(defaultLimit).toBeNull(); // unlimited
    expect(perUserQuota).toBe(0); // a real cap of zero
    expect(defaultLimit).not.toBe(perUserQuota);
  });
});
