import { API, type ConfigResponse } from '@fitcheck/contracts';
import { Hono } from 'hono';
import type { Deps } from './deps.js';
import { type Env, paypalModeFor, sandboxBuyerFor } from './env.js';

export function configFrom(env: Env): ConfigResponse {
  const config: ConfigResponse = {
    paypalMode: paypalModeFor(env),
    channel3Mode: env.CHANNEL3_MODE,
    reviewModel: env.REVIEW_MODEL,
    capAmountCents: env.CAP_AMOUNT_CENTS,
  };
  const buyer = sandboxBuyerFor(env);
  if (buyer) config.sandboxBuyer = buyer;
  return config;
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();
  app.get(API.healthz, (c) => c.json({ ok: true }));
  app.get(API.config, (c) => c.json(configFrom(deps.env)));
  return app;
}
