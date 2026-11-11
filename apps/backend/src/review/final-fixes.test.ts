// Regression tests for the findings of the whole-branch review (2026-11-11) and the lead's
// rulings on them.
import type { Category, Intent, ProductRecord, ReviewInput, TaskMemory } from '@fitcheck/contracts';
import { describe, expect, it, vi } from 'vitest';
import { getChecklist } from './checklist.js';
import { evaluateCommon } from './common-checks.js';
import { appliesTo } from './evaluate.js';
import { collectCandidates } from './facts.js';
import { checksFor, FAIL_CLOSED_MESSAGE, review, verifyIntentDraft } from './index.js';
import { type Match, parseUsdCents, TEXT_NORMALIZERS } from './normalize.js';
import { contextFor, readPath } from './paths.js';
import { intentFor, purchaseFor, recordedProduct, withProduct } from './testing.js';

const deps = { now: () => new Date('2026-11-11T12:00:00.000Z') };
const tv = getChecklist('tv');
const dryer = getChecklist('hair_dryer');
const vals = (ms: Match[]) => ms.map((m) => m.value);

function normalizer(name: string, fact: (typeof tv.facts)[string] | undefined) {
  const make = TEXT_NORMALIZERS[name];
  if (!make || !fact) throw new Error(`missing ${name}`);
  return make(fact);
}
const inches = normalizer('inches', tv.facts.screenSizeIn);
const voltage = normalizer('voltage', dryer.facts.voltage);

function input(
  product: string | ProductRecord,
  domain: string,
  intent: Intent,
  o: { memory?: TaskMemory; purchase?: Partial<ReviewInput['purchase']> } = {},
): ReviewInput {
  const record = typeof product === 'string' ? recordedProduct(product) : product;
  return {
    intent,
    record,
    purchase: purchaseFor(record, domain, o.purchase ?? {}),
    memory: o.memory ?? {},
    capturedProductIds: [],
  };
}

function common(
  reqId: string,
  product: string | ProductRecord,
  domain: string,
  purchase: Partial<ReviewInput['purchase']> = {},
  parts: Parameters<typeof intentFor>[2] = {},
  category: Category = 'tv',
) {
  const record = typeof product === 'string' ? recordedProduct(product) : product;
  const checklist = getChecklist(category);
  const req = checklist.requirements.find((r) => r.id === reqId);
  if (!req) throw new Error(`no ${reqId}`);
  const i = input(record, domain, intentFor(category, 'request', parts), { purchase });
  return evaluateCommon(
    req,
    i,
    checklist,
    contextFor(record.product, domain, i.purchase.variantSelected),
  );
}

const unpinnedLg = () =>
  withProduct(recordedProduct('1U7pIWX'), (p) => {
    if (p.variants) p.variants.selected = [];
  });

const tvWall = intentFor('tv', 'Replace the TV on our living room wall with a 65-inch.', {
  stated: { 'tv.screen_size': { value: 65, quote: '65-inch' } },
  budgetCents: 160000,
  triggered: { 'tv.wall_mount': { quote: 'our living room wall' } },
});

describe('price change (lead ruling 1)', () => {
  it('amount_matches checks that the agent charges what it saw', () => {
    const e = common('common.amount_matches', 'UXXAg59', 'pcrichard.com', {
      priceSeenCents: 129800,
      amountCents: 129800,
    });
    expect(e?.result.state).toBe('backed');
    const off = common('common.amount_matches', 'UXXAg59', 'pcrichard.com', {
      priceSeenCents: 129800,
      amountCents: 139800,
    });
    expect(off?.returnReason).toBe(
      'The agent asked to charge $1,398.00; the offer price is $1,298.00.',
    );
  });

  it('a LURA price drift asks the price line, not a return', async () => {
    const r = await review(
      input('saZdY6C', 'walmart.com', intentFor('hair_dryer', 'A hair dryer.'), {
        purchase: { priceSeenCents: 1990, amountCents: 1990 },
      }),
      deps,
    );
    expect(r.decision).toBe('ask');
    expect(r.card).toEqual({
      title: 'Before we pay $20.20 for this hair dryer',
      lines: [
        {
          lineId: 'common.price_unchanged=2020',
          requirement: 'common.price_unchanged',
          type: 'payment',
          text: 'The price changed from $19.90 to $20.20 since the agent chose it. Is that OK?',
        },
      ],
    });
  });
});

describe('screen-size ranges (lead ruling 2)', () => {
  it('two sizes joined by a dash or "to" are a compatibility range', () => {
    expect(inches('Tilt Mount for 43"-98" TVs')).toEqual([]);
    expect(inches('fits 43 inch to 98 inch TVs')).toEqual([]);
    expect(inches('For 32 to 70 inch TVs')).toEqual([]);
    expect(vals(inches('65 inch - 2024 model'))).toEqual([65]);
  });
});

describe('a stated width next to a wall cue', () => {
  const both = intentFor('tv', 'For the wall; the spot is 50 inches.', {
    stated: { 'tv.fits_space': { value: 50, quote: '50 inches' } },
    triggered: { 'tv.wall_mount': { quote: 'wall' } },
    budgetCents: 500000,
  });

  it('a stated fits_space applies even when the wall mount applies', () => {
    const fits = tv.requirements.find((r) => r.id === 'tv.fits_space');
    if (!fits) throw new Error('no fits_space');
    expect(appliesTo(fits, both, null)).toEqual({
      applies: true,
      origin: 'stated',
      originQuote: '50 inches',
    });
    expect(checksFor(both).map((c) => c.requirement)).toContain('tv.fits_space');
  });

  it('a TV wider than the stated spot goes back without a question', async () => {
    const r = await review(input('giXv9lz', 'rcwilley.com', both), deps);
    expect(r.decision).toBe('return_to_agent');
    expect(r.agentMessage).toBe('Not paid. This TV is 56.9 inches wide; the spot is 50 inches.');
  });

  it('the intent keeps a stated width next to a triggered wall mount', () => {
    const request = 'Hang it on the wall above a 50 inch shelf, a 65-inch TV.';
    const v = verifyIntentDraft(
      {
        budget: null,
        quantity: null,
        acceptUsed: null,
        stores: [],
        stated: [
          { requirement: 'tv.fits_space', quote: '50 inch' },
          { requirement: 'tv.screen_size', quote: '65-inch' },
        ],
        triggered: [{ requirement: 'tv.wall_mount', quote: 'wall' }],
        unsupported: [],
      },
      request,
      'tv',
    );
    expect(v.ok && v.value.stated['tv.fits_space']?.value).toBe(50);
    expect(v.ok && v.value.triggered['tv.wall_mount']).toBeTruthy();
  });
});

describe('the agent pinned a variant', () => {
  it('a pinned variant that conflicts with the listing returns', () => {
    const e = common('common.variant_pinned', '1U7pIWX', 'lg.com', {
      variantSelected: [{ name: 'Size', label: '83"' }],
    });
    expect(e?.returnReason).toBe('The agent pinned size 83", but the listing is for size 65".');
  });

  it('a pinned label the listing does not offer returns', () => {
    const e = common('common.variant_pinned', unpinnedLg(), 'lg.com', {
      variantSelected: [{ name: 'Size', label: '55"' }],
    });
    expect(e?.returnReason).toBe('The agent pinned size 55", which the listing does not offer.');
    const curly = common('common.variant_pinned', unpinnedLg(), 'lg.com', {
      variantSelected: [{ name: 'size', label: '65”' }],
    });
    expect(curly?.result.state).toBe('backed');
  });

  it('a pinned size feeds the screen-size evidence', async () => {
    const r = await review(
      input(unpinnedLg(), 'lg.com', tvWall, {
        purchase: { variantSelected: [{ name: 'Size', label: '65"' }] },
      }),
      deps,
    );
    const size = r.results.find((x) => x.requirement === 'tv.screen_size');
    expect(size?.state).toBe('backed');
    expect(size?.evidence[0]?.label).toBe('Selected variant, Size');
  });
});

describe('record and purchase must be the same product', () => {
  it('a record for another product fails closed', async () => {
    const warn = vi.fn();
    const r = await review(
      input('0gH7IUm', 'beachcamera.com', tvWall, { purchase: { productId: 'SOMETHING_ELSE' } }),
      { ...deps, logger: { warn } },
    );
    expect(r).toMatchObject({ decision: 'return_to_agent', failedClosed: true });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when the logger throws', async () => {
    const bad = withProduct(recordedProduct('UXXAg59'), (p) => {
      (p as unknown as { key_features: number }).key_features = 7;
    });
    const warn = () => {
      throw new Error('logger down');
    };
    const r = await review(input(bad, 'pcrichard.com', tvWall), { ...deps, logger: { warn } });
    expect(r).toMatchObject({ failedClosed: true, agentMessage: FAIL_CLOSED_MESSAGE });
  });
});

describe('brand', () => {
  const noBrands = () =>
    withProduct(recordedProduct('UXXAg59'), (p) => {
      p.brands = [];
    });

  it('falls back to the title only when brands is empty', () => {
    const sony = common(
      'common.brand',
      noBrands(),
      'pcrichard.com',
      {},
      {
        stated: { 'common.brand': { value: 'sony', quote: 'Sony' } },
      },
    );
    expect(sony?.result.state).toBe('backed');
    const ev = sony?.result.evidence[0];
    expect(ev?.label).toBe('Title');
    expect(ev && ev.end <= ev.text.length).toBe(true);
    expect(ev?.text.slice(ev.start, ev.end)).toBe('Sony');
  });

  it('asks when the listing names no brand', () => {
    const lg = common(
      'common.brand',
      noBrands(),
      'pcrichard.com',
      {},
      {
        stated: { 'common.brand': { value: 'lg', quote: 'LG' } },
      },
    );
    expect(lg?.line).toEqual({
      lineId: 'common.brand',
      requirement: 'common.brand',
      type: 'unbacked',
      text: 'The listing does not name the brand. Is that OK?',
    });
  });

  it('matches by containment and never cites the whole title as a brand', () => {
    const loose = common(
      'common.brand',
      'UXXAg59',
      'pcrichard.com',
      {},
      {
        stated: { 'common.brand': { value: 'a sony tv', quote: 'A Sony TV' } },
      },
    );
    expect(loose?.result.state).toBe('backed');
    expect(loose?.result.evidence.map((x) => x.path)).toEqual(['brands[0].name']);
    const other = common(
      'common.brand',
      '0gH7IUm',
      'beachcamera.com',
      {},
      {
        stated: { 'common.brand': { value: 'sony', quote: 'Sony' } },
      },
    );
    expect(other?.returnReason).toBe('It is a Panasonic; the buyer asked for Sony.');
  });
});

describe('budget amounts', () => {
  it('reads k suffixes, space thousands and bare numbers after budget words', () => {
    expect(parseUsdCents('Up to $2k')).toBe(200000);
    expect(parseUsdCents('under $1.5K')).toBe(150000);
    expect(parseUsdCents('$1 500')).toBe(150000);
    expect(parseUsdCents('budget 1500')).toBe(150000);
    expect(parseUsdCents('under 1500')).toBe(150000);
    expect(parseUsdCents('$40ish')).toBeNull();
    expect(parseUsdCents('for my 2 kids')).toBeNull();
    expect(parseUsdCents('Under $40')).toBe(4000);
    expect(parseUsdCents('Up to $1,500')).toBe(150000);
    expect(parseUsdCents('40 dollars')).toBe(4000);
  });
});

describe('negated claims (re-graded: they could capture a wrong product)', () => {
  it('a negated voltage claim is not dual', () => {
    expect(voltage('Not dual voltage')).toEqual([]);
    expect(voltage('non-dual voltage model')).toEqual([]);
    expect(vals(voltage('Dual voltage, so it works abroad'))).toEqual(['dual']);
  });

  it('a diffuser sold separately or not included is not in the box', () => {
    const r = withProduct(recordedProduct('LRCibGC'), (p) => {
      p.key_features = ['Diffuser sold separately', 'Diffuser attachment not included'];
    });
    const c = collectCandidates('diffuserIncluded', contextFor(r.product, 'macys.com'), dryer);
    expect(c.map((x) => x.value)).toEqual([false]);
  });
});

describe('checklist data guard', () => {
  it('every evidence, scan and productHas pattern in the data is readable', () => {
    const ctx = contextFor(recordedProduct('UXXAg59').product, 'pcrichard.com');
    for (const checklist of [tv, dryer]) {
      for (const fact of Object.values(checklist.facts)) {
        for (const p of [...fact.evidence, ...(fact.contradictionScan ?? [])]) {
          expect(() => readPath(p, ctx), p).not.toThrow();
        }
      }
      for (const req of checklist.requirements) {
        const when = req.appliesWhen;
        if ('productHas' in when) expect(() => readPath(when.productHas, ctx)).not.toThrow();
      }
    }
  });
});
