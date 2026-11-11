import { type Cap, formatUsd, type PaymentEvent, type PaymentEventType } from '@fitcheck/contracts';
import type { CSSProperties } from 'react';
import { formatClock } from '../lib/format.js';
import styles from './PaypalPanel.module.css';

function pct(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${((part / whole) * 100).toFixed(2)}%`;
}

export function meterWidths(cap: Cap): { captured: string; held: string } {
  return {
    captured: pct(cap.capturedCents, cap.amountCents),
    held: pct(cap.heldCents, cap.amountCents),
  };
}

/** The spending cap, how much of it is captured and held, and what is left. */
export function CapMeter({ cap }: { cap: Cap }) {
  const widths = meterWidths(cap);
  return (
    <div>
      <div className={styles.capFigure}>
        <span>Spending cap, approved once</span>
        <b>{formatUsd(cap.amountCents)}</b>
      </div>
      <div className={styles.meter} data-meter aria-hidden="true">
        <i
          data-bar="captured"
          style={{ width: widths.captured }}
          {...(cap.capturedCents > 0 ? { 'data-some': '' } : {})}
        />
        <i data-bar="held" style={{ width: widths.held }} />
      </div>
      <div className={styles.split}>
        <span>
          <i className={styles.dot} data-dot="captured" />
          Captured
          <b>{formatUsd(cap.capturedCents)}</b>
        </span>
        <span>
          <i className={styles.dot} data-dot="held" />
          On hold
          <b>{formatUsd(cap.heldCents)}</b>
        </span>
        <span>
          <i className={styles.dot} data-dot="available" />
          Available
          <b>{formatUsd(cap.availableCents)}</b>
        </span>
      </div>
    </div>
  );
}

const EVENT_NAME: Record<PaymentEventType, string> = {
  authorized: 'Cap authorized',
  held: 'On hold',
  captured: 'Captured',
  not_captured: 'Not captured',
  released: 'Hold released',
  voided: 'Cap voided',
};

/** One thing that happened to the money, with the PayPal call behind it. */
export function PaymentEventItem({ event, delayMs }: { event: PaymentEvent; delayMs: number }) {
  const capture = event.type === 'captured' && event.paypalId ? ` Capture ${event.paypalId}.` : '';
  const call = event.paypalCall
    ? `${event.paypalCall.method} ${event.paypalCall.path}${event.paypalCall.note ? `, ${event.paypalCall.note}` : ''}`
    : 'No capture sent to PayPal';
  const delay = event.type === 'authorized' ? 0 : delayMs;
  return (
    <li
      className={styles.ev}
      data-type={event.type}
      style={{ '--d': `${delay}ms` } as CSSProperties}
    >
      <i className={styles.pip} />
      <b className={styles.what}>{EVENT_NAME[event.type]}</b>
      <span className={styles.amt}>{formatUsd(event.amountCents)}</span>
      <span className={styles.why}>
        {formatClock(event.at)}. {event.sentence}
        {capture}
      </span>
      <span className={styles.call}>{call}</span>
    </li>
  );
}

/** What the same purchase would have done with a spending cap and no review. */
export function CapOnlyBox({ sentence }: { sentence: string }) {
  return (
    <div className={styles.baseline}>
      <b>With a spending cap only</b>
      {sentence}
    </div>
  );
}

/** The dark panel: PayPal's side of the purchase. */
export function PaypalPanel({
  cap,
  events,
  capOnlySentence,
  eventDelayMs,
}: {
  cap: Cap;
  events: PaymentEvent[];
  capOnlySentence: string | null;
  eventDelayMs: number;
}) {
  return (
    <aside className={styles.ledger} aria-label="What PayPal did">
      <div className={styles.head}>
        <h2>PayPal</h2>
        <span>{cap.mode}</span>
      </div>
      <CapMeter cap={cap} />
      <ol className={styles.events}>
        {events.map((event) => (
          <PaymentEventItem key={event.eventId} event={event} delayMs={eventDelayMs} />
        ))}
      </ol>
      {capOnlySentence && <CapOnlyBox sentence={capOnlySentence} />}
    </aside>
  );
}
