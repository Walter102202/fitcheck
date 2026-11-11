import type { Cents } from '@fitcheck/contracts';
import { AppError } from '../api/errors.js';

export type OrderStatus = 'CREATED' | 'APPROVED' | 'COMPLETED' | 'VOIDED' | 'EXPIRED';
export type CaptureResult = {
  captureId: string;
  status: 'COMPLETED' | 'PENDING' | 'DECLINED';
  amountCents: Cents;
  raw: unknown;
};

/**
 * DealingWith's gateway, minus CAPTURE-intent orders (Fitcheck only authorizes a cap and
 * captures parts of it), plus void and reauthorize.
 */
export interface PaypalGateway {
  createOrder(i: {
    intent: 'AUTHORIZE';
    amountCents: Cents;
    customId: string;
    requestId: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ orderId: string; approveUrl: string; raw: unknown }>;
  getOrder(orderId: string): Promise<{
    orderId: string;
    intent: 'AUTHORIZE' | 'CAPTURE';
    status: OrderStatus;
    amountCents: Cents;
    customId: string;
    authorizationId?: string;
    raw: unknown;
  }>;
  authorizeOrder(
    orderId: string,
    requestId: string,
  ): Promise<{
    authorizationId: string;
    amountCents: Cents;
    expiresAt: string | null;
    raw: unknown;
  }>;
  captureAuthorization(
    authorizationId: string,
    i: { amountCents: Cents; finalCapture: false; requestId: string; invoiceId: string },
  ): Promise<CaptureResult>;
  voidAuthorization(
    authorizationId: string,
    requestId: string,
  ): Promise<{ status: 'VOIDED'; raw: unknown }>;
  reauthorizeAuthorization(
    authorizationId: string,
    i: { amountCents: Cents; requestId: string },
  ): Promise<{ authorizationId: string; expiresAt: string | null; raw: unknown }>;
  verifyWebhookSignature(headers: Record<string, string>, rawBody: string): Promise<SignatureCheck>;
}
/**
 * Why a webhook was rejected, so the service log can tell a missing header from a body PayPal's
 * verify call refused. `verificationStatus` is PayPal's own answer when the call was made.
 */
export type SignatureCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'webhook_id_missing' | 'headers_missing' | 'body_not_json' | 'verification_failed';
      verificationStatus?: string;
    };
export class PaypalError extends AppError {
  constructor(code: string, status = 422, message = code.replaceAll('_', ' ')) {
    super(code, message, { status });
    this.name = 'PaypalError';
  }
}
