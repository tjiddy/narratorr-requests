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

    const promoted = await svc.setRole(alice.publicId, 'admin');
    expect(promoted.role).toBe('admin');
    const demoted = await svc.setRole(alice.publicId, 'user');
    expect(demoted.role).toBe('user');
  });

  it('throws 404 for an unknown user', async () => {
    await expect(svc.setRole('us_nope', 'admin')).rejects.toMatchObject({ statusCode: 404 });
  });
});
