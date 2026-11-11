import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChecklist } from '@fitcheck/checklists';
import { type Category, type ProductRecord, ProductRecordSchema } from '@fitcheck/contracts';
import type { CaseContext } from './case-schema.js';

export const EVAL_DIR = fileURLToPath(new URL('../', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURES_DIR = join(REPO_ROOT, 'fixtures', 'channel3');
export const CATALOG_FILE = join(EVAL_DIR, 'catalog', 'catalog.json');

export type CatalogQuery = {
  category: Category;
  query: string;
  tool: 'search_products' | 'browse_products';
  probeFile: string;
};

export type Catalog = {
  recordedOn: '2026-11-10';
  queries: (CatalogQuery & { productIds: string[] })[];
  products: { id: string; category: Category; title: string }[];
};

/** The fixed queries the 2026-11-10 probe ran (medicion.md §4, rule against cherry-picking). */
export const CATALOG_QUERIES: CatalogQuery[] = [
  {
    category: 'tv',
    query: '65 inch 4K TV',
    tool: 'search_products',
    probeFile: 'medicion/search-tv-65.json',
  },
  {
    category: 'tv',
    query: '55 inch OLED TV',
    tool: 'search_products',
    probeFile: 'medicion/search-tv-55-oled.json',
  },
  {
    category: 'tv',
    query: '75 inch TV for a bright living room',
    tool: 'search_products',
    probeFile: 'medicion/search-tv-75.json',
  },
  {
    category: 'tv',
    query: '43 inch smart TV for a bedroom',
    tool: 'search_products',
    probeFile: 'medicion/search-tv-43.json',
  },
  {
    category: 'tv',
    query: '65 inch 4K TV',
    tool: 'browse_products',
    probeFile: 'requisitos/browse-tv-0.json',
  },
  {
    category: 'tv',
    query: '55 inch smart TV Dolby Vision',
    tool: 'browse_products',
    probeFile: 'requisitos/browse-tv-1.json',
  },
  {
    category: 'hair_dryer',
    query: 'hair dryer',
    tool: 'browse_products',
    probeFile: 'requisitos/browse-hairdryer-0.json',
  },
  {
    category: 'hair_dryer',
    query: 'travel hair dryer dual voltage',
    tool: 'browse_products',
    probeFile: 'requisitos/browse-hairdryer2-0.json',
  },
  {
    category: 'hair_dryer',
    query: 'hair dryer with diffuser for curly hair',
    tool: 'browse_products',
    probeFile: 'requisitos/browse-hairdryer2-1.json',
  },
];

const PER_QUERY = 8;

export function loadRecord(id: string, fixturesDir: string = FIXTURES_DIR): ProductRecord {
  return ProductRecordSchema.parse(
    JSON.parse(readFileSync(join(fixturesDir, `${id}.json`), 'utf8')),
  );
}

/**
 * Keeps the first 8 results of each query, in order, and all of them. Every kept id must
 * have a recorded fixture, or the catalog cannot be built.
 */
export function buildCatalog(
  probeDir: string,
  fixturesDir: string,
  queries: CatalogQuery[] = CATALOG_QUERIES,
): Catalog {
  const products = new Map<string, Catalog['products'][number]>();
  const built = queries.map((q) => {
    const probe = JSON.parse(readFileSync(join(probeDir, q.probeFile), 'utf8')) as {
      result: { structuredContent: { products: { id: string }[] } };
    };
    const productIds = probe.result.structuredContent.products.slice(0, PER_QUERY).map((p) => p.id);
    for (const id of productIds) {
      if (!existsSync(join(fixturesDir, `${id}.json`))) {
        throw new Error(`Catalog id ${id} (${q.probeFile}) has no recorded fixture`);
      }
      if (!products.has(id)) {
        products.set(id, {
          id,
          category: q.category,
          title: loadRecord(id, fixturesDir).product.title,
        });
      }
    }
    return { ...q, productIds };
  });
  return { recordedOn: '2026-11-10', queries: built, products: [...products.values()] };
}

export function loadCatalog(file: string = CATALOG_FILE): Catalog {
  return JSON.parse(readFileSync(file, 'utf8')) as Catalog;
}

/** Every requirement id of the three lists. */
export function requirementIds(): Set<string> {
  return new Set(
    (['common', 'tv', 'hair_dryer'] as const).flatMap((name) =>
      loadChecklist(name).requirements.map((r) => r.id),
    ),
  );
}

export function caseContext(catalog: Catalog = loadCatalog()): CaseContext {
  return {
    catalogIds: new Set(catalog.products.map((p) => p.id)),
    requirementIds: requirementIds(),
    record: (id) => loadRecord(id),
  };
}
