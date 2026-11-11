// The injectable model: every model call goes through a ModelPort that calls the API, records or
// replays. callModel owns the one retry.
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { ReviewUnavailableError } from '../errors.js';

export type ModelCallKind = 'intent' | 'citation';

export type ModelCall = {
  kind: ModelCallKind;
  /** recordingKey([category, request]) or recordingKey([productId, ...requirementIds]). */
  key: string;
  attempt: 1 | 2;
  system: string;
  prompt: string;
  schema: z.ZodType;
  /** Stored with the recording. */
  input: Record<string, unknown>;
};

export interface ModelPort {
  /** 'claude-sonnet-5-5' or 'replay'. */
  readonly modelName: string;
  /** True for replay; Intent.source becomes 'recorded'. */
  readonly recorded: boolean;
  complete(call: ModelCall): Promise<unknown>;
}

/** Replay has no recording for this call. */
export class NoRecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoRecordingError';
  }
}

export type Verify<T> = (
  parsed: unknown,
) => { ok: true; value: T } | { ok: false; errors: string[] };

/** sha256 of the parts joined by newlines, first 16 hex characters. */
export function recordingKey(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}

function correction(prompt: string, errors: string[]): string {
  return `${prompt}\n# Correction\nYour previous answer was rejected:\n- ${errors.join('\n- ')}\nAnswer again. Quote the text exactly as it is written.\n`;
}

function schemaErrors(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

/**
 * Attempt 1 with the prompt. A provider error retries once with the same prompt; an invalid
 * answer retries once with the errors quoted back. A replay miss fails at once.
 */
export async function callModel<T>(
  port: ModelPort,
  call: Omit<ModelCall, 'attempt'>,
  verify: Verify<T>,
): Promise<T> {
  let prompt = call.prompt;
  for (const attempt of [1, 2] as const) {
    let raw: unknown;
    try {
      raw = await port.complete({ ...call, attempt, prompt });
    } catch (err) {
      if (err instanceof NoRecordingError) {
        throw new ReviewUnavailableError('no_recording', err.message, { cause: err });
      }
      if (attempt === 2) {
        throw new ReviewUnavailableError('model_error', 'The model failed twice', { cause: err });
      }
      continue;
    }
    const parsed = call.schema.safeParse(raw);
    let errors: string[];
    if (parsed.success) {
      const checked = verify(parsed.data);
      if (checked.ok) return checked.value;
      errors = checked.errors;
    } else {
      errors = schemaErrors(parsed.error);
    }
    if (attempt === 2) {
      throw new ReviewUnavailableError(
        'invalid_output',
        `The model answer was rejected twice: ${errors.join('; ')}`,
      );
    }
    prompt = correction(call.prompt, errors);
  }
  throw new ReviewUnavailableError('model_error');
}
