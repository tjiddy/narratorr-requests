import { describe, it, expect, beforeEach } from 'vitest';
import { UserService } from './user.service.js';
import { createTestDb, insertUser } from '../test-support/db.js';
import type { Db } from '../../db/client.js';

let db: Db;
let svc: UserService;

beforeEach(async () => {
  db = await createTestDb();
  svc = new UserService(db);
});

describe('UserService role management', () => {
  it('lists users oldest-first and flips a role', async () => {
    const alice = await insertUser(db, { role: 'user', username: 'alice' });
    await insertUser(db, { role: 'admin', username: 'bob' });

    const all = await svc.listAll();
    expect(all.map((u) => u.plexUsername)).toEqual(['alice', 'bob']);

    const promoted = await svc.updateUser(alice.publicId, { role: 'admin' });
    expect(promoted.role).toBe('admin');
    const demoted = await svc.updateUser(alice.publicId, { role: 'user' });
    expect(demoted.role).toBe('user');
  });

  it('updates quota + auto-approve independently, leaving untouched fields alone', async () => {
    const u = await insertUser(db, { role: 'user' });
    const set = await svc.updateUser(u.publicId, { requestQuota: 3, autoApprove: true });
    expect(set.requestQuota).toBe(3);
    expect(set.autoApprove).toBe(true);

    const cleared = await svc.updateUser(u.publicId, { requestQuota: null });
    expect(cleared.requestQuota).toBeNull();
    expect(cleared.autoApprove).toBe(true); // untouched by the quota-only patch
  });

  it('throws 404 for an unknown user', async () => {
    await expect(svc.updateUser('us_nope', { role: 'admin' })).rejects.toMatchObject({ statusCode: 404 });
  });
});
