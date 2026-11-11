import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadChecklist } from '@fitcheck/checklists';
import type { Intent, ProductRecord, ReviewInput, ReviewResult } from '@fitcheck/contracts';
import { loadEnv } from '../../apps/backend/src/env.js';
import { HARNESS_NOW } from '../../apps/backend/src/runs/harness.js';
import { createPorts } from '../../apps/backend/src/runs/ports.js';
import { toOfferCents } from './case-schema.js';
import { type Catalog, EVAL_DIR, loadCatalog } from './catalog.js';

/** The triggered requirements the sweep checks, each with the request cue that switches it on. */
export const SWEEP_CUES = {
  'tv.wall_mount': 'It goes on the wall.',
  'tv.fits_space': 'It replaces our old TV in the same spot.',
  'hair_dryer.dual_voltage': 'For a trip to Spain.',
  'hair_dryer.diffuser': 'For my curly hair.',
} as const;
type SweptRequirement = keyof typeof SWEEP_CUES;

export type SweepRow = {
  requirement: SweptRequirement;
  name: string;
  records: number;
  missing: number;
  disagrees: number;
};
export type SweepResult = { records: number; rows: SweepRow[] };

type SweepDeps = {
  review: { review(input: ReviewInput): Promise<ReviewResult> };
  channel3: { getProduct(id: string): Promise<ProductRecord> };
};

const categoryOf = (requirement: SweptRequirement) =>
  requirement.startsWith('tv.') ? ('tv' as const) : ('hair_dryer' as const);

/**
 * How often the recorded data alone forces a question: every catalog product reviewed once per
 * swept requirement of its category, with a synthetic intent (no model call). `unbacked` counts
 * as Missing and `contradictory` as Disagrees.
 */
export async function sweep(deps: SweepDeps, catalog: Catalog): Promise<SweepResult> {
  const rows: SweepRow[] = [];
  for (const requirement of Object.keys(SWEEP_CUES) as SweptRequirement[]) {
    const category = categoryOf(requirement);
    const cue = SWEEP_CUES[requirement];
    const name =
      loadChecklist(category).requirements.find((r) => r.id === requirement)?.name ?? requirement;
    const row: SweepRow = { requirement, name, records: 0, missing: 0, disagrees: 0 };
    for (const product of catalog.products.filter((p) => p.category === category)) {
      const record = await deps.channel3.getProduct(product.id);
      const offer = record.product.offers[0];
      if (!offer) continue;
      const price = toOfferCents(offer.price.price);
      const intent: Intent = {
        category,
        request: cue,
        quantity: 1,
        acceptUsed: false,
        stated: {},
        triggered: { [requirement]: { quote: cue } },
        notChecked: [],
        source: 'recorded',
      };
      const result = await deps.review.review({
        intent,
        record,
        purchase: {
          purchaseId: `sweep:${product.id}:${requirement}`,
          taskId: 'sweep',
          productId: product.id,
          domain: offer.domain,
          quantity: 1,
          priceSeenCents: price,
          amountCents: price,
        },
        memory: {},
        capturedProductIds: [],
      });
      const state = result.results.find((r) => r.requirement === requirement)?.state;
      row.records += 1;
      if (state === 'unbacked') row.missing += 1;
      if (state === 'contradictory') row.disagrees += 1;
    }
    rows.push(row);
  }
  return { records: catalog.products.length, rows };
}

/** The medicion.md §6 third table. */
export function sweepMarkdown(r: SweepResult): string {
  return [
    '### How often the data alone forces a question',
    '',
    `Across ${r.records} recorded product records, share where a field is missing or disagrees with itself.`,
    '',
    '| Requirement | Records | Missing | Disagrees |',
    '|---|---|---|---|',
    ...r.rows.map((row) => `| ${row.name} | ${row.records} | ${row.missing} | ${row.disagrees} |`),
    '',
  ].join('\n');
}

/** `pnpm --filter @fitcheck/eval sweep`: eval/results/sweep.json and sweep.md. */
async function main(): Promise<void> {
  const env = loadEnv({ CHANNEL3_MODE: 'recorded', LLM_PROVIDER: 'mock' });
  const ports = createPorts(env, { now: () => HARNESS_NOW, citations: false });
  const result = await sweep(ports, loadCatalog());
  const dir = join(EVAL_DIR, 'results');
  writeFileSync(join(dir, 'sweep.json'), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(dir, 'sweep.md'), sweepMarkdown(result));
  for (const row of result.rows) {
    console.log(
      `${row.requirement}: ${row.records} records, ${row.missing} missing, ${row.disagrees} disagree`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
