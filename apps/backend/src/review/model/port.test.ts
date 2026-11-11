import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ReviewUnavailableError } from '../errors.js';
import {
  callModel,
  type ModelCall,
  type ModelPort,
  NoRecordingError,
  type Verify,
} from './port.js';
import {
  createMemoryRecordingStore,
  createRecordingModelPort,
  createReplayModelPort,
} from './recordings.js';

const schema = z.object({ quote: z.string() });
const call: Omit<ModelCall, 'attempt'> = {
  kind: 'intent',
  key: 'k1',
  system: 'sys',
  prompt: 'base prompt',
  schema,
  input: { request: 'r' },
};
const verify: Verify<string> = (parsed) => {
  const q = (parsed as { quote: string }).quote;
  return q === 'good' ? { ok: true, value: q } : { ok: false, errors: [`bad quote "${q}"`] };
};

/** A port answering from a script of outputs or errors, recording each call. */
function scripted(answers: (unknown | Error)[]) {
  const calls: ModelCall[] = [];
  const port: ModelPort = {
    modelName: 'fake',
    recorded: false,
    async complete(c) {
      calls.push(c);
      const a = answers[calls.length - 1];
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { port, calls };
}

describe('callModel', () => {
  it('returns on a valid first attempt', async () => {
    const { port, calls } = scripted([{ quote: 'good' }]);
    await expect(callModel(port, call, verify)).resolves.toBe('good');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ attempt: 1, prompt: 'base prompt', key: 'k1' });
  });

  it('retries once with the errors quoted after an invalid answer', async () => {
    const { port, calls } = scripted([{ quote: 'nope' }, { quote: 'good' }]);
    await expect(callModel(port, call, verify)).resolves.toBe('good');
    const prompts = calls.map((c) => c.prompt);
    expect(calls[1]?.attempt).toBe(2);
    expect(prompts[1]).toContain('# Correction');
    expect(prompts[1]).toContain('bad quote');
    expect(prompts[1]?.startsWith('base prompt\n# Correction\n')).toBe(true);
  });

  it('quotes schema errors too', async () => {
    const { port, calls } = scripted([{}, { quote: 'good' }]);
    await expect(callModel(port, call, verify)).resolves.toBe('good');
    expect(calls[1]?.prompt).toContain('quote');
  });

  it('two invalid answers fail with invalid_output', async () => {
    const { port } = scripted([{ quote: 'a' }, { quote: 'b' }]);
    const err = await callModel(port, call, verify).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewUnavailableError);
    expect(err).toMatchObject({ reason: 'invalid_output' });
  });

  it('two provider errors fail with model_error', async () => {
    const { port, calls } = scripted([new Error('500'), new Error('timeout')]);
    await expect(callModel(port, call, verify)).rejects.toMatchObject({ reason: 'model_error' });
    expect(calls.map((c) => c.prompt)).toEqual(['base prompt', 'base prompt']);
  });

  it('a provider error then a valid answer succeeds', async () => {
    const { port } = scripted([new Error('overloaded'), { quote: 'good' }]);
    await expect(callModel(port, call, verify)).resolves.toBe('good');
  });

  it('a replay miss fails with no_recording and does not retry', async () => {
    const { port, calls } = scripted([new NoRecordingError('none'), { quote: 'good' }]);
    await expect(callModel(port, call, verify)).rejects.toMatchObject({ reason: 'no_recording' });
    expect(calls).toHaveLength(1);
  });
});

describe('record and replay', () => {
  it('the recording port stores each attempt and replay returns them', async () => {
    const store = createMemoryRecordingStore();
    const { port: inner } = scripted([{ quote: 'nope' }, { quote: 'good' }]);
    const recording = createRecordingModelPort(inner, store);
    expect(recording.recorded).toBe(false);
    await expect(callModel(recording, call, verify)).resolves.toBe('good');
    expect(await store.get('intent', 'k1', 1)).toEqual({ quote: 'nope' });
    expect(await store.get('intent', 'k1', 2)).toEqual({ quote: 'good' });

    const replay = createReplayModelPort(store);
    expect(replay).toMatchObject({ modelName: 'replay', recorded: true });
    await expect(callModel(replay, call, verify)).resolves.toBe('good');
    await expect(callModel(replay, { ...call, key: 'other' }, verify)).rejects.toMatchObject({
      reason: 'no_recording',
    });
  });
});
