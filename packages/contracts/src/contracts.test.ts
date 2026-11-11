import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { quoted } from './examples/shared.js';
import {
  API,
  type Evidence,
  formatUsd,
  ProductRecordSchema,
  ResultsJsonSchema,
  ResultsRowSchema,
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

describe('results', () => {
  it('accepts a decimal row such as questions per held purchase', () => {
    const results = {
      measuredAt: '2026-11-11T21:00:00.000Z',
      model: 'claude-sonnet-5-5',
      recordedOn: '2026-11-11',
      heldOutCommit: 'abc1234',
      rows: [
        {
          id: 'questions_per_held',
          label: 'Questions per held purchase',
          of: 0,
          capOnly: null,
          fitcheck: 1.2,
          squares: { capOnly: [], fitcheck: [] },
        },
      ],
      notes: [],
    };
    expect(ResultsJsonSchema.safeParse(results).success).toBe(true);
  });

  it('marks a mean row with unit "mean" and rejects other units', () => {
    const row = {
      id: 'questions_per_held',
      label: 'Questions per held purchase',
      of: 9,
      capOnly: null,
      fitcheck: 1.2,
      squares: { capOnly: [], fitcheck: [] },
    };
    expect(ResultsRowSchema.parse({ ...row, unit: 'mean' }).unit).toBe('mean');
    expect(ResultsRowSchema.parse(row).unit).toBeUndefined();
    expect(ResultsRowSchema.safeParse({ ...row, unit: 'percent' }).success).toBe(false);
  });
});

describe('example evidence excerpts', () => {
  it('cuts the ANIQ description to the sentence holding the quote', () => {
    const evidence = runDryerSpain.attempts[0]?.review.results.find(
      (r) => r.requirement === 'hair_dryer.dual_voltage',
    )?.evidence[0];
    expect(evidence?.text).toBe('Note: For use with 110V–120V outlets only.');
    expect(evidence?.text.slice(evidence.start, evidence.end)).toBe(
      'Note: For use with 110V–120V outlets only.',
    );
  });

  it('windows a long sentence at word boundaries with ellipses', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const evidence = quoted('description', 'Description', words, 'word40', 'x', 'x');
    expect(evidence.text.length).toBeLessThanOrEqual(160);
    expect(evidence.text.startsWith('…')).toBe(true);
    expect(evidence.text.endsWith('…')).toBe(true);
    expect(evidence.text.slice(evidence.start, evidence.end)).toBe('word40');
    const all = new Set(words.split(' '));
    for (const token of evidence.text.slice(1, -1).trim().split(' ')) {
      expect(all.has(token)).toBe(true);
    }
  });
});

describe('API', () => {
  it('names every route the lanes share', () => {
    expect(API.config).toBe('/api/config');
    expect(API.runAnswers('run_1')).toBe('/api/runs/run_1/answers');
  });
});
