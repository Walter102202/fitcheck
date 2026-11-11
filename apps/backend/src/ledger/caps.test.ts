import { afterEach, describe, expect, it } from 'vitest';
import { createSession } from '../db/sessions.js';
import { createHarness } from '../runs/harness.js';
import { completeApproval, createCap, getCap, listCapEvents, voidCap } from './caps.js';
import { capturePurchase, holdPurchase } from './purchases.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness;
afterEach(async () => h?.close());

async function newCap(mode: 'mock' | 'simulated') {
  const sessionId = await createSession(h.deps);
  return createCap(h.deps, {
    sessionId,
    mode,
    amountCents: 300000,
    returnScenarioId: null,
    fallback: false,
  });
}
const ref = (capId: string, n: number, amountCents: number) => ({
  capId,
  purchaseId: h.deps.newId(),
  runId: h.deps.newId(),
  attemptNo: n,
  productId: 'saZdY6C',
  domain: 'walmart.com',
  amountCents,
});

describe('caps', () => {
  it('createCap in mock mode is active at once', async () => {
    h = await createHarness();
    const cap = await newCap('mock');
    expect(cap).toMatchObject({ status: 'active', mode: 'mock', availableCents: 300000 });
    expect(cap.approveUrl).toBeUndefined();
    expect(cap.authorizationId).toBe('MOCK-AUTH-000001');
    const events = await listCapEvents(h.deps.db, cap.capId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'authorized',
      amountCents: 300000,
      sentence: 'PayPal authorized $3,000.00. Nothing is captured yet.',
      paypalCall: { method: 'POST', path: '/v2/checkout/orders/MOCK-ORDER-000001/authorize' },
      paypalId: 'MOCK-AUTH-000001',
    });
    expect(events[0]?.paypalCall?.note).toBeUndefined();
    expect(h.paypal.calls('create')).toEqual([`cap:${cap.capId}:create`]);
  });

  it('createCap in simulated mode waits for approval', async () => {
    h = await createHarness();
    const cap = await newCap('simulated');
    expect(cap).toMatchObject({ status: 'pending_approval', mode: 'simulated', availableCents: 0 });
    expect(cap.approveUrl?.startsWith('/cap/approve-simulated?token=')).toBe(true);
    expect(await listCapEvents(h.deps.db, cap.capId)).toEqual([]);
  });

  it('completeApproval twice authorizes once', async () => {
    h = await createHarness();
    const cap = await newCap('simulated');
    const orderId = cap.approveUrl?.split('token=')[1] ?? '';
    await h.paypal.approve(orderId);
    const first = await completeApproval(h.deps, { orderId });
    const second = await completeApproval(h.deps, { orderId });
    expect(second).toEqual(first);
    expect(first.status).toBe('active');
    expect(first.expiresAt).toBe('2026-12-10T12:00:00.000Z');
    const events = await listCapEvents(h.deps.db, cap.capId);
    expect(events.map((e) => e.type)).toEqual(['authorized']);
    // The approval webhook, then the two calls above: one PayPal request id every time.
    expect(h.paypal.calls('authorize')).toEqual([
      `cap:${cap.capId}:authorize`,
      `cap:${cap.capId}:authorize`,
      `cap:${cap.capId}:authorize`,
    ]);
  });

  it('voidCap voids the remainder and releases holds', async () => {
    h = await createHarness();
    const cap = await newCap('mock');
    await capturePurchase(h.deps, ref(cap.capId, 1, 2020));
    await holdPurchase(h.deps, ref(cap.capId, 2, 1499));
    const voided = await voidCap(h.deps, { capId: cap.capId, reason: 'reset' });
    expect(voided).toMatchObject({
      status: 'voided',
      availableCents: 0,
      heldCents: 0,
      capturedCents: 2020,
    });
    const events = await listCapEvents(h.deps.db, cap.capId);
    expect(events.slice(-2)).toMatchObject([
      {
        type: 'released',
        amountCents: 1499,
        sentence: 'The hold on $14.99 was released. No capture sent to PayPal.',
        paypalCall: null,
      },
      {
        type: 'voided',
        amountCents: 297980,
        sentence: 'Fitcheck released the $2,979.80 left on the cap.',
        paypalCall: { method: 'POST', path: '/v2/payments/authorizations/MOCK-AUTH-000001/void' },
      },
    ]);
    expect(h.paypal.calls('void')).toEqual([`void:${cap.capId}`]);
    await voidCap(h.deps, { capId: cap.capId, reason: 'reset' });
    expect(await listCapEvents(h.deps.db, cap.capId)).toHaveLength(events.length);
    expect(h.paypal.calls('void')).toEqual([`void:${cap.capId}`]);
  });

  it('getCap expires a cap past its authorization limit', async () => {
    h = await createHarness();
    const cap = await newCap('mock');
    h.clock.set(new Date('2026-12-10T12:00:01.000Z'));
    expect(await getCap(h.deps, cap.capId)).toMatchObject({ status: 'expired', availableCents: 0 });
  });
});
