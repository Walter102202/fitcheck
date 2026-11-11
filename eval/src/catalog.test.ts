import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCatalog, CATALOG_QUERIES, FIXTURES_DIR } from './catalog.js';

const IDS = [
  'JsWPLPk',
  '0gH7IUm',
  'NF7jfuZ',
  '1U7pIWX',
  'giXSDZ7',
  'oQY2CWr',
  'NgltcGJ',
  'YQfWgKT',
  'ENqcYcj',
  '7ZfAuSE',
];

function probeDir(ids: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'probe-'));
  mkdirSync(join(dir, 'medicion'));
  const file = {
    result: { structuredContent: { products: ids.map((id) => ({ id, title: 'x' })) } },
  };
  writeFileSync(join(dir, 'medicion', 'search-tv-65.json'), JSON.stringify(file));
  return dir;
}

const oneQuery = CATALOG_QUERIES.filter((q) => q.probeFile === 'medicion/search-tv-65.json');

describe('CATALOG_QUERIES', () => {
  it('are the nine fixed queries of the 2026-11-10 probe', () => {
    expect(CATALOG_QUERIES).toHaveLength(9);
    expect(CATALOG_QUERIES.filter((q) => q.category === 'tv')).toHaveLength(6);
    expect(oneQuery).toHaveLength(1);
  });
});

describe('buildCatalog', () => {
  it('keeps exactly the first 8 ids of each query in order', () => {
    const catalog = buildCatalog(probeDir(IDS), FIXTURES_DIR, oneQuery);
    expect(catalog.recordedOn).toBe('2026-11-10');
    expect(catalog.queries[0]?.productIds).toEqual(IDS.slice(0, 8));
    expect(catalog.products.map((p) => p.id)).toEqual(IDS.slice(0, 8));
    expect(catalog.products[1]).toEqual({
      id: '0gH7IUm',
      category: 'tv',
      title: 'Panasonic 65" W80C 4K UHD QLED+ Fire TV (2026)',
    });
  });

  it('fails when a catalog id has no recorded fixture', () => {
    expect(() => buildCatalog(probeDir(['nope123', ...IDS]), FIXTURES_DIR, oneQuery)).toThrow(
      /nope123/,
    );
  });
});
