import type { Logger } from '../logger.js';

/** The shared logger's warn, `warn(msg, fields)`; lane C passes `Deps.logger`. */
export type ReviewLogger = Pick<Logger, 'warn'>;

export type ReviewDeps = {
  now: () => Date;
  logger?: ReviewLogger;
};
