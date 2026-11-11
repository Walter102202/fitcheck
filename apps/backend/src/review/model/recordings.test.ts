import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordingKey } from './port.js';
import { createFileRecordingStore, DEFAULT_RECORDINGS_DIR, recordedModel } from './recordings.js';

describe('recordedModel', () => {
  const put = (dir: string, kind: 'intent' | 'citation', key: string, model: string) =>
    createFileRecordingStore(dir).put(kind, key, 1, { input: {}, output: {}, model });

  it('names the model only when every recording came from that one model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    expect(recordedModel(dir)).toBeNull();
    await put(dir, 'intent', 'a', 'claude-sonnet-5-5');
    await put(dir, 'citation', 'b', 'claude-sonnet-5-5');
    expect(recordedModel(dir)).toBe('claude-sonnet-5-5');
    await put(dir, 'intent', 'c', 'hand');
    expect(recordedModel(dir)).toBeNull();
  });
});

describe('createFileRecordingStore', () => {
  it('writes <kind>/<key>.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const store = createFileRecordingStore(dir);
    await store.put('intent', 'abc', 1, { input: { request: 'r' }, output: { a: 1 }, model: 'm' });
    const file = join(dir, 'intent', 'abc.json');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(json).toMatchObject({
      kind: 'intent',
      key: 'abc',
      input: { request: 'r' },
      model: 'm',
      attempts: { '1': { a: 1 } },
    });
    expect(typeof json.recordedAt).toBe('string');
    await store.put('intent', 'abc', 2, { input: { request: 'r' }, output: { a: 2 }, model: 'm' });
    expect(await store.get('intent', 'abc', 2)).toEqual({ a: 2 });
    expect(await store.get('intent', 'abc', 1)).toEqual({ a: 1 });
    expect(await store.get('citation', 'abc', 1)).toBeUndefined();
  });

  it('a new first attempt replaces an old second one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const store = createFileRecordingStore(dir);
    const e = { input: {}, model: 'm' };
    await store.put('intent', 'k', 1, { ...e, output: 1 });
    await store.put('intent', 'k', 2, { ...e, output: 2 });
    await store.put('intent', 'k', 1, { ...e, output: 3 });
    expect(await store.get('intent', 'k', 1)).toBe(3);
    expect(await store.get('intent', 'k', 2)).toBeUndefined();
  });

  it('rejects keys that are not plain file names', async () => {
    const store = createFileRecordingStore(mkdtempSync(join(tmpdir(), 'rec-')));
    await expect(store.get('intent', '../x', 1)).rejects.toThrow();
  });
});

describe('recordingKey', () => {
  it('is stable and 16 hex characters', () => {
    const k = recordingKey(['tv', 'A 65-inch OLED TV']);
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(recordingKey(['tv', 'A 65-inch OLED TV'])).toBe(k);
    expect(recordingKey(['hair_dryer', 'A 65-inch OLED TV'])).not.toBe(k);
  });

  it('the default recordings dir is inside the backend source', () => {
    expect(DEFAULT_RECORDINGS_DIR.replaceAll('\\', '/')).toMatch(
      /apps\/backend\/src\/review\/recordings$/,
    );
    expect(existsSync(join(DEFAULT_RECORDINGS_DIR, '..', 'review.ts'))).toBe(true);
  });
});
