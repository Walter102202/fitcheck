import { describe, expect, it } from 'vitest';
import type { EvalCase } from './case-schema.js';
import { QUOTAS, quotaKey, validateCaseSet } from './quotas.js';

function total(split: 'tuning' | 'heldout', category?: 'tv' | 'hair_dryer'): number {
  const cats: ('tv' | 'hair_dryer')[] = category ? [category] : ['tv', 'hair_dryer'];
  let sum = 0;
  for (const cat of cats) for (const n of Object.values(QUOTAS[split][cat])) sum += n;
  return sum;
}

function stub(id: string, request: string, family: string): EvalCase {
  return {
    id,
    split: 'tuning',
    category: 'tv',
    family,
    request,
    known_to_agent: {},
    dossier: {},
    attempt: {
      product_id: 'ENqcYcj',
      store: 'bestbuy.com',
      quantity: 1,
      price_seen_cents: 48999,
      amount_cents: 48999,
    },
    label: { class: 'correct', should_end_paid: true, evidence: 'title = "65"' },
  };
}

describe('QUOTAS', () => {
  it('add up to 16 and 32, with 8 and 16 per category', () => {
    expect(total('tuning')).toBe(16);
    expect(total('heldout')).toBe(32);
    expect(total('tuning', 'tv')).toBe(8);
    expect(total('tuning', 'hair_dryer')).toBe(8);
    expect(total('heldout', 'tv')).toBe(16);
    expect(total('heldout', 'hair_dryer')).toBe(16);
  });

  it('keys a case by class, failure group and failure', () => {
    const c = stub('t-tv-01', 'A 65-inch TV.', 'a');
    expect(quotaKey(c)).toBe('correct');
    c.label = {
      class: 'wrong',
      failure: 'over_cap',
      broken_key: 'common.budget',
      should_end_paid: false,
      evidence: 'x',
    };
    expect(quotaKey(c)).toBe('wrong:payment:over_cap');
  });
});

describe('validateCaseSet', () => {
  it('rejects two cases with the same category and request', () => {
    const errors = validateCaseSet(
      [stub('t-tv-01', 'A 65-inch TV.', 'a'), stub('t-tv-02', 'A 65-inch TV.', 'b')],
      'tuning',
    );
    expect(errors).toContain('t-tv-02: category and request repeat another case');
  });

  it('rejects a repeated family within a split', () => {
    const errors = validateCaseSet(
      [stub('t-tv-01', 'A 65-inch TV.', 'a'), stub('t-tv-02', 'A 55-inch TV.', 'a')],
      'tuning',
    );
    expect(errors).toContain('t-tv-02: family repeats another case in the split');
  });

  it('reports a quota that is not met', () => {
    const errors = validateCaseSet([stub('t-tv-01', 'A 65-inch TV.', 'a')], 'tuning');
    expect(errors).toContain('quota tv correct: expected 2, got 1');
  });

  it('rejects families and products shared with the other split', () => {
    const heldout = { ...stub('h-tv-01', 'A 65-inch TV, please.', 'a'), split: 'heldout' as const };
    const errors = validateCaseSet([heldout], 'heldout', [stub('t-tv-01', 'A 65-inch TV.', 'a')]);
    expect(errors).toContain('h-tv-01: family is also used in the other split');
    expect(errors).toContain('h-tv-01: product_id is also used in the other split');
  });
});
