import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ResultsJson, ResultsJsonSchema } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import type { EvalCase } from './case-schema.js';
import { type CaseRunOutcome, computeRows } from './measures.js';
import {
  expectedResults,
  FIXED_NOTES,
  missesMarkdown,
  publishHeldout,
  type RunDetail,
  readmeTable,
  toResultsJson,
} from './results.js';

const LABELS = [
  'Wrong purchases that got paid',
  'Purchases the product data could not back, paid unasked',
  'Correct purchases blocked by mistake',
  'Correct purchases where the buyer was asked for nothing',
  'Questions per held purchase',
  'Same outcome in all 3 runs',
];

function outcome(
  caseId: string,
  column: 'cap_only' | 'fitcheck',
  run: number,
  captured: boolean,
  o: Partial<CaseRunOutcome> = {},
): CaseRunOutcome {
  return {
    caseId,
    column,
    run,
    captured,
    capturedCents: captured ? 100 : 0,
    asked: false,
    lines: 0,
    decision: captured ? 'capture' : 'return_to_agent',
    reasons: [],
    failedClosed: false,
    unavailable: null,
    ...o,
  };
}
const evalCase = (id: string, cls: EvalCase['label']['class'], failure?: string): EvalCase => ({
  id,
  split: 'heldout',
  category: 'tv',
  family: id,
  request: 'r',
  known_to_agent: {},
  dossier: {},
  attempt: {
    product_id: 'UXXAg59',
    store: 'pcrichard.com',
    quantity: 1,
    price_seen_cents: 100,
    amount_cents: 100,
  },
  label: {
    class: cls,
    should_end_paid: cls === 'correct' || cls === 'correct_with_question',
    evidence: 'e',
    ...(failure ? { failure, broken_key: 'tv.screen_size' } : {}),
  },
});

const detail = (outcomes: CaseRunOutcome[], cases: EvalCase[]): RunDetail => ({
  measuredAt: '2026-11-11T20:00:00.000Z',
  model: 'claude-sonnet-5-5',
  recordedOn: '2026-11-10',
  heldOutCommit: 'abcdef1234567890',
  casesSha256: '0'.repeat(64),
  recordingsDir: 'eval/recordings/heldout/20261111-2000',
  runs: 3,
  rerun: null,
  outcomes,
  rows: computeRows(cases, outcomes),
});

describe('results', () => {
  it('expectedResults has cap-only 14, 4, 0, 7, n/a, 32 and no Fitcheck numbers', () => {
    const r = expectedResults();
    expect(r).toMatchObject({
      measuredAt: null,
      model: 'claude-sonnet-5-5',
      recordedOn: '2026-11-10',
      heldOutCommit: null,
      notes: [
        'Spending cap only numbers are what the set is built to show. Fitcheck numbers appear after the held-out run.',
      ],
    });
    expect(r.rows.map((row) => row.label)).toEqual(LABELS);
    expect(r.rows.map((row) => row.capOnly)).toEqual([14, 4, 0, 7, null, 32]);
    expect(r.rows.map((row) => row.of)).toEqual([16, 4, 12, 7, 0, 32]);
    // Only the mean row says so; a count row leaves `unit` out (ResultsRow.unit).
    expect(r.rows.map((row) => row.unit)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'mean',
      undefined,
    ]);
    expect(r.rows.every((row) => row.fitcheck === null)).toBe(true);
    for (const row of r.rows) {
      expect(row.squares.fitcheck.every((s) => s === 'pending')).toBe(true);
    }
    const wrong = r.rows[0];
    expect(wrong?.squares.capOnly).toEqual([
      ...Array(14).fill('paid_bad'),
      ...Array(2).fill('not_paid'),
    ]);
    expect(wrong?.squares.fitcheck).toHaveLength(16);
  });

  it('toResultsJson uses the medicion labels in order, and the fixed notes', () => {
    const cases = [evalCase('h-tv-01', 'wrong', 'variant'), evalCase('h-tv-02', 'correct')];
    const outcomes = [
      outcome('h-tv-01', 'cap_only', 1, true),
      outcome('h-tv-02', 'cap_only', 1, true),
      ...[1, 2, 3].map((run) => outcome('h-tv-01', 'fitcheck', run, false)),
      ...[1, 2, 3].map((run) => outcome('h-tv-02', 'fitcheck', run, true)),
    ];
    const r = toResultsJson(detail(outcomes, cases));
    expect(r.rows.map((row) => row.label)).toEqual(LABELS);
    expect(r.notes).toEqual(FIXED_NOTES);
    expect(FIXED_NOTES).toEqual([
      "Each held purchase gets one card. Questions are the lines on it, each answered yes, no or don't know.",
      'Paid means a capture exists in the payment ledger.',
      "Cases use only the first 8 results of 9 fixed Channel3 queries, recorded on 2026-11-10. None of those hair dryers says '110-120 V only', so the hair dryer cases that break a requirement come from the diffuser. The demo's ANIQ hair dryer is outside that catalog.",
    ]);
    expect(r).toMatchObject({
      measuredAt: '2026-11-11T20:00:00.000Z',
      heldOutCommit: 'abcdef1234567890',
    });
  });

  it('adds one note per rerun and per erratum, each with both numbers', () => {
    const cases = [evalCase('h-tv-01', 'wrong', 'variant')];
    const first = detail(
      [outcome('h-tv-01', 'cap_only', 1, true), outcome('h-tv-01', 'fitcheck', 1, true)],
      cases,
    );
    const rerun = {
      ...detail(
        [outcome('h-tv-01', 'cap_only', 1, true), outcome('h-tv-01', 'fitcheck', 1, false)],
        cases,
      ),
      rerun: 'citation crash',
    };
    const r = toResultsJson(rerun, {
      reruns: [{ file: 'heldout-rerun-1.json', detail: rerun }],
      first,
      errata: ['2026-11-12 h-tv-01: label fixed; wrong purchases paid 1 before, 0 after.'],
    });
    expect(r.notes).toHaveLength(FIXED_NOTES.length + 2);
    expect(r.notes[3]).toBe(
      'Rerun heldout-rerun-1.json after "citation crash". Fitcheck numbers in table order: heldout.json 1 / 0 / 0 / 0 / n/a / 1; heldout-rerun-1.json 0 / 0 / 0 / 0 / n/a / 1. Both files are in eval/results/.',
    );
    expect(r.notes[4]).toBe(
      'Erratum: 2026-11-12 h-tv-01: label fixed; wrong purchases paid 1 before, 0 after.',
    );
  });

  it('a first file measured after an interrupted live run says so', () => {
    const cases = [evalCase('h-tv-01', 'wrong', 'variant')];
    const first = {
      ...detail([outcome('h-tv-01', 'fitcheck', 1, false)], cases),
      rerun: 'crash in run 2',
    };
    const r = toResultsJson(first, { first });
    expect(r.notes.slice(FIXED_NOTES.length)).toEqual([
      'Measured after an interrupted live run ("crash in run 2") that wrote no results; its recordings stay in eval/recordings/heldout/.',
    ]);
  });

  it('readmeTable fills the medicion template', () => {
    const r: ResultsJson = {
      ...expectedResults(),
      measuredAt: '2026-11-11T20:00:00.000Z',
      heldOutCommit: 'abcdef1234567890',
    };
    const values = [3, 0, 1, 5, 1.2, 30];
    r.rows = r.rows.map((row, i) => ({ ...row, fitcheck: values[i] ?? null }));
    const table = readmeTable(r);
    expect(table).toContain('## Does it work?');
    expect(table).toContain(
      'Measured on 2026-11-11 with Claude Sonnet 5.5, on product records from Channel3 recorded on 2026-11-10.',
    );
    expect(table).toContain('They were committed (commit abcdef1) before the');
    expect(table).toContain('| 32 held-out purchase attempts | Spending cap only | Fitcheck |');
    expect(table).toContain('| Wrong purchases that got paid (of 16) | 14 | 3 |');
    expect(table).toContain('| Questions per held purchase | n/a | 1.2 |');
    expect(table).toContain('| Same outcome in all 3 runs (of 32) | 32 | 30 |');
    expect(table).toContain('Reproduce without any key: `pnpm measure --replay`.');
    expect(readmeTable(expectedResults())).toContain(
      '| Wrong purchases that got paid (of 16) | 14 | n/a |',
    );
  });

  it('missesMarkdown lists each Fitcheck miss with its label and reasons, never case text', () => {
    const cases = [
      evalCase('h-tv-01', 'wrong', 'variant'),
      evalCase('h-tv-02', 'correct'),
      evalCase('h-tv-03', 'unbacked', 'absent'),
      evalCase('h-tv-04', 'correct'),
    ];
    const outcomes = [
      outcome('h-tv-01', 'fitcheck', 1, false),
      outcome('h-tv-01', 'fitcheck', 2, true, { reasons: [] }),
      outcome('h-tv-02', 'fitcheck', 1, false, {
        reasons: [{ requirement: 'tv.screen_size', type: 'contradictory' }],
      }),
      outcome('h-tv-03', 'fitcheck', 1, true),
      outcome('h-tv-04', 'fitcheck', 1, true),
    ];
    const md = missesMarkdown(detail(outcomes, cases), cases);
    const lines = md.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toEqual([
      '- h-tv-01 · wrong/variant · paid in run 2 of 2 · reasons: none',
      '- h-tv-02 · correct · not paid in run 1 of 1 · reasons: contradictory',
      '- h-tv-03 · unbacked/absent · paid unasked in run 1 of 1 · reasons: none',
    ]);
    expect(md).not.toContain('pcrichard');
  });

  it('publishHeldout writes latest.json and misses.md, noting reruns and errata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'publish-'));
    const errataFile = join(dir, 'errata.md');
    writeFileSync(errataFile, '# Errata\n');
    const cases = [evalCase('h-tv-01', 'wrong', 'variant')];
    const first = detail(
      [outcome('h-tv-01', 'cap_only', 1, true), outcome('h-tv-01', 'fitcheck', 1, true)],
      cases,
    );
    writeFileSync(join(dir, 'heldout.json'), JSON.stringify(first));
    const latest = publishHeldout({ resultsDir: dir, errataFile, detail: first, cases });
    expect(
      ResultsJsonSchema.parse(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'))),
    ).toEqual(latest);
    expect(latest.notes).toEqual(FIXED_NOTES);
    expect(readFileSync(join(dir, 'misses.md'), 'utf8')).toContain('- h-tv-01 · wrong/variant');

    const rerun = {
      ...detail(
        [outcome('h-tv-01', 'cap_only', 1, true), outcome('h-tv-01', 'fitcheck', 1, false)],
        cases,
      ),
      rerun: 'citation crash',
    };
    writeFileSync(join(dir, 'heldout-rerun-1.json'), JSON.stringify(rerun));
    writeFileSync(errataFile, '# Errata\n\n- 2026-11-12 h-tv-01: before 1, after 0.\n');
    const again = publishHeldout({ resultsDir: dir, errataFile, detail: rerun, cases });
    expect(again.notes.slice(FIXED_NOTES.length)).toEqual([
      'Rerun heldout-rerun-1.json after "citation crash". Fitcheck numbers in table order: heldout.json 1 / 0 / 0 / 0 / n/a / 1; heldout-rerun-1.json 0 / 0 / 0 / 0 / n/a / 1. Both files are in eval/results/.',
      'Erratum: 2026-11-12 h-tv-01: before 1, after 0.',
    ]);
    expect(existsSync(join(dir, 'misses.md'))).toBe(true);
  });
});
