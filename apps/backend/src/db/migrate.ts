import { fileURLToPath } from 'node:url';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { Db } from './client.js';

/** `apps/backend/drizzle`, next to `src/` in development and `dist/` in production. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Applies every SQL migration in `apps/backend/drizzle` that has not run yet,
 * with the migrator matching the driver behind `db`. Same SQL for PGlite and `pg`.
 */
export async function runMigrations(db: Db): Promise<void> {
  const config = { migrationsFolder: MIGRATIONS_FOLDER };
  if (db instanceof PgliteDatabase) {
    await migratePglite(db, config);
    return;
  }
  if (db instanceof NodePgDatabase) {
    await migrateNodePg(db, config);
    return;
  }
  throw new Error('runMigrations: unsupported database driver');
}
