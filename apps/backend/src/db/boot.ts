import type { Logger } from '../logger.js';
import type { Db } from './client.js';
import { runMigrations } from './migrate.js';

/**
 * Errors that mean "the server is not reachable yet", not "the SQL is wrong".
 * Socket codes from Node, plus Postgres 57P03 (`the database system is starting up`).
 */
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', '57P03']);

/** True when `error`, or any error in its `cause` chain, carries a connection code. */
export function isConnectionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === 'string' && CONNECTION_CODES.has(code)) return true;
    current = current.cause;
  }
  return false;
}

export interface MigrateWhenReadyOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Pause between attempts. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  migrate?: (db: Db) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs the migrations, waiting for the database when it is not reachable yet.
 * On Render the first deploy of a Blueprint starts the service while Postgres is
 * still booting; a bounded retry turns that race into a few `db.not_ready` lines
 * instead of a failed deploy. Any other failure is thrown at once.
 */
export async function migrateWhenReady(
  db: Db,
  logger: Logger,
  options: MigrateWhenReadyOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 3000;
  const sleep = options.sleep ?? defaultSleep;
  const migrate = options.migrate ?? runMigrations;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await migrate(db);
      return;
    } catch (error) {
      if (attempt >= attempts || !isConnectionError(error)) throw error;
      logger.warn('db.not_ready', {
        attempt,
        attempts,
        retryInMs: delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
    }
  }
}
