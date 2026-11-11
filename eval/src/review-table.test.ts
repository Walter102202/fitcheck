import { describe, expect, it } from 'vitest';
import type { EvalCase } from './case-schema.js';
import { renderReviewTable } from './review-table.js';

function synthetic(id: string, evidence: string): EvalCase {
  return {
    id,
    split: 'heldout',
    category: 'hair_dryer',
    family: `family-${id}`,
    request: 'A travel hair dryer | for Spain.',
    known_to_agent: {},
    dossier: { 'hair_dryer.dual_voltage': { need: 'needed', value: '230 V' } },
    attempt: {
      product_id: 'saZdY6C',
      store: 'walmart.com',
      quantity: 1,
      price_seen_cents: 2020,
      amount_cents: 2020,
    },
    label: {
      class: 'wrong',
      failure: 'price_changed',
      broken_key: 'common.price_unchanged',
      should_end_paid: false,
      evidence,
    },
  };
}

describe('renderReviewTable', () => {
  const table = renderReviewTable([
    synthetic('h-dryer-02', 'key_features[0] = "Dual Voltage"'),
    synthetic('h-dryer-01', 'offers[walmart.com].price.price = 20.2'),
  ]);
  const rows = table.split('\n').filter((line) => line.startsWith('| h-'));

  it('renders one row per case, sorted by id', () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]?.startsWith('| h-dryer-01 |')).toBe(true);
    expect(rows[1]?.startsWith('| h-dryer-02 |')).toBe(true);
  });

  it('shows the decisive field, the amount, the product and the hidden facts', () => {
    expect(rows[0]).toContain('offers[walmart.com].price.price = 20.2');
    expect(rows[1]).toContain('key_features[0] = "Dual Voltage"');
    for (const row of rows) {
      expect(row).toContain('$20.20');
      expect(row).toContain('Travel Hair Dryer (saZdY6C)');
      expect(row).toContain('hair_dryer.dual_voltage: needed (230 V)');
      expect(row).toContain('wrong / price_changed');
      expect(row).toContain('A travel hair dryer \\| for Spain.');
    }
  });

  it('has the seven columns', () => {
    expect(table).toContain(
      '| id | request | hidden buyer facts | product, store, amount | decisive field | class / failure | should end paid |',
    );
  });
});
