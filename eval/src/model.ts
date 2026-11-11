import type { Env } from '../../apps/backend/src/env.js';
import {
  createFileRecordingStore,
  createModelPort,
  createRecordingModelPort,
  createReplayModelPort,
  type ModelPort,
} from '../../apps/backend/src/review/index.js';

/**
 * Lane B's record and replay, unwrapped. `record` calls the env's live model and stores every
 * output under `dir`; `replay` answers only from `dir`, and a call it has no recording for
 * fails with no_recording. Lane B keys each recording by sha256(category + request) and the
 * attempt number, so one directory holds exactly one run.
 */
export function evalModel(env: Env, o: { mode: 'record' | 'replay'; dir: string }): ModelPort {
  const store = createFileRecordingStore(o.dir);
  if (o.mode === 'replay') return createReplayModelPort(store);
  const live = createModelPort({
    LLM_PROVIDER: env.LLM_PROVIDER,
    REVIEW_MODEL: env.REVIEW_MODEL,
    ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
  });
  return createRecordingModelPort(live, store);
}
