import type { Db } from './db/client.js';
import type { Env } from './env.js';
import type { Logger } from './logger.js';
import type { PaypalGateways } from './paypal/index.js';
import type { Channel3Port, ReviewPort } from './runs/ports.js';

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
  paypal: PaypalGateways;
  /** Lane B's Channel3 gateway behind a port; the recorded stub in tests. */
  channel3: Channel3Port;
  /** Lane B's review behind a port; the example-run stub in tests. */
  review: ReviewPort;
};
