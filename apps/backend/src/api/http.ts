import { existsSync } from 'node:fs';
import type { ApiError } from '@fitcheck/contracts';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Context, Env, ErrorHandler, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import type { Logger } from '../logger.js';
import { PaypalError } from '../paypal/gateway.js';
import { AppError } from './errors.js';

const body = (error: string, message: string): ApiError => ({ error, message });

/** Every error becomes `ApiError = { error, message }` with its HTTP status. */
export function onError<E extends Env>(logger: Logger): ErrorHandler<E> {
  return (error, c) => {
    if (error instanceof HTTPException && error.status === 400) {
      return c.json(body('invalid_request', 'The request body must be valid JSON.'), 400);
    }
    if (error instanceof PaypalError) {
      logger.warn('request.paypal_error', { code: error.code, status: error.status });
      return c.json(
        body('paypal_error', 'PayPal did not complete the request.'),
        (error.status >= 500 ? 502 : error.status) as ContentfulStatusCode,
      );
    }
    if (error instanceof AppError) {
      return c.json(body(error.code, error.message), error.status as ContentfulStatusCode);
    }
    logger.error('request.failed', {
      path: c.req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json(body('internal_error', 'Something went wrong on our side.'), 500);
  };
}

export function notFound(c: Context): Response {
  return c.json(body('not_found', 'Route not found'), 404);
}

/** Parses a JSON body with a contracts schema; a mismatch is a 400 `invalid_request`. */
export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError('invalid_request', 'The request body must be valid JSON.', { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.') || 'body').join(', ');
    throw new AppError('invalid_request', `Invalid request: ${fields}.`, { status: 400 });
  }
  return parsed.data;
}

/** The built web app with the SPA fallback (DealingWith api/static.ts). */
export function mountStatic<E extends Env>(app: Hono<E>, dir: string): void {
  const files = existsSync(dir) ? serveStatic<E>({ root: dir }) : null;
  const fallback = serveStatic<E>({ path: `${dir}/index.html` });
  app.get('*', async (c, next) => {
    if (/^\/(api|healthz)(\/|$)/.test(c.req.path) || !files) return notFound(c);
    return files(c, async () => {
      const response = await fallback(c, next);
      if (response) c.res = response;
    });
  });
}
