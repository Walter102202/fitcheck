import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatUsd } from '@fitcheck/contracts';
import { z } from 'zod';
import { type EvalCase, EvalCaseSchema } from './case-schema.js';
import { EVAL_DIR, loadRecord } from './catalog.js';

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function hiddenFacts(c: EvalCase): string {
  const entries = Object.entries(c.dossier);
  if (entries.length === 0) return 'none';
  return entries
    .map(([key, { need, value }]) => (value ? `${key}: ${need} (${value})` : `${key}: ${need}`))
    .join('; ');
}

/** The label review table Walter reads: one row per case, sorted by id. */
export function renderReviewTable(
  cases: EvalCase[],
  titleOf: (productId: string) => string = (id) => loadRecord(id).product.title,
): string {
  const sorted = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    '# Held-out labels for review',
    '',
    `${sorted.length} cases. Labels are judged against the recorded Channel3 record, not the physical product.`,
    '',
    '| id | request | hidden buyer facts | product, store, amount | decisive field | class / failure | should end paid |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const c of sorted) {
    const { attempt, label } = c;
    const quantity = attempt.quantity === 1 ? '' : ` x ${attempt.quantity}`;
    const product = `${titleOf(attempt.product_id)} (${attempt.product_id}), ${attempt.store}, ${formatUsd(attempt.amount_cents)}${quantity}`;
    const cls = label.failure ? `${label.class} / ${label.failure}` : label.class;
    lines.push(
      `| ${[
        c.id,
        c.request,
        hiddenFacts(c),
        product,
        label.evidence,
        cls,
        label.should_end_paid ? 'yes' : 'no',
      ]
        .map(cell)
        .join(' | ')} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export const HELDOUT_FILE = join(EVAL_DIR, 'cases', 'heldout.json');
export const REVIEW_FILE = join(EVAL_DIR, 'cases', 'heldout-review.md');

// pnpm --filter @fitcheck/eval review-table: writes heldout-review.md and prints only the count.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cases = z.array(EvalCaseSchema).parse(JSON.parse(readFileSync(HELDOUT_FILE, 'utf8')));
  writeFileSync(REVIEW_FILE, renderReviewTable(cases));
  console.log(`heldout-review.md: ${cases.length} rows`);
}
