import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, ResultsJsonSchema } from '@fitcheck/contracts';
import { Hono } from 'hono';
import type { Deps } from '../../deps.js';
import type { ApiEnv } from '../session.js';

/** The repo's eval/results, the same five levels up from src/api/routes and dist/api/routes. */
const DEFAULT_RESULTS_DIR = fileURLToPath(new URL('../../../../../eval/results/', import.meta.url));

/**
 * The measured table: latest.json once the held-out run is committed, else expected.json (the
 * cap-only numbers the set is built to show). A file that does not parse is a 500.
 */
export function resultsRoutes(deps: Deps): Hono<ApiEnv> {
  const dir = deps.env.EVAL_RESULTS_DIR ?? DEFAULT_RESULTS_DIR;
  return new Hono<ApiEnv>().get(API.results, async (c) => {
    const latest = join(dir, 'latest.json');
    const file = existsSync(latest) ? latest : join(dir, 'expected.json');
    const parsed = ResultsJsonSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    return c.json(parsed);
  });
}
