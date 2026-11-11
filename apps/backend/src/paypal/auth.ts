import { z } from 'zod';
import { PaypalError } from './gateway.js';

export const SANDBOX_URL = 'https://api-m.sandbox.paypal.com';
const ErrorBody = z.object({
  name: z.string().optional(),
  details: z.array(z.object({ issue: z.string().optional() })).optional(),
});
export class PaypalHttpError extends PaypalError {
  constructor(
    code: string,
    readonly httpStatus: number,
  ) {
    super(code, [401, 403, 408, 429].includes(httpStatus) ? 503 : httpStatus);
  }
}
export async function paypalJson(
  path: string,
  init: RequestInit,
  fetch: typeof globalThis.fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${SANDBOX_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new PaypalError('PAYPAL_UNREACHABLE', 502);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = ErrorBody.safeParse(body);
    throw new PaypalHttpError(
      error.success
        ? (error.data.details?.[0]?.issue ?? error.data.name ?? `HTTP_${response.status}`)
        : `HTTP_${response.status}`,
      response.status,
    );
  }
  return body;
}
export function createTokenSource(options: {
  clientId: string;
  clientSecret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}) {
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  let token: string | undefined;
  let expiresAt = 0;
  let pending: Promise<string> | undefined;
  async function refresh(): Promise<string> {
    const startedAt = now();
    const body = await paypalJson(
      '/v1/oauth2/token',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      },
      fetch,
    );
    const result = z
      .object({ access_token: z.string().min(1), expires_in: z.number().positive() })
      .safeParse(body);
    if (!result.success) throw new PaypalError('INVALID_PAYPAL_RESPONSE', 502);
    token = result.data.access_token;
    expiresAt = startedAt + Math.max(0, result.data.expires_in - 60) * 1000;
    return token;
  }
  return {
    invalidate(rejectedToken: string): void {
      if (token === rejectedToken) {
        token = undefined;
        expiresAt = 0;
      }
    },
    async getAccessToken(): Promise<string> {
      if (token && now() < expiresAt) return token;
      pending ??= refresh().finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}
