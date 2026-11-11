import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { caseContext, EVAL_DIR } from './catalog.js';
import { heldoutReport } from './import-heldout.js';

const tuning = JSON.parse(readFileSync(join(EVAL_DIR, 'cases', 'tuning.json'), 'utf8'));

describe('heldoutReport', () => {
  const ctx = caseContext();
  const secret = 'SECRET REQUEST TEXT';
  const raw = [
    {
      ...tuning[0],
      id: 'h-tv-01',
      split: 'heldout',
      family: 'brand-new-family',
      request: secret,
      attempt: { ...tuning[0].attempt, amount_cents: 1 },
    },
    { id: 'h-tv-02', split: 'heldout', request: secret },
  ];
  const report = heldoutReport(raw, tuning, ctx);
  const text = report.lines.join('\n');

  it('prints counts and case-id error lines only, never case content', () => {
    expect(report.ok).toBe(false);
    expect(text).not.toContain(secret);
    expect(text).toContain('h-tv-01: amount_cents must equal price_seen_cents * quantity');
    expect(text).toContain('h-tv-01: product_id is also used in the other split');
    expect(text).toMatch(/^h-tv-02: schema: /m);
    expect(text).toContain('tv correct: 1');
  });

  it('passes a clean set only when every rule and quota holds', () => {
    expect(heldoutReport([], tuning, ctx).ok).toBe(false);
  });
});
