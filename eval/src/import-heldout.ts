import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { type CaseContext, type EvalCase, EvalCaseSchema, validateCase } from './case-schema.js';
import { caseContext, EVAL_DIR } from './catalog.js';
import { quotaKey, validateCaseSet } from './quotas.js';
import { HELDOUT_FILE } from './review-table.js';

export const KIT_DIR = 'C:\\dev\\fitcheck-heldout-kit';
export const TUNING_FILE = join(EVAL_DIR, 'cases', 'tuning.json');

/**
 * Validates the held-out cases and reports only counts per category and class, and
 * `<case id>: <rule>` lines. Held-out isolation: nothing from a case's content is printed,
 * so the Lane C session can run this without reading the cases.
 */
export function heldoutReport(
  raw: unknown,
  tuning: EvalCase[],
  ctx: CaseContext,
): { ok: boolean; lines: string[] } {
  const errors: string[] = [];
  const cases: EvalCase[] = [];
  const items = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) errors.push('file: the top level must be a JSON array of cases');
  items.forEach((item, index) => {
    const id =
      typeof item === 'object' && item !== null && typeof item.id === 'string'
        ? item.id
        : `#${index + 1}`;
    const parsed = EvalCaseSchema.safeParse(item);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${id}: schema: ${issue.path.join('.') || '(case)'} ${issue.code}`);
      }
      return;
    }
    cases.push(parsed.data);
    for (const rule of validateCase(parsed.data, ctx)) errors.push(`${id}: ${rule}`);
  });
  errors.push(...validateCaseSet(cases, 'heldout', tuning));

  const counts = new Map<string, number>();
  for (const c of cases) {
    const key = `${c.category} ${quotaKey(c)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines = [
    `${items.length} cases read, ${cases.length} parsed.`,
    ...[...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k}: ${n}`),
    ...(errors.length === 0 ? ['No errors.'] : [`${errors.length} errors:`, ...errors]),
  ];
  return { ok: errors.length === 0, lines };
}

// pnpm --filter @fitcheck/eval import-heldout            copies the kit's heldout.json in, then checks it
// ... import-heldout --check <path to heldout.json>        checks a file in place, copies nothing
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--check');
  let file = HELDOUT_FILE;
  if (at >= 0) {
    const target = process.argv[at + 1];
    if (!target) {
      console.error('Usage: import-heldout [--check <heldout.json>]');
      process.exit(2);
    }
    file = target;
  } else {
    copyFileSync(join(KIT_DIR, 'heldout.json'), HELDOUT_FILE);
  }
  const tuning = z.array(EvalCaseSchema).parse(JSON.parse(readFileSync(TUNING_FILE, 'utf8')));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    console.log('file: not readable as JSON');
    process.exit(1);
  }
  const report = heldoutReport(raw, tuning, caseContext());
  for (const line of report.lines) console.log(line);
  process.exit(report.ok ? 0 : 1);
}
