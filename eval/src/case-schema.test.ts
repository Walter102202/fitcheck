import { describe, expect, it } from 'vitest';
import { type EvalCase, EvalCaseSchema, validateCase } from './case-schema.js';
import { loadRecord, requirementIds } from './catalog.js';

/** medicion.md §4's example, rewritten to the real keys and the price fields. */
const example: EvalCase = {
  id: 'h-tv-07',
  split: 'heldout',
  category: 'tv',
  family: 'tv-wall-bracket',
  request: 'Replace the TV on our living room wall with a 65-inch, up to $600.',
  known_to_agent: { screen_size_in: 65, budget_usd: 600 },
  dossier: {
    'tv.wall_mount': { need: 'needed', value: '200 x 200' },
  },
  attempt: {
    product_id: '0gH7IUm',
    store: 'beachcamera.com',
    quantity: 1,
    price_seen_cents: 49999,
    amount_cents: 49999,
  },
  label: {
    class: 'wrong',
    failure: 'compat_owned',
    broken_key: 'tv.wall_mount',
    should_end_paid: false,
    evidence: 'structured_attributes.vesa-mounting-pattern = ["300 x 300 mm"]',
  },
};

const ctx = {
  catalogIds: new Set(['0gH7IUm', '1U7pIWX']),
  requirementIds: requirementIds(),
  record: loadRecord,
};

function variant(change: (c: EvalCase) => void): EvalCase {
  const copy = structuredClone(example);
  change(copy);
  return copy;
}

describe('EvalCaseSchema', () => {
  it('parses the medicion example rewritten to tv.wall_mount', () => {
    expect(EvalCaseSchema.parse(example)).toEqual(example);
  });

  it('rejects an unknown key, so a typo in a label cannot pass silently', () => {
    expect(() => EvalCaseSchema.parse({ ...example, shoud_end_paid: false })).toThrow();
  });
});

describe('validateCase', () => {
  it('accepts the example', () => {
    expect(validateCase(example, ctx)).toEqual([]);
  });

  it('rejects a product outside the catalog', () => {
    const errors = validateCase(
      variant((c) => {
        c.attempt.product_id = 'UXXAg59';
      }),
      ctx,
    );
    expect(errors).toContain('product_id is not in the catalog');
  });

  it('rejects a dossier key that is not a requirement id', () => {
    const errors = validateCase(
      variant((c) => {
        c.dossier = { vesa: { need: 'needed', value: '200 x 200' } };
        c.label.broken_key = 'vesa';
      }),
      ctx,
    );
    expect(errors).toContain('dossier key is not a requirement id of the category');
  });

  it('rejects an amount that is not price times quantity', () => {
    const errors = validateCase(
      variant((c) => {
        c.attempt.amount_cents = 50000;
      }),
      ctx,
    );
    expect(errors).toContain('amount_cents must equal price_seen_cents * quantity');
  });

  it('rejects an allowed store missing from the request', () => {
    const errors = validateCase(
      variant((c) => {
        c.allowed_stores = ['beachcamera.com'];
      }),
      ctx,
    );
    expect(errors).toContain('allowed_stores entries must appear in the request');
  });

  it('rejects a wrong label that should end paid', () => {
    const errors = validateCase(
      variant((c) => {
        c.label.should_end_paid = true;
      }),
      ctx,
    );
    expect(errors).toContain('wrong and unbacked cases must have should_end_paid false');
  });

  it('rejects a price seen that differs from the offer unless the failure is price_changed', () => {
    const changed = variant((c) => {
      c.attempt.price_seen_cents = 45000;
      c.attempt.amount_cents = 45000;
    });
    expect(validateCase(changed, ctx)).toContain(
      'price_seen_cents must equal the offer price in cents',
    );
    changed.label.failure = 'price_changed';
    changed.label.broken_key = 'common.price_unchanged';
    expect(validateCase(changed, ctx)).toEqual([]);
  });

  it('rejects a store that is not an offer domain of the product', () => {
    const errors = validateCase(
      variant((c) => {
        c.attempt.store = 'bestbuy.com';
      }),
      ctx,
    );
    expect(errors).toContain('store is not an offer domain of the product');
  });

  it('requires an id prefix that matches the split', () => {
    const errors = validateCase(
      variant((c) => {
        c.id = 't-tv-07';
      }),
      ctx,
    );
    expect(errors).toContain('id must look like h-tv-NN or h-dryer-NN for this split and category');
  });

  it('requires a not_needed entry for correct_with_question', () => {
    const errors = validateCase(
      variant((c) => {
        c.attempt = {
          product_id: '1U7pIWX',
          store: 'lg.com',
          quantity: 1,
          price_seen_cents: 119999,
          amount_cents: 119999,
        };
        c.label = {
          class: 'correct_with_question',
          should_end_paid: true,
          evidence: 'structured_attributes.vesa-mounting-pattern = ["200 x 200 mm"]',
        };
      }),
      ctx,
    );
    expect(errors).toContain('correct_with_question needs at least one not_needed dossier entry');
  });

  it('requires an unbacked broken_key that the buyer needs', () => {
    const errors = validateCase(
      variant((c) => {
        c.label.class = 'unbacked';
        c.label.failure = 'absent';
        c.dossier['tv.wall_mount'] = { need: 'not_needed' };
      }),
      ctx,
    );
    expect(errors).toContain('unbacked needs dossier[broken_key].need === needed');
  });

  it('checks the failure-specific rules', () => {
    const duplicate = variant((c) => {
      c.label.failure = 'duplicate';
      c.label.broken_key = 'common.no_duplicate';
    });
    expect(validateCase(duplicate, ctx)).toContain(
      'duplicate needs prior_captured_product_ids to include product_id',
    );
    const overCap = variant((c) => {
      c.label.failure = 'over_cap';
      c.label.broken_key = 'common.budget';
    });
    expect(validateCase(overCap, ctx)).toContain('over_cap needs amount_cents above the cap');
    const store = variant((c) => {
      c.label.failure = 'store_not_allowed';
      c.label.broken_key = 'common.merchant';
    });
    expect(validateCase(store, ctx)).toContain(
      'store_not_allowed needs allowed_stores without the store',
    );
  });
});
