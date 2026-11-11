import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAiSdkModelPort, createModelPort } from './ai-sdk.js';

type Captured = { temperature?: unknown; providerOptions?: Record<string, unknown> };

function mockModel(text: string, captured: Captured[]) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      captured.push(options as unknown as Captured);
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

describe('createAiSdkModelPort', () => {
  it('sends no temperature and the structured-output options', async () => {
    const captured: Captured[] = [];
    const port = createAiSdkModelPort(mockModel('{"ok":true}', captured), 'claude-sonnet-5-5');
    const out = await port.complete({
      kind: 'intent',
      key: 'k',
      attempt: 1,
      system: 'sys',
      prompt: 'p',
      schema: z.object({ ok: z.boolean() }),
      input: {},
    });
    expect(out).toEqual({ ok: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.temperature).toBeUndefined();
    expect(captured[0]?.providerOptions?.anthropic).toMatchObject({
      structuredOutputMode: 'outputFormat',
      effort: 'low',
    });
    expect(port).toMatchObject({ modelName: 'claude-sonnet-5-5', recorded: false });
  });

  it('lets a provider error propagate', async () => {
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('overloaded');
      },
    });
    const port = createAiSdkModelPort(failing, 'm');
    await expect(
      port.complete({
        kind: 'intent',
        key: 'k',
        attempt: 1,
        system: 's',
        prompt: 'p',
        schema: z.object({}),
        input: {},
      }),
    ).rejects.toThrow('overloaded');
  });
});

describe('createModelPort', () => {
  it('with mock replays', () => {
    const port = createModelPort({ LLM_PROVIDER: 'mock', REVIEW_MODEL: 'claude-sonnet-5-5' });
    expect(port).toMatchObject({ modelName: 'replay', recorded: true });
  });

  it('with anthropic and no key throws', () => {
    expect(() =>
      createModelPort({ LLM_PROVIDER: 'anthropic', REVIEW_MODEL: 'claude-sonnet-5-5' }),
    ).toThrow('ANTHROPIC_API_KEY is required when LLM_PROVIDER is anthropic');
  });

  it('with anthropic and a key names the model (no call is made)', () => {
    const port = createModelPort({
      LLM_PROVIDER: 'anthropic',
      REVIEW_MODEL: 'claude-sonnet-5-5',
      ANTHROPIC_API_KEY: 'test-key',
    });
    expect(port).toMatchObject({ modelName: 'claude-sonnet-5-5', recorded: false });
  });
});
