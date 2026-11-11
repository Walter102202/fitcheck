import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  callModel,
  type ModelCall,
  type ModelPort,
  NoRecordingError,
  ReviewUnavailableError,
} from '../../apps/backend/src/review/index.js';
import { recordingPort, replayPort } from './model.js';

const schema = z.object({ answer: z.string() });
const call = (key: string): Omit<ModelCall, 'attempt'> => ({
  kind: 'intent',
  key,
  system: 's',
  prompt: 'p',
  schema,
  input: { request: 'r' },
});
const accept = (parsed: unknown) => ({ ok: true as const, value: parsed });

/** A live model that fails the first `failures` calls, then answers. */
function flaky(failures: number): ModelPort & { calls: number } {
  return {
    modelName: 'claude-sonnet-5-5',
    recorded: false,
    calls: 0,
    async complete() {
      this.calls += 1;
      if (this.calls <= failures) throw new Error('overloaded_error (529)');
      return { answer: 'yes' };
    },
  };
}

describe('eval model record and replay', () => {
  it('replays a live run whose first attempt hit a provider error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const live = flaky(1);
    const recorded = await callModel(recordingPort(live, dir), call('k1'), accept);
    expect(recorded).toEqual({ answer: 'yes' });
    expect(live.calls).toBe(2);
    const replayed = await callModel(replayPort(dir), call('k1'), accept);
    expect(replayed).toEqual({ answer: 'yes' });
  });

  it('replays a live model_error as the same model_error, not a missed recording', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const live = await callModel(recordingPort(flaky(2), dir), call('k2'), accept).catch(
      (e: unknown) => e,
    );
    expect(live).toBeInstanceOf(ReviewUnavailableError);
    expect((live as ReviewUnavailableError).reason).toBe('model_error');
    const replayed = await callModel(replayPort(dir), call('k2'), accept).catch((e: unknown) => e);
    expect((replayed as ReviewUnavailableError).reason).toBe('model_error');
  });

  it('a call never recorded still fails as no_recording', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    await expect(replayPort(dir).complete({ ...call('k3'), attempt: 1 })).rejects.toBeInstanceOf(
      NoRecordingError,
    );
    const replayed = await callModel(replayPort(dir), call('k3'), accept).catch((e: unknown) => e);
    expect((replayed as ReviewUnavailableError).reason).toBe('no_recording');
  });

  it('keeps the live model name and marks replay as recorded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    expect(recordingPort(flaky(0), dir)).toMatchObject({
      modelName: 'claude-sonnet-5-5',
      recorded: false,
    });
    expect(replayPort(dir)).toMatchObject({ modelName: 'replay', recorded: true });
  });
});
