import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { sessions } from '../db/schema.js';
import { createSession, touchSession } from '../db/sessions.js';
import type { Deps } from '../deps.js';

export const SESSION_COOKIE = 'fc_session';
export const SESSION_TTL_SECONDS = 7 * 86_400;
const SessionSchema = z.object({ sid: z.uuid() });
export type Session = z.infer<typeof SessionSchema>;

/** Anonymous visitor session: `{ sid }` signed with HMAC-SHA256 (DealingWith access/session.ts). */
export function signSession(
  session: Session,
  secret: string,
  options: { now: Date; ttlSeconds?: number },
): string {
  const payload = Buffer.from(
    JSON.stringify({
      ...SessionSchema.parse(session),
      exp: Math.floor(options.now.getTime() / 1000) + (options.ttlSeconds ?? SESSION_TTL_SECONDS),
    }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function verifySession(token: string, secret: string, now: Date): Session | null {
  const parts = token.split('.');
  const payload = parts[0];
  const signature = parts[1];
  if (
    parts.length !== 2 ||
    !payload ||
    !signature ||
    !/^[A-Za-z0-9_-]+$/.test(payload) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  )
    return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (
      !data ||
      typeof data !== 'object' ||
      !('exp' in data) ||
      typeof data.exp !== 'number' ||
      !Number.isFinite(data.exp) ||
      data.exp <= now.getTime() / 1000
    )
      return null;
    const session = SessionSchema.safeParse(data);
    return session.success ? { sid: session.data.sid } : null;
  } catch {
    return null;
  }
}

export function sessionCookieHeader(token: string, options: { secure: boolean }): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${options.secure ? '; Secure' : ''}`;
}

export type ApiEnv = { Variables: { sessionId: string } };

/** Starts a new anonymous session and sets its cookie on the response. */
export async function startSession(deps: Deps, c: Context<ApiEnv>): Promise<string> {
  const sid = await createSession(deps);
  const token = signSession({ sid }, deps.env.SESSION_SECRET, { now: deps.now() });
  c.header(
    'Set-Cookie',
    sessionCookieHeader(token, { secure: deps.env.APP_URL.startsWith('https:') }),
    {
      append: true,
    },
  );
  return sid;
}

/**
 * On /api/* (not webhooks): a valid cookie names the session and marks it seen; anything else
 * (no cookie, tampered, expired, or a session the database no longer has) starts a new one.
 */
export function withSession(deps: Deps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (c.req.path.startsWith('/api/webhooks/')) return next();
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? verifySession(token, deps.env.SESSION_SECRET, deps.now()) : null;
    let sessionId = session?.sid;
    if (sessionId) {
      const known = await deps.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, sessionId));
      if (known.length > 0) await touchSession(deps.db, sessionId, deps.now());
      else sessionId = undefined;
    }
    c.set('sessionId', sessionId ?? (await startSession(deps, c)));
    await next();
  };
}
