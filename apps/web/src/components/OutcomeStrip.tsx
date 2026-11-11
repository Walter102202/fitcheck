import { type Cents, formatUsd } from '@fitcheck/contracts';
import type { ReactNode } from 'react';
import { Check, CircleSlash, ICON_PROPS, Undo2 } from './icons.js';
import styles from './OutcomeStrip.module.css';

type Reason = 'review' | 'answers' | 'failed_closed';

function sentences(
  kind: 'captured' | 'not_captured',
  reason: Reason,
  amount: string,
  cap: string,
  product: string,
): [bold: string, rest: string] {
  if (kind === 'captured')
    return [
      `PayPal captured ${amount} from the ${cap} cap.`,
      reason === 'answers'
        ? 'You answered yes to every line.'
        : 'The amount is the price of the store offer at the moment of paying, not a number from the agent.',
    ];
  if (reason === 'failed_closed')
    return [
      'Fitcheck could not check this listing.',
      'Nothing is captured when the review cannot run.',
    ];
  return [
    `PayPal captured nothing for this ${product}.`,
    reason === 'answers'
      ? 'You did not accept every line, so the purchase went back to the agent.'
      : 'It went back to the agent with the reason.',
  ];
}

/** How a purchase ended: the payment state in large type, and why. */
export function OutcomeStrip({
  kind,
  amountCents,
  capAmountCents,
  product,
  reason,
  agentMessage,
  children,
}: {
  kind: 'captured' | 'not_captured';
  amountCents: Cents;
  capAmountCents: Cents;
  product: string;
  reason: Reason;
  agentMessage?: string;
  children?: ReactNode;
}) {
  const captured = kind === 'captured';
  const Icon = captured ? Check : CircleSlash;
  const [bold, rest] = sentences(
    kind,
    reason,
    formatUsd(amountCents),
    formatUsd(capAmountCents),
    product,
  );
  return (
    <div className={styles.outcome} role="status" data-kind={kind}>
      <div className={styles.label}>
        <Icon {...ICON_PROPS} size={28} strokeWidth={2.2} />
        {captured ? 'Captured' : 'Not captured'}
        <span className="mono">{formatUsd(captured ? amountCents : 0)}</span>
      </div>
      <div className={styles.body}>
        <p>
          <b>{bold}</b> {rest}
        </p>
        {agentMessage && (
          <div className={styles.returned}>
            <Undo2 {...ICON_PROPS} />
            <span>
              <b>Sent to the agent:</b> {agentMessage}
            </span>
          </div>
        )}
        {children && <p className="note">{children}</p>}
      </div>
    </div>
  );
}
