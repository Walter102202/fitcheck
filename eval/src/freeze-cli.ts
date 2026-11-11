import { join } from 'node:path';
import { EVAL_DIR } from './catalog.js';
import { writeFreeze } from './freeze.js';

/** `pnpm --filter @fitcheck/eval freeze`: freezes eval/cases/heldout.json and prints the sha. */
const casesDir = join(EVAL_DIR, 'cases');
const sha = writeFreeze(join(casesDir, 'heldout.json'), join(casesDir, 'heldout.sha256'));
console.log(sha);
