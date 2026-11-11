import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import * as schema from './schema.js';

/** The database handle every module receives. Driver-agnostic: PGlite in tests and locally, pg on Render. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const closers = new WeakMap<Db, () => Promise<void>>();

/**
 * Picks the driver from the URL scheme:
 * - `pglite://memory` → in-memory PGlite (tests)
 * - `pglite://<dir>` → PGlite persisted in `<dir>` (local default)
 * - `postgres://...` / `postgresql://...` → `pg` pool (Render)
 */
export async function createDb(url: string): Promise<Db> {
  if (url.startsWith('pglite://')) {
    const target = url.slice('pglite://'.length);
    const client = target === 'memory' ? new PGlite() : new PGlite(target);
    await client.waitReady;
    const db: Db = drizzlePglite(client, { schema });
    closers.set(db, () => client.close());
    return db;
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const pool = new Pool({ connectionString: url });
    const db: Db = drizzleNodePg(pool, { schema });
    closers.set(db, () => pool.end());
    return db;
  }
  throw new Error(
    `Unsupported DATABASE_URL scheme: expected pglite:// or postgres://, got "${url.split(':')[0]}"`,
  );
}

/** Releases the underlying PGlite instance or pg pool. Safe to call once per `createDb`. */
export async function closeDb(db: Db): Promise<void> {
  const close = closers.get(db);
  closers.delete(db);
  await close?.();
}
