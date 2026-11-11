import { eq } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import type { Db } from './client.js';
import { sessions } from './schema.js';

/** An anonymous visitor session: each one gets its own spending cap. */
export async function createSession(deps: Pick<Deps, 'db' | 'newId' | 'now'>): Promise<string> {
  const id = deps.newId();
  const at = deps.now();
  await deps.db.insert(sessions).values({ id, createdAt: at, lastSeenAt: at });
  return id;
}

/** Marks the session active; the stale-cap sweep voids caps of sessions idle too long. */
export async function touchSession(db: Db, id: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ lastSeenAt: now })
    .where(eq(sessions.id, id))
    .returning({ id: sessions.id });
  return rows.length > 0;
}
