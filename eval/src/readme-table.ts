import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ResultsJsonSchema } from '@fitcheck/contracts';
import { EVAL_DIR } from './catalog.js';
import { readmeTable } from './results.js';

/**
 * Prints the README "Does it work?" block for what GET /api/results serves (latest.json, else
 * expected.json), to paste between `<!-- results:start -->` and `<!-- results:end -->`.
 * `pnpm --filter @fitcheck/eval readme-table`
 */
const dir = join(EVAL_DIR, 'results');
const latest = join(dir, 'latest.json');
const file = existsSync(latest) ? latest : join(dir, 'expected.json');
process.stdout.write(readmeTable(ResultsJsonSchema.parse(JSON.parse(readFileSync(file, 'utf8')))));
