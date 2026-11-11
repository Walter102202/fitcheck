import type { Env } from '../../apps/backend/src/env.js';
import {
  createFileRecordingStore,
  createModelPort,
  type ModelPort,
  NoRecordingError,
} from '../../apps/backend/src/review/index.js';

/** Stored in place of an answer when the live provider failed that attempt. */
type ErrorMarker = { fitcheckModelError: string };
const isMarker = (value: unknown): value is ErrorMarker =>
  typeof value === 'object' && value !== null && 'fitcheckModelError' in value;

/**
 * Lane B's recording port, plus the attempts that failed: a provider error (429, 529, a
 * timeout) is stored as a marker, so replay retries exactly where the live run retried and a
 * live model_error replays as model_error. Without the marker, replay of a run that met one
 * overload would miss attempt 1 and could never re-derive the published numbers.
 */
export function recordingPort(inner: ModelPort, dir: string): ModelPort {
  const store = createFileRecordingStore(dir);
  return {
    modelName: inner.modelName,
    recorded: false,
    async complete(call) {
      let output: unknown;
      try {
        output = await inner.complete(call);
      } catch (error) {
        const marker: ErrorMarker = {
          fitcheckModelError: error instanceof Error ? error.message : String(error),
        };
        await store.put(call.kind, call.key, call.attempt, {
          input: call.input,
          output: marker,
          model: inner.modelName,
        });
        throw error;
      }
      await store.put(call.kind, call.key, call.attempt, {
        input: call.input,
        output,
        model: inner.modelName,
      });
      return output;
    },
  };
}

/** Answers only from `dir`. A recorded provider error fails again; a missing file is no_recording. */
export function replayPort(dir: string): ModelPort {
  const store = createFileRecordingStore(dir);
  return {
    modelName: 'replay',
    recorded: true,
    async complete(call) {
      const output = await store.get(call.kind, call.key, call.attempt);
      if (output === undefined) {
        throw new NoRecordingError(
          `No recording for ${call.kind}/${call.key} attempt ${call.attempt}`,
        );
      }
      if (isMarker(output))
        throw new Error(`Recorded provider error: ${output.fitcheckModelError}`);
      return output;
    },
  };
}

/**
 * The measurement's model: `record` calls the env's live model and stores every attempt under
 * `dir`; `replay` answers only from `dir`. Lane B keys each recording by sha256(category +
 * request) and the attempt number, so one directory holds exactly one run.
 */
export function evalModel(env: Env, o: { mode: 'record' | 'replay'; dir: string }): ModelPort {
  if (o.mode === 'replay') return replayPort(o.dir);
  const live = createModelPort({
    LLM_PROVIDER: env.LLM_PROVIDER,
    REVIEW_MODEL: env.REVIEW_MODEL,
    ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
  });
  return recordingPort(live, o.dir);
}
