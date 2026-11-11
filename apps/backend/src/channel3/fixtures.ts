import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ProductRecord, ProductRecordSchema } from '@fitcheck/contracts';

function findRepoRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `<repo>/fixtures/channel3`, found by walking up to the directory holding pnpm-workspace.yaml. */
export const FIXTURES_DIR = join(
  findRepoRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd(),
  'fixtures',
  'channel3',
);

// Channel3 ids are short alphanumeric strings; anything else never touches the file system.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** The recorded copy of a product, or null when there is none. Throws on a corrupt file. */
export function readRecordedProduct(id: string, dir: string = FIXTURES_DIR): ProductRecord | null {
  if (!SAFE_ID.test(id) || id === 'index') return null;
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) return null;
  return ProductRecordSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

/** Every recorded product (`index.json` excluded), sorted by file name. */
export function listRecordedProducts(dir: string = FIXTURES_DIR): ProductRecord[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .sort()
    .map((f) => ProductRecordSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}
