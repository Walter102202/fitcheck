import { expect, it, vi } from 'vitest';
import { SandboxPaypalGateway } from './sandbox.js';

const input = {
  intent: 'AUTHORIZE' as const,
  amountCents: 300000,
  customId: 'cap:cap-1',
  requestId: 'cap:cap-1:create',
  returnUrl: 'https://example.com/api/cap/return',
  cancelUrl: 'https://example.com/cap?cancelled=1',
};
const amount = { currency_code: 'USD', value: '3000.00' };
const capture = {
  id: 'capture-1',
  status: 'COMPLETED',
  amount: { currency_code: 'USD', value: '20.20' },
};
function setup(body: unknown, status = 200, webhookId = 'webhook-1') {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (url) =>
      String(url).endsWith('/v1/oauth2/token')
        ? Response.json({ access_token: 'token', expires_in: 3600 })
        : status === 204
          ? new Response(null, { status })
          : Response.json(body, { status }),
    );
  const gateway = new SandboxPaypalGateway({
    clientId: 'client',
    clientSecret: 'secret',
    webhookId,
    fetch,
  });
  const request = () => {
    const call = fetch.mock.calls.at(-1);
    return {
      url: call?.[0],
      ...call?.[1],
      body: call?.[1]?.body === undefined ? undefined : JSON.parse(String(call[1].body)),
    };
  };
  return { gateway, fetch, request };
}

it.each(['payer-action', 'approve'])(
  'creates AUTHORIZE orders for Fitcheck with idempotency and the %s approval link',
  async (rel) => {
    const { gateway, request } = setup({
      id: 'order-1',
      links: [{ rel, href: 'https://www.sandbox.paypal.com/approve' }],
    });
    expect(await gateway.createOrder(input)).toMatchObject({
      orderId: 'order-1',
      approveUrl: 'https://www.sandbox.paypal.com/approve',
    });
    expect(request()).toMatchObject({
      url: 'https://api-m.sandbox.paypal.com/v2/checkout/orders',
      method: 'POST',
      headers: expect.objectContaining({ 'PayPal-Request-Id': input.requestId }),
      body: {
        intent: 'AUTHORIZE',
        purchase_units: [{ reference_id: 'default', custom_id: input.customId, amount }],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'Fitcheck',
              shipping_preference: 'NO_SHIPPING',
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
            },
          },
        },
      },
    });
  },
);
it('prefers payer-action and rejects missing approval links', async () => {
  const { gateway } = setup({
    id: 'o',
    links: [
      { rel: 'approve', href: 'fallback' },
      { rel: 'payer-action', href: 'preferred' },
    ],
  });
  expect((await gateway.createOrder(input)).approveUrl).toBe('preferred');
  await expect(setup({ id: 'o', links: [] }).gateway.createOrder(input)).rejects.toMatchObject({
    code: 'APPROVE_LINK_MISSING',
    status: 502,
  });
});
it('reads the order and its authorization id, mapping PAYER_ACTION_REQUIRED to CREATED', async () => {
  const { gateway } = setup({
    id: 'o',
    intent: 'AUTHORIZE',
    status: 'PAYER_ACTION_REQUIRED',
    purchase_units: [
      { amount, custom_id: 'cap:cap-1', payments: { authorizations: [{ id: 'auth-1' }] } },
    ],
  });
  expect(await gateway.getOrder('o')).toMatchObject({
    orderId: 'o',
    intent: 'AUTHORIZE',
    status: 'CREATED',
    amountCents: 300000,
    customId: 'cap:cap-1',
    authorizationId: 'auth-1',
  });
});
it('authorizes an order and preserves expiration_time', async () => {
  const { gateway, request } = setup({
    purchase_units: [
      {
        payments: {
          authorizations: [
            { id: 'auth-1', status: 'CREATED', amount, expiration_time: '2026-12-10T12:00:00Z' },
          ],
        },
      },
    ],
  });
  expect(await gateway.authorizeOrder('o', 'cap:cap-1:authorize')).toMatchObject({
    authorizationId: 'auth-1',
    amountCents: 300000,
    expiresAt: '2026-12-10T12:00:00Z',
  });
  expect(request()).toMatchObject({
    url: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/o/authorize',
    headers: expect.objectContaining({ 'PayPal-Request-Id': 'cap:cap-1:authorize' }),
  });
});
it.each(['DENIED', 'PENDING'])('rejects an authorization with status %s', async (status) => {
  const { gateway } = setup(
    { purchase_units: [{ payments: { authorizations: [{ id: 'auth', amount, status }] } }] },
    201,
  );
  await expect(gateway.authorizeOrder('o', 'key')).rejects.toMatchObject({
    code: status,
    status: 502,
  });
});
it.each(['COMPLETED', 'PENDING', 'DECLINED', 'FAILED'])(
  'partially captures with final_capture false and the invoice id (status %s)',
  async (status) => {
    const { gateway, request } = setup({ ...capture, status });
    expect(
      await gateway.captureAuthorization('AUTH-1', {
        amountCents: 2020,
        finalCapture: false,
        requestId: 'capture:p1',
        invoiceId: 'purchase:p1',
      }),
    ).toMatchObject({
      captureId: 'capture-1',
      amountCents: 2020,
      status: status === 'FAILED' ? 'DECLINED' : status,
    });
    expect(request()).toMatchObject({
      url: 'https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH-1/capture',
      headers: expect.objectContaining({ 'PayPal-Request-Id': 'capture:p1' }),
      body: {
        amount: { currency_code: 'USD', value: '20.20' },
        final_capture: false,
        invoice_id: 'purchase:p1',
      },
    });
  },
);
it('voids an authorization with the request id and an empty body', async () => {
  const { gateway, request } = setup(null, 204);
  expect(await gateway.voidAuthorization('AUTH-1', 'void:cap-1')).toMatchObject({
    status: 'VOIDED',
  });
  expect(request()).toMatchObject({
    url: 'https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH-1/void',
    method: 'POST',
    headers: expect.objectContaining({ 'PayPal-Request-Id': 'void:cap-1' }),
    body: undefined,
  });
});
it('accepts a 200 void that returns the authorization', async () => {
  const { gateway } = setup({ id: 'AUTH-1', status: 'VOIDED' });
  expect(await gateway.voidAuthorization('AUTH-1', 'void:cap-1')).toMatchObject({
    status: 'VOIDED',
  });
});
it('reauthorizes the remaining amount and returns the new authorization', async () => {
  const { gateway, request } = setup({
    id: 'AUTH-2',
    status: 'CREATED',
    expiration_time: '2027-01-08T12:00:00Z',
  });
  expect(
    await gateway.reauthorizeAuthorization('AUTH-1', {
      amountCents: 197980,
      requestId: 'reauth:cap-1',
    }),
  ).toMatchObject({ authorizationId: 'AUTH-2', expiresAt: '2027-01-08T12:00:00Z' });
  expect(request()).toMatchObject({
    url: 'https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH-1/reauthorize',
    headers: expect.objectContaining({ 'PayPal-Request-Id': 'reauth:cap-1' }),
    body: { amount: { currency_code: 'USD', value: '1979.80' } },
  });
});
it('preserves PayPal issue codes and HTTP status', async () => {
  const { gateway } = setup(
    { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'AUTHORIZATION_AMOUNT_EXCEEDED' }] },
    422,
  );
  await expect(
    gateway.captureAuthorization('a', {
      amountCents: 100,
      finalCapture: false,
      requestId: 'key',
      invoiceId: 'invoice',
    }),
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_AMOUNT_EXCEEDED', status: 422 });
});
const headers = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
  'paypal-transmission-id': 'transmission',
  'paypal-transmission-sig': 'signature',
  'paypal-transmission-time': '2026-11-08T00:00:00Z',
};
it.each(['SUCCESS', 'FAILURE'])('verifies the seven webhook fields for %s', async (status) => {
  const { gateway, request } = setup({ verification_status: status });
  expect(await gateway.verifyWebhookSignature(headers, '{"id":"event"}')).toEqual(
    status === 'SUCCESS'
      ? { ok: true }
      : { ok: false, reason: 'verification_failed', verificationStatus: 'FAILURE' },
  );
  expect(request()).toMatchObject({
    url: 'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature',
    body: {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: 'webhook-1',
      webhook_event: { id: 'event' },
    },
  });
});
it('rejects missing signature or webhook id without fetching', async () => {
  const { gateway, fetch } = setup({});
  const { 'paypal-transmission-sig': _, ...missing } = headers;
  expect(await gateway.verifyWebhookSignature(missing, '{}')).toEqual({
    ok: false,
    reason: 'headers_missing',
  });
  expect(await gateway.verifyWebhookSignature(headers, 'not json')).toEqual({
    ok: false,
    reason: 'body_not_json',
  });
  expect(fetch).not.toHaveBeenCalled();
  const absent = setup({}, 200, '');
  expect(await absent.gateway.verifyWebhookSignature(headers, '{}')).toEqual({
    ok: false,
    reason: 'webhook_id_missing',
  });
  expect(absent.fetch).not.toHaveBeenCalled();
});
it('refreshes a rejected token once and keeps the request id', async () => {
  let tokens = 0;
  let calls = 0;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith('/v1/oauth2/token'))
      return Response.json({ access_token: `token-${++tokens}`, expires_in: 3600 });
    calls++;
    return calls === 1
      ? Response.json({ name: 'AUTHENTICATION_FAILURE' }, { status: 401 })
      : Response.json(capture);
  });
  const gateway = new SandboxPaypalGateway({ clientId: 'client', clientSecret: 'secret', fetch });
  expect(
    await gateway.captureAuthorization('a', {
      amountCents: 2020,
      finalCapture: false,
      requestId: 'capture:p1',
      invoiceId: 'purchase:p1',
    }),
  ).toMatchObject({ captureId: 'capture-1' });
  expect(tokens).toBe(2);
  const requests = fetch.mock.calls.filter(([url]) => !String(url).endsWith('/v1/oauth2/token'));
  expect(
    requests.map(
      ([, init]) => (init?.headers as Record<string, string> | undefined)?.['PayPal-Request-Id'],
    ),
  ).toEqual(['capture:p1', 'capture:p1']);
});
