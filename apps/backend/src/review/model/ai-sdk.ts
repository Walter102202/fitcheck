import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, type LanguageModel, Output } from 'ai';
import type { ModelPort } from './port.js';
import {
  createFileRecordingStore,
  createRecordingModelPort,
  createReplayModelPort,
  DEFAULT_RECORDINGS_DIR,
} from './recordings.js';

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Structured output with the default temperature (Sonnet 5.5 accepts no other) and no thinking
 * budget; maxRetries 0 because callModel owns the one retry. Every error propagates.
 */
export function createAiSdkModelPort(
  model: LanguageModel,
  modelName: string,
  opts: { timeoutMs?: number } = {},
): ModelPort {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    modelName,
    recorded: false,
    async complete(call) {
      const result = await generateText({
        model,
        system: call.system,
        prompt: call.prompt,
        output: Output.object({ schema: call.schema }),
        providerOptions: { anthropic: { structuredOutputMode: 'outputFormat', effort: 'low' } },
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(timeoutMs),
      });
      return result.output;
    },
  };
}

export type ModelEnv = {
  LLM_PROVIDER: 'mock' | 'anthropic';
  REVIEW_MODEL: string;
  ANTHROPIC_API_KEY?: string;
};

/** mock: replay from recordingsDir; anthropic: live, wrapped in a recording port when `record`. */
export function createModelPort(
  env: ModelEnv,
  opts: { recordingsDir?: string; record?: boolean } = {},
): ModelPort {
  const dir = opts.recordingsDir ?? DEFAULT_RECORDINGS_DIR;
  if (env.LLM_PROVIDER === 'mock') return createReplayModelPort(createFileRecordingStore(dir));
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER is anthropic');
  }
  const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const live = createAiSdkModelPort(anthropic(env.REVIEW_MODEL), env.REVIEW_MODEL);
  return opts.record ? createRecordingModelPort(live, createFileRecordingStore(dir)) : live;
}
