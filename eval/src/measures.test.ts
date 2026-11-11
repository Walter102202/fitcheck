import type { ResultsRow } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import type { CaseClass, EvalCase } from './case-schema.js';
import { type CaseRunOutcome, computeRows } from './measures.js';

function evalCase(id: string, cls: CaseClass): EvalCase {
  const bad = cls === 'wrong' || cls === 'unbacked';
  return {
    id,
    split: 'tuning',
    category: 'tv',
    family: id,
    request: `request ${id}`,
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
      should_end_paid: !bad,
      evidence: 'e',
      ...(bad ? { failure: cls === 'wrong' ? 'variant' : 'absent', broken_key: 'tv.size' } : {}),
    },
  };
}

function outcome(
  caseId: string,
  column: 'cap_only' | 'fitcheck',
  run: number,
  o: { captured: boolean; lines?: number },
): CaseRunOutcome {
  const lines = o.lines ?? 0;
  return {
    caseId,
    column,
    run,
    captured: o.captured,
    capturedCents: o.captured ? 100 : 0,
    asked: lines > 0,
    lines,
    decision: lines > 0 ? 'ask' : o.captured ? 'capture' : 'return_to_agent',
    reasons: [],
    failedClosed: false,
    unavailable: null,
  };
}

const rowOf = (rows: ResultsRow[], id: string): ResultsRow => {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
};

describe('computeRows', () => {
  it('a wrong case paid in one of three runs counts as paid', () => {
    const cases = [evalCase('t-tv-01', 'wrong'), evalCase('t-tv-02', 'wrong')];
    const rows = computeRows(cases, [
      outcome('t-tv-01', 'fitcheck', 1, { captured: false }),
      outcome('t-tv-01', 'fitcheck', 2, { captured: true }),
      outcome('t-tv-01', 'fitcheck', 3, { captured: false }),
      ...[1, 2, 3].map((run) => outcome('t-tv-02', 'fitcheck', run, { captured: false })),
      outcome('t-tv-01', 'cap_only', 1, { captured: true }),
      outcome('t-tv-02', 'cap_only', 1, { captured: true }),
    ]);
    const row = rowOf(rows, 'wrong_paid');
    expect(row).toMatchObject({
      label: 'Wrong purchases that got paid',
      of: 2,
      capOnly: 2,
      fitcheck: 1,
    });
    expect(row.squares).toEqual({
      capOnly: ['paid_bad', 'paid_bad'],
      fitcheck: ['paid_bad', 'not_paid'],
    });
  });

  it('a correct case blocked in one run counts as blocked', () => {
    const cases = [evalCase('t-tv-01', 'correct'), evalCase('t-tv-02', 'correct_with_question')];
    const rows = computeRows(cases, [
      outcome('t-tv-01', 'fitcheck', 1, { captured: true }),
      outcome('t-tv-01', 'fitcheck', 2, { captured: false }),
      outcome('t-tv-01', 'fitcheck', 3, { captured: true }),
      ...[1, 2, 3].map((run) => outcome('t-tv-02', 'fitcheck', run, { captured: true, lines: 1 })),
      outcome('t-tv-01', 'cap_only', 1, { captured: true }),
      outcome('t-tv-02', 'cap_only', 1, { captured: true }),
    ]);
    const row = rowOf(rows, 'correct_blocked');
    expect(row).toMatchObject({ of: 2, capOnly: 0, fitcheck: 1 });
    expect(row.squares).toEqual({
      capOnly: ['paid_good', 'paid_good'],
      fitcheck: ['not_paid', 'paid_good'],
    });
  });

  it('asked-nothing needs a capture with no card in all three runs', () => {
    const cases = [evalCase('t-tv-01', 'correct'), evalCase('t-tv-02', 'correct')];
    const rows = computeRows(cases, [
      ...[1, 2, 3].map((run) => outcome('t-tv-01', 'fitcheck', run, { captured: true })),
      outcome('t-tv-02', 'fitcheck', 1, { captured: true }),
      outcome('t-tv-02', 'fitcheck', 2, { captured: true, lines: 1 }),
      outcome('t-tv-02', 'fitcheck', 3, { captured: true }),
      outcome('t-tv-01', 'cap_only', 1, { captured: true }),
      outcome('t-tv-02', 'cap_only', 1, { captured: true }),
    ]);
    const row = rowOf(rows, 'correct_asked_nothing');
    expect(row).toMatchObject({ of: 2, capOnly: 2, fitcheck: 1 });
    expect(row.squares.fitcheck).toEqual(['paid_good', 'not_paid']);
  });

  it('unbacked paid unasked counts a capture with no card in any run', () => {
    const cases = [evalCase('t-tv-01', 'unbacked'), evalCase('t-tv-02', 'unbacked')];
    const rows = computeRows(cases, [
      outcome('t-tv-01', 'fitcheck', 1, { captured: true, lines: 1 }),
      outcome('t-tv-02', 'fitcheck', 1, { captured: true }),
      outcome('t-tv-01', 'cap_only', 1, { captured: true }),
      outcome('t-tv-02', 'cap_only', 1, { captured: false }),
    ]);
    const row = rowOf(rows, 'unbacked_paid_unasked');
    expect(row).toMatchObject({ of: 2, capOnly: 1, fitcheck: 1 });
    expect(row.squares).toEqual({
      capOnly: ['paid_bad', 'not_paid'],
      fitcheck: ['not_paid', 'paid_bad'],
    });
  });

  it('questions per held purchase averages card lines', () => {
    const cases = [evalCase('t-tv-01', 'correct_with_question')];
    const rows = computeRows(cases, [
      outcome('t-tv-01', 'fitcheck', 1, { captured: true, lines: 1 }),
      outcome('t-tv-01', 'fitcheck', 2, { captured: true, lines: 2 }),
      outcome('t-tv-01', 'fitcheck', 3, { captured: true, lines: 2 }),
      outcome('t-tv-01', 'cap_only', 1, { captured: true }),
    ]);
    expect(rowOf(rows, 'questions_per_held')).toEqual({
      id: 'questions_per_held',
      label: 'Questions per held purchase',
      of: 3,
      capOnly: null,
      fitcheck: 1.7,
      squares: { capOnly: [], fitcheck: [] },
    });
  });

  it('consistency counts cases with the same captured value in every run', () => {
    const cases = [evalCase('t-tv-01', 'correct'), evalCase('t-tv-02', 'wrong')];
    const rows = computeRows(cases, [
      ...[1, 2, 3].map((run) => outcome('t-tv-01', 'fitcheck', run, { captured: true })),
      outcome('t-tv-02', 'fitcheck', 1, { captured: false }),
      outcome('t-tv-02', 'fitcheck', 2, { captured: true }),
      outcome('t-tv-02', 'fitcheck', 3, { captured: false }),
      outcome('t-tv-01', 'cap_only', 1, { captured: true }),
      outcome('t-tv-02', 'cap_only', 1, { captured: true }),
    ]);
    expect(rowOf(rows, 'consistent')).toMatchObject({
      label: 'Same outcome in all 3 runs',
      of: 2,
      capOnly: null,
      fitcheck: 1,
    });
  });

  it('the cap-only column uses its single run', () => {
    const cases = [evalCase('t-tv-01', 'wrong'), evalCase('t-tv-02', 'correct')];
    const rows = computeRows(cases, [
      ...[1, 2, 3].map((run) => outcome('t-tv-01', 'fitcheck', run, { captured: false })),
      ...[1, 2, 3].map((run) => outcome('t-tv-02', 'fitcheck', run, { captured: true })),
      outcome('t-tv-01', 'cap_only', 1, { captured: false }),
      outcome('t-tv-02', 'cap_only', 1, { captured: false }),
    ]);
    expect(rowOf(rows, 'wrong_paid').capOnly).toBe(0);
    expect(rowOf(rows, 'correct_blocked').capOnly).toBe(1);
    expect(rows.map((r) => r.id)).toEqual([
      'wrong_paid',
      'unbacked_paid_unasked',
      'correct_blocked',
      'correct_asked_nothing',
      'questions_per_held',
      'consistent',
    ]);
  });

  it('squares follow case id order', () => {
    const cases = [evalCase('t-tv-02', 'wrong'), evalCase('t-tv-01', 'wrong')];
    const rows = computeRows(cases, [
      outcome('t-tv-02', 'fitcheck', 1, { captured: true }),
      outcome('t-tv-01', 'fitcheck', 1, { captured: false }),
      outcome('t-tv-02', 'cap_only', 1, { captured: true }),
      outcome('t-tv-01', 'cap_only', 1, { captured: true }),
    ]);
    expect(rowOf(rows, 'wrong_paid').squares.fitcheck).toEqual(['not_paid', 'paid_bad']);
  });
});
