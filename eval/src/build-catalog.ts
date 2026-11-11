import { writeFileSync } from 'node:fs';
import { buildCatalog, CATALOG_FILE, FIXTURES_DIR } from './catalog.js';

// pnpm --filter @fitcheck/eval build-catalog --probe C:\dev\fitcheck\docs\hackathon\channel3_probe
// The probe folder is git-ignored, so its path is passed in.
const at = process.argv.indexOf('--probe');
const probeDir = at >= 0 ? process.argv[at + 1] : undefined;
if (!probeDir) {
  console.error('Usage: build-catalog --probe <channel3_probe dir>');
  process.exit(2);
}
const catalog = buildCatalog(probeDir, FIXTURES_DIR);
writeFileSync(CATALOG_FILE, `${JSON.stringify(catalog, null, 2)}\n`);
const byCategory = (category: string) =>
  catalog.products.filter((p) => p.category === category).length;
console.log(
  `catalog.json: ${catalog.queries.length} queries, ${catalog.products.length} products (tv ${byCategory('tv')}, hair_dryer ${byCategory('hair_dryer')}), recordedOn ${catalog.recordedOn}`,
);
