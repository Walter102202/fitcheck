import { z } from 'zod';
import { CentsSchema } from './money.js';
import { PaypalModeSchema } from './payments.js';

export const ConfigResponseSchema = z.object({
  paypalMode: PaypalModeSchema,
  channel3Mode: z.enum(['live', 'recorded']),
  reviewModel: z.string(),
  /** live: the model reads each request; recorded: answers recorded from it earlier. */
  reviewSource: z.enum(['live', 'recorded']).optional(),
  capAmountCents: CentsSchema,
  /** The sandbox test buyer shown on the cap screen; absent unless sandbox. */
  sandboxBuyer: z.object({ email: z.string(), password: z.string() }).optional(),
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;

/** Where to come back after approval; the server picks the PayPal mode. */
export const CapCreateRequestSchema = z.object({ scenarioId: z.string().optional() });
export type CapCreateRequest = z.infer<typeof CapCreateRequestSchema>;

/** Every error response. `error` is a snake_case code such as "cap_not_active". */
export const ApiErrorSchema = z.object({ error: z.string(), message: z.string() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Route paths shared by the backend and the web app. */
export const API = {
  config: '/api/config',
  scenarios: '/api/scenarios',
  cap: '/api/cap',
  capReturn: '/api/cap/return',
  capApproveSimulated: '/api/cap/approve-simulated',
  runs: '/api/runs',
  run: (runId: string) => `/api/runs/${encodeURIComponent(runId)}`,
  runAnswers: (runId: string) => `/api/runs/${encodeURIComponent(runId)}/answers`,
  results: '/api/results',
  sessionReset: '/api/session/reset',
  paypalWebhook: '/api/webhooks/paypal',
  healthz: '/healthz',
} as const;
