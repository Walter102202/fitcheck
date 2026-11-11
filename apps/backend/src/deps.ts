import type { Db } from './db/client.js';
import type { Env } from './env.js';
import type { Logger } from './logger.js';

/**
 * Everything a route or workflow needs, passed explicitly so tests build their own.
 * Only `index.ts`, `env.ts` and the CLI scripts touch `process.env`.
 */
export type Deps = {
  env: Env;
  now: () => Date;
  logger: Logger;
  db: Db;
  /** Defaults to crypto.randomUUID; tests use a sequential one. */
  newId: () => string;
};
