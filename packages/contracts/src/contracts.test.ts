import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  API,
  type Evidence,
  formatUsd,
  ProductRecordSchema,
  type RunResponse,
  RunResponseSchema,
  runDryerSilent,
  runDryerSpain,
  runSonyAsk,
} from './index.js';

const fixturesDir = fileURLToPath(new URL('../../../fixtures/channel3/', import.meta.url));
const examples: [string, RunResponse][] = [
  ['runDryerSpain', runDryerSpain],
  ['runSonyAsk', runSonyAsk],
  ['runDryerSilent', runDryerSilent],
];

describe('formatUsd', () => {
  it('formats integer cents as US dollars', () => {
    expect(formatUsd(139800)).toBe('$1,398.00');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(2020)).toBe('$20.20');
  });
});

describe('fixtures-parse', () => {
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json') && f !== 'index.json');

  it('has the recorded products', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(files)('%s parses as a ProductRecord', (file) => {
    const json: unknown = JSON.parse(readFileSync(`${fixturesDir}${file}`, 'utf8'));
    const record = ProductRecordSchema.parse(json);
    expect(`${record.product.id}.json`).toBe(file);
    expect(record.source).toBe('recorded');
  });
});

describe('example runs', () => {
  it.each(examples)('%s parses as a RunResponse', (_, run) => {
    expect(() => RunResponseSchema.parse(run)).not.toThrow();
  });

  it('runDryerSilent has an unbacked result with searched fields and no evidence', () => {
    const unbacked = runDryerSilent.attempts
      .flatMap((a) => a.review.results)
      .filter((r) => r.state === 'unbacked');
    expect(unbacked.length).toBeGreaterThan(0);
    for (const result of unbacked) {
      expect(result.searched?.length ?? 0).toBeGreaterThan(0);
      expect(result.evidence).toEqual([]);
    }
  });

  it.each(examples)('%s has a card iff the decision is ask, with 1 to 3 lines', (_, run) => {
    for (const attempt of run.attempts) {
      const { decision, card } = attempt.review;
      expect(card !== undefined).toBe(decision === 'ask');
      if (card) {
        expect(card.lines.length).toBeGreaterThanOrEqual(1);
        expect(card.lines.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it.each(examples)('%s has evidence ranges inside the text', (_, run) => {
    const evidence: Evidence[] = run.attempts.flatMap((a) =>
      a.review.results.flatMap((r) => r.evidence),
    );
    for (const item of evidence) {
      expect(item.start).toBeGreaterThanOrEqual(0);
      expect(item.start).toBeLessThanOrEqual(item.end);
      expect(item.end).toBeLessThanOrEqual(item.text.length);
      if (item.path === 'title' || item.path === 'description') {
        expect(item.text.length).toBeLessThanOrEqual(160);
      }
    }
  });
});

describe('API', () => {
  it('names every route the lanes share', () => {
    expect(API.config).toBe('/api/config');
    expect(API.runAnswers('run_1')).toBe('/api/runs/run_1/answers');
  });
});
