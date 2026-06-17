import { describe, it, expect, beforeEach } from 'vitest';
import { UserService } from './user.service.js';
import type { OidcProfile } from './oidc.service.js';
import { createTestDb, insertUser } from '../test-support/db.js';
import type { Db } from '../../db/client.js';

let db: Db;
let svc: UserService;

const prof = (subject: string, username: string, email: string | null = null): OidcProfile => ({
  subject,
  username,
  email,
  thumb: null,
});

beforeEach(async () => {
  db = await createTestDb();
  svc = new UserService(db);
});

describe('UserService role/status management', () => {
  it('lists users oldest-first and flips a role', async () => {
    const alice = await insertUser(db, { role: 'user', username: 'alice' });
    await insertUser(db, { role: 'admin', username: 'bob' });

    const all = await svc.listAll();
    expect(all.map((u) => u.username)).toEqual(['alice', 'bob']);

    const promoted = await svc.updateUser(alice.publicId, { role: 'admin' });
    expect(promoted.role).toBe('admin');
    const demoted = await svc.updateUser(alice.publicId, { role: 'user' });
    expect(demoted.role).toBe('user');
  });

  it('approves and rejects via the status patch', async () => {
    const u = await insertUser(db, { role: 'user', status: 'pending' });
    expect((await svc.updateUser(u.publicId, { status: 'active' })).status).toBe('active');
    expect((await svc.updateUser(u.publicId, { status: 'rejected' })).status).toBe('rejected');
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

describe('UserService OIDC upsert + approval queue', () => {
  it('first user (any method) becomes admin + active; everyone after lands pending', async () => {
    const first = await svc.upsertFromOidc('plex', prof('p1', 'todd'));
    expect(first).toMatchObject({ role: 'admin', status: 'active', authProvider: 'plex', authSubject: 'p1' });

    const second = await svc.upsertFromOidc('plex', prof('p2', 'bob'));
    expect(second).toMatchObject({ role: 'user', status: 'pending' });
  });

  it('upserts are keyed on (provider, subject) — same subject across providers = two accounts', async () => {
    const a = await svc.upsertFromOidc('plex', prof('shared', 'a'));
    const b = await svc.upsertFromOidc('authelia', prof('shared', 'b'));
    expect(a.id).not.toBe(b.id);
    expect((await svc.listAll()).length).toBe(2);
  });

  it('refreshes display fields for a returning active user', async () => {
    const created = await svc.upsertFromOidc('plex', prof('p1', 'old-name', 'old@x.com'));
    const again = await svc.upsertFromOidc('plex', prof('p1', 'new-name', 'new@x.com'));
    expect(again.id).toBe(created.id);
    expect(again).toMatchObject({ username: 'new-name', email: 'new@x.com' });
  });

  it('freezes profile metadata for a rejected user on re-login', async () => {
    await svc.upsertFromOidc('plex', prof('p1', 'first')); // becomes admin+active (first user)
    const target = await svc.upsertFromOidc('plex', prof('p2', 'frozen-name', 'a@x.com'));
    await svc.updateUser(target.publicId, { status: 'rejected' });

    const reauth = await svc.upsertFromOidc('plex', prof('p2', 'changed', 'b@x.com'));
    expect(reauth).toMatchObject({ status: 'rejected', username: 'frozen-name', email: 'a@x.com' });
  });
});

describe('UserService local auth', () => {
  it('keys a local user on the lowercased email; display = local-part; email stored', async () => {
    const u = await svc.createLocalUser({ email: 'Todd@Example.com', passwordHash: 'hash' });
    expect(u).toMatchObject({
      authProvider: 'local',
      authSubject: 'todd@example.com',
      username: 'todd',
      email: 'todd@example.com',
      role: 'admin',
      status: 'active',
    });
    expect((await svc.findLocalByEmail('TODD@EXAMPLE.COM'))?.id).toBe(u.id);
    expect((await svc.findLocalByEmail('todd@example.com'))?.passwordHash).toBe('hash');
  });

  it('a second local user lands pending', async () => {
    await svc.createLocalUser({ email: 'first@x.com', passwordHash: 'h' });
    const second = await svc.createLocalUser({ email: 'second@x.com', passwordHash: 'h' });
    expect(second).toMatchObject({ role: 'user', status: 'pending' });
  });
});

describe('UserService BOOTSTRAP_ADMIN', () => {
  it('grants admin only to the pinned identity (by username) and disables first-user-admin', async () => {
    svc = new UserService(db, { bootstrapAdmin: { provider: 'authelia', value: 'todd' } });

    // First to arrive does NOT match the pin → pending, not admin.
    const stranger = await svc.upsertFromOidc('plex', prof('p1', 'stranger'));
    expect(stranger).toMatchObject({ role: 'user', status: 'pending' });

    // The pinned identity → admin + active.
    const owner = await svc.upsertFromOidc('authelia', prof('sub-todd', 'todd'));
    expect(owner).toMatchObject({ role: 'admin', status: 'active' });
  });

  it('matches the pin by exact subject too', async () => {
    svc = new UserService(db, { bootstrapAdmin: { provider: 'authelia', value: 'sub-xyz' } });
    const owner = await svc.upsertFromOidc('authelia', prof('sub-xyz', 'display'));
    expect(owner.role).toBe('admin');
  });
});

describe('UserService.ensureDevAdmin', () => {
  it('is idempotent and yields a local/active admin', async () => {
    const a = await svc.ensureDevAdmin();
    const b = await svc.ensureDevAdmin();
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ authProvider: 'local', authSubject: 'dev-admin', role: 'admin', status: 'active' });
  });

  it('does NOT occupy the first-user slot: the first real user after a bypass run still becomes admin', async () => {
    // Simulates flipping AUTH_BYPASS=1 → standard on the same volume: the persisted
    // dev-admin must be excluded from the first-user count, or the first real signup
    // would land pending with no admin to approve it (bricked install).
    await svc.ensureDevAdmin();
    const firstReal = await svc.upsertFromOidc('plex', prof('p1', 'todd'));
    expect(firstReal).toMatchObject({ role: 'admin', status: 'active' });
  });
});
