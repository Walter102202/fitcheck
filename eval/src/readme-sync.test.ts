import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ResultsJsonSchema } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import { EVAL_DIR, REPO_ROOT } from './catalog.js';
import { readmeTable } from './results.js';

const START = '<!-- results:start -->';
const END = '<!-- results:end -->';

/** What GET /api/results serves: latest.json once the held-out run exists, else expected.json. */
function served() {
  const dir = join(EVAL_DIR, 'results');
  const latest = join(dir, 'latest.json');
  const file = existsSync(latest) ? latest : join(dir, 'expected.json');
  return ResultsJsonSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

describe('readme-sync', () => {
  it('the README results block equals readmeTable of the served results', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    const start = readme.indexOf(START);
    const end = readme.indexOf(END);
    // Lane I owns README.md and adds the markers; until then there is nothing to keep in sync.
    if (start === -1 || end === -1) return;
    const block = readme
      .slice(start + START.length, end)
      .replaceAll('\r\n', '\n')
      .trim();
    expect(block).toBe(readmeTable(served()).trim());
  });
});
