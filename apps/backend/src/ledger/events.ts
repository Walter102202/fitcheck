import { type Cents, formatUsd, type PaymentEvent, type PaypalCall } from '@fitcheck/contracts';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { paymentEvents } from '../db/schema.js';
import type { Deps } from '../deps.js';

/** Every sentence the PayPal panel shows, in one place. Amounts go through formatUsd. */
export const SENTENCES = {
  authorized: (amount: Cents) => `PayPal authorized ${formatUsd(amount)}. Nothing is captured yet.`,
  reauthorized: 'PayPal authorized the cap again before its 29-day limit.',
  held: 'No capture sent to PayPal.',
  pending: 'PayPal has not confirmed this capture yet.',
  captured: (amount: Cents, cap: Cents) =>
    `PayPal captured ${formatUsd(amount)} from the ${formatUsd(cap)} cap.`,
  notSent: 'No capture sent to PayPal.',
  capShort: (available: Cents) => `The spending cap has ${formatUsd(available)} left.`,
  capInactive: 'The spending cap is no longer active.',
  declined: 'PayPal declined the capture.',
  voided: (amount: Cents) => `Fitcheck released the ${formatUsd(amount)} left on the cap.`,
  released: (amount: Cents) =>
    `The hold on ${formatUsd(amount)} was released. No capture sent to PayPal.`,
} as const;

/** Shown beside capture calls: Fitcheck never closes the authorization by capturing. */
export const FINAL_CAPTURE_NOTE = 'final_capture: false';

type EventRow = typeof paymentEvents.$inferSelect;
/** A transaction or the db itself: anything that can insert and select. */
export type Tx = Pick<Db, 'insert' | 'select' | 'update' | 'execute'>;

export function toEvent(row: EventRow): PaymentEvent {
  return {
    eventId: row.id,
    ...(row.purchaseId ? { purchaseId: row.purchaseId } : {}),
    type: row.type,
    amountCents: row.amountCents,
    at: row.at.toISOString(),
    sentence: row.sentence,
    paypalCall: row.paypalCall ?? null,
    ...(row.paypalId ? { paypalId: row.paypalId } : {}),
  };
}

export async function writeEvent(
  tx: Tx,
  d: Pick<Deps, 'newId' | 'now'>,
  e: {
    capId: string;
    purchaseId?: string;
    type: PaymentEvent['type'];
    amountCents: Cents;
    sentence: string;
    paypalCall: PaypalCall | null;
    paypalId?: string;
  },
): Promise<PaymentEvent> {
  const [row] = await tx
    .insert(paymentEvents)
    .values({
      id: d.newId(),
      capId: e.capId,
      purchaseId: e.purchaseId ?? null,
      type: e.type,
      amountCents: e.amountCents,
      at: d.now(),
      sentence: e.sentence,
      paypalCall: e.paypalCall,
      paypalId: e.paypalId ?? null,
    })
    .returning();
  if (!row) throw new Error('payment event insert returned no row');
  return toEvent(row);
}

/** Every event of a cap, in the order written. */
export async function listCapEvents(db: Tx, capId: string): Promise<PaymentEvent[]> {
  const rows = await db
    .select()
    .from(paymentEvents)
    .where(eq(paymentEvents.capId, capId))
    .orderBy(asc(paymentEvents.seq));
  return rows.map(toEvent);
}
