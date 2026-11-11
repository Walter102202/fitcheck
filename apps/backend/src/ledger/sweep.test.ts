import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { sessions } from '../db/schema.js';
import { createSession, touchSession } from '../db/sessions.js';
import { activeCap, createHarness } from '../runs/harness.js';
import { createCap, getCap, listCapEvents } from './caps.js';
import { sweepCaps } from './sweep.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness;
afterEach(async () => h?.close());

const NOW = new Date('2026-11-11T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

async function seenAt(sessionId: string, at: Date) {
  await h.deps.db.update(sessions).set({ lastSeenAt: at }).where(eq(sessions.id, sessionId));
}

describe('sweepCaps', () => {
  it('reauthorizes on day 25', async () => {
    h = await createHarness();
    const { sessionId, cap } = await activeCap(h.deps);
    const day25 = new Date(NOW.getTime() + 25 * 86_400_000);
    h.clock.set(day25);
    await touchSession(h.deps.db, sessionId, day25);
    const result = await sweepCaps(h.deps);
    expect(result).toEqual({ voided: 0, reauthorized: 1, expired: 0 });
    const after = await getCap(h.deps, cap.capId);
    expect(after.status).toBe('active');
    expect(after.authorizationId).toBe('MOCK-AUTH-000002');
    expect(after.expiresAt).toBe(new Date(day25.getTime() + 29 * 86_400_000).toISOString());
    const events = await listCapEvents(h.deps.db, cap.capId);
    expect(events.at(-1)).toMatchObject({
      type: 'authorized',
      sentence: 'PayPal authorized the cap again before its 29-day limit.',
      paypalCall: {
        method: 'POST',
        path: '/v2/payments/authorizations/MOCK-AUTH-000001/reauthorize',
      },
      paypalId: 'MOCK-AUTH-000002',
    });
    expect(h.paypal.calls('reauthorize')).toEqual([`reauth:${cap.capId}`]);
    expect(await sweepCaps(h.deps)).toEqual({ voided: 0, reauthorized: 0, expired: 0 });
  });

  it('voids the cap of a session idle for 120 minutes', async () => {
    h = await createHarness();
    const idle = await activeCap(h.deps);
    const recent = await activeCap(h.deps);
    await seenAt(idle.sessionId, minutesAgo(121));
    await seenAt(recent.sessionId, minutesAgo(119));
    expect(await sweepCaps(h.deps)).toEqual({ voided: 1, reauthorized: 0, expired: 0 });
    expect((await getCap(h.deps, idle.cap.capId)).status).toBe('voided');
    expect((await getCap(h.deps, recent.cap.capId)).status).toBe('active');
    const events = await listCapEvents(h.deps.db, idle.cap.capId);
    expect(events.at(-1)).toMatchObject({
      type: 'voided',
      paypalCall: {
        method: 'POST',
        path: `/v2/payments/authorizations/${idle.cap.authorizationId}/void`,
      },
    });
  });

  it('expires an approval abandoned for 120 minutes, with no PayPal call', async () => {
    h = await createHarness();
    const sessionId = await createSession(h.deps);
    const cap = await createCap(h.deps, {
      sessionId,
      mode: 'simulated',
      amountCents: 300000,
      returnScenarioId: null,
      fallback: true,
    });
    await seenAt(sessionId, minutesAgo(121));
    expect(await sweepCaps(h.deps)).toEqual({ voided: 0, reauthorized: 0, expired: 1 });
    expect((await getCap(h.deps, cap.capId)).status).toBe('expired');
    expect(h.paypal.calls('void')).toEqual([]);
  });

  it('expires an active cap past its authorization limit', async () => {
    h = await createHarness();
    const { sessionId, cap } = await activeCap(h.deps);
    const late = new Date(NOW.getTime() + 30 * 86_400_000);
    h.clock.set(late);
    await touchSession(h.deps.db, sessionId, late);
    expect(await sweepCaps(h.deps)).toEqual({ voided: 0, reauthorized: 0, expired: 1 });
    expect((await getCap(h.deps, cap.capId)).status).toBe('expired');
  });
});
