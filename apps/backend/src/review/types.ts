import type { Logger } from '../logger.js';
import type { ModelPort } from './model/port.js';

/** The shared logger's warn, `warn(msg, fields)`; lane C passes `Deps.logger`. */
export type ReviewLogger = Pick<Logger, 'warn'>;

export type ReviewDeps = {
  now: () => Date;
  /** Optional: the model proposes the quote shown for free-text evidence; never changes a state or a decision. */
  citations?: ModelPort;
  logger?: ReviewLogger;
};

export type IntentDeps = {
  model: ModelPort;
  logger?: ReviewLogger;
};
