import type { Category, ProductRecord, ReviewInput } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import { getChecklist } from './checklist.js';
import { evaluateCommon } from './common-checks.js';
import { contextFor } from './paths.js';
import { intentFor, purchaseFor, recordedProduct, withProduct } from './testing.js';

type Parts = Parameters<typeof intentFor>[2];

function common(
  reqId: string,
  product: string | ProductRecord,
  domain: string,
  purchase: Partial<ReviewInput['purchase']> = {},
  parts: Parts = {},
  opts: { category?: Category; captured?: string[] } = {},
) {
  const record = typeof product === 'string' ? recordedProduct(product) : product;
  const category =
    opts.category ?? (record.product.category?.slug === 'televisions' ? 'tv' : 'hair_dryer');
  const checklist = getChecklist(category);
  const req = checklist.requirements.find((r) => r.id === reqId);
  if (!req) throw new Error(`no ${reqId}`);
  const input: ReviewInput = {
    intent: intentFor(category, 'request', parts),
    record,
    purchase: purchaseFor(record, domain, purchase),
    memory: {},
    capturedProductIds: opts.captured ?? [],
  };
  return evaluateCommon(req, input, checklist, contextFor(record.product, domain));
}

const COMMON_IDS = getChecklist('hair_dryer')
  .requirements.filter((r) => r.id.startsWith('common.'))
  .map((r) => r.id);

describe('evaluateCommon', () => {
  it('every common check passes for the LURA at walmart.com', () => {
    const states = COMMON_IDS.map((id) => [
      id,
      common(id, 'saZdY6C', 'walmart.com', {}, { budgetCents: 4000 })?.result.state ?? null,
    ]);
    expect(states).toEqual(
      COMMON_IDS.map((id) => [
        id,
        id === 'common.variant_pinned' || id === 'common.brand' ? null : 'backed',
      ]),
    );
    const budget = common('common.budget', 'saZdY6C', 'walmart.com', {}, { budgetCents: 4000 });
    expect(budget?.result).toMatchObject({
      origin: 'stated',
      originQuote: '$40.00',
      fact: 'price',
      evidence: [{ path: 'offer.price.price', display: '$20.20' }],
    });
  });

  it('a price change asks one payment line', () => {
    const e = common('common.price_unchanged', 'UXXAg59', 'pcrichard.com', {
      priceSeenCents: 129800,
    });
    expect(e?.result).toMatchObject({
      state: 'broken',
      note: 'The price changed from $1,298.00 to $1,398.00.',
    });
    expect(e?.line).toEqual({
      lineId: 'common.price_unchanged=139800',
      requirement: 'common.price_unchanged',
      type: 'payment',
      text: 'The price changed from $1,298.00 to $1,398.00 since the agent chose it. Is that OK?',
    });
    expect(e?.returnReason).toBeUndefined();
  });

  it('over budget returns', () => {
    const e = common('common.budget', 'RxdGNA8', 'newegg.com', {}, { budgetCents: 4000 });
    expect(e?.result.state).toBe('broken');
    expect(e?.returnReason).toBe('$136.80 is over the $40.00 budget.');
    expect(e?.returnType).toBe('payment');
  });

  it('the budget counts the quantity', () => {
    const e = common(
      'common.budget',
      'saZdY6C',
      'walmart.com',
      {},
      { budgetCents: 4000, quantity: 2 },
    );
    expect(e?.returnReason).toBe('$40.40 is over the $40.00 budget.');
  });

  it('the scenario budgets pass', () => {
    expect(
      common('common.budget', 'cv7t721', 'walmart.com', {}, { budgetCents: 4000 })?.result.state,
    ).toBe('backed');
    expect(
      common('common.budget', 'UXXAg59', 'pcrichard.com', {}, { budgetCents: 150000 })?.result
        .state,
    ).toBe('backed');
    expect(
      common('common.budget', '1U7pIWX', 'lg.com', {}, { budgetCents: 160000 })?.result.state,
    ).toBe('backed');
  });

  it('the beachcamera Sony is out of stock and used', () => {
    const stock = common('common.in_stock', 'UXXAg59', 'beachcamera.com');
    expect(stock?.returnReason).toBe('beachcamera.com lists it as out of stock.');
    expect(stock?.result.evidence[0]?.display).toBe('Out of stock');
    const cond = common('common.condition_new', 'UXXAg59', 'beachcamera.com');
    expect(cond?.returnReason).toBe('The beachcamera.com offer is used.');
    expect(cond?.returnType).toBe('payment');
  });

  it('used is fine when the buyer accepted used', () => {
    const e = common(
      'common.condition_new',
      'UXXAg59',
      'beachcamera.com',
      {},
      { acceptUsed: true },
    );
    expect(e?.result.state).toBe('backed');
  });

  it('an unknown condition asks', () => {
    const noCondition = withProduct(recordedProduct('UXXAg59'), (p) => {
      const o = p.offers.find((x) => x.domain === 'pcrichard.com');
      if (o) o.condition = null;
    });
    const e = common('common.condition_new', noCondition, 'pcrichard.com');
    expect(e?.line).toEqual({
      lineId: 'common.condition_new',
      requirement: 'common.condition_new',
      type: 'payment',
      text: 'pcrichard.com does not say whether this one is new. Is that OK?',
    });
    expect(e?.result).toMatchObject({
      state: 'unbacked',
      fact: 'condition',
      evidence: [],
      searched: ['Store offer, pcrichard.com', 'Attribute: cosmetic-condition', 'Title'],
    });
  });

  it('a domain with no offer returns without crashing', () => {
    const e = common('common.merchant', 'UXXAg59', 'amazon.com');
    expect(e?.returnReason).toBe('The listing has no offer from amazon.com.');
    expect(e?.result.state).toBe('broken');
    for (const id of [
      'common.budget',
      'common.price_unchanged',
      'common.amount_matches',
      'common.in_stock',
      'common.condition_new',
    ]) {
      expect(common(id, 'UXXAg59', 'amazon.com', {}, { budgetCents: 150000 })).toBeNull();
    }
  });

  it('a non-USD offer returns', () => {
    const eur = withProduct(recordedProduct('UXXAg59'), (p) => {
      const o = p.offers.find((x) => x.domain === 'pcrichard.com');
      if (o) o.price.currency = 'EUR';
    });
    const e = common('common.amount_matches', eur, 'pcrichard.com', {
      priceSeenCents: 139800,
      amountCents: 139800,
    });
    expect(e?.returnReason).toBe('The pcrichard.com offer is not in USD.');
    expect(e?.result.state).toBe('broken');
  });

  it('an amount different from the offer returns', () => {
    const e = common('common.amount_matches', 'UXXAg59', 'pcrichard.com', { amountCents: 100 });
    expect(e?.returnReason).toBe('The agent asked to charge $1.00; the offer price is $1,398.00.');
  });

  it('a quantity mismatch returns', () => {
    const e = common('common.quantity', 'UXXAg59', 'pcrichard.com', { quantity: 2 });
    expect(e?.returnReason).toBe('The agent ordered 2; the buyer asked for 1.');
    expect(e?.result).not.toHaveProperty('fact');
  });

  it('a store outside the allowed list returns', () => {
    const e = common(
      'common.merchant',
      'UXXAg59',
      'pcrichard.com',
      {},
      { stores: ['bestbuy.com'] },
    );
    expect(e?.returnReason).toBe('pcrichard.com is not among the stores the buyer allowed.');
    const ok = common(
      'common.merchant',
      'UXXAg59',
      'pcrichard.com',
      {},
      { stores: ['PCRichard.com'] },
    );
    expect(ok?.result.state).toBe('backed');
  });

  it('a listing with size options needs a pinned size', () => {
    const unpinned = withProduct(recordedProduct('1U7pIWX'), (p) => {
      if (p.variants) p.variants.selected = [];
    });
    const e = common('common.variant_pinned', unpinned, 'lg.com');
    expect(e?.returnReason).toBe(
      'The listing has several size options and the agent did not pin one.',
    );
    const pinnedByAgent = common('common.variant_pinned', unpinned, 'lg.com', {
      variantSelected: [{ name: 'size', label: '65"' }],
    });
    expect(pinnedByAgent?.result.state).toBe('backed');
    expect(common('common.variant_pinned', '1U7pIWX', 'lg.com')?.result.state).toBe('backed');
    expect(common('common.variant_pinned', '0gH7IUm', 'beachcamera.com')).toBeNull();
  });

  it('an already captured product returns', () => {
    const e = common(
      'common.no_duplicate',
      'UXXAg59',
      'pcrichard.com',
      {},
      {},
      {
        captured: ['UXXAg59'],
      },
    );
    expect(e?.returnReason).toBe('This product was already bought in this task.');
  });

  it('the wrong category returns', () => {
    const e = common('common.category_match', 'saZdY6C', 'walmart.com', {}, {}, { category: 'tv' });
    expect(e?.returnReason).toBe('The agent picked a hair-dryers, not a TV.');
  });

  it('a stated brand that differs returns', () => {
    const e = common(
      'common.brand',
      '0gH7IUm',
      'beachcamera.com',
      {},
      {
        stated: { 'common.brand': { value: 'sony', quote: 'Sony' } },
      },
    );
    expect(e?.returnReason).toBe('It is a Panasonic; the buyer asked for Sony.');
    expect(e?.returnType).toBe('broken');
    const ok = common(
      'common.brand',
      '3KRsP5G',
      'crutchfield.com',
      {},
      {
        stated: { 'common.brand': { value: 'samsung', quote: 'Samsung' } },
      },
    );
    expect(ok?.result.state).toBe('backed');
  });
});
