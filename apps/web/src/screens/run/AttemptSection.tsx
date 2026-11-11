import type { Answer, Attempt, Category, Cents, Decision } from '@fitcheck/contracts';
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

function RecordLine({ record }: { record: Attempt['review']['record'] }) {
  if (!record) return null;
  const when =
    record.source === 'live'
      ? `Record fetched again from Channel3 at ${formatClock(record.fetchedAt)}.`
      : `Record from the Channel3 copy recorded on ${record.recordedOn ?? record.fetchedAt.slice(0, 10)}.`;
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

/** Steps 2 to 4 for one pick: the product, the review of its listing, and how it ended. */
export function AttemptSection({
  attempt,
  category,
  capAmountCents,
  review,
  canAnswer,
  onAnswer,
  next,
}: {
  attempt: Attempt;
  category: Category;
  capAmountCents: Cents;
  review: 'on' | 'off';
  canAnswer: boolean;
  onAnswer: (attemptNo: number, answers: Record<string, Answer>) => Promise<void>;
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
    checked = (
      <>
        <div className={styles.checks}>
          {result.results.map((r, i) => (
            <RequirementRow key={r.requirement} result={r} index={i} />
          ))}
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
        kind={paid ? 'captured' : 'not_captured'}
        amountCents={outcome ? outcome.amountCents : capOnly.amountCents}
        capAmountCents={capAmountCents}
        product={product}
        reason="review"
        {...(offMessage === undefined ? {} : { agentMessage: offMessage })}
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
      >
        {next}
      </OutcomeStrip>
    );
  }

  return (
    <>
      <Step n={2} title={attempt.attemptNo > 1 ? 'The agent picked again' : 'The agent picked'}>
        <ProductCard pick={attempt.pick} category={category} />
      </Step>
      <Step
        n={3}
        title={off ? 'Fitcheck review is off' : 'Fitcheck checked the listing'}
        {...(off || !result.record ? {} : { aside: <RecordLine record={result.record} /> })}
      >
        {checked}
      </Step>
      {ending}
    </>
  );
}
