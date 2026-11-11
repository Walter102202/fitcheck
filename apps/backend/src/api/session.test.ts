import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sessions } from '../db/schema.js';
import { createHarness } from '../runs/harness.js';
import { SESSION_COOKIE, sessionCookieHeader, signSession, verifySession } from './session.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness;
afterEach(async () => h?.close());

const now = new Date('2026-11-11T12:00:00.000Z');
const sid = '00000000-0000-4000-8000-0000000000aa';

function cookieOf(res: Response): string | undefined {
  const header = res.headers.get('set-cookie') ?? '';
  return /fc_session=([^;]+)/.exec(header)?.[1];
}

describe('signed session cookie', () => {
  it('round-trips the session id and rejects tampering, another secret and expiry', () => {
    const token = signSession({ sid }, 'secret', { now });
    expect(verifySession(token, 'secret', now)).toEqual({ sid });
    const [payload, sig] = token.split('.');
    expect(
      verifySession(`${payload}.${sig?.[0] === 'A' ? 'B' : 'A'}${sig?.slice(1)}`, 'secret', now),
    ).toBeNull();
    expect(verifySession(token, 'other', now)).toBeNull();
    expect(
      verifySession(token, 'secret', new Date(now.getTime() + 7 * 86_400_000 + 1000)),
    ).toBeNull();
    expect(verifySession('invalid', 'secret', now)).toBeNull();
  });

  it('is HttpOnly, SameSite=Lax, seven days, and Secure only on https', () => {
    expect(sessionCookieHeader('t', { secure: false })).toBe(
      `${SESSION_COOKIE}=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    );
    expect(sessionCookieHeader('t', { secure: true })).toContain('; Secure');
  });
});

describe('withSession', () => {
  it('first request sets an fc_session cookie and creates a session', async () => {
    h = await createHarness();
    const res = await createApp(h.deps).request('/api/config');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(
      /^fc_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax/,
    );
    const rows = await h.deps.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(verifySession(cookieOf(res) ?? '', h.deps.env.SESSION_SECRET, now)).toEqual({
      sid: rows[0]?.id,
    });
  });

  it('a valid cookie keeps the session and sets no new cookie', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const first = await app.request('/api/config');
    const token = cookieOf(first);
    const second = await app.request('/api/config', { headers: { cookie: `fc_session=${token}` } });
    expect(second.headers.get('set-cookie')).toBeNull();
    expect(await h.deps.db.select().from(sessions)).toHaveLength(1);
  });

  it('a tampered cookie gets a new session', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const token = cookieOf(await app.request('/api/config')) ?? '';
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    const res = await app.request('/api/config', { headers: { cookie: `fc_session=${tampered}` } });
    expect(cookieOf(res)).toBeDefined();
    expect(cookieOf(res)).not.toBe(token);
    expect(await h.deps.db.select().from(sessions)).toHaveLength(2);
  });

  it('an expired cookie gets a new session', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const old = signSession({ sid }, h.deps.env.SESSION_SECRET, {
      now: new Date(now.getTime() - 8 * 86_400_000),
    });
    const res = await app.request('/api/config', { headers: { cookie: `fc_session=${old}` } });
    expect(cookieOf(res)).toBeDefined();
    const rows = await h.deps.db.select().from(sessions);
    expect(rows.map((r) => r.id)).not.toContain(sid);
  });

  it('marks the cookie Secure when APP_URL is https', async () => {
    h = await createHarness({
      env: { APP_URL: 'https://fitcheck.example', SESSION_SECRET: 's3cret' },
    });
    const res = await createApp(h.deps).request('/api/config');
    expect(res.headers.get('set-cookie')).toContain('; Secure');
  });
});
