import type { Env } from './env.js';
import type { Logger } from './logger.js';

/**
 * Everything a route or workflow needs, passed explicitly so tests build their own.
 * Lane C extends this with `db`, `paypal`, `channel3` and `review`.
 */
export type Deps = {
  env: Env;
  now: () => Date;
  logger: Logger;
};
