import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { EvalCaseSchema } from './case-schema.js';
import { CATALOG_FILE, EVAL_DIR, FIXTURES_DIR, loadCatalog, REPO_ROOT } from './catalog.js';
import { KIT_DIR, TUNING_FILE } from './import-heldout.js';

// pnpm --filter @fitcheck/eval writer-kit [--out <dir>]
// Builds the held-out writer's only inputs. It never removes anything: a heldout.json the
// writer already wrote stays in place.
const at = process.argv.indexOf('--out');
const out = (at >= 0 ? process.argv[at + 1] : undefined) ?? KIT_DIR;

mkdirSync(join(out, 'checklists'), { recursive: true });
mkdirSync(join(out, 'fixtures'), { recursive: true });
copyFileSync(join(EVAL_DIR, 'briefs', 'heldout-writer.md'), join(out, 'heldout-writer.md'));
copyFileSync(join(EVAL_DIR, 'src', 'case-schema.ts'), join(out, 'case-schema.ts'));
copyFileSync(join(EVAL_DIR, 'src', 'quotas.ts'), join(out, 'quotas.ts'));
for (const name of ['common', 'tv', 'hair_dryer']) {
  copyFileSync(
    join(REPO_ROOT, 'packages', 'checklists', `${name}.json`),
    join(out, 'checklists', `${name}.json`),
  );
}
copyFileSync(CATALOG_FILE, join(out, 'catalog.json'));
const catalog = loadCatalog();
for (const { id } of catalog.products) {
  copyFileSync(join(FIXTURES_DIR, `${id}.json`), join(out, 'fixtures', `${id}.json`));
}
const tuning = z.array(EvalCaseSchema).parse(JSON.parse(readFileSync(TUNING_FILE, 'utf8')));
const exclusions = {
  families: [...new Set(tuning.map((c) => c.family))].sort(),
  productIds: [...new Set(tuning.map((c) => c.attempt.product_id))].sort(),
};
writeFileSync(join(out, 'tuning-exclusions.json'), `${JSON.stringify(exclusions, null, 2)}\n`);
console.log(
  `writer kit at ${out}: brief, case-schema.ts, quotas.ts, 3 checklists, catalog.json, ${catalog.products.length} fixtures, tuning-exclusions.json (${exclusions.families.length} families, ${exclusions.productIds.length} product ids)`,
);
