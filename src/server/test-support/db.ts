import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../../db/schema.js';
import { users } from '../../db/schema.js';
import type { Db } from '../../db/client.js';
import type { Role } from '../../shared/schemas/user.js';
import { publicId } from '../util/ids.js';

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

/** Fresh in-memory libSQL db with all migrations applied — one per test. */
export async function createTestDb(): Promise<Db> {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: drizzleDir });
  return db;
}

export async function insertUser(
  db: Db,
  opts: { role?: Role; requestQuota?: number | null; username?: string } = {},
): Promise<{ id: number; publicId: string; role: Role }> {
  const [row] = await db
    .insert(users)
    .values({
      publicId: publicId('us'),
      plexId: publicId('plex'),
      plexUsername: opts.username ?? 'tester',
      role: opts.role ?? 'user',
      requestQuota: opts.requestQuota ?? null,
    })
    .returning();
  if (!row) throw new Error('failed to insert test user');
  return { id: row.id, publicId: row.publicId, role: row.role };
}
