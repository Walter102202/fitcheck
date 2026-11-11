import type { Cents } from '@fitcheck/contracts';
import type { Logger } from '../logger.js';
import { toPaypalAmount } from './amount.js';
import {
  type CaptureResult,
  type OrderStatus,
  PaypalError,
  type PaypalGateway,
  type SignatureCheck,
} from './gateway.js';

type OrderInput = Parameters<PaypalGateway['createOrder']>[0];
type Order = OrderInput & { orderId: string; status: OrderStatus; authorizationId?: string };
type Authorization = {
  order: Order;
  captured: Cents;
  /** Amount of captures PayPal has not settled yet; it already counts against the limit. */
  pending: Cents;
  closed: 'voided' | 'reauthorized' | null;
};
type PendingCapture = { authorizationId: string; amountCents: Cents; raw: Record<string, unknown> };
export type MockOp = 'create' | 'authorize' | 'capture' | 'void' | 'reauthorize';
export type MockFailure = 'DECLINED' | 'PENDING' | { httpStatus: 422 | 503 };
export type MockWebhookEvent = {
  id: string;
  event_type: string;
  create_time: string;
  resource_type: string;
  resource: Record<string, unknown>;
};
export type MockOptions = {
  webhookSecret: string;
  /** Delivers each emitted webhook in-process. Without it, webhooks are only recorded. */
  deliverWebhook?: (event: MockWebhookEvent, headers: Record<string, string>) => Promise<void>;
  now?: () => Date;
  /** `MOCK` in tests; `SIM-<bootId>` on a server, so ids never collide across restarts. */
  idPrefix?: string;
  /** Where the buyer approves; the relative web route by default. */
  approveUrl?: (orderId: string) => string;
  logger?: Pick<Logger, 'warn'>;
};

/**
 * PayPal in memory: the gateway behind `mock` (tests) and `simulated` (the hosted fallback).
 * It keeps PayPal's rules that matter to the ledger: idempotent request ids, partial captures
 * within the authorization, void, reauthorize, pending captures, and signed webhooks. It
 * forgets everything on restart, like a cap whose authorization PayPal no longer knows.
 */
export class MockPaypalGateway implements PaypalGateway {
  private orders = new Map<string, Order>();
  private authorizations = new Map<string, Authorization>();
  private pendingCaptures = new Map<string, PendingCapture>();
  private results = new Map<string, unknown>();
  private emitted: MockWebhookEvent[] = [];
  private seen: Record<MockOp, string[]> = {
    create: [],
    authorize: [],
    capture: [],
    void: [],
    reauthorize: [],
  };
  private failures = new Map<MockOp, MockFailure>();
  private counters = { ORDER: 0, AUTH: 0, CAP: 0 };
  private readonly prefix: string;
  constructor(private readonly options: MockOptions) {
    this.prefix = options.idPrefix ?? 'MOCK';
  }
  private id(kind: 'ORDER' | 'AUTH' | 'CAP'): string {
    this.counters[kind] += 1;
    return `${this.prefix}-${kind}-${String(this.counters[kind]).padStart(6, '0')}`;
  }
  private approveUrlFor(orderId: string): string {
    return this.options.approveUrl?.(orderId) ?? `/cap/approve-simulated?token=${orderId}`;
  }
  private order(id: string): Order {
    const order = this.orders.get(id);
    if (!order) throw new PaypalError('RESOURCE_NOT_FOUND', 404);
    return order;
  }
  private raw(order: Order): Record<string, unknown> {
    return {
      id: order.orderId,
      intent: order.intent,
      status: order.status,
      purchase_units: [
        {
          custom_id: order.customId,
          amount: { currency_code: 'USD', value: toPaypalAmount(order.amountCents) },
        },
      ],
      links: [{ rel: 'approve', href: this.approveUrlFor(order.orderId) }],
    };
  }
  /** Records the request id, then applies a one-shot failure for this operation. */
  private enter(op: MockOp, requestId: string): MockFailure | undefined {
    this.seen[op].push(requestId);
    const failure = this.failures.get(op);
    this.failures.delete(op);
    if (failure && typeof failure === 'object') {
      throw new PaypalError(
        failure.httpStatus === 503 ? 'SERVICE_UNAVAILABLE' : 'UNPROCESSABLE_ENTITY',
        failure.httpStatus,
      );
    }
    return failure;
  }
  private cached<T>(key: string): T | undefined {
    return this.results.has(key) ? (structuredClone(this.results.get(key)) as T) : undefined;
  }

  /** The next call of `op` fails as given; later calls behave normally. */
  failNext(op: 'capture' | 'authorize' | 'void', outcome: MockFailure): void {
    this.failures.set(op, outcome);
  }
  /** Request ids seen for `op`, repeats included. */
  calls(op: MockOp): string[] {
    return [...this.seen[op]];
  }
  events(): MockWebhookEvent[] {
    return structuredClone(this.emitted);
  }

  async createOrder(input: OrderInput): ReturnType<PaypalGateway['createOrder']> {
    const key = `create:${input.requestId}`;
    this.seen.create.push(input.requestId);
    const hit = this.cached<Awaited<ReturnType<PaypalGateway['createOrder']>>>(key);
    if (hit) return hit;
    this.validateAmount(input.amountCents);
    const order: Order = { ...input, orderId: this.id('ORDER'), status: 'CREATED' };
    this.orders.set(order.orderId, order);
    const result = {
      orderId: order.orderId,
      approveUrl: this.approveUrlFor(order.orderId),
      raw: this.raw(order),
    };
    this.results.set(key, result);
    return structuredClone(result);
  }
  async getOrder(orderId: string): ReturnType<PaypalGateway['getOrder']> {
    const o = this.order(orderId);
    return {
      orderId: o.orderId,
      intent: o.intent,
      status: o.status,
      amountCents: o.amountCents,
      customId: o.customId,
      ...(o.authorizationId ? { authorizationId: o.authorizationId } : {}),
      raw: this.raw(o),
    };
  }
  /** The buyer approves on the simulated page. A no-op once approved. */
  async approve(orderId: string, payerId = 'SIMPAYER01'): Promise<void> {
    const order = this.order(orderId);
    if (order.status === 'EXPIRED') throw new PaypalError('ORDER_EXPIRED');
    if (order.status !== 'CREATED') return;
    order.status = 'APPROVED';
    await this.emitWebhook('CHECKOUT.ORDER.APPROVED', {
      ...this.raw(order),
      payer: { payer_id: payerId },
    });
  }
  async authorizeOrder(
    orderId: string,
    requestId: string,
  ): ReturnType<PaypalGateway['authorizeOrder']> {
    const key = `authorize:${requestId}`;
    const hit = this.cached<Awaited<ReturnType<PaypalGateway['authorizeOrder']>>>(key);
    if (hit) {
      this.seen.authorize.push(requestId);
      return hit;
    }
    this.enter('authorize', requestId);
    const order = this.order(orderId);
    if (order.status === 'EXPIRED') throw new PaypalError('ORDER_EXPIRED');
    if (order.status === 'COMPLETED') throw new PaypalError('ORDER_ALREADY_AUTHORIZED');
    if (order.status !== 'APPROVED') throw new PaypalError('ORDER_NOT_APPROVED');
    const authorizationId = this.id('AUTH');
    this.authorizations.set(authorizationId, { order, captured: 0, pending: 0, closed: null });
    order.status = 'COMPLETED';
    order.authorizationId = authorizationId;
    const raw = {
      id: authorizationId,
      status: 'CREATED',
      amount: { currency_code: 'USD', value: toPaypalAmount(order.amountCents) },
      custom_id: order.customId,
    };
    const result = { authorizationId, amountCents: order.amountCents, expiresAt: null, raw };
    this.results.set(key, result);
    await this.emitWebhook('PAYMENT.AUTHORIZATION.CREATED', raw);
    return structuredClone(result);
  }
  async captureAuthorization(
    authorizationId: string,
    input: Parameters<PaypalGateway['captureAuthorization']>[1],
  ): Promise<CaptureResult> {
    const key = `capture:${input.requestId}`;
    const hit = this.cached<CaptureResult>(key);
    if (hit) {
      this.seen.capture.push(input.requestId);
      return hit;
    }
    const failure = this.enter('capture', input.requestId);
    const auth = this.authorizations.get(authorizationId);
    if (!auth) throw new PaypalError('RESOURCE_NOT_FOUND', 404);
    this.validateAmount(input.amountCents);
    if (auth.closed) throw new PaypalError('AUTHORIZATION_VOIDED');
    if (input.amountCents > auth.order.amountCents - auth.captured - auth.pending)
      throw new PaypalError('AUTHORIZATION_AMOUNT_EXCEEDED');
    const captureId = this.id('CAP');
    const status =
      failure === 'DECLINED' ? 'DECLINED' : failure === 'PENDING' ? 'PENDING' : 'COMPLETED';
    const raw: Record<string, unknown> = {
      id: captureId,
      status,
      amount: { currency_code: 'USD', value: toPaypalAmount(input.amountCents) },
      final_capture: input.finalCapture,
      invoice_id: input.invoiceId,
      custom_id: auth.order.customId,
      supplementary_data: {
        related_ids: { order_id: auth.order.orderId, authorization_id: authorizationId },
      },
    };
    const result: CaptureResult = { captureId, status, amountCents: input.amountCents, raw };
    this.results.set(key, result);
    if (status === 'COMPLETED') {
      auth.captured += input.amountCents;
      await this.emitWebhook('PAYMENT.CAPTURE.COMPLETED', raw);
    } else if (status === 'PENDING') {
      auth.pending += input.amountCents;
      this.pendingCaptures.set(captureId, { authorizationId, amountCents: input.amountCents, raw });
      await this.emitWebhook('PAYMENT.CAPTURE.PENDING', raw);
    } else {
      await this.emitWebhook('PAYMENT.CAPTURE.DECLINED', raw);
    }
    return structuredClone(result);
  }
  /** PayPal settles a pending capture: COMPLETED captures it, DENIED releases it. */
  async settlePending(captureId: string, outcome: 'COMPLETED' | 'DENIED'): Promise<void> {
    const pending = this.pendingCaptures.get(captureId);
    if (!pending) throw new PaypalError('RESOURCE_NOT_FOUND', 404);
    this.pendingCaptures.delete(captureId);
    const auth = this.authorizations.get(pending.authorizationId);
    if (auth) {
      auth.pending -= pending.amountCents;
      if (outcome === 'COMPLETED') auth.captured += pending.amountCents;
    }
    await this.emitWebhook(`PAYMENT.CAPTURE.${outcome}`, { ...pending.raw, status: outcome });
  }
  async voidAuthorization(
    authorizationId: string,
    requestId: string,
  ): ReturnType<PaypalGateway['voidAuthorization']> {
    const key = `void:${requestId}`;
    const hit = this.cached<Awaited<ReturnType<PaypalGateway['voidAuthorization']>>>(key);
    if (hit) {
      this.seen.void.push(requestId);
      return hit;
    }
    this.enter('void', requestId);
    const auth = this.authorizations.get(authorizationId);
    if (!auth) throw new PaypalError('RESOURCE_NOT_FOUND', 404);
    const wasOpen = auth.closed === null;
    auth.closed = 'voided';
    const raw = {
      id: authorizationId,
      status: 'VOIDED',
      amount: { currency_code: 'USD', value: toPaypalAmount(auth.order.amountCents) },
      custom_id: auth.order.customId,
    };
    const result = { status: 'VOIDED' as const, raw };
    this.results.set(key, result);
    if (wasOpen) await this.emitWebhook('PAYMENT.AUTHORIZATION.VOIDED', raw);
    return structuredClone(result);
  }
  async reauthorizeAuthorization(
    authorizationId: string,
    input: Parameters<PaypalGateway['reauthorizeAuthorization']>[1],
  ): ReturnType<PaypalGateway['reauthorizeAuthorization']> {
    const key = `reauthorize:${input.requestId}`;
    this.seen.reauthorize.push(input.requestId);
    const hit = this.cached<Awaited<ReturnType<PaypalGateway['reauthorizeAuthorization']>>>(key);
    if (hit) return hit;
    const auth = this.authorizations.get(authorizationId);
    if (!auth) throw new PaypalError('RESOURCE_NOT_FOUND', 404);
    if (auth.closed) throw new PaypalError('AUTHORIZATION_VOIDED');
    this.validateAmount(input.amountCents);
    const next = this.id('AUTH');
    this.authorizations.set(next, {
      order: auth.order,
      captured: auth.captured,
      pending: auth.pending,
      closed: null,
    });
    auth.closed = 'reauthorized';
    auth.order.authorizationId = next;
    const raw = { id: next, status: 'CREATED' };
    const result = { authorizationId: next, expiresAt: null, raw };
    this.results.set(key, result);
    return structuredClone(result);
  }
  async verifyWebhookSignature(
    headers: Record<string, string>,
    _rawBody: string,
  ): Promise<SignatureCheck> {
    const signed = Object.entries(headers).some(
      ([key, value]) =>
        key.toLowerCase() === 'x-mock-signature' && value === this.options.webhookSecret,
    );
    return signed ? { ok: true } : { ok: false, reason: 'verification_failed' };
  }
  async emitWebhook(eventType: string, resource: Record<string, unknown>): Promise<void> {
    const event: MockWebhookEvent = {
      id: `WH-${this.prefix}-${String(this.emitted.length + 1).padStart(6, '0')}`,
      event_type: eventType,
      create_time: (this.options.now?.() ?? new Date()).toISOString(),
      resource_type: eventType.startsWith('CHECKOUT') ? 'checkout-order' : 'payment',
      resource: structuredClone(resource),
    };
    this.emitted.push(event);
    if (!this.options.deliverWebhook) return;
    const headers = {
      'content-type': 'application/json',
      'x-mock-signature': this.options.webhookSecret,
    };
    try {
      await this.options.deliverWebhook(structuredClone(event), headers);
    } catch (error) {
      this.options.logger?.warn('paypal.simulated_webhook_failed', {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  expireOrder(orderId: string): void {
    this.order(orderId).status = 'EXPIRED';
  }
  private validateAmount(cents: number): void {
    if (!Number.isSafeInteger(cents) || cents < 0) throw new PaypalError('INVALID_AMOUNT');
  }
}
