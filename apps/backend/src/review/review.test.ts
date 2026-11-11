import {
  type Intent,
  type ProductRecord,
  type ReviewInput,
  ReviewResultSchema,
  type TaskMemory,
} from '@fitcheck/contracts';
import { describe, expect, it, vi } from 'vitest';
import { FAIL_CLOSED_MESSAGE, failClosed, OVERFLOW_MESSAGE, review } from './index.js';
import { intentFor, purchaseFor, recordedProduct, withProduct } from './testing.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const deps = { now: () => NOW };

const travel = intentFor('hair_dryer', 'A hair dryer for my trip to Spain next week.', {
  triggered: { 'hair_dryer.dual_voltage': { quote: 'trip to Spain' } },
});
const sonyWall = intentFor('tv', 'A 65-inch OLED TV for the living room wall. Up to $1,500.', {
  stated: {
    'tv.screen_size': { value: 65, quote: '65-inch' },
    'tv.panel_type': { value: 'oled', quote: 'OLED' },
  },
  budgetCents: 150000,
  triggered: { 'tv.wall_mount': { quote: 'wall' } },
});
const tvWall = intentFor('tv', 'Replace the TV on our living room wall with a 65-inch.', {
  stated: { 'tv.screen_size': { value: 65, quote: '65-inch' } },
  budgetCents: 160000,
  triggered: { 'tv.wall_mount': { quote: 'our living room wall' } },
});
const wallOnly = intentFor('tv', 'A TV for the wall.', {
  triggered: { 'tv.wall_mount': { quote: 'wall' } },
});
const tvSony = intentFor('tv', 'A 65-inch OLED TV for the living room. Up to $1,500.', {
  stated: {
    'tv.screen_size': { value: 65, quote: '65-inch' },
    'tv.panel_type': { value: 'oled', quote: 'OLED' },
  },
  budgetCents: 150000,
});

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

describe('review', () => {
  it('captures when every requirement is backed', async () => {
    const lura = intentFor('hair_dryer', 'travel', {
      triggered: travel.triggered,
      budgetCents: 4000,
    });
    const r = await review(input('saZdY6C', 'walmart.com', lura), deps);
    expect(r.decision).toBe('capture');
    expect(r.card).toBeUndefined();
    expect(r).not.toHaveProperty('agentMessage');
    expect(r.reasons).toEqual([]);
    expect(ReviewResultSchema.parse(r)).toEqual(r);
  });

  it('a broken requirement returns without a card', async () => {
    const r = await review(input('cv7t721', 'walmart.com', travel), deps);
    expect(r).toMatchObject({
      decision: 'return_to_agent',
      agentMessage:
        'Not paid. The listing says it only works on 110-120 V outlets; the buyer is taking it abroad. Pick an offer whose listing states 220-240 V or dual voltage.',
    });
    expect(r.card).toBeUndefined();
  });

  it('a wall request on the Sony asks one card with two lines in order', async () => {
    const r = await review(input('UXXAg59', 'pcrichard.com', sonyWall), deps);
    expect(r.decision).toBe('ask');
    expect(r.card?.title).toBe('Before we pay $1,398.00 for this TV');
    expect(r.card?.lines.map((l) => [l.requirement, l.type])).toEqual([
      ['tv.screen_size', 'contradictory'],
      ['tv.wall_mount', 'never_asked'],
    ]);
    expect(r).not.toHaveProperty('agentMessage');
    expect(ReviewResultSchema.parse(r)).toEqual(r);
  });

  it('results are ordered stated, triggered, always', async () => {
    const r = await review(input('UXXAg59', 'pcrichard.com', sonyWall), deps);
    expect(r.results.slice(0, 4).map((x) => x.requirement)).toEqual([
      'tv.screen_size',
      'tv.panel_type',
      'common.budget',
      'tv.wall_mount',
    ]);
    expect(r.results.slice(4).every((x) => x.origin === 'always')).toBe(true);
  });

  it('four lines overflow back to the agent', async () => {
    const noCondition = withProduct(recordedProduct('UXXAg59'), (p) => {
      const o = p.offers.find((x) => x.domain === 'pcrichard.com');
      if (o) o.condition = null;
    });
    const result = await review(
      input(noCondition, 'pcrichard.com', sonyWall, {
        purchase: { priceSeenCents: 129800, amountCents: 139800 },
      }),
      deps,
    );
    expect(result).toMatchObject({
      decision: 'return_to_agent',
      agentMessage: `Not paid. ${OVERFLOW_MESSAGE}`,
    });
    expect(result.card).toBeUndefined();
    expect(result.reasons.map((x) => x.type)).toEqual([
      'payment',
      'payment',
      'contradictory',
      'never_asked',
    ]);
  });

  it('a remembered no returns without a question', async () => {
    const memory = { 'hair_dryer.dual_voltage': 'needed' } as const;
    const conair = await review(input('5swh9aC', 'boscovs.com', travel, { memory }), deps);
    expect(conair).toMatchObject({
      decision: 'return_to_agent',
      agentMessage:
        'Not paid. The buyer already said no to this point earlier in this task: Works on 220-240 V outlets abroad.',
    });
    expect(conair.card).toBeUndefined();
    expect(conair.reasons).toEqual([{ requirement: 'hair_dryer.dual_voltage', type: 'unbacked' }]);
    const row = conair.results.find((x) => x.requirement === 'hair_dryer.dual_voltage');
    expect(row?.note).toBe('You said this is not OK earlier in this task.');
    const aniq = await review(input('cv7t721', 'walmart.com', travel, { memory }), deps);
    expect(aniq.decision).toBe('return_to_agent');
    expect(aniq.card).toBeUndefined();
  });

  it('a remembered yes drops the line', async () => {
    const memory = { 'tv.wall_mount=300x300': 'not_needed' } as const;
    const r = await review(input('0gH7IUm', 'beachcamera.com', wallOnly, { memory }), deps);
    expect(r.decision).toBe('capture');
    const row = r.results.find((x) => x.requirement === 'tv.wall_mount');
    expect(row).toMatchObject({
      state: 'never_asked',
      note: 'You said this is OK earlier in this task.',
    });
  });

  it('a remembered no for one VESA pattern still asks about another', async () => {
    const memory = { 'tv.wall_mount=300x300': 'needed' } as const;
    const lg = await review(input('1U7pIWX', 'lg.com', tvWall, { memory }), deps);
    expect(lg.decision).toBe('ask');
    expect(lg.card?.lines.map((l) => l.lineId)).toEqual(['tv.wall_mount=200x200']);
    const sony = await review(input('UXXAg59', 'pcrichard.com', wallOnly, { memory }), deps);
    expect(sony.decision).toBe('return_to_agent');
    expect(sony.card).toBeUndefined();
    const q8f = await review(input('7ZfAuSE', 'qvc.com', tvWall, { memory }), deps);
    expect(q8f.decision).toBe('ask');
    expect(q8f.card?.lines.map((l) => [l.lineId, l.type])).toEqual([['tv.wall_mount', 'unbacked']]);
  });

  it('summary counts states', async () => {
    const r = await review(input('UXXAg59', 'pcrichard.com', sonyWall), deps);
    const count = (s: string) => r.results.filter((x) => x.state === s).length;
    expect(r.summary).toEqual({
      backed: count('backed'),
      unbacked: count('unbacked'),
      never_asked: count('never_asked'),
      contradictory: count('contradictory'),
      broken: count('broken'),
    });
    expect(r.summary).toMatchObject({ contradictory: 1, never_asked: 1 });
  });

  it('review fails closed on an internal error', async () => {
    const bad = withProduct(recordedProduct('UXXAg59'), (p) => {
      (p as unknown as { key_features: number }).key_features = 7;
    });
    const warn = vi.fn();
    const r = await review(input(bad, 'pcrichard.com', sonyWall), { ...deps, logger: { warn } });
    expect(r).toMatchObject({
      decision: 'return_to_agent',
      failedClosed: true,
      agentMessage: FAIL_CLOSED_MESSAGE,
      results: [],
      reasons: [],
      record: { source: 'recorded', recordedOn: '2026-11-10' },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'review failed closed',
      expect.objectContaining({ err: expect.any(Error) }),
    );
  });

  it('failClosed without a record omits record', () => {
    const r = failClosed(NOW);
    expect(r).not.toHaveProperty('record');
    expect(r.reasons).toEqual([]);
    expect(r.agentMessage).toBe('Fitcheck could not check this listing.');
    expect(ReviewResultSchema.parse(r)).toEqual(r);
  });

  it('reasons match the decision', async () => {
    const aniq = await review(input('cv7t721', 'walmart.com', travel), deps);
    expect(aniq.reasons).toEqual([{ requirement: 'hair_dryer.dual_voltage', type: 'broken' }]);
    const sony = await review(input('UXXAg59', 'pcrichard.com', tvSony), deps);
    expect(sony.decision).toBe('ask');
    expect(sony.reasons).toEqual([{ requirement: 'tv.screen_size', type: 'contradictory' }]);
    const changed = await review(
      input('0gH7IUm', 'beachcamera.com', wallOnly, {
        memory: { 'tv.wall_mount=300x300': 'not_needed' },
        purchase: { priceSeenCents: 45000 },
      }),
      deps,
    );
    expect(changed.decision).toBe('ask');
    expect(changed.reasons).toEqual([{ requirement: 'common.price_unchanged', type: 'payment' }]);
    expect(changed.card?.lines[0]?.type).toBe('payment');
    expect(changed.results.find((x) => x.requirement === 'common.price_unchanged')?.state).toBe(
      'broken',
    );
  });

  it('copies the record metadata', async () => {
    const r = await review(input('cv7t721', 'walmart.com', travel), deps);
    expect(r.record).toEqual({
      fetchedAt: recordedProduct('cv7t721').fetchedAt,
      source: 'recorded',
      recordedOn: '2026-11-10',
    });
    const live: ProductRecord = { ...recordedProduct('saZdY6C'), source: 'live' };
    delete live.recordedOn;
    const l = await review(input(live, 'walmart.com', travel), deps);
    expect(l.record).toEqual({ fetchedAt: live.fetchedAt, source: 'live' });
  });
});

describe('agent messages', () => {
  it('the ANIQ return equals the contract example, Not paid prefix included', async () => {
    const { runDryerSpain } = await import('@fitcheck/contracts');
    const example = runDryerSpain.attempts[0]?.review.agentMessage;
    const r = await review(input('cv7t721', 'walmart.com', travel), deps);
    expect(r.agentMessage).toBe(example);
    expect(r.agentMessage?.startsWith('Not paid. ')).toBe(true);
  });

  it('fail closed keeps its message without the prefix', () => {
    expect(failClosed(NOW).agentMessage).toBe('Fitcheck could not check this listing.');
  });
});
