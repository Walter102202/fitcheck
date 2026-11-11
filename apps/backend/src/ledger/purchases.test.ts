import { afterEach, describe, expect, it } from 'vitest';
import { MockPaypalGateway } from '../paypal/mock.js';
import { activeCap, createHarness } from '../runs/harness.js';
import { getCap, listCapEvents, voidCap } from './caps.js';
import {
  capturePurchase,
  holdPurchase,
  type PurchaseRef,
  refusePurchase,
  releaseHold,
  settleCapture,
} from './purchases.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness;
afterEach(async () => h?.close());

let attempt = 0;
function ref(capId: string, amountCents: number): PurchaseRef {
  attempt += 1;
  return {
    capId,
    purchaseId: h.deps.newId(),
    runId: h.deps.newId(),
    attemptNo: attempt,
    productId: 'UXXAg59',
    domain: 'pcrichard.com',
    amountCents,
  };
}

describe('purchases', () => {
  it('holds without a PayPal call', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const result = await holdPurchase(h.deps, ref(cap.capId, 139800));
    expect(result.outcome).toBe('held');
    expect(result.cap).toMatchObject({ heldCents: 139800, availableCents: 160200 });
    expect(result.event).toMatchObject({
      type: 'held',
      amountCents: 139800,
      sentence: 'No capture sent to PayPal.',
      paypalCall: null,
    });
    expect(h.paypal.calls('capture')).toEqual([]);
  });

  it('captures a held purchase once', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const p = ref(cap.capId, 139800);
    await holdPurchase(h.deps, p);
    const [a, b] = await Promise.all([
      capturePurchase(h.deps, { ...p, fromHold: true }),
      capturePurchase(h.deps, { ...p, fromHold: true }),
    ]);
    expect(a.outcome).toBe('captured');
    expect(b.outcome).toBe('captured');
    const events = await listCapEvents(h.deps.db, cap.capId);
    expect(events.filter((e) => e.type === 'captured')).toHaveLength(1);
    const after = await getCap(h.deps, cap.capId);
    expect(after).toMatchObject({ capturedCents: 139800, heldCents: 0 });
    expect(new Set(h.paypal.calls('capture'))).toEqual(new Set([`capture:${p.purchaseId}`]));
    expect(
      h.paypal.events().filter((e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED'),
    ).toHaveLength(1);
  });

  it('writes the captured event with the PayPal call', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const result = await capturePurchase(h.deps, ref(cap.capId, 2020));
    expect(result.event).toMatchObject({
      type: 'captured',
      amountCents: 2020,
      sentence: 'PayPal captured $20.20 from the $3,000.00 cap.',
      paypalCall: {
        method: 'POST',
        path: '/v2/payments/authorizations/MOCK-AUTH-000001/capture',
        note: 'final_capture: false',
      },
      paypalId: 'MOCK-CAP-000001',
    });
  });

  it('retries a PayPal 5xx once with the same request id', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const p = ref(cap.capId, 2020);
    h.paypal.failNext('capture', { httpStatus: 503 });
    const result = await capturePurchase(h.deps, p);
    expect(result.outcome).toBe('captured');
    expect(h.paypal.calls('capture')).toEqual([
      `capture:${p.purchaseId}`,
      `capture:${p.purchaseId}`,
    ]);
    expect(
      h.paypal.events().filter((e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED'),
    ).toHaveLength(1);
  });

  it('never captures above available', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    expect((await capturePurchase(h.deps, ref(cap.capId, 250000))).outcome).toBe('captured');
    const second = await capturePurchase(h.deps, ref(cap.capId, 60000));
    expect(second).toMatchObject({ outcome: 'not_captured', reason: 'cap_short' });
    expect(second.event).toMatchObject({
      type: 'not_captured',
      sentence: 'The spending cap has $500.00 left.',
      paypalCall: null,
    });
    expect(h.paypal.calls('capture')).toHaveLength(1);
  });

  it('a voided cap captures nothing', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    await voidCap(h.deps, { capId: cap.capId, reason: 'reset' });
    const result = await capturePurchase(h.deps, ref(cap.capId, 2020));
    expect(result).toMatchObject({ outcome: 'not_captured', reason: 'cap_short' });
    expect(result.event.sentence).toBe('The spending cap is no longer active.');
    expect(h.paypal.calls('capture')).toEqual([]);
  });

  it('an expired authorization captures nothing', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    h.clock.set(new Date(new Date(cap.expiresAt ?? '').getTime() + 1000));
    const result = await capturePurchase(h.deps, ref(cap.capId, 2020));
    expect(result.cap.status).toBe('expired');
    expect(result).toMatchObject({ outcome: 'not_captured' });
    expect(result.event.sentence).toBe('The spending cap is no longer active.');
    expect(h.paypal.calls('capture')).toEqual([]);
  });

  it('a declined capture releases the amount', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    h.paypal.failNext('capture', 'DECLINED');
    const result = await capturePurchase(h.deps, ref(cap.capId, 2020));
    expect(result).toMatchObject({ outcome: 'not_captured', reason: 'declined' });
    expect(result.event).toMatchObject({
      type: 'not_captured',
      sentence: 'PayPal declined the capture.',
      paypalCall: { method: 'POST', path: '/v2/payments/authorizations/MOCK-AUTH-000001/capture' },
    });
    expect(result.cap.availableCents).toBe(300000);
  });

  it('a pending capture stays on hold until PayPal settles it', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const p = ref(cap.capId, 2020);
    h.paypal.failNext('capture', 'PENDING');
    const pending = await capturePurchase(h.deps, p);
    expect(pending.outcome).toBe('pending');
    expect(pending.event).toMatchObject({
      type: 'held',
      sentence: 'PayPal has not confirmed this capture yet.',
    });
    expect(pending.cap.heldCents).toBe(2020);
    const captureId = pending.event.paypalId ?? '';
    const settled = await settleCapture(h.deps, {
      purchaseId: p.purchaseId,
      captureId,
      status: 'COMPLETED',
    });
    expect(settled.outcome).toBe('captured');
    expect(settled.cap).toMatchObject({ heldCents: 0, capturedCents: 2020 });
    const again = await settleCapture(h.deps, {
      purchaseId: p.purchaseId,
      captureId,
      status: 'COMPLETED',
    });
    expect(again.outcome).toBe('captured');
    const events = await listCapEvents(h.deps.db, cap.capId);
    expect(events.filter((e) => e.type === 'captured')).toHaveLength(1);
  });

  it('a simulated cap forgotten after a restart expires', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    h.deps.paypal.simulated = new MockPaypalGateway({ webhookSecret: 'x' });
    const result = await capturePurchase(h.deps, ref(cap.capId, 2020));
    expect(result.outcome).toBe('not_captured');
    expect(result.cap.status).toBe('expired');
    expect(result.event.sentence).toBe('The spending cap is no longer active.');
  });

  it('refusePurchase records not_captured without a PayPal call', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const result = await refusePurchase(h.deps, {
      ...ref(cap.capId, 2929),
      sentence: 'No capture sent to PayPal.',
      reason: 'review',
    });
    expect(result).toMatchObject({ outcome: 'not_captured', reason: 'review', amountCents: 2929 });
    expect(result.event).toMatchObject({
      type: 'not_captured',
      amountCents: 2929,
      sentence: 'No capture sent to PayPal.',
      paypalCall: null,
    });
    expect(result.cap.availableCents).toBe(300000);
    expect(h.paypal.calls('capture')).toEqual([]);
  });

  it('releaseHold returns the held amount and ends the purchase once', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const p = ref(cap.capId, 139800);
    await holdPurchase(h.deps, p);
    const released = await releaseHold(h.deps, { purchaseId: p.purchaseId });
    expect(released).toMatchObject({ outcome: 'not_captured', reason: 'answers' });
    expect(released.event).toMatchObject({
      type: 'not_captured',
      sentence: 'No capture sent to PayPal.',
    });
    expect(released.cap).toMatchObject({ heldCents: 0, availableCents: 300000 });
    const again = await capturePurchase(h.deps, { ...p, fromHold: true });
    expect(again.outcome).toBe('not_captured');
    expect(h.paypal.calls('capture')).toEqual([]);
  });

  it('a hold refused by the cap is not captured with the cap sentence', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps, { amountCents: 1000 });
    const result = await holdPurchase(h.deps, ref(cap.capId, 139800));
    expect(result).toMatchObject({ outcome: 'not_captured', reason: 'cap_short' });
    expect(result.event.sentence).toBe('The spending cap has $10.00 left.');
  });

  it('a capture equal to what is left exhausts the cap', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps, { amountCents: 2020 });
    const result = await capturePurchase(h.deps, ref(cap.capId, 2020));
    expect(result.cap).toMatchObject({ status: 'exhausted', availableCents: 0 });
  });
});
