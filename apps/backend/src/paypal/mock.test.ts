import { describe, expect, it, vi } from 'vitest';
import { MockPaypalGateway } from './mock.js';

const input = {
  intent: 'AUTHORIZE' as const,
  amountCents: 300000,
  customId: 'cap:cap-1',
  requestId: 'cap:cap-1:create',
  returnUrl: 'http://localhost:5173/api/cap/return',
  cancelUrl: 'http://localhost:5173/cap?cancelled=1',
};
const gateway = (options: { idPrefix?: string } = {}) =>
  new MockPaypalGateway({
    webhookSecret: 'secret',
    deliverWebhook: vi.fn(async () => {}),
    ...options,
  });

async function authorized(paypal: MockPaypalGateway) {
  const order = await paypal.createOrder(input);
  await paypal.approve(order.orderId);
  const auth = await paypal.authorizeOrder(order.orderId, 'cap:cap-1:authorize');
  return { order, auth };
}
const capture = (requestId: string, amountCents: number) => ({
  amountCents,
  finalCapture: false as const,
  requestId,
  invoiceId: `purchase:${requestId}`,
});

describe('MockPaypalGateway', () => {
  it('ids carry the boot prefix', async () => {
    const paypal = gateway({ idPrefix: 'SIM-ab12cd34' });
    const { order, auth } = await authorized(paypal);
    expect(order.orderId).toBe('SIM-ab12cd34-ORDER-000001');
    expect(auth.authorizationId).toBe('SIM-ab12cd34-AUTH-000001');
    const cap = await paypal.captureAuthorization(auth.authorizationId, capture('p1', 2020));
    expect(cap.captureId).toBe('SIM-ab12cd34-CAP-000001');
  });

  it('defaults to MOCK ids and the relative simulated approve page', async () => {
    const order = await gateway().createOrder(input);
    expect(order.orderId).toBe('MOCK-ORDER-000001');
    expect(order.approveUrl).toBe('/cap/approve-simulated?token=MOCK-ORDER-000001');
  });

  it('captures twice with the same request id return one capture', async () => {
    const paypal = gateway();
    const { auth } = await authorized(paypal);
    const first = await paypal.captureAuthorization(auth.authorizationId, capture('p1', 2020));
    const second = await paypal.captureAuthorization(auth.authorizationId, capture('p1', 2020));
    expect(second.captureId).toBe(first.captureId);
    expect(
      paypal.events().filter((e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED'),
    ).toHaveLength(1);
    expect(paypal.calls('capture')).toEqual(['p1', 'p1']);
  });

  it('refuses a capture above the remaining authorization', async () => {
    const paypal = gateway();
    const { auth } = await authorized(paypal);
    await paypal.captureAuthorization(auth.authorizationId, capture('p1', 250000));
    await expect(
      paypal.captureAuthorization(auth.authorizationId, capture('p2', 60000)),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_AMOUNT_EXCEEDED', status: 422 });
  });

  it('voids the remainder after a partial capture', async () => {
    const paypal = gateway();
    const { auth } = await authorized(paypal);
    await paypal.captureAuthorization(auth.authorizationId, capture('p1', 2020));
    expect(await paypal.voidAuthorization(auth.authorizationId, 'void:cap-1')).toMatchObject({
      status: 'VOIDED',
    });
    expect(await paypal.voidAuthorization(auth.authorizationId, 'void:cap-1')).toMatchObject({
      status: 'VOIDED',
    });
    expect(
      paypal.events().filter((e) => e.event_type === 'PAYMENT.AUTHORIZATION.VOIDED'),
    ).toHaveLength(1);
    await expect(
      paypal.captureAuthorization(auth.authorizationId, capture('p2', 100)),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_VOIDED', status: 422 });
  });

  it('reauthorizes with a new id that keeps the captured total', async () => {
    const paypal = gateway();
    const { auth } = await authorized(paypal);
    await paypal.captureAuthorization(auth.authorizationId, capture('p1', 2020));
    const again = await paypal.reauthorizeAuthorization(auth.authorizationId, {
      amountCents: 297980,
      requestId: 'reauth:cap-1',
    });
    expect(again.authorizationId).toBe('MOCK-AUTH-000002');
    await expect(
      paypal.captureAuthorization(auth.authorizationId, capture('p2', 100)),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_VOIDED' });
    await expect(
      paypal.captureAuthorization(again.authorizationId, capture('p3', 297981)),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_AMOUNT_EXCEEDED' });
    expect(
      (await paypal.captureAuthorization(again.authorizationId, capture('p4', 297980))).status,
    ).toBe('COMPLETED');
  });

  it('failNext capture PENDING returns PENDING and emits nothing until settlePending', async () => {
    const paypal = gateway();
    const { auth } = await authorized(paypal);
    paypal.failNext('capture', 'PENDING');
    const pending = await paypal.captureAuthorization(auth.authorizationId, capture('p1', 2020));
    expect(pending.status).toBe('PENDING');
    const completed = () =>
      paypal.events().filter((e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED');
    expect(completed()).toHaveLength(0);
    await paypal.settlePending(pending.captureId, 'COMPLETED');
    expect(completed()).toMatchObject([
      { resource: { id: pending.captureId, invoice_id: 'purchase:p1' } },
    ]);
    const next = await paypal.captureAuthorization(auth.authorizationId, capture('p2', 100));
    expect(next.status).toBe('COMPLETED');
  });

  it('failNext with an HTTP status throws once, then the same request id succeeds', async () => {
    const paypal = gateway();
    const { auth } = await authorized(paypal);
    paypal.failNext('capture', { httpStatus: 503 });
    await expect(
      paypal.captureAuthorization(auth.authorizationId, capture('p1', 2020)),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      (await paypal.captureAuthorization(auth.authorizationId, capture('p1', 2020))).status,
    ).toBe('COMPLETED');
    expect(paypal.calls('capture')).toEqual(['p1', 'p1']);
  });

  it('failNext DECLINED returns a declined capture and keeps the amount available', async () => {
    const paypal = gateway();
    const { auth } = await authorized(paypal);
    paypal.failNext('capture', 'DECLINED');
    expect(
      (await paypal.captureAuthorization(auth.authorizationId, capture('p1', 300000))).status,
    ).toBe('DECLINED');
    expect(
      (await paypal.captureAuthorization(auth.authorizationId, capture('p2', 300000))).status,
    ).toBe('COMPLETED');
  });

  it('an unknown authorization is RESOURCE_NOT_FOUND, as after a restart', async () => {
    await expect(
      gateway().captureAuthorization('MOCK-AUTH-000001', capture('p1', 100)),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
  });

  it('signs its webhooks with the secret', async () => {
    const paypal = gateway();
    expect(await paypal.verifyWebhookSignature({ 'x-mock-signature': 'secret' }, '{}')).toEqual({
      ok: true,
    });
    expect((await paypal.verifyWebhookSignature({}, '{}')).ok).toBe(false);
  });
});
