import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Read a migration file and split it into statements (the migrator's own split token). */
function statements(tag: string): Array<{ sql: string; args: [] }> {
  const sql = readFileSync(path.join(drizzleDir, `${tag}.sql`), 'utf8');
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ sql: s, args: [] as [] }));
}

describe('migration 0003_auth_identity', () => {
  it('applies cleanly on a fresh DB with the generic identity schema', async () => {
    const client = createClient({ url: ':memory:' });
    await migrate(drizzle(client), { migrationsFolder: drizzleDir });
    const cols = (await client.execute("PRAGMA table_info('users')")).rows.map((r) => r['name']);
    expect(cols).toEqual(
      expect.arrayContaining(['auth_provider', 'auth_subject', 'username', 'password_hash', 'status']),
    );
    expect(cols).not.toContain('plex_id');
    expect(cols).not.toContain('authelia_subject');
    client.close();
  });

  it('backfills legacy plex/authelia/dev-admin identities and preserves both request FKs', async () => {
    const client = createClient({ url: ':memory:' });
    // Apply the REAL 0000→0002 migrations (their actual SQL, via the FK-off migrate path),
    // so the pre-0003 shape and any 0002→0003 interaction are exercised — not a hand-rebuild.
    await client.migrate([...statements('0000_living_gargoyle'), ...statements('0001_nifty_kingpin'), ...statements('0002_broken_changeling')]);

    // Seed legacy rows + a request that exercises BOTH FKs (user_id and decided_by).
    await client.executeMultiple(`
      INSERT INTO users (id, public_id, plex_id, plex_username, role, auto_approve)
        VALUES (1,'us_plex','plex-abc','family-bob','user',0);
      INSERT INTO users (id, public_id, authelia_subject, plex_username, role, auto_approve)
        VALUES (2,'us_auth','authelia-sub-1','todd','admin',0);
      INSERT INTO users (id, public_id, plex_id, plex_username, role, auto_approve)
        VALUES (3,'us_dev','dev-admin','dev-admin','admin',0);
      INSERT INTO requests (id, public_id, user_id, asin, title, status, decided_by)
        VALUES (10,'rq_1',1,'B01','A Book','approved',2);
    `);

    await client.migrate(statements('0003_auth_identity'));

    const rows = (await client.execute('SELECT id, auth_provider, auth_subject, username, status, role, password_hash FROM users ORDER BY id')).rows;
    expect(rows[0]).toMatchObject({ auth_provider: 'plex', auth_subject: 'plex-abc', username: 'family-bob', status: 'active', role: 'user' });
    expect(rows[1]).toMatchObject({ auth_provider: 'authelia', auth_subject: 'authelia-sub-1', username: 'todd', status: 'active', role: 'admin' });
    // The dev-admin sentinel maps to the local provider (matches ensureDevAdmin).
    expect(rows[2]).toMatchObject({ auth_provider: 'local', auth_subject: 'dev-admin', username: 'dev-admin', status: 'active' });
    expect(rows.every((r) => r['password_hash'] === null)).toBe(true);

    // FK ids are preserved through the rebuild → both the requester (user_id) and the
    // decider (decided_by) still resolve.
    const joined = (
      await client.execute(
        'SELECT req.username AS requester, dec.username AS decider FROM requests r ' +
          'JOIN users req ON r.user_id = req.id JOIN users dec ON r.decided_by = dec.id',
      )
    ).rows;
    expect(joined[0]).toMatchObject({ requester: 'family-bob', decider: 'todd' });
    client.close();
  });
});
