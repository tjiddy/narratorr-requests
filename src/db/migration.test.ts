import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

// The migration history was squashed to a single 0000 for the 1.0 public release, so
// the legacy column-per-provider identity and its one-time backfill (the old 0003) no
// longer exist in the tree. What still matters is that applying the migration folder to
// a fresh DB yields the generic (auth_provider, auth_subject) identity schema.
describe('schema migrations', () => {
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

  it('drops the never-producible user-fault failure column from requests', async () => {
    const client = createClient({ url: ':memory:' });
    await migrate(drizzle(client), { migrationsFolder: drizzleDir });
    const cols = (await client.execute("PRAGMA table_info('requests')")).rows.map((r) => r['name']);
    expect(cols).not.toContain('user_caused_failure');
    client.close();
  });
});
