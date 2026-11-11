import type { Cents, Decision, ReasonType, ResultsRow, SquareState } from '@fitcheck/contracts';
import type { UnavailableReason } from '../../apps/backend/src/runs/ports.js';
import type { CaseClass, EvalCase } from './case-schema.js';

export type Column = 'cap_only' | 'fitcheck';

/** One case run once in one column: what the ledger captured and what the review did. */
export type CaseRunOutcome = {
  caseId: string;
  column: Column;
  run: number;
  captured: boolean;
  capturedCents: Cents;
  asked: boolean;
  lines: number;
  decision: Decision;
  reasons: { requirement: string; type: ReasonType }[];
  failedClosed: boolean;
  unavailable: UnavailableReason | null;
  /** The requirements of the card lines the buyer answered; empty when no card reached them. */
  cardRequirements: string[];
  /** The ledger refused the hold or the capture: the cap was short, inactive, or PayPal declined. */
  capRefused: boolean;
};

/**
 * Was this unpaid case-run stopped for the requirement that made the purchase wrong? Yes when a
 * review reason or a card line names the broken key, or, for an over-cap purchase, when the cap
 * refused it (the cap is what that purchase breaks).
 */
export function stoppedForBrokenKey(c: EvalCase, o: CaseRunOutcome): boolean {
  if (c.label.failure === 'over_cap' && o.capRefused) return true;
  const key = c.label.broken_key;
  if (key === undefined) return false;
  return o.reasons.some((r) => r.requirement === key) || o.cardRequirements.includes(key);
}

export type WrongStops = {
  /** Fitcheck case-runs of wrong cases that ended unpaid. */
  notPaid: number;
  /** Of those, the ones stopped for the broken key. */
  rightReason: number;
  /** The rest, sorted by case id and run. */
  others: CaseRunOutcome[];
};

/** medicion.md §2: a wrong purchase stopped by a question about something else is a miss. */
export function wrongStops(cases: EvalCase[], outcomes: CaseRunOutcome[]): WrongStops {
  const wrong = new Map(cases.filter((c) => c.label.class === 'wrong').map((c) => [c.id, c]));
  const unpaid = outcomes
    .filter((o) => o.column === 'fitcheck' && !o.captured && wrong.has(o.caseId))
    .sort((a, b) => a.caseId.localeCompare(b.caseId) || a.run - b.run);
  const others = unpaid.filter((o) => {
    const c = wrong.get(o.caseId);
    return c !== undefined && !stoppedForBrokenKey(c, o);
  });
  return { notPaid: unpaid.length, rightReason: unpaid.length - others.length, others };
}

type Runs = CaseRunOutcome[];
const BAD: SquareState = 'paid_bad';
const GOOD: SquareState = 'paid_good';
const NONE: SquareState = 'not_paid';

const paidUnasked = (o: CaseRunOutcome) => o.captured && !o.asked;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The six rows of the results table (04-lane-c C12). A bad outcome counts if it happens in any
 * run; a good outcome counts only if it holds in every run. The cap-only column has one run.
 */
export function computeRows(cases: EvalCase[], outcomes: CaseRunOutcome[]): ResultsRow[] {
  const sorted = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  const runsOf = (c: EvalCase, column: Column): Runs =>
    outcomes.filter((o) => o.caseId === c.id && o.column === column);
  const ofClass = (...classes: CaseClass[]) =>
    sorted.filter((c) => classes.includes(c.label.class));

  /** A count row: `hit` decides each case per column; the squares show the paid state. */
  const countRow = (
    id: string,
    label: string,
    group: EvalCase[],
    hit: (runs: Runs) => boolean,
    square: (runs: Runs) => SquareState,
  ): ResultsRow => {
    const column = (col: Column) => {
      const per = group.map((c) => runsOf(c, col));
      return { value: per.filter(hit).length, squares: per.map(square) };
    };
    const capOnly = column('cap_only');
    const fitcheck = column('fitcheck');
    return {
      id,
      label,
      of: group.length,
      capOnly: capOnly.value,
      fitcheck: fitcheck.value,
      squares: { capOnly: capOnly.squares, fitcheck: fitcheck.squares },
    };
  };

  const anyCaptured = (runs: Runs) => runs.some((o) => o.captured);
  const everyCaptured = (runs: Runs) => runs.length > 0 && runs.every((o) => o.captured);
  const everyUnasked = (runs: Runs) => runs.length > 0 && runs.every(paidUnasked);

  const held = outcomes.filter((o) => o.column === 'fitcheck' && o.asked);
  const consistent = (runs: Runs) =>
    runs.length > 0 && runs.every((o) => o.captured === runs[0]?.captured);

  return [
    countRow(
      'wrong_paid',
      'Wrong purchases that got paid',
      ofClass('wrong'),
      anyCaptured,
      (runs) => (anyCaptured(runs) ? BAD : NONE),
    ),
    countRow(
      'unbacked_paid_unasked',
      'Purchases the product data could not back, paid unasked',
      ofClass('unbacked'),
      (runs) => runs.some(paidUnasked),
      (runs) => (runs.some(paidUnasked) ? BAD : NONE),
    ),
    countRow(
      'correct_blocked',
      'Correct purchases blocked by mistake',
      ofClass('correct', 'correct_with_question'),
      (runs) => !everyCaptured(runs),
      (runs) => (everyCaptured(runs) ? GOOD : NONE),
    ),
    countRow(
      'correct_asked_nothing',
      'Correct purchases where the buyer was asked for nothing',
      ofClass('correct'),
      everyUnasked,
      (runs) => (everyUnasked(runs) ? GOOD : NONE),
    ),
    {
      id: 'questions_per_held',
      label: 'Questions per held purchase',
      of: held.length,
      unit: 'mean',
      capOnly: null,
      fitcheck:
        held.length === 0 ? null : round1(held.reduce((sum, o) => sum + o.lines, 0) / held.length),
      squares: { capOnly: [], fitcheck: [] },
    },
    {
      id: 'consistent',
      label: 'Same outcome in all 3 runs',
      of: sorted.length,
      capOnly: sorted.map((c) => runsOf(c, 'cap_only')).filter(consistent).length,
      fitcheck: sorted.map((c) => runsOf(c, 'fitcheck')).filter(consistent).length,
      squares: { capOnly: [], fitcheck: [] },
    },
  ];
}
