import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(dbPath: string) {
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client);

  // In dev (tsx): __dirname = src/db/, migrations at ../../drizzle/
  // In prod (bundled): __dirname = dist/server/, migrations at ../../drizzle/
  try {
    await migrate(db, { migrationsFolder: path.join(__dirname, '../../drizzle') });
  } finally {
    // Release the file handle so Windows doesn't keep the db locked.
    client.close();
  }

  return db;
}

// CLI entry — only when run directly via `tsx src/db/migrate.ts`, not when tsup
// inlines this file into the server bundle (argv[1] would match the bundle).
const isBundled = !import.meta.url.includes('/src/');
if (!isBundled && process.argv[1] === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.DATABASE_PATH || './narrator-request.db';
  console.log(`Running migrations on ${dbPath}...`);
  runMigrations(dbPath)
    .then(() => {
      console.log('Migrations complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
