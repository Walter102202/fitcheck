import type { ResultsJson, ResultsRow, SquareState } from '@fitcheck/contracts';

// The "Spending cap only" rows are the mockup's; Fitcheck's rows wait for the held-out run.

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
      'unbacked_paid',
      'Purchases the listing could not back, paid without asking',
      4,
      squares(['paid_bad', 4]),
    ),
    row('good_blocked', 'Correct purchases blocked by mistake', 0, squares(['not_paid', 12])),
    row(
      'good_unasked',
      'Correct purchases where the buyer was asked nothing',
      7,
      squares(['paid_good', 7]),
    ),
  ],
  notes: [
    'The buyer here is simulated and always reads the question. We chose the mix of right and wrong purchases, so these are not rates you would see in production. Labels are judged against the Channel3 record, not the physical product. “Spending cap only” is the same payment flow with the review switched off. “Paid” means a capture exists in the payment ledger.',
  ],
};
