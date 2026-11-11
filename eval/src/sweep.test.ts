import type {
  ProductRecord,
  RequirementState,
  ReviewInput,
  ReviewResult,
} from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import type { Catalog } from './catalog.js';
import { loadRecord } from './catalog.js';
import { SWEEP_CUES, sweep, sweepMarkdown } from './sweep.js';

/** A review that answers fixed states per product and requirement, and records its inputs. */
function stubReview(states: Record<string, Record<string, RequirementState>>) {
  const inputs: ReviewInput[] = [];
  return {
    inputs,
    async review(input: ReviewInput): Promise<ReviewResult> {
      inputs.push(input);
      const [requirement] = Object.keys(input.intent.triggered);
      const state = states[input.purchase.productId]?.[requirement ?? ''] ?? 'backed';
      return {
        decision: 'capture',
        results: [{ requirement, state }],
        summary: { backed: 0, unbacked: 0, never_asked: 0, contradictory: 0, broken: 0 },
        reasons: [],
      } as unknown as ReviewResult;
    },
  };
}
const channel3 = {
  async getProduct(id: string): Promise<ProductRecord> {
    return loadRecord(id);
  },
};

describe('catalog sweep', () => {
  it('sweep counts unbacked as missing and contradictory as disagrees', async () => {
    const catalog: Catalog = {
      recordedOn: '2026-11-10',
      queries: [],
      products: [
        { id: 'UXXAg59', category: 'tv', title: 'a' },
        { id: '0gH7IUm', category: 'tv', title: 'b' },
        { id: 'cv7t721', category: 'hair_dryer', title: 'c' },
      ],
    };
    const review = stubReview({
      UXXAg59: { 'tv.wall_mount': 'unbacked', 'tv.fits_space': 'contradictory' },
      '0gH7IUm': { 'tv.wall_mount': 'unbacked' },
      cv7t721: { 'hair_dryer.dual_voltage': 'broken', 'hair_dryer.diffuser': 'contradictory' },
    });
    const result = await sweep({ review, channel3 }, catalog);
    expect(result.records).toBe(3);
    expect(result.rows).toEqual([
      {
        requirement: 'tv.wall_mount',
        name: expect.any(String),
        records: 2,
        missing: 2,
        disagrees: 0,
      },
      {
        requirement: 'tv.fits_space',
        name: expect.any(String),
        records: 2,
        missing: 0,
        disagrees: 1,
      },
      {
        requirement: 'hair_dryer.dual_voltage',
        name: expect.any(String),
        records: 1,
        missing: 0,
        disagrees: 0,
      },
      {
        requirement: 'hair_dryer.diffuser',
        name: expect.any(String),
        records: 1,
        missing: 0,
        disagrees: 1,
      },
    ]);
    expect(review.inputs).toHaveLength(6);
    const wall = review.inputs.find((i) => 'tv.wall_mount' in i.intent.triggered);
    expect(wall?.intent.request).toContain(SWEEP_CUES['tv.wall_mount']);
    expect(wall?.intent.triggered['tv.wall_mount']?.quote).toBe(SWEEP_CUES['tv.wall_mount']);
    expect(SWEEP_CUES).toEqual({
      'tv.wall_mount': 'It goes on the wall.',
      'tv.fits_space': 'It replaces our old TV in the same spot.',
      'hair_dryer.dual_voltage': 'For a trip to Spain.',
      'hair_dryer.diffuser': 'For my curly hair.',
    });
  });

  it('renders the medicion table', () => {
    const md = sweepMarkdown({
      records: 69,
      rows: [
        {
          requirement: 'tv.wall_mount',
          name: 'Fits the wall mount',
          records: 45,
          missing: 40,
          disagrees: 2,
        },
      ],
    });
    expect(md).toContain('### How often the data alone forces a question');
    expect(md).toContain('Across 69 recorded product records');
    expect(md).toContain('| Requirement | Records | Missing | Disagrees |');
    expect(md).toContain('| Fits the wall mount | 45 | 40 | 2 |');
  });
});
