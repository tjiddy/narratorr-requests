import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../../db/schema.js';
import { users } from '../../db/schema.js';
import type { Db } from '../../db/client.js';
import type { Role, UserStatus } from '../../shared/schemas/user.js';
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
  opts: {
    role?: Role;
    status?: UserStatus;
    requestQuota?: number | null;
    username?: string;
    autoApprove?: boolean;
    provider?: string;
    subject?: string;
    passwordHash?: string | null;
  } = {},
): Promise<{ id: number; publicId: string; role: Role; status: UserStatus }> {
  const [row] = await db
    .insert(users)
    .values({
      publicId: publicId('us'),
      authProvider: opts.provider ?? 'plex',
      authSubject: opts.subject ?? publicId('sub'),
      username: opts.username ?? 'tester',
      passwordHash: opts.passwordHash ?? null,
      // Default to active so existing tests that create requesters keep working; the
      // approval queue is exercised explicitly where it matters.
      status: opts.status ?? 'active',
      role: opts.role ?? 'user',
      requestQuota: opts.requestQuota ?? null,
      autoApprove: opts.autoApprove ?? false,
    })
    .returning();
  if (!row) throw new Error('failed to insert test user');
  return { id: row.id, publicId: row.publicId, role: row.role, status: row.status };
}
