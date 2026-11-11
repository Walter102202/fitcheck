import { createDb, type Db } from './client.js';
import { runMigrations } from './migrate.js';

/** A fresh in-memory PostgreSQL (PGlite) with every migration applied. One per test file or test. */
export async function createTestDb(): Promise<Db> {
  const db = await createDb('pglite://memory');
  await runMigrations(db);
  return db;
}
