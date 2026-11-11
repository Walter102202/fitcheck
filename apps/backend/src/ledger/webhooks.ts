import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../api/errors.js';
import { webhookEvents } from '../db/schema.js';
import { type MockWebhookEvent, type PaypalGateway, verifyCaptureAmount } from '../paypal/index.js';
import { completeApproval, findCapByOrder, type LedgerDeps, markVoided } from './caps.js';
import { findPurchaseForCapture, settleCapture } from './purchases.js';

export type WebhookResult = 'processed' | 'duplicate' | 'ignored' | 'invalid_signature';

const EventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource: z.record(z.string(), z.unknown()),
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** The purchase a capture event belongs to: invoice id `purchase:<id>`, else the capture id. */
async function purchaseOf(d: LedgerDeps, resource: Record<string, unknown>) {
  const invoiceId = text(resource.invoice_id);
  const captureId = text(resource.id);
  return findPurchaseForCapture(d.db, {
    ...(invoiceId ? { invoiceId } : {}),
    ...(captureId ? { captureId } : {}),
  });
}

/** Inside the event's transaction: what each event type does to the ledger. */
async function dispatch(
  d: LedgerDeps,
  type: string,
  resource: Record<string, unknown>,
): Promise<'processed' | 'ignored'> {
  switch (type) {
    case 'PAYMENT.AUTHORIZATION.CREATED':
    case 'PAYMENT.CAPTURE.PENDING':
      return 'processed';
    case 'CHECKOUT.ORDER.APPROVED': {
      const orderId = text(resource.id);
      return orderId && (await findCapByOrder(d, orderId)) ? 'processed' : 'ignored';
    }
    case 'PAYMENT.AUTHORIZATION.VOIDED': {
      const authorizationId = text(resource.id);
      if (!authorizationId) return 'ignored';
      return (await markVoided(d, { authorizationId })) ? 'processed' : 'ignored';
    }
    case 'PAYMENT.CAPTURE.COMPLETED': {
      const purchase = await purchaseOf(d, resource);
      if (!purchase) return 'ignored';
      verifyCaptureAmount(resource.amount, purchase.amountCents);
      await settleCapture(d, {
        purchaseId: purchase.id,
        captureId: text(resource.id) ?? '',
        status: 'COMPLETED',
      });
      return 'processed';
    }
    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.DECLINED': {
      const purchase = await purchaseOf(d, resource);
      if (!purchase || (purchase.status !== 'pending' && purchase.status !== 'capturing'))
        return 'ignored';
      await settleCapture(d, {
        purchaseId: purchase.id,
        captureId: text(resource.id) ?? '',
        status: 'DECLINED',
      });
      return 'processed';
    }
    default:
      return 'ignored';
  }
}

/**
 * A PayPal webhook (adapted from DealingWith workflows/webhooks.ts): signature check, one
 * `webhook_events` row per PayPal event id, and dispatch inside that row's transaction, so a
 * failed dispatch (a 409 amount mismatch) leaves no row and PayPal's retry is processed again.
 * Every handler converges with the browser path: whichever arrives first writes.
 */
export async function processWebhook(
  d: LedgerDeps,
  i: { headers: Record<string, string>; rawBody: string; verifier: PaypalGateway; host?: string },
): Promise<{ result: WebhookResult }> {
  const check = await i.verifier.verifyWebhookSignature(i.headers, i.rawBody);
  if (!check.ok) {
    // Enough to tell a missing header from PayPal refusing the body. Never the body itself.
    const lower = Object.fromEntries(
      Object.entries(i.headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const transmissionId = lower['paypal-transmission-id'];
    d.logger.warn('webhook.rejected', {
      reason: check.reason,
      ...(check.verificationStatus ? { verificationStatus: check.verificationStatus } : {}),
      ...(i.host ? { host: i.host } : {}),
      ...(transmissionId ? { transmissionId } : {}),
      bodyBytes: Buffer.byteLength(i.rawBody),
    });
    return { result: 'invalid_signature' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(i.rawBody);
  } catch {
    throw new AppError('invalid_webhook', 'Webhook body must be JSON', { status: 400 });
  }
  const validation = EventSchema.safeParse(parsed);
  if (!validation.success) {
    throw new AppError('invalid_webhook', 'Webhook id, type and resource are required', {
      status: 400,
    });
  }
  const event = validation.data;
  const orderId = text(event.resource.id);
  if (event.event_type === 'CHECKOUT.ORDER.APPROVED' && orderId) {
    const [seen] = await d.db
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(eq(webhookEvents.paypalEventId, event.id));
    if (seen) return { result: 'duplicate' };
    const cap = await findCapByOrder(d, orderId);
    // No transaction open during the PayPal call: the simulated gateway answers with an
    // in-process webhook of its own.
    if (cap?.status === 'pending_approval') await completeApproval(d, { orderId });
  }
  const result = await d.db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(webhookEvents)
      .values({
        paypalEventId: event.id,
        eventType: event.event_type,
        resourceId: text(event.resource.id) ?? null,
        payload: record(parsed),
        receivedAt: d.now(),
      })
      .onConflictDoNothing({ target: webhookEvents.paypalEventId })
      .returning();
    if (!inserted) return 'duplicate' as const;
    const outcome = await dispatch({ ...d, db: tx }, event.event_type, event.resource);
    await tx
      .update(webhookEvents)
      .set({ result: outcome, processedAt: d.now() })
      .where(eq(webhookEvents.id, inserted.id));
    return outcome;
  });
  d.logger.info('webhook.processed', { eventId: event.id, type: event.event_type, result });
  return { result };
}

/**
 * The simulated gateway's `deliverWebhook`: its signed events go straight into processWebhook,
 * verified by the gateway that is current at delivery time (a restart replaces it).
 */
export async function deliverInProcess(
  d: LedgerDeps,
  event: MockWebhookEvent,
  headers: Record<string, string>,
): Promise<void> {
  await processWebhook(d, {
    headers,
    rawBody: JSON.stringify(event),
    verifier: d.paypal.simulated,
  });
}
