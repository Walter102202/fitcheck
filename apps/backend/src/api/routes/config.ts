import { API, type ConfigResponse } from '@fitcheck/contracts';
import { Hono } from 'hono';
import type { Deps } from '../../deps.js';
import { type Env, paypalModeFor, sandboxBuyerFor } from '../../env.js';
import { recordedModel } from '../../review/model/recordings.js';
import type { ApiEnv } from '../session.js';

/**
 * `recorded` is the model behind the review recordings (null when hand-written); it only matters
 * when the model is not called live.
 */
export function configFrom(env: Env, recorded: string | null): ConfigResponse {
  const live = env.LLM_PROVIDER === 'anthropic';
  const config: ConfigResponse = {
    paypalMode: paypalModeFor(env),
    channel3Mode: env.CHANNEL3_MODE,
    reviewModel: !live && recorded ? recorded : env.REVIEW_MODEL,
    reviewSource: live ? 'live' : recorded ? 'recorded' : 'scripted',
    capAmountCents: env.CAP_AMOUNT_CENTS,
  };
  const buyer = sandboxBuyerFor(env);
  if (buyer) config.sandboxBuyer = buyer;
  return config;
}

export function configRoutes(deps: Deps): Hono<ApiEnv> {
  const config = configFrom(deps.env, recordedModel());
  return new Hono<ApiEnv>().get(API.config, (c) => c.json(config));
}
