// One-off: turns the 2026-11-10 Channel3 probe files (local, git-ignored) into
// recorded ProductRecord fixtures. TVs and hair dryers only.
// Usage: node scripts/import-probe.mjs [probeDir]
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const probeDir = process.argv[2] ?? join(root, 'docs/hackathon/channel3_probe');
const outDir = join(root, 'fixtures/channel3');
const RECORDED_ON = '2026-11-10';
const CATEGORIES = { televisions: 'tv', 'hair-dryers': 'hair_dryer' };

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /^(c3-)?detail-.*\.json$/.test(entry.name) ? [path] : [];
  });
}

// Deterministic order: shortest relative path first, then alphabetical. The first
// record seen for an id wins.
const files = walk(probeDir).sort((a, b) => {
  const ra = relative(probeDir, a);
  const rb = relative(probeDir, b);
  return ra.split(/[\\/]/).length - rb.split(/[\\/]/).length || ra.localeCompare(rb);
});

const records = new Map();
for (const file of files) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const products = json?.result?.structuredContent?.products ?? [];
  const fetchedAt = statSync(file).mtime.toISOString();
  for (const product of products) {
    const category = CATEGORIES[product?.category?.slug];
    if (!category || records.has(product.id)) continue;
    records.set(product.id, {
      category,
      record: { product, fetchedAt, source: 'recorded', recordedOn: RECORDED_ON },
    });
  }
}

mkdirSync(outDir, { recursive: true });
const index = [];
for (const [id, { category, record }] of [...records].sort(([a], [b]) => a.localeCompare(b))) {
  writeFileSync(join(outDir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  index.push({ id, title: record.product.title, category, recordedOn: RECORDED_ON });
}
writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

const counts = {};
for (const row of index) counts[row.category] = (counts[row.category] ?? 0) + 1;
console.log(`files=${files.length} products=${index.length}`, counts);
