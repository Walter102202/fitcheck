import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EvalCaseSchema, validateCase } from './case-schema.js';
import { caseContext, EVAL_DIR } from './catalog.js';
import { validateCaseSet } from './quotas.js';

const tuning = z
  .array(EvalCaseSchema)
  .parse(JSON.parse(readFileSync(join(EVAL_DIR, 'cases', 'tuning.json'), 'utf8')));

describe('tuning.json', () => {
  const ctx = caseContext();

  it('has 16 cases, each valid', () => {
    expect(tuning).toHaveLength(16);
    for (const c of tuning)
      expect({ id: c.id, errors: validateCase(c, ctx) }).toEqual({ id: c.id, errors: [] });
  });

  it('meets the tuning quotas', () => {
    expect(validateCaseSet(tuning, 'tuning')).toEqual([]);
  });
});
