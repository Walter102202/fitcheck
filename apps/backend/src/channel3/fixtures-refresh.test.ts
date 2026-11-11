import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkShapes, refreshFixtures } from '../../scripts/fixtures-refresh.js';
import { FIXTURES_DIR, readRecordedProduct } from './fixtures.js';
import type { Channel3RestClient } from './rest.js';

const IDS = ['cv7t721', 'saZdY6C', 'UXXAg59'];
const now = new Date('2026-11-11T12:00:00.000Z');

type IndexEntry = { id: string; title: string; category: string; recordedOn: string };

function index(dir: string): IndexEntry[] {
  return JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as IndexEntry[];
}

function product(id: string) {
  const r = readRecordedProduct(id);
  if (!r) throw new Error(`missing fixture ${id}`);
  return r.product;
}

let tmp: string;
const client: Channel3RestClient = {
  async getProductRaw(id) {
    if (id === 'UXXAg59') throw new Error('Channel3 answered 503');
    return product(id);
  },
  async searchRaw() {
    throw new Error('not used');
  },
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'c3-refresh-'));
  for (const id of IDS) copyFileSync(join(FIXTURES_DIR, `${id}.json`), join(tmp, `${id}.json`));
  const all = JSON.parse(readFileSync(join(FIXTURES_DIR, 'index.json'), 'utf8')) as IndexEntry[];
  const entries = IDS.map((id) => all.find((e) => e.id === id));
  writeFileSync(join(tmp, 'index.json'), `${JSON.stringify(entries, null, 2)}\n`);
});

describe('refreshFixtures', () => {
  it("rewrites each listed product with today's date", async () => {
    const out = await refreshFixtures({ client, fixturesDir: tmp, now });
    expect(out.updated).toEqual(['cv7t721', 'saZdY6C']);
    const r = JSON.parse(readFileSync(join(tmp, 'cv7t721.json'), 'utf8'));
    expect(r).toMatchObject({
      source: 'recorded',
      recordedOn: '2026-11-11',
      fetchedAt: '2026-11-11T12:00:00.000Z',
    });
    expect(r.product.id).toBe('cv7t721');
    expect(index(tmp).find((e) => e.id === 'cv7t721')?.recordedOn).toBe('2026-11-11');
  });

  it('leaves a failing product untouched and reports it', async () => {
    const before = readFileSync(join(tmp, 'UXXAg59.json'));
    const out = await refreshFixtures({ client, fixturesDir: tmp, now });
    expect(out.failed.map((f) => f.id)).toEqual(['UXXAg59']);
    expect(out.failed[0]?.error).toContain('503');
    expect(readFileSync(join(tmp, 'UXXAg59.json')).equals(before)).toBe(true);
    expect(index(tmp).find((e) => e.id === 'UXXAg59')?.recordedOn).toBe('2026-11-10');
  });

  it('honours only', async () => {
    const out = await refreshFixtures({ client, fixturesDir: tmp, now, only: ['saZdY6C'] });
    expect(out).toEqual({ updated: ['saZdY6C'], failed: [] });
    expect(index(tmp).find((e) => e.id === 'cv7t721')?.recordedOn).toBe('2026-11-10');
  });

  it('never writes a live product under another id', async () => {
    const before = readFileSync(join(tmp, 'saZdY6C.json'));
    const swapped: Channel3RestClient = {
      ...client,
      getProductRaw: async () => product('cv7t721'),
    };
    const out = await refreshFixtures({
      client: swapped,
      fixturesDir: tmp,
      now,
      only: ['saZdY6C'],
    });
    expect(out.updated).toEqual([]);
    expect(out.failed[0]?.id).toBe('saZdY6C');
    expect(readFileSync(join(tmp, 'saZdY6C.json')).equals(before)).toBe(true);
  });
});

describe('checkShapes', () => {
  it('reports keys missing in live', async () => {
    const stripped: Channel3RestClient = {
      ...client,
      async getProductRaw(id) {
        const { key_features: _drop, ...rest } = product(id);
        return { ...rest, extra_field: 1 };
      },
    };
    const [d] = await checkShapes({ client: stripped, fixturesDir: tmp, ids: ['cv7t721'] });
    expect(d?.missingInLive).toContain('key_features');
    expect(d?.newInLive).toEqual(['extra_field']);
    expect(d?.parses).toBe(false);
  });

  it('an identical live shape parses with no differences and saves the raw answer', async () => {
    const raw = mkdtempSync(join(tmpdir(), 'c3-raw-'));
    const [d] = await checkShapes({ client, fixturesDir: tmp, ids: ['cv7t721'], saveRawDir: raw });
    expect(d).toEqual({ id: 'cv7t721', parses: true, missingInLive: [], newInLive: [] });
    expect(JSON.parse(readFileSync(join(raw, 'rest-cv7t721.json'), 'utf8')).id).toBe('cv7t721');
  });

  it('compares nested offer and price keys', async () => {
    const renamed: Channel3RestClient = {
      ...client,
      async getProductRaw(id) {
        const p = structuredClone(product(id)) as unknown as {
          offers: { price: Record<string, unknown> }[];
        };
        const first = p.offers[0];
        if (first) {
          first.price.amount = first.price.price;
          delete first.price.price;
        }
        return { product: p };
      },
    };
    const [d] = await checkShapes({ client: renamed, fixturesDir: tmp, ids: ['cv7t721'] });
    expect(d?.missingInLive).toEqual(['offers[0].price.price']);
    expect(d?.newInLive).toEqual(['offers[0].price.amount']);
    expect(d?.parses).toBe(false);
  });
});
