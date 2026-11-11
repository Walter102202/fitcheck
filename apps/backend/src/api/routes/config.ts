import { API, type ConfigResponse } from '@fitcheck/contracts';
import { Hono } from 'hono';
import type { Deps } from '../../deps.js';
import { type Env, paypalModeFor, sandboxBuyerFor } from '../../env.js';
import type { ApiEnv } from '../session.js';

export function configFrom(env: Env): ConfigResponse {
  const config: ConfigResponse = {
    paypalMode: paypalModeFor(env),
    channel3Mode: env.CHANNEL3_MODE,
    reviewModel: env.REVIEW_MODEL,
    reviewSource: env.LLM_PROVIDER === 'anthropic' ? 'live' : 'recorded',
    capAmountCents: env.CAP_AMOUNT_CENTS,
  };
  const buyer = sandboxBuyerFor(env);
  if (buyer) config.sandboxBuyer = buyer;
  return config;
}

export function configRoutes(deps: Deps): Hono<ApiEnv> {
  return new Hono<ApiEnv>().get(API.config, (c) => c.json(configFrom(deps.env)));
}
