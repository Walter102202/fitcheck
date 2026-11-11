import { ApiErrorSchema, CapSchema } from '@fitcheck/contracts';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { purchases, webhookEvents } from '../db/schema.js';
import { toPaypalAmount } from '../paypal/index.js';
import { activeCap, createHarness } from '../runs/harness.js';
import { getCap, listCapEvents } from './caps.js';
import { capturePurchase, holdPurchase, type PurchaseRef } from './purchases.js';
import { processWebhook } from './webhooks.js';

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

const signed = () => ({
  'content-type': 'application/json',
  'x-mock-signature': h.deps.env.MOCK_WEBHOOK_SECRET,
});
function postWebhook(body: unknown, headers: Record<string, string> = signed()) {
  return createApp(h.deps).request('/api/webhooks/paypal', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}
async function purchaseRow(id: string) {
  const [row] = await h.deps.db.select().from(purchases).where(eq(purchases.id, id));
  return row;
}
function lastEvent(type: string) {
  const event = h.paypal
    .events()
    .filter((e) => e.event_type === type)
    .at(-1);
  if (!event) throw new Error(`no ${type} event`);
  return event;
}

describe('PayPal webhooks', () => {
  it('rejects a webhook without a valid signature', async () => {
    h = await createHarness();
    const res = await postWebhook(
      { id: 'WH-FORGED-1', event_type: 'PAYMENT.AUTHORIZATION.CREATED', resource: { id: 'A' } },
      { 'content-type': 'application/json', 'x-mock-signature': 'wrong' },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ result: 'invalid_signature' });
    expect(await h.deps.db.select().from(webhookEvents)).toHaveLength(0);
  });

  it('a deployed simulated site accepts no webhook over HTTP, even with the mock secret', async () => {
    h = await createHarness({ env: { PAYPAL_MODE: 'sandbox' } });
    const res = await postWebhook({
      id: 'WH-FORGED-2',
      event_type: 'PAYMENT.AUTHORIZATION.CREATED',
      resource: { id: 'A' },
    });
    expect(res.status).toBe(401);
    expect(await h.deps.db.select().from(webhookEvents)).toHaveLength(0);
  });

  it('the same event id twice is processed once', async () => {
    h = await createHarness();
    const event = {
      id: 'WH-TEST-000001',
      event_type: 'PAYMENT.AUTHORIZATION.CREATED',
      resource: { id: 'AUTH-X' },
    };
    const first = await postWebhook(event);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ result: 'processed' });
    const second = await postWebhook(event);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ result: 'duplicate' });
    expect(
      await h.deps.db.select().from(webhookEvents).where(eq(webhookEvents.paypalEventId, event.id)),
    ).toHaveLength(1);
  });

  it('an unknown event type is ignored', async () => {
    h = await createHarness();
    const res = await postWebhook({
      id: 'WH-TEST-000002',
      event_type: 'CUSTOMER.DISPUTE.CREATED',
      resource: { id: 'D-1' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: 'ignored' });
  });

  it('a capture webhook after the browser path changes nothing', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const p = ref(cap.capId, 139800);
    const result = await capturePurchase(h.deps, p);
    expect(result.outcome).toBe('captured');
    const completed = lastEvent('PAYMENT.CAPTURE.COMPLETED');
    const [row] = await h.deps.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.paypalEventId, completed.id));
    expect(row?.result).toBe('processed');
    const events = await listCapEvents(h.deps.db, cap.capId);
    expect(events.filter((e) => e.type === 'captured')).toHaveLength(1);
    expect((await getCap(h.deps, cap.capId)).capturedCents).toBe(139800);
  });

  it('a capture webhook settles a pending capture', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const p = ref(cap.capId, 2020);
    h.paypal.failNext('capture', 'PENDING');
    await capturePurchase(h.deps, p);
    expect((await purchaseRow(p.purchaseId))?.status).toBe('pending');
    const captureId = String(lastEvent('PAYMENT.CAPTURE.PENDING').resource.id);
    await h.paypal.settlePending(captureId, 'COMPLETED');
    expect((await purchaseRow(p.purchaseId))?.status).toBe('captured');
    expect(await getCap(h.deps, cap.capId)).toMatchObject({ heldCents: 0, capturedCents: 2020 });
  });

  it('a capture webhook with a different amount is refused', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const p = ref(cap.capId, 2020);
    h.paypal.failNext('capture', 'PENDING');
    await capturePurchase(h.deps, p);
    const pending = lastEvent('PAYMENT.CAPTURE.PENDING');
    const before = await getCap(h.deps, cap.capId);
    const res = await postWebhook({
      id: 'WH-TEST-000003',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        ...pending.resource,
        status: 'COMPLETED',
        amount: { currency_code: 'USD', value: toPaypalAmount(1) },
      },
    });
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(await res.json()).error).toBe('payment_mismatch');
    expect(await getCap(h.deps, cap.capId)).toEqual(before);
    expect((await purchaseRow(p.purchaseId))?.status).toBe('pending');
    expect(
      await h.deps.db
        .select()
        .from(webhookEvents)
        .where(eq(webhookEvents.paypalEventId, 'WH-TEST-000003')),
    ).toHaveLength(0);
  });

  it('an order-approved webhook activates a cap whose buyer never came back', async () => {
    h = await createHarness({ env: { PAYPAL_MODE: 'sandbox' } });
    const app = createApp(h.deps);
    const cookie = /fc_session=[^;]+/.exec(
      (await app.request('/api/config')).headers.get('set-cookie') ?? '',
    )?.[0];
    if (!cookie) throw new Error('no cookie');
    const opened = await app.request('/api/cap', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'tv-sony' }),
    });
    const cap = CapSchema.parse(await opened.json());
    expect(cap.status).toBe('pending_approval');
    const token = new URL(cap.approveUrl ?? '', 'http://x').searchParams.get('token') ?? '';
    await h.paypal.approve(token);
    expect((await getCap(h.deps, cap.capId)).status).toBe('active');
    const authorized = async () =>
      (await listCapEvents(h.deps.db, cap.capId)).filter((e) => e.type === 'authorized');
    expect(await authorized()).toHaveLength(1);
    const back = await app.request(`/api/cap/return?token=${token}`, { headers: { cookie } });
    expect(back.headers.get('location')).toBe('/run/tv-sony');
    expect(await authorized()).toHaveLength(1);
  });

  it('a voided-authorization webhook marks the cap voided and releases holds', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const p = ref(cap.capId, 139800);
    await holdPurchase(h.deps, p);
    // PayPal voids the authorization on its own (for example from the dashboard).
    await h.paypal.voidAuthorization(cap.authorizationId ?? '', 'external');
    const after = await getCap(h.deps, cap.capId);
    expect(after).toMatchObject({ status: 'voided', heldCents: 0, availableCents: 0 });
    expect((await purchaseRow(p.purchaseId))?.status).toBe('not_captured');
    const types = (await listCapEvents(h.deps.db, cap.capId)).map((e) => e.type);
    expect(types).toEqual(['authorized', 'held', 'released', 'voided']);
  });

  it('a denied capture webhook releases the hold', async () => {
    h = await createHarness();
    const { cap } = await activeCap(h.deps);
    const p = ref(cap.capId, 2020);
    h.paypal.failNext('capture', 'PENDING');
    await capturePurchase(h.deps, p);
    const captureId = String(lastEvent('PAYMENT.CAPTURE.PENDING').resource.id);
    await h.paypal.settlePending(captureId, 'DENIED');
    expect((await purchaseRow(p.purchaseId))?.status).toBe('declined');
    expect(await getCap(h.deps, cap.capId)).toMatchObject({ heldCents: 0, capturedCents: 0 });
  });

  it('processWebhook reports invalid_signature without touching the ledger', async () => {
    h = await createHarness();
    const result = await processWebhook(h.deps, {
      headers: {},
      rawBody: '{}',
      verifier: h.deps.paypal.simulated,
    });
    expect(result).toEqual({ result: 'invalid_signature' });
  });
});
