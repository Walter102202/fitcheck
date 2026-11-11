import type { ResultsJson, ResultsRow, SquareState } from '@fitcheck/contracts';

// Mirrors eval/results/expected.json, what GET /api/results serves before the held-out run.
// Squares show what happened to each payment (eval/src/measures.ts computeRows).

function squares(...runs: [SquareState, number][]): SquareState[] {
  return runs.flatMap(([state, n]) => Array<SquareState>(n).fill(state));
}

function row(id: string, label: string, capOnly: number, capOnlySquares: SquareState[]) {
  const of = capOnlySquares.length;
  return {
    id,
    label,
    of,
    capOnly,
    fitcheck: null,
    squares: { capOnly: capOnlySquares, fitcheck: squares(['pending', of]) },
  } satisfies ResultsRow;
}

export const FIXTURE_RESULTS: ResultsJson = {
  measuredAt: null,
  model: 'claude-sonnet-5-5',
  recordedOn: '2026-11-10',
  heldOutCommit: null,
  rows: [
    row(
      'wrong_paid',
      'Wrong purchases that got paid',
      14,
      squares(['paid_bad', 14], ['not_paid', 2]),
    ),
    row(
      'unbacked_paid_unasked',
      'Purchases the product data could not back, paid unasked',
      4,
      squares(['paid_bad', 4]),
    ),
    row('correct_blocked', 'Correct purchases blocked by mistake', 0, squares(['paid_good', 12])),
    row(
      'correct_asked_nothing',
      'Correct purchases where the buyer was asked for nothing',
      7,
      squares(['paid_good', 7]),
    ),
    {
      id: 'questions_per_held',
      label: 'Questions per held purchase',
      of: 0,
      unit: 'mean',
      capOnly: null,
      fitcheck: null,
      squares: { capOnly: [], fitcheck: [] },
    },
    {
      id: 'consistent',
      label: 'Same outcome in all 3 runs',
      of: 32,
      capOnly: 32,
      fitcheck: null,
      squares: { capOnly: [], fitcheck: [] },
    },
  ],
  notes: [
    'Spending cap only numbers are what the set is built to show. Fitcheck numbers appear after the held-out run.',
  ],
};
