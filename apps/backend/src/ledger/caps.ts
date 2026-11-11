import type { Cap, Cents, PaypalMode } from '@fitcheck/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { AppError } from '../api/errors.js';
import { caps, purchases } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { paypalModeFor } from '../env.js';
import { gatewayFor, PAYPAL_PATHS, PaypalError } from '../paypal/index.js';
import { listCapEvents, SENTENCES, type Tx, writeEvent } from './events.js';

export { listCapEvents };

export type LedgerDeps = Pick<Deps, 'db' | 'paypal' | 'now' | 'newId' | 'logger' | 'env'>;
export type CapRow = typeof caps.$inferSelect;

/** PayPal honors an authorization for 29 days. */
export const AUTHORIZATION_DAYS = 29;
const DAY_MS = 86_400_000;

export function availableOf(row: CapRow): Cents {
  return row.status === 'active' ? row.amountCents - row.capturedCents - row.heldCents : 0;
}

export function toCap(row: CapRow): Cap {
  return {
    capId: row.id,
    mode: row.mode,
    status: row.status,
    amountCents: row.amountCents,
    capturedCents: row.capturedCents,
    heldCents: row.heldCents,
    availableCents: availableOf(row),
    ...(row.status === 'pending_approval' && row.approveUrl ? { approveUrl: row.approveUrl } : {}),
    ...(row.authorizationId ? { authorizationId: row.authorizationId } : {}),
    ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
  };
}

/** Locks the cap row for the rest of the transaction. */
export async function lockCap(tx: Tx, capId: string): Promise<CapRow> {
  const [row] = await tx.select().from(caps).where(eq(caps.id, capId)).for('update');
  if (!row) throw new AppError('not_found', 'Spending cap not found', { status: 404 });
  return row;
}

export async function updateCap(
  tx: Tx,
  capId: string,
  values: Partial<Omit<CapRow, 'id'>>,
  now: Date,
): Promise<CapRow> {
  const [row] = await tx
    .update(caps)
    .set({ ...values, updatedAt: now })
    .where(eq(caps.id, capId))
    .returning();
  if (!row) throw new AppError('not_found', 'Spending cap not found', { status: 404 });
  return row;
}

/** An active cap whose authorization is past its limit becomes expired. */
export async function expireIfDue(tx: Tx, row: CapRow, now: Date): Promise<CapRow> {
  if (row.status === 'active' && row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return updateCap(tx, row.id, { status: 'expired' }, now);
  }
  return row;
}

async function readCap(d: Pick<Deps, 'db' | 'now'>, where: ReturnType<typeof eq>) {
  return d.db.transaction(async (tx) => {
    const [row] = await tx.select().from(caps).where(where).for('update');
    if (!row) return null;
    return expireIfDue(tx, row, d.now());
  });
}

export async function getCap(d: Pick<Deps, 'db' | 'now'>, capId: string): Promise<Cap> {
  const row = await readCap(d, eq(caps.id, capId));
  if (!row) throw new AppError('not_found', 'Spending cap not found', { status: 404 });
  return toCap(row);
}

export async function latestCapForSession(
  d: Pick<Deps, 'db' | 'now'>,
  sessionId: string,
): Promise<Cap | null> {
  const [latest] = await d.db
    .select({ id: caps.id })
    .from(caps)
    .where(eq(caps.sessionId, sessionId))
    .orderBy(desc(caps.seq))
    .limit(1);
  if (!latest) return null;
  return getCap(d, latest.id);
}

/**
 * The session's latest cap, expired first when a restart forgot its simulated order. The web
 * then asks for a new cap before the next purchase instead of failing at capture.
 */
export async function currentCapForSession(d: LedgerDeps, sessionId: string): Promise<Cap | null> {
  const cap = await latestCapForSession(d, sessionId);
  if (!cap || (cap.status !== 'active' && cap.status !== 'pending_approval')) return cap;
  if (await simulatedOrderKnown(d, cap.capId)) return cap;
  d.logger.warn('caps.order_forgotten', { capId: cap.capId, status: cap.status });
  return expireCap(d, cap.capId);
}

/**
 * Opens a PayPal AUTHORIZE order for the cap. Sandbox and simulated caps wait for the buyer's
 * approval; a mock cap (tests) is approved and authorized in the same call.
 */
export async function createCap(
  d: LedgerDeps,
  i: {
    sessionId: string;
    mode: PaypalMode;
    amountCents: Cents;
    returnScenarioId: string | null;
    fallback: boolean;
  },
): Promise<Cap> {
  const capId = d.newId();
  const order = await gatewayFor(d.paypal, i.mode).createOrder({
    intent: 'AUTHORIZE',
    amountCents: i.amountCents,
    customId: `cap:${capId}`,
    requestId: `cap:${capId}:create`,
    returnUrl: `${d.env.APP_URL}/api/cap/return`,
    cancelUrl: `${d.env.APP_URL}/cap?cancelled=1`,
  });
  const now = d.now();
  const [row] = await d.db
    .insert(caps)
    .values({
      id: capId,
      sessionId: i.sessionId,
      mode: i.mode,
      status: 'pending_approval',
      amountCents: i.amountCents,
      orderId: order.orderId,
      approveUrl: order.approveUrl,
      returnScenarioId: i.returnScenarioId,
      fallback: i.fallback,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('cap insert returned no row');
  if (i.mode !== 'mock') return toCap(row);
  await d.paypal.simulated.approve(order.orderId);
  return completeApproval(d, { orderId: order.orderId });
}

/**
 * The session's spending cap: the open one if there is one, else a new one. The server picks
 * the PayPal mode, never the client: mock in tests, sandbox with credentials, and simulated
 * (with the fallback notice) without them or when the sandbox refuses to create the order.
 */
export async function openCap(
  d: LedgerDeps,
  i: { sessionId: string; returnScenarioId: string | null },
): Promise<Cap> {
  const latest = await latestCapForSession(d, i.sessionId);
  if (latest?.status === 'active') return latest;
  if (latest?.status === 'pending_approval') {
    if (await simulatedOrderKnown(d, latest.capId)) return latest;
    // A restart forgot the simulated order: the buyer could never approve it.
    d.logger.warn('caps.pending_order_forgotten', { capId: latest.capId });
    await expireCap(d, latest.capId);
  }
  const base = {
    sessionId: i.sessionId,
    amountCents: d.env.CAP_AMOUNT_CENTS,
    returnScenarioId: i.returnScenarioId,
  };
  if (paypalModeFor(d.env) === 'mock')
    return createCap(d, { ...base, mode: 'mock', fallback: false });
  if (!d.paypal.sandbox) return createCap(d, { ...base, mode: 'simulated', fallback: true });
  try {
    return await createCap(d, { ...base, mode: 'sandbox', fallback: false });
  } catch (error) {
    if (!(error instanceof PaypalError)) throw error;
    d.logger.warn('paypal.sandbox_fallback', { code: error.code, status: error.status });
    return createCap(d, { ...base, mode: 'simulated', fallback: true });
  }
}

/**
 * False only for a simulated (or mock) cap whose order the in-memory gateway no longer has,
 * which happens after a server restart. Sandbox orders live at PayPal and are always kept.
 */
async function simulatedOrderKnown(d: LedgerDeps, capId: string): Promise<boolean> {
  const [row] = await d.db
    .select({ mode: caps.mode, orderId: caps.orderId })
    .from(caps)
    .where(eq(caps.id, capId));
  if (!row?.orderId || row.mode === 'sandbox') return true;
  try {
    await d.paypal.simulated.getOrder(row.orderId);
    return true;
  } catch (error) {
    if (error instanceof PaypalError && error.status === 404) return false;
    throw error;
  }
}

/** The cap that owns this PayPal order (the `token` on the approval return). */
export async function findCapByOrder(d: Pick<Deps, 'db'>, orderId: string): Promise<CapRow | null> {
  const [row] = await d.db.select().from(caps).where(eq(caps.orderId, orderId));
  return row ?? null;
}

/**
 * Authorizes an approved order once. Safe to repeat and to race (the PayPal return and the
 * CHECKOUT.ORDER.APPROVED webhook): PayPal answers the same request id with the same
 * authorization, and the row lock lets only the first writer record it.
 */
export async function completeApproval(d: LedgerDeps, i: { orderId: string }): Promise<Cap> {
  const [found] = await d.db.select().from(caps).where(eq(caps.orderId, i.orderId));
  if (!found)
    throw new AppError('not_found', 'No spending cap has this PayPal order', { status: 404 });
  if (found.status !== 'pending_approval' && found.status !== 'active') return toCap(found);
  const auth = await gatewayFor(d.paypal, found.mode).authorizeOrder(
    i.orderId,
    `cap:${found.id}:authorize`,
  );
  return toCap(
    await d.db.transaction(async (tx) => {
      const row = await lockCap(tx, found.id);
      if (row.authorizationId || row.status !== 'pending_approval') return row;
      const now = d.now();
      const expiresAt = auth.expiresAt
        ? new Date(auth.expiresAt)
        : new Date(now.getTime() + AUTHORIZATION_DAYS * DAY_MS);
      const updated = await updateCap(
        tx,
        row.id,
        { status: 'active', authorizationId: auth.authorizationId, authorizedAt: now, expiresAt },
        now,
      );
      await writeEvent(tx, d, {
        capId: row.id,
        type: 'authorized',
        amountCents: row.amountCents,
        sentence: SENTENCES.authorized(row.amountCents),
        paypalCall: { method: 'POST', path: PAYPAL_PATHS.authorize(i.orderId) },
        paypalId: auth.authorizationId,
      });
      return updated;
    }),
  );
}

/** A cap waiting for approval has no authorization to void: it just expires. */
export async function expireCap(d: Pick<Deps, 'db' | 'now'>, capId: string): Promise<Cap> {
  return toCap(
    await d.db.transaction(async (tx) => {
      const row = await lockCap(tx, capId);
      if (row.status !== 'pending_approval' && row.status !== 'active') return row;
      return updateCap(tx, capId, { status: 'expired' }, d.now());
    }),
  );
}

/** Releases every hold on the cap, one `released` event each. Inside the caller's lock. */
async function releaseHolds(tx: Tx, d: Pick<Deps, 'newId' | 'now'>, row: CapRow): Promise<CapRow> {
  const held = await tx
    .select()
    .from(purchases)
    .where(and(eq(purchases.capId, row.id), eq(purchases.status, 'held')));
  let heldCents = row.heldCents;
  for (const purchase of held) {
    await tx
      .update(purchases)
      .set({ status: 'not_captured', reason: 'cap_short', updatedAt: d.now() })
      .where(eq(purchases.id, purchase.id));
    heldCents -= purchase.amountCents;
    await writeEvent(tx, d, {
      capId: row.id,
      purchaseId: purchase.id,
      type: 'released',
      amountCents: purchase.amountCents,
      sentence: SENTENCES.released(purchase.amountCents),
      paypalCall: null,
    });
  }
  return held.length > 0 ? updateCap(tx, row.id, { heldCents }, d.now()) : row;
}

/** Inside the caller's lock: marks the cap voided and writes the one `voided` event. */
async function recordVoided(tx: Tx, d: Pick<Deps, 'newId' | 'now'>, row: CapRow): Promise<CapRow> {
  const released = await releaseHolds(tx, d, row);
  const left = released.amountCents - released.capturedCents - released.heldCents;
  const updated = await updateCap(tx, row.id, { status: 'voided' }, d.now());
  await writeEvent(tx, d, {
    capId: row.id,
    type: 'voided',
    amountCents: left,
    sentence: SENTENCES.voided(left),
    // Fitcheck's own void call; the VOIDED webhook it triggers records the same event.
    paypalCall: { method: 'POST', path: PAYPAL_PATHS.void(row.authorizationId ?? '') },
    ...(row.authorizationId ? { paypalId: row.authorizationId } : {}),
  });
  return updated;
}

/**
 * Voids what is left of the authorization in PayPal, so the shared sandbox buyer's funds are
 * released (reset, and sessions idle too long). Holds are released first. No transaction stays
 * open during the PayPal call, because the simulated gateway delivers its webhook in-process.
 */
export async function voidCap(
  d: LedgerDeps,
  i: { capId: string; reason: 'reset' | 'idle' },
): Promise<Cap> {
  const before = await d.db.transaction(async (tx) => {
    const row = await expireIfDue(tx, await lockCap(tx, i.capId), d.now());
    return row.status === 'active' ? releaseHolds(tx, d, row) : row;
  });
  if (before.status !== 'active' || !before.authorizationId) return toCap(before);
  try {
    await gatewayFor(d.paypal, before.mode).voidAuthorization(
      before.authorizationId,
      `void:${before.id}`,
    );
  } catch (error) {
    if (error instanceof PaypalError && error.status === 404) {
      // A simulated authorization forgotten by a restart: nothing left to release.
      d.logger.warn('caps.void_unknown_authorization', { capId: before.id, reason: i.reason });
      return expireCap(d, before.id);
    }
    throw error;
  }
  d.logger.info('caps.voided', { capId: before.id, reason: i.reason });
  return toCap(
    await d.db.transaction(async (tx) => {
      const row = await lockCap(tx, before.id);
      return row.status === 'active' ? recordVoided(tx, d, row) : row;
    }),
  );
}

/** PAYMENT.AUTHORIZATION.VOIDED: the authorization is gone, so the cap is too. */
export async function markVoided(
  d: LedgerDeps,
  i: { authorizationId: string },
): Promise<Cap | null> {
  const [found] = await d.db
    .select({ id: caps.id })
    .from(caps)
    .where(eq(caps.authorizationId, i.authorizationId));
  if (!found) return null;
  return toCap(
    await d.db.transaction(async (tx) => {
      const row = await lockCap(tx, found.id);
      return row.status === 'active' ? recordVoided(tx, d, row) : row;
    }),
  );
}
