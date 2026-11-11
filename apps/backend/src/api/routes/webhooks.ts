import { API } from '@fitcheck/contracts';
import { Hono } from 'hono';
import type { Deps } from '../../deps.js';
import { processWebhook } from '../../ledger/webhooks.js';
import type { PaypalGateway } from '../../paypal/index.js';
import type { ApiEnv } from '../session.js';

/**
 * Who may post webhooks over HTTP: the PayPal sandbox when it is configured. Simulated PayPal
 * delivers its webhooks in-process, so its shared secret is accepted over HTTP only in local
 * mock mode; on a deployed simulated site nothing outside the process can forge a capture.
 */
function verifierFor(deps: Deps): PaypalGateway | null {
  if (deps.paypal.sandbox) return deps.paypal.sandbox;
  return deps.env.PAYPAL_MODE === 'mock' ? deps.paypal.simulated : null;
}

export function webhookRoutes(deps: Deps): Hono<ApiEnv> {
  return new Hono<ApiEnv>().post(API.paypalWebhook, async (c) => {
    const verifier = verifierFor(deps);
    if (!verifier) return c.json({ result: 'invalid_signature' as const }, 401);
    const host = c.req.header('host');
    const { result } = await processWebhook(deps, {
      headers: Object.fromEntries(c.req.raw.headers.entries()),
      rawBody: await c.req.text(),
      verifier,
      ...(host ? { host } : {}),
    });
    return c.json({ result }, result === 'invalid_signature' ? 401 : 200);
  });
}
