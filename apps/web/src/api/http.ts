import {
  API,
  CapSchema,
  ConfigResponseSchema,
  ResultsJsonSchema,
  RunResponseSchema,
  ScenarioSchema,
} from '@fitcheck/contracts';
import { ZodError, type z } from 'zod';
import { postForm } from '../lib/browser.js';
import { ApiRequestError } from './errors.js';
import type { FitcheckApi } from './types.js';

/** Reads `{ error, message }` (the contract) or `{ error: { code, message } }`. */
function errorFrom(status: number, body: unknown): ApiRequestError {
  let code = 'http_error';
  let message = `Request failed with status ${status}`;
  if (body && typeof body === 'object') {
    const { error, message: topMessage } = body as { error?: unknown; message?: unknown };
    if (typeof error === 'string') {
      code = error;
      if (typeof topMessage === 'string') message = topMessage;
    } else if (error && typeof error === 'object') {
      const nested = error as { code?: unknown; message?: unknown };
      if (typeof nested.code === 'string') code = nested.code;
      if (typeof nested.message === 'string') message = nested.message;
    }
  }
  return new ApiRequestError(status, code, message);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T> | null,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const options: RequestInit = { method: init.method ?? 'GET', credentials: 'include', headers };
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(init.body);
  }
  const res = await fetch(path, options);
  const body = res.status === 204 ? undefined : await readJson(res);
  if (!res.ok) throw errorFrom(res.status, body);
  if (schema === null) return undefined as T;
  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) console.error(`Response from ${path} broke the contract`, error);
    throw error;
  }
}

export const httpApi: FitcheckApi = {
  getConfig: () => request(API.config, ConfigResponseSchema),
  getScenarios: () => request(API.scenarios, ScenarioSchema.array()),
  getCap: () => request(API.cap, CapSchema.nullable()),
  createCap: (req) => request(API.cap, CapSchema, { method: 'POST', body: req }),
  completeSimulatedApproval: async (token) => {
    postForm(`${API.capApproveSimulated}?token=${encodeURIComponent(token)}`);
  },
  startRun: (req) => request(API.runs, RunResponseSchema, { method: 'POST', body: req }),
  getRun: (runId) => request(API.run(runId), RunResponseSchema),
  sendAnswers: (runId, req) =>
    request(API.runAnswers(runId), RunResponseSchema, { method: 'POST', body: req }),
  getResults: () => request(API.results, ResultsJsonSchema),
  resetSession: () => request<void>(API.sessionReset, null, { method: 'POST' }),
};
