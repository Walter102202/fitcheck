import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRecordedProduct } from './fixtures.js';
import {
  type Channel3Options,
  Channel3SearchLimitError,
  Channel3UnavailableError,
  createChannel3Gateway,
  fallbackNotice,
} from './gateway.js';

const NOW = '2026-11-11T12:00:00.000Z';

function clock(start = NOW) {
  let t = new Date(start);
  return {
    now: () => t,
    set: (iso: string) => {
      t = new Date(iso);
    },
  };
}

function product(id: string) {
  const r = readRecordedProduct(id);
  if (!r) throw new Error(`missing fixture ${id}`);
  return r.product;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const okFetch = (async () => json(200, product('UXXAg59'))) as typeof fetch;

function failingFetch(kind: string): typeof fetch {
  return ((_input: string | URL | Request, init?: RequestInit) => {
    switch (kind) {
      case 'network':
        return Promise.reject(new TypeError('fetch failed'));
      case '503':
        return Promise.resolve(json(503, { error: 'unavailable' }));
      case '404':
        return Promise.resolve(json(404, { error: 'not found' }));
      case 'shape':
        return Promise.resolve(json(200, { id: 'UXXAg59', title: 'no offers' }));
      default:
        // timeout: never answers until the abort signal fires
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
    }
  }) as typeof fetch;
}

const c = clock();
const recorded = createChannel3Gateway(
  { CHANNEL3_MODE: 'recorded', CHANNEL3_DAILY_SEARCH_LIMIT: 2000 },
  { now: c.now },
);

function live(f: typeof fetch, extra: Partial<Channel3Options> = {}) {
  return createChannel3Gateway(
    { CHANNEL3_MODE: 'live', CHANNEL3_API_KEY: 'k', CHANNEL3_DAILY_SEARCH_LIMIT: 2000 },
    { fetch: f, now: clock().now, ...extra },
  );
}

describe('createChannel3Gateway', () => {
  it('recorded mode returns the fixture with source recorded', async () => {
    const r = await recorded.getProduct('cv7t721');
    expect(r).toMatchObject({ source: 'recorded', recordedOn: '2026-11-10' });
    expect(r.product.title).toBe('Hair Dryer');
    expect(recorded.noticeFor(r)).toBeNull();
    expect(recorded.mode).toBe('recorded');
  });

  it('recorded mode throws Channel3UnavailableError for an unknown id', async () => {
    await expect(recorded.getProduct('nope404')).rejects.toBeInstanceOf(Channel3UnavailableError);
    await expect(recorded.getProduct('../index')).rejects.toMatchObject({
      productId: '../index',
    });
  });

  it('live mode returns source live with fetchedAt from now', async () => {
    const g = live(okFetch);
    const r = await g.getProduct('UXXAg59');
    expect(r).toMatchObject({ source: 'live', fetchedAt: NOW });
    expect(r).not.toHaveProperty('recordedOn');
    expect(r.product.id).toBe('UXXAg59');
    expect(g.noticeFor(r)).toBeNull();
  });

  it.each(['network', '503', '404', 'shape', 'timeout'])(
    'live failure (%s) falls back to the recording with the notice',
    async (kind) => {
      const g = live(failingFetch(kind), { timeoutMs: 10 });
      const r = await g.getProduct('UXXAg59');
      expect(r.source).toBe('recorded');
      expect(g.noticeFor(r)).toBe(
        'Channel3 did not answer. Showing the copy recorded on Nov 10, 2026.',
      );
    },
  );

  it('live failure with no recording throws Channel3UnavailableError', async () => {
    const g = live(failingFetch('503'), {
      fixturesDir: mkdtempSync(join(tmpdir(), 'c3-empty-')),
    });
    await expect(g.getProduct('UXXAg59')).rejects.toBeInstanceOf(Channel3UnavailableError);
  });

  it('live mode without a key throws at construction', () => {
    expect(() =>
      createChannel3Gateway({ CHANNEL3_MODE: 'live', CHANNEL3_DAILY_SEARCH_LIMIT: 2000 }),
    ).toThrow('CHANNEL3_API_KEY is required when CHANNEL3_MODE is live');
  });

  it('search counts against the daily cap and resets the next UTC day', async () => {
    const t = clock();
    let fetchCalls = 0;
    const f = (async () => {
      fetchCalls += 1;
      return json(200, { products: [product('UXXAg59')] });
    }) as typeof fetch;
    const g = createChannel3Gateway(
      { CHANNEL3_MODE: 'live', CHANNEL3_API_KEY: 'k', CHANNEL3_DAILY_SEARCH_LIMIT: 2 },
      { fetch: f, now: t.now },
    );
    await g.search('tv');
    await g.search('tv');
    await expect(g.search('tv')).rejects.toBeInstanceOf(Channel3SearchLimitError);
    expect(fetchCalls).toBe(2);
    t.set('2026-11-12T00:00:01.000Z');
    const res = await g.search('tv');
    expect(res).toMatchObject({ source: 'live' });
    expect(res.records[0]).toMatchObject({ source: 'live', fetchedAt: '2026-11-12T00:00:01.000Z' });
  });

  it('live search reads a bare array and fails without a recorded fallback', async () => {
    const arr = live((async () => json(200, [product('cv7t721')])) as typeof fetch);
    expect((await arr.search('dryer')).records.map((r) => r.product.id)).toEqual(['cv7t721']);
    const bad = live(failingFetch('503'));
    await expect(bad.search('dryer')).rejects.toBeInstanceOf(Channel3UnavailableError);
  });

  it('recorded search matches every query word in fixture titles', async () => {
    // 15 recorded titles match; the default limit keeps the first 10 by id
    expect((await recorded.search('travel hair dryer')).records).toHaveLength(10);
    const res = await recorded.search('travel hair dryer', { limit: 20 });
    expect(res.source).toBe('recorded');
    expect(res.records.map((r) => r.product.id)).toContain('saZdY6C');
    expect(res.records.every((r) => /travel/i.test(r.product.title))).toBe(true);
    const ids = res.records.map((r) => r.product.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('fallbackNotice formats the recorded date', () => {
    expect(fallbackNotice('2026-11-10')).toBe(
      'Channel3 did not answer. Showing the copy recorded on Nov 10, 2026.',
    );
  });
});
