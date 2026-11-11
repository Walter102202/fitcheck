import { API, type ConfigResponse, type PaypalMode } from '@fitcheck/contracts';
import { Hono } from 'hono';
import type { Deps } from './deps.js';
import { type Env, hasSandboxCredentials } from './env.js';

function paypalModeOf(env: Env): PaypalMode {
  if (env.PAYPAL_MODE === 'mock') return 'mock';
  return hasSandboxCredentials(env) ? 'sandbox' : 'simulated';
}

export function configFrom(env: Env): ConfigResponse {
  const paypalMode = paypalModeOf(env);
  const config: ConfigResponse = {
    paypalMode,
    channel3Mode: env.CHANNEL3_MODE,
    reviewModel: env.REVIEW_MODEL,
    capAmountCents: env.CAP_AMOUNT_CENTS,
  };
  if (paypalMode === 'sandbox' && env.SANDBOX_BUYER_EMAIL && env.SANDBOX_BUYER_PASSWORD) {
    config.sandboxBuyer = { email: env.SANDBOX_BUYER_EMAIL, password: env.SANDBOX_BUYER_PASSWORD };
  }
  return config;
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();
  app.get(API.healthz, (c) => c.json({ ok: true }));
  app.get(API.config, (c) => c.json(configFrom(deps.env)));
  return app;
}
