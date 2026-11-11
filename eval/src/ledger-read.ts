import type { Cents } from '@fitcheck/contracts';
import type { Deps } from '../../apps/backend/src/deps.js';
import { listCapEvents } from '../../apps/backend/src/ledger/caps.js';
import { findPurchaseForCapture } from '../../apps/backend/src/ledger/purchases.js';
import { fromPaypalAmount } from '../../apps/backend/src/paypal/index.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * What the ledger captured for a purchase, read from its `captured` event, and checked against
 * the mock gateway's PAYMENT.CAPTURE.COMPLETED events for invoice `purchase:<id>`. The two
 * disagreeing is a harness error, never a measured outcome.
 */
export async function capturedFor(
  deps: Pick<Deps, 'db' | 'paypal'>,
  purchaseId: string,
): Promise<{ captured: boolean; capturedCents: Cents }> {
  const invoiceId = `purchase:${purchaseId}`;
  const purchase = await findPurchaseForCapture(deps.db, { invoiceId });
  const events = purchase ? await listCapEvents(deps.db, purchase.capId) : [];
  const captured = events.filter((e) => e.purchaseId === purchaseId && e.type === 'captured');
  const ledgerCents = captured.reduce((sum, e) => sum + e.amountCents, 0);
  const paypal = deps.paypal.simulated
    .events()
    .filter(
      (e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED' && e.resource.invoice_id === invoiceId,
    );
  const paypalCents = paypal.reduce(
    (sum, e) => sum + fromPaypalAmount(String(record(e.resource.amount).value)),
    0,
  );
  if (captured.length !== paypal.length || ledgerCents !== paypalCents) {
    throw new Error(
      `Ledger and PayPal disagree on purchase ${purchaseId}: ledger ${captured.length} capture(s) ` +
        `of ${ledgerCents} cents, PayPal ${paypal.length} of ${paypalCents} cents.`,
    );
  }
  return { captured: captured.length > 0, capturedCents: ledgerCents };
}
