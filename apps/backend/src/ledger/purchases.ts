import type { Cap, Cents, PaymentEvent } from '@fitcheck/contracts';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { AppError } from '../api/errors.js';
import type { Db } from '../db/client.js';
import { paymentEvents, purchases } from '../db/schema.js';
import {
  type CaptureResult,
  gatewayFor,
  PAYPAL_PATHS,
  PaypalError,
  verifyCaptureAmount,
} from '../paypal/index.js';
import {
  availableOf,
  type CapRow,
  expireIfDue,
  type LedgerDeps,
  lockCap,
  toCap,
  updateCap,
} from './caps.js';
import { FINAL_CAPTURE_NOTE, SENTENCES, type Tx, toEvent, writeEvent } from './events.js';

export type PurchaseRef = {
  capId: string;
  purchaseId: string;
  runId: string;
  attemptNo: number;
  productId: string;
  domain: string;
  amountCents: Cents;
};
export type LedgerReason = 'cap_short' | 'declined' | 'answers' | 'review';
export type LedgerResult = {
  outcome: 'held' | 'captured' | 'pending' | 'not_captured';
  purchaseId: string;
  amountCents: Cents;
  reason?: LedgerReason;
  cap: Cap;
  event: PaymentEvent;
};
type PurchaseRow = typeof purchases.$inferSelect;

const ENDED = new Set<PurchaseRow['status']>(['captured', 'pending', 'not_captured', 'declined']);
const SETTLED = new Set<PurchaseRow['status']>(['captured', 'not_captured', 'declined']);

function outcomeOf(status: PurchaseRow['status']): LedgerResult['outcome'] {
  if (status === 'held') return 'held';
  if (status === 'captured') return 'captured';
  if (status === 'capturing' || status === 'pending') return 'pending';
  return 'not_captured';
}

async function findPurchase(tx: Tx, purchaseId: string): Promise<PurchaseRow | undefined> {
  const [row] = await tx.select().from(purchases).where(eq(purchases.id, purchaseId));
  return row;
}

/** The result a purchase already reached, with its latest event and no new write. */
async function resultOf(tx: Tx, cap: CapRow, purchase: PurchaseRow): Promise<LedgerResult> {
  const [last] = await tx
    .select()
    .from(paymentEvents)
    .where(eq(paymentEvents.purchaseId, purchase.id))
    .orderBy(desc(paymentEvents.seq))
    .limit(1);
  if (!last) throw new Error(`purchase ${purchase.id} has no event`);
  return {
    outcome: outcomeOf(purchase.status),
    purchaseId: purchase.id,
    amountCents: purchase.amountCents,
    ...(purchase.reason ? { reason: purchase.reason } : {}),
    cap: toCap(cap),
    event: toEvent(last),
  };
}

async function insertPurchase(
  tx: Tx,
  d: Pick<LedgerDeps, 'now'>,
  p: PurchaseRef,
  status: PurchaseRow['status'],
  reason?: LedgerReason,
): Promise<PurchaseRow> {
  const now = d.now();
  const [row] = await tx
    .insert(purchases)
    .values({
      id: p.purchaseId,
      capId: p.capId,
      runId: p.runId,
      attemptNo: p.attemptNo,
      productId: p.productId,
      domain: p.domain,
      amountCents: p.amountCents,
      status,
      reason: reason ?? null,
      requestId: `capture:${p.purchaseId}`,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('purchase insert returned no row');
  return row;
}

async function setPurchase(
  tx: Tx,
  d: Pick<LedgerDeps, 'now'>,
  id: string,
  values: Partial<Omit<PurchaseRow, 'id'>>,
): Promise<PurchaseRow> {
  const [row] = await tx
    .update(purchases)
    .set({ ...values, updatedAt: d.now() })
    .where(eq(purchases.id, id))
    .returning();
  if (!row) throw new Error(`purchase ${id} not found`);
  return row;
}

function done(
  cap: CapRow,
  purchase: PurchaseRow,
  event: PaymentEvent,
  reason?: LedgerReason,
): LedgerResult {
  return {
    outcome: outcomeOf(purchase.status),
    purchaseId: purchase.id,
    amountCents: purchase.amountCents,
    ...(reason ? { reason } : {}),
    cap: toCap(cap),
    event,
  };
}

/** Ends a purchase unpaid with the cap sentence, releasing its own hold if it had one. */
async function refuseForCap(
  tx: Tx,
  d: LedgerDeps,
  cap: CapRow,
  p: PurchaseRef,
  existing: PurchaseRow | undefined,
): Promise<LedgerResult> {
  let row = cap;
  let purchase: PurchaseRow;
  if (existing) {
    const ownHold =
      existing.status === 'held' || existing.status === 'capturing' ? existing.amountCents : 0;
    if (ownHold > 0)
      row = await updateCap(tx, cap.id, { heldCents: cap.heldCents - ownHold }, d.now());
    purchase = await setPurchase(tx, d, existing.id, {
      status: 'not_captured',
      reason: 'cap_short',
    });
  } else {
    purchase = await insertPurchase(tx, d, p, 'not_captured', 'cap_short');
  }
  const event = await writeEvent(tx, d, {
    capId: cap.id,
    purchaseId: purchase.id,
    type: 'not_captured',
    amountCents: purchase.amountCents,
    sentence: SENTENCES.capShort(availableOf(row)),
    paypalCall: null,
  });
  return done(row, purchase, event, 'cap_short');
}

/** On hold for the buyer's answers: Fitcheck's ledger only, no PayPal call. */
export async function holdPurchase(d: LedgerDeps, p: PurchaseRef): Promise<LedgerResult> {
  return d.db.transaction(async (tx) => {
    let cap = await lockCap(tx, p.capId);
    const existing = await findPurchase(tx, p.purchaseId);
    if (existing) return resultOf(tx, cap, existing);
    cap = await expireIfDue(tx, cap, d.now());
    if (cap.status !== 'active' || p.amountCents > availableOf(cap)) {
      return refuseForCap(tx, d, cap, p, undefined);
    }
    const purchase = await insertPurchase(tx, d, p, 'held');
    cap = await updateCap(tx, cap.id, { heldCents: cap.heldCents + p.amountCents }, d.now());
    const event = await writeEvent(tx, d, {
      capId: cap.id,
      purchaseId: purchase.id,
      type: 'held',
      amountCents: p.amountCents,
      sentence: SENTENCES.held,
      paypalCall: null,
    });
    return done(cap, purchase, event);
  });
}

/** Not captured for a reason decided before the ledger (the review, or the cap-only check). */
export async function refusePurchase(
  d: LedgerDeps,
  p: PurchaseRef & { sentence: string; reason: 'review' | 'cap_short' },
): Promise<LedgerResult> {
  return d.db.transaction(async (tx) => {
    const cap = await lockCap(tx, p.capId);
    const existing = await findPurchase(tx, p.purchaseId);
    if (existing) return resultOf(tx, cap, existing);
    const purchase = await insertPurchase(tx, d, p, 'not_captured', p.reason);
    const event = await writeEvent(tx, d, {
      capId: cap.id,
      purchaseId: purchase.id,
      type: 'not_captured',
      amountCents: p.amountCents,
      sentence: p.sentence,
      paypalCall: null,
    });
    return done(cap, purchase, event, p.reason);
  });
}

async function capOf(db: Db, purchaseId: string): Promise<string> {
  const [row] = await db
    .select({ capId: purchases.capId })
    .from(purchases)
    .where(eq(purchases.id, purchaseId));
  if (!row) throw new AppError('not_found', 'Purchase not found', { status: 404 });
  return row.capId;
}

/** The buyer did not answer yes to every line: the hold is dropped, nothing is captured. */
export async function releaseHold(d: LedgerDeps, i: { purchaseId: string }): Promise<LedgerResult> {
  const capId = await capOf(d.db, i.purchaseId);
  return d.db.transaction(async (tx) => {
    const cap = await lockCap(tx, capId);
    const purchase = await findPurchase(tx, i.purchaseId);
    if (!purchase) throw new AppError('not_found', 'Purchase not found', { status: 404 });
    if (purchase.status !== 'held') return resultOf(tx, cap, purchase);
    const row = await updateCap(
      tx,
      cap.id,
      { heldCents: cap.heldCents - purchase.amountCents },
      d.now(),
    );
    const ended = await setPurchase(tx, d, purchase.id, {
      status: 'not_captured',
      reason: 'answers',
    });
    const event = await writeEvent(tx, d, {
      capId: cap.id,
      purchaseId: purchase.id,
      type: 'not_captured',
      amountCents: purchase.amountCents,
      sentence: SENTENCES.notSent,
      paypalCall: null,
    });
    return done(row, ended, event, 'answers');
  });
}

const captureCall = (cap: CapRow) => ({
  method: 'POST' as const,
  path: PAYPAL_PATHS.capture(cap.authorizationId ?? ''),
  note: FINAL_CAPTURE_NOTE,
});

/**
 * Captures one purchase, at most once, in three phases. No transaction stays open during the
 * PayPal call: the simulated gateway delivers PAYMENT.CAPTURE.* webhooks in-process, and the
 * webhook handler needs the same rows (DealingWith webhooks.ts, the same reason).
 */
export async function capturePurchase(
  d: LedgerDeps,
  p: PurchaseRef & { fromHold?: true },
): Promise<LedgerResult> {
  // Phase 1: under the cap lock, decide and reserve the amount.
  const phase1 = await d.db.transaction(
    async (tx): Promise<{ result: LedgerResult } | { cap: CapRow; purchase: PurchaseRow }> => {
      let cap = await lockCap(tx, p.capId);
      const existing = await findPurchase(tx, p.purchaseId);
      if (existing && ENDED.has(existing.status))
        return { result: await resultOf(tx, cap, existing) };
      // Another call is capturing it: repeat the PayPal call with the same request id.
      if (existing?.status === 'capturing') return { cap, purchase: existing };
      cap = await expireIfDue(tx, cap, d.now());
      const ownHold = existing?.status === 'held' ? existing.amountCents : 0;
      if (
        cap.status !== 'active' ||
        !cap.authorizationId ||
        p.amountCents > availableOf(cap) + ownHold
      ) {
        return { result: await refuseForCap(tx, d, cap, p, existing) };
      }
      const purchase = existing
        ? await setPurchase(tx, d, existing.id, { status: 'capturing', amountCents: p.amountCents })
        : await insertPurchase(tx, d, p, 'capturing');
      cap = await updateCap(
        tx,
        cap.id,
        { heldCents: cap.heldCents - ownHold + p.amountCents },
        d.now(),
      );
      return { cap, purchase };
    },
  );
  if ('result' in phase1) return phase1.result;
  const { cap, purchase } = phase1;

  // Phase 2: the PayPal call, retried once on a 5xx or a network error.
  const call = () =>
    gatewayFor(d.paypal, cap.mode).captureAuthorization(cap.authorizationId ?? '', {
      amountCents: purchase.amountCents,
      finalCapture: false,
      requestId: `capture:${purchase.id}`,
      invoiceId: `purchase:${purchase.id}`,
    });
  const retryable = (error: unknown) => !(error instanceof PaypalError) || error.status >= 500;
  let capture: CaptureResult;
  try {
    try {
      capture = await call();
    } catch (error) {
      if (!retryable(error)) throw error;
      d.logger.warn('ledger.capture_retry', { purchaseId: purchase.id });
      capture = await call();
    }
  } catch (error) {
    if (retryable(error)) {
      d.logger.warn('ledger.capture_unconfirmed', { purchaseId: purchase.id });
      return markPending(d, { purchaseId: purchase.id });
    }
    return refuseAfterPaypal(d, purchase.id, error as PaypalError);
  }

  // Phase 3: settle, exactly as the webhook would.
  if (capture.status === 'PENDING') {
    return markPending(d, { purchaseId: purchase.id, captureId: capture.captureId });
  }
  return settleCapture(d, {
    purchaseId: purchase.id,
    captureId: capture.captureId,
    status: capture.status,
    amount: (capture.raw as { amount?: unknown } | null)?.amount,
  });
}

/** PayPal took the capture but has not confirmed it: the amount stays on hold. */
async function markPending(
  d: LedgerDeps,
  i: { purchaseId: string; captureId?: string },
): Promise<LedgerResult> {
  const capId = await capOf(d.db, i.purchaseId);
  return d.db.transaction(async (tx) => {
    const cap = await lockCap(tx, capId);
    const purchase = await findPurchase(tx, i.purchaseId);
    if (!purchase) throw new AppError('not_found', 'Purchase not found', { status: 404 });
    if (purchase.status !== 'capturing') return resultOf(tx, cap, purchase);
    const pending = await setPurchase(tx, d, purchase.id, {
      status: 'pending',
      ...(i.captureId ? { captureId: i.captureId } : {}),
    });
    const event = await writeEvent(tx, d, {
      capId: cap.id,
      purchaseId: purchase.id,
      type: 'held',
      amountCents: purchase.amountCents,
      sentence: SENTENCES.pending,
      paypalCall: captureCall(cap),
      ...(i.captureId ? { paypalId: i.captureId } : {}),
    });
    return done(cap, pending, event);
  });
}

/** A 4xx from PayPal: declined, or the authorization is voided or unknown (restart). */
async function refuseAfterPaypal(
  d: LedgerDeps,
  purchaseId: string,
  error: PaypalError,
): Promise<LedgerResult> {
  const capGone =
    error.code === 'AUTHORIZATION_VOIDED' ||
    error.code === 'RESOURCE_NOT_FOUND' ||
    error.status === 404;
  if (!capGone) {
    d.logger.warn('ledger.capture_declined', { purchaseId, code: error.code });
    return settleCapture(d, { purchaseId, captureId: '', status: 'DECLINED' });
  }
  const capId = await capOf(d.db, purchaseId);
  d.logger.warn('ledger.capture_authorization_gone', { purchaseId, code: error.code });
  return d.db.transaction(async (tx) => {
    let cap = await lockCap(tx, capId);
    const purchase = await findPurchase(tx, purchaseId);
    if (!purchase) throw new AppError('not_found', 'Purchase not found', { status: 404 });
    if (SETTLED.has(purchase.status)) return resultOf(tx, cap, purchase);
    if (cap.status === 'active') {
      cap = await updateCap(
        tx,
        cap.id,
        { status: error.code === 'AUTHORIZATION_VOIDED' ? 'voided' : 'expired' },
        d.now(),
      );
    }
    const ref = { ...purchase, purchaseId: purchase.id };
    return refuseForCap(tx, d, cap, ref, purchase);
  });
}

/**
 * Records PayPal's verdict on a capture. Idempotent: the browser path and the webhook both
 * call it, and only the first one writes.
 */
export async function settleCapture(
  d: LedgerDeps,
  i: { purchaseId: string; captureId: string; status: 'COMPLETED' | 'DECLINED'; amount?: unknown },
): Promise<LedgerResult> {
  const capId = await capOf(d.db, i.purchaseId);
  return d.db.transaction(async (tx) => {
    const cap = await lockCap(tx, capId);
    const purchase = await findPurchase(tx, i.purchaseId);
    if (!purchase) throw new AppError('not_found', 'Purchase not found', { status: 404 });
    if (SETTLED.has(purchase.status)) return resultOf(tx, cap, purchase);
    const amount = purchase.amountCents;
    if (i.status === 'COMPLETED') {
      if (i.amount !== undefined) verifyCaptureAmount(i.amount, amount);
      const capturedCents = cap.capturedCents + amount;
      const row = await updateCap(
        tx,
        cap.id,
        {
          capturedCents,
          heldCents: cap.heldCents - amount,
          ...(cap.status === 'active' && capturedCents === cap.amountCents
            ? { status: 'exhausted' as const }
            : {}),
        },
        d.now(),
      );
      const ended = await setPurchase(tx, d, purchase.id, {
        status: 'captured',
        captureId: i.captureId || purchase.captureId,
      });
      const event = await writeEvent(tx, d, {
        capId: cap.id,
        purchaseId: purchase.id,
        type: 'captured',
        amountCents: amount,
        sentence: SENTENCES.captured(amount, cap.amountCents),
        paypalCall: captureCall(cap),
        ...(i.captureId ? { paypalId: i.captureId } : {}),
      });
      return done(row, ended, event);
    }
    const row = await updateCap(tx, cap.id, { heldCents: cap.heldCents - amount }, d.now());
    const ended = await setPurchase(tx, d, purchase.id, { status: 'declined', reason: 'declined' });
    const event = await writeEvent(tx, d, {
      capId: cap.id,
      purchaseId: purchase.id,
      type: 'not_captured',
      amountCents: amount,
      sentence: SENTENCES.declined,
      paypalCall: { method: 'POST', path: PAYPAL_PATHS.capture(cap.authorizationId ?? '') },
      ...(i.captureId ? { paypalId: i.captureId } : {}),
    });
    return done(row, ended, event, 'declined');
  });
}

/** The purchase a PayPal capture belongs to: by invoice id `purchase:<id>`, else capture id. */
export async function findPurchaseForCapture(
  db: Db,
  i: { invoiceId?: string; captureId?: string },
): Promise<PurchaseRow | undefined> {
  const id = i.invoiceId?.startsWith('purchase:') ? i.invoiceId.slice('purchase:'.length) : null;
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const row = await findPurchase(db, id);
    if (row) return row;
  }
  if (!i.captureId) return undefined;
  const [row] = await db.select().from(purchases).where(eq(purchases.captureId, i.captureId));
  return row;
}

/** The purchase of one run attempt (unique by run and attempt number). */
export async function purchaseFor(
  db: Db,
  i: { runId: string; attemptNo: number },
): Promise<PurchaseRow> {
  const [row] = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.runId, i.runId), eq(purchases.attemptNo, i.attemptNo)));
  if (!row) throw new AppError('not_found', 'Purchase not found', { status: 404 });
  return row;
}

/** A run's view of the ledger: the cap-level events and this run's purchases, in order. */
export async function listRunEvents(
  db: Db,
  i: { capId: string; runId: string },
): Promise<PaymentEvent[]> {
  const runPurchases = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(and(eq(purchases.capId, i.capId), eq(purchases.runId, i.runId)));
  const ids = runPurchases.map((r) => r.id);
  const rows = await db
    .select()
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.capId, i.capId),
        ids.length > 0
          ? or(isNull(paymentEvents.purchaseId), inArray(paymentEvents.purchaseId, ids))
          : isNull(paymentEvents.purchaseId),
      ),
    )
    .orderBy(asc(paymentEvents.seq));
  return rows.map(toEvent);
}
