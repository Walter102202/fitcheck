import type { PaypalMode } from '@fitcheck/contracts';
import { AppError } from '../api/errors.js';
import { type Env, paypalModeFor } from '../env.js';
import type { Logger } from '../logger.js';
import type { PaypalGateway } from './gateway.js';
import { type MockOptions, MockPaypalGateway } from './mock.js';
import { SandboxPaypalGateway } from './sandbox.js';

export * from './amount.js';
export * from './gateway.js';
export * from './mock.js';
export * from './paths.js';
export * from './verify-amount.js';

/**
 * The two gateways a server may use. `sandbox` exists only with credentials; `simulated`
 * always exists, as the automatic fallback and as the test gateway (`mock`).
 */
export type PaypalGateways = { sandbox: PaypalGateway | null; simulated: MockPaypalGateway };

export function createPaypalGateways(
  env: Env,
  o: {
    logger: Pick<Logger, 'warn'>;
    deliverWebhook: MockOptions['deliverWebhook'];
    bootId: string;
    now?: () => Date;
    /** Tests pin a fixed prefix for readable ids; a server never does. */
    idPrefix?: string;
  },
): PaypalGateways {
  const mode = paypalModeFor(env);
  if (mode === 'sandbox' && !env.PAYPAL_WEBHOOK_ID?.trim())
    o.logger.warn('paypal.webhook_id_missing');
  const simulated = new MockPaypalGateway({
    webhookSecret: env.MOCK_WEBHOOK_SECRET,
    // A per-process prefix: a restarted server (persistent database, in-memory gateway) never
    // reissues an order, capture or webhook id the old process gave out.
    idPrefix: o.idPrefix ?? `${env.PAYPAL_MODE === 'mock' ? 'MOCK' : 'SIM'}-${o.bootId}`,
    logger: o.logger,
    ...(o.deliverWebhook ? { deliverWebhook: o.deliverWebhook } : {}),
    ...(o.now ? { now: o.now } : {}),
  });
  const sandbox =
    mode === 'sandbox'
      ? new SandboxPaypalGateway({
          clientId: env.PAYPAL_CLIENT_ID ?? '',
          clientSecret: env.PAYPAL_CLIENT_SECRET ?? '',
          ...(env.PAYPAL_WEBHOOK_ID ? { webhookId: env.PAYPAL_WEBHOOK_ID } : {}),
        })
      : null;
  return { sandbox, simulated };
}

/** The gateway a cap of this mode talks to. */
export function gatewayFor(g: PaypalGateways, mode: PaypalMode): PaypalGateway {
  if (mode !== 'sandbox') return g.simulated;
  if (!g.sandbox)
    throw new AppError('paypal_unavailable', 'The PayPal sandbox is not configured.', {
      status: 503,
    });
  return g.sandbox;
}
