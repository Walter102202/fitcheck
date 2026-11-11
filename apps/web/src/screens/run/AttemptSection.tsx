import type {
  Answer,
  Attempt,
  Category,
  Cents,
  Decision,
  RequirementResult,
} from '@fitcheck/contracts';
import type { ReactNode } from 'react';
import { OutcomeStrip } from '../../components/OutcomeStrip.js';
import { PaymentChip, type PaymentState } from '../../components/PaymentChip.js';
import { ProductCard } from '../../components/ProductCard.js';
import { QuestionCard } from '../../components/QuestionCard.js';
import { RequirementRow } from '../../components/RequirementRow.js';
import { formatClock, productNoun, summaryLine } from '../../lib/format.js';
import styles from './AttemptSection.module.css';
import { Step } from './Step.js';

const VERDICT: Record<Decision, { chip: PaymentState; note: string }> = {
  capture: { chip: 'captured', note: 'The buyer is not asked anything.' },
  ask: { chip: 'held', note: 'The payment waits and the buyer gets one card.' },
  return_to_agent: {
    chip: 'not_captured',
    note: 'The listing itself answers the question, so the buyer is not asked.',
  },
};

/** A backed check that runs on every purchase: it folds away so the verdict comes up sooner. */
export function isRoutine(r: RequirementResult): boolean {
  return r.state === 'backed' && r.origin === 'always';
}

/** The rows shown in step 3 before the fold: everything but routine and not-applicable rows. */
export function shownRows(results: RequirementResult[]): RequirementResult[] {
  return results.filter((r) => r.state !== 'not_applicable' && !isRoutine(r));
}

function RecordLine({ record }: { record: Attempt['review']['record'] }) {
  if (!record) return null;
  const when =
    record.source === 'live'
      ? `Record fetched again from Channel3 at ${formatClock(record.fetchedAt)}.`
      : `Copy recorded from Channel3 on ${record.recordedOn ?? record.fetchedAt.slice(0, 10)}.`;
  return (
    <>
      {when}
      <br />
      Nothing is taken from the agent’s word.
    </>
  );
}

function Verdict({ text, chip, note }: { text?: string; chip: PaymentState; note: string }) {
  return (
    <div className={styles.verdict}>
      {text && <span>{text}</span>}
      <PaymentChip state={chip} />
      <span className="note">{note}</span>
    </div>
  );
}

/** Two numbered steps for one pick (the product, the review of its listing), then how it ended. */
export function AttemptSection({
  attempt,
  firstStep,
  category,
  capAmountCents,
  review,
  canAnswer,
  onAnswer,
  action,
  next,
}: {
  attempt: Attempt;
  /** The number of this pick's first step; picks number on so a second pick never restarts at 1. */
  firstStep: number;
  category: Category;
  capAmountCents: Cents;
  review: 'on' | 'off';
  canAnswer: boolean;
  onAnswer: (attemptNo: number, answers: Record<string, Answer>) => Promise<void>;
  /** Given to the last strip when the run cannot go on, such as Start over when the cap ran out. */
  action?: ReactNode;
  /** The "Next purchase" link, given to the last strip once the run is done. */
  next?: ReactNode;
}) {
  const { review: result, outcome, capOnly } = attempt;
  const product = productNoun(category);
  const off = review === 'off';
  // The review said capture or ask, but the attempt ended unpaid with no answers: the cap
  // was short or inactive, or PayPal declined. Step 3 then closes on what really happened.
  const refused =
    outcome?.decision === 'return_to_agent' &&
    !attempt.answers &&
    result.decision !== 'return_to_agent';

  let checked: ReactNode;
  if (off) {
    checked = <p>Nothing was checked. The spending cap alone decides.</p>;
  } else if (result.failedClosed) {
    checked = (
      <>
        <p>Fitcheck could not check this listing.</p>
        <Verdict chip="not_captured" note="Nothing is captured when the review cannot run." />
      </>
    );
  } else {
    const shown = shownRows(result.results);
    const routine = result.results.filter(isRoutine);
    checked = (
      <>
        <div className={styles.checks}>
          {shown.map((r, i) => (
            <RequirementRow key={r.requirement} result={r} index={i} />
          ))}
          {routine.length > 0 && (
            <details className={styles.routine}>
              <summary>{routine.length} more checked on every purchase, all backed</summary>
              <div className={styles.checks}>
                {routine.map((r, i) => (
                  <RequirementRow key={r.requirement} result={r} index={i} />
                ))}
              </div>
            </details>
          )}
        </div>
        <Verdict
          text={summaryLine(result.summary)}
          chip={refused ? 'not_captured' : VERDICT[result.decision].chip}
          note={
            refused ? 'Nothing was captured. The reason is below.' : VERDICT[result.decision].note
          }
        />
      </>
    );
  }

  let ending: ReactNode = null;
  if (off) {
    // What PayPal did wins over the cap-only forecast, which was computed before paying.
    const paid = outcome ? outcome.decision === 'capture' : capOnly.outcome === 'captured';
    const offMessage = outcome?.agentMessage;
    ending = (
      <OutcomeStrip
        kind={paid ? 'unchecked' : 'not_captured'}
        amountCents={outcome ? outcome.amountCents : capOnly.amountCents}
        capAmountCents={capAmountCents}
        product={product}
        reason="review"
        {...(offMessage === undefined ? {} : { agentMessage: offMessage })}
        {...(action ? { action } : {})}
      >
        {next}
      </OutcomeStrip>
    );
  } else if (
    result.decision === 'ask' &&
    !attempt.answers &&
    !outcome &&
    canAnswer &&
    result.card
  ) {
    ending = (
      <QuestionCard
        card={result.card}
        onSubmit={(answers) => onAnswer(attempt.attemptNo, answers)}
      />
    );
  } else if (outcome) {
    const agentMessage = outcome.agentMessage ?? result.agentMessage;
    ending = (
      <OutcomeStrip
        kind={outcome.decision === 'capture' ? 'captured' : 'not_captured'}
        amountCents={outcome.amountCents}
        capAmountCents={capAmountCents}
        product={product}
        reason={result.failedClosed ? 'failed_closed' : attempt.answers ? 'answers' : 'review'}
        {...(agentMessage === undefined ? {} : { agentMessage })}
        {...(action ? { action } : {})}
      >
        {next}
      </OutcomeStrip>
    );
  }

  return (
    <>
      <Step
        n={firstStep}
        title={attempt.attemptNo > 1 ? 'The agent picked again' : 'The agent picked'}
      >
        <ProductCard pick={attempt.pick} category={category} />
      </Step>
      <Step
        n={firstStep + 1}
        title={off ? 'Fitcheck review is off' : 'Fitcheck checked the listing'}
        {...(off || result.failedClosed || !result.record
          ? {}
          : { aside: <RecordLine record={result.record} /> })}
      >
        {checked}
      </Step>
      {ending}
    </>
  );
}
