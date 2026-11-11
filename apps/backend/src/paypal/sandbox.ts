import { z } from 'zod';
import { fromPaypalAmount, toPaypalAmount } from './amount.js';
import { createTokenSource, PaypalHttpError, paypalJson } from './auth.js';
import {
  type CaptureResult,
  PaypalError,
  type PaypalGateway,
  type SignatureCheck,
} from './gateway.js';
import { PAYPAL_PATHS } from './paths.js';

const Amount = z.object({
  currency_code: z.literal('USD'),
  value: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
});
const Capture = z.object({
  id: z.string().min(1),
  status: z.enum(['COMPLETED', 'PENDING', 'DECLINED', 'FAILED']),
  amount: Amount,
});
const Authorization = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  amount: Amount,
  expiration_time: z.string().optional(),
});
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new PaypalError('INVALID_PAYPAL_RESPONSE', 502);
  return result.data;
}
function captureResult(raw: unknown): CaptureResult {
  const capture = parse(Capture, raw);
  return {
    captureId: capture.id,
    status: capture.status === 'FAILED' ? 'DECLINED' : capture.status,
    amountCents: fromPaypalAmount(capture.amount.value),
    raw,
  };
}
const enc = encodeURIComponent;

/** The real PayPal sandbox (Orders v2 and Payments v2), copied from DealingWith. */
export class SandboxPaypalGateway implements PaypalGateway {
  private readonly tokenSource;
  private readonly fetch: typeof globalThis.fetch;
  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      webhookId?: string;
      fetch?: typeof globalThis.fetch;
    },
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.tokenSource = createTokenSource(options);
  }
  private async request(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; requestId?: string },
    retry = true,
  ): Promise<unknown> {
    const token = await this.tokenSource.getAccessToken();
    try {
      return await paypalJson(
        path,
        {
          method: init.method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
            ...(init.requestId ? { 'PayPal-Request-Id': init.requestId } : {}),
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        },
        this.fetch,
      );
    } catch (error) {
      if (error instanceof PaypalHttpError && error.httpStatus === 401) {
        this.tokenSource.invalidate(token);
        if (retry) return this.request(path, init, false);
      }
      throw error;
    }
  }
  private post(path: string, body: unknown, requestId?: string): Promise<unknown> {
    return this.request(path, { method: 'POST', body, ...(requestId ? { requestId } : {}) });
  }
  async createOrder(
    input: Parameters<PaypalGateway['createOrder']>[0],
  ): ReturnType<PaypalGateway['createOrder']> {
    const raw = await this.post(
      '/v2/checkout/orders',
      {
        intent: input.intent,
        purchase_units: [
          {
            reference_id: 'default',
            custom_id: input.customId,
            amount: { currency_code: 'USD', value: toPaypalAmount(input.amountCents) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'Fitcheck',
              shipping_preference: 'NO_SHIPPING',
              user_action: 'PAY_NOW',
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
            },
          },
        },
      },
      input.requestId,
    );
    const order = parse(
      z.object({
        id: z.string().min(1),
        links: z.array(z.object({ rel: z.string(), href: z.string().min(1) })).default([]),
      }),
      raw,
    );
    const approveUrl = (
      order.links.find((link) => link.rel === 'payer-action') ??
      order.links.find((link) => link.rel === 'approve')
    )?.href;
    if (!approveUrl) throw new PaypalError('APPROVE_LINK_MISSING', 502);
    return { orderId: order.id, approveUrl, raw };
  }
  async getOrder(id: string): ReturnType<PaypalGateway['getOrder']> {
    const raw = await this.request(`/v2/checkout/orders/${enc(id)}`, { method: 'GET' });
    const order = parse(
      z.object({
        id: z.string(),
        intent: z.enum(['CAPTURE', 'AUTHORIZE']),
        status: z.enum([
          'CREATED',
          'SAVED',
          'PAYER_ACTION_REQUIRED',
          'APPROVED',
          'COMPLETED',
          'VOIDED',
          'EXPIRED',
        ]),
        purchase_units: z
          .array(
            z.object({
              amount: Amount,
              custom_id: z.string(),
              payments: z
                .object({ authorizations: z.array(z.object({ id: z.string() })).optional() })
                .optional(),
            }),
          )
          .min(1),
      }),
      raw,
    );
    const unit = order.purchase_units[0];
    if (!unit) throw new PaypalError('INVALID_PAYPAL_RESPONSE', 502);
    const authorizationId = unit.payments?.authorizations?.[0]?.id;
    return {
      orderId: order.id,
      intent: order.intent,
      status:
        order.status === 'SAVED' || order.status === 'PAYER_ACTION_REQUIRED'
          ? 'CREATED'
          : order.status,
      amountCents: fromPaypalAmount(unit.amount.value),
      customId: unit.custom_id,
      ...(authorizationId ? { authorizationId } : {}),
      raw,
    };
  }
  async authorizeOrder(id: string, requestId: string): ReturnType<PaypalGateway['authorizeOrder']> {
    const raw = await this.post(PAYPAL_PATHS.authorize(enc(id)), {}, requestId);
    const order = parse(
      z.object({
        purchase_units: z
          .array(
            z.object({ payments: z.object({ authorizations: z.array(Authorization).min(1) }) }),
          )
          .min(1),
      }),
      raw,
    );
    const auth = order.purchase_units[0]?.payments.authorizations[0];
    if (!auth) throw new PaypalError('INVALID_PAYPAL_RESPONSE', 502);
    if (auth.status !== 'CREATED') throw new PaypalError(auth.status, 502);
    return {
      authorizationId: auth.id,
      amountCents: fromPaypalAmount(auth.amount.value),
      expiresAt: auth.expiration_time ?? null,
      raw,
    };
  }
  async captureAuthorization(
    id: string,
    input: Parameters<PaypalGateway['captureAuthorization']>[1],
  ): Promise<CaptureResult> {
    return captureResult(
      await this.post(
        PAYPAL_PATHS.capture(enc(id)),
        {
          amount: { currency_code: 'USD', value: toPaypalAmount(input.amountCents) },
          final_capture: input.finalCapture,
          invoice_id: input.invoiceId,
        },
        input.requestId,
      ),
    );
  }
  /** Releases what is left of the authorization. PayPal answers 204, or 200 with the body. */
  async voidAuthorization(
    id: string,
    requestId: string,
  ): ReturnType<PaypalGateway['voidAuthorization']> {
    const raw = await this.request(PAYPAL_PATHS.void(enc(id)), { method: 'POST', requestId });
    return { status: 'VOIDED', raw };
  }
  async reauthorizeAuthorization(
    id: string,
    input: Parameters<PaypalGateway['reauthorizeAuthorization']>[1],
  ): ReturnType<PaypalGateway['reauthorizeAuthorization']> {
    const raw = await this.post(
      PAYPAL_PATHS.reauthorize(enc(id)),
      { amount: { currency_code: 'USD', value: toPaypalAmount(input.amountCents) } },
      input.requestId,
    );
    const auth = parse(
      z.object({
        id: z.string().min(1),
        status: z.literal('CREATED'),
        expiration_time: z.string().optional(),
      }),
      raw,
    );
    return { authorizationId: auth.id, expiresAt: auth.expiration_time ?? null, raw };
  }
  async verifyWebhookSignature(
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<SignatureCheck> {
    if (!this.options.webhookId?.trim()) return { ok: false, reason: 'webhook_id_missing' };
    const normalized = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const fields = {
      auth_algo: normalized['paypal-auth-algo'],
      cert_url: normalized['paypal-cert-url'],
      transmission_id: normalized['paypal-transmission-id'],
      transmission_sig: normalized['paypal-transmission-sig'],
      transmission_time: normalized['paypal-transmission-time'],
    };
    if (Object.values(fields).some((value) => !value?.trim()))
      return { ok: false, reason: 'headers_missing' };
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return { ok: false, reason: 'body_not_json' };
    }
    const result = await this.post('/v1/notifications/verify-webhook-signature', {
      ...fields,
      webhook_id: this.options.webhookId,
      webhook_event: event,
    });
    const status = parse(
      z.object({ verification_status: z.enum(['SUCCESS', 'FAILURE']) }),
      result,
    ).verification_status;
    return status === 'SUCCESS'
      ? { ok: true }
      : { ok: false, reason: 'verification_failed', verificationStatus: status };
  }
}
