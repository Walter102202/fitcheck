import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ModelCallKind, type ModelPort, NoRecordingError } from './port.js';

export interface RecordingStore {
  get(kind: ModelCallKind, key: string, attempt: 1 | 2): Promise<unknown | undefined>;
  put(
    kind: ModelCallKind,
    key: string,
    attempt: 1 | 2,
    e: { input: Record<string, unknown>; output: unknown; model: string },
  ): Promise<void>;
}

type RecordingFile = {
  kind: ModelCallKind;
  key: string;
  input: Record<string, unknown>;
  model: string;
  recordedAt: string;
  attempts: { '1'?: unknown; '2'?: unknown };
};

function findPackageRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** <backend package root>/src/review/recordings. */
export const DEFAULT_RECORDINGS_DIR = join(
  findPackageRoot(dirname(fileURLToPath(import.meta.url))),
  'src',
  'review',
  'recordings',
);

const SAFE_KEY = /^[A-Za-z0-9_-]+$/;

/** <dir>/<kind>/<key>.json = { kind, key, input, model, recordedAt, attempts: { "1", "2"? } }. */
export function createFileRecordingStore(dir: string): RecordingStore {
  const fileOf = (kind: ModelCallKind, key: string) => {
    if (!SAFE_KEY.test(key)) throw new Error(`Bad recording key: ${key}`);
    return join(dir, kind, `${key}.json`);
  };
  const read = async (file: string): Promise<RecordingFile | null> =>
    existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as RecordingFile) : null;

  return {
    async get(kind, key, attempt) {
      const rec = await read(fileOf(kind, key));
      return rec?.attempts[String(attempt) as '1' | '2'];
    },
    async put(kind, key, attempt, e) {
      const file = fileOf(kind, key);
      const previous = attempt === 2 ? await read(file) : null;
      const rec: RecordingFile = {
        kind,
        key,
        input: e.input,
        model: e.model,
        recordedAt: new Date().toISOString(),
        attempts: { ...(previous?.attempts ?? {}), [String(attempt)]: e.output },
      };
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(rec, null, 2)}\n`);
    },
  };
}

export function createMemoryRecordingStore(): RecordingStore {
  const map = new Map<string, unknown>();
  return {
    async get(kind, key, attempt) {
      return map.get(`${kind}/${key}/${attempt}`);
    },
    async put(kind, key, attempt, e) {
      if (attempt === 1) map.delete(`${kind}/${key}/2`);
      map.set(`${kind}/${key}/${attempt}`, e.output);
    },
  };
}

/** Answers from the store; a miss is NoRecordingError. */
export function createReplayModelPort(store: RecordingStore): ModelPort {
  return {
    modelName: 'replay',
    recorded: true,
    async complete(call) {
      const out = await store.get(call.kind, call.key, call.attempt);
      if (out === undefined) {
        throw new NoRecordingError(
          `No recording for ${call.kind}/${call.key} attempt ${call.attempt}`,
        );
      }
      return out;
    },
  };
}

/** Calls `inner` and stores every answer (not errors). */
export function createRecordingModelPort(inner: ModelPort, store: RecordingStore): ModelPort {
  return {
    modelName: inner.modelName,
    recorded: false,
    async complete(call) {
      const output = await inner.complete(call);
      await store.put(call.kind, call.key, call.attempt, {
        input: call.input,
        output,
        model: inner.modelName,
      });
      return output;
    },
  };
}
