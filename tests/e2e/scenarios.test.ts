import { API, ApiErrorSchema, type RunResponse } from '@fitcheck/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createE2E, type E2E } from './harness.js';

let e: E2E | undefined;
afterEach(async () => {
  await e?.close();
  e = undefined;
});

async function boot(env: Record<string, string> = {}) {
  e = await createE2E(env);
  return e;
}

const LURA_CENTS = 2020;
const SONY_CENTS = 139800;
const LG_CENTS = 119999;

const result = (run: RunResponse, attempt: number, requirement: string) =>
  run.attempts[attempt]?.review.results.find((r) => r.requirement === requirement);
const eventSummary = (run: RunResponse) => run.events.map((ev) => [ev.type, ev.amountCents]);

describe('the four scenarios over HTTP', () => {
  it('dryer-spain: the 110-120 V ANIQ goes back to the agent, the LURA is captured', async () => {
    const v = (await boot()).visitor();
    await v.approveCap('dryer-spain');
    const run = await v.start('dryer-spain');

    expect(run.status).toBe('done');
    expect(run.attempts[0]?.review.decision).toBe('return_to_agent');
    expect(result(run, 0, 'hair_dryer.dual_voltage')?.state).toBe('broken');
    expect(run.attempts[1]?.review.decision).toBe('capture');
    expect(run.attempts[1]?.review.card).toBeUndefined();
    expect(eventSummary(run)).toEqual([
      ['authorized', 300000],
      ['not_captured', 2929],
      ['captured', LURA_CENTS],
    ]);
    expect(run.cap.capturedCents).toBe(LURA_CENTS);
  });

  it('dryer-silent: voltage unbacked and asked; a no moves to the LURA, which is captured', async () => {
    const v = (await boot()).visitor();
    await v.approveCap();
    const held = await v.start('dryer-silent');

    expect(held.attempts[0]?.review.decision).toBe('ask');
    expect(held.attempts[0]?.review.card?.lines).toHaveLength(1);
    const voltage = result(held, 0, 'hair_dryer.dual_voltage');
    expect(voltage?.state).toBe('unbacked');
    expect(voltage?.searched?.length ?? 0).toBeGreaterThan(0);

    const done = await v.answerAll(held, 'no');
    expect(done.attempts[0]?.outcome?.decision).toBe('return_to_agent');
    expect(done.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: LURA_CENTS });
  });

  it('tv-sony: the 65/55 contradiction is asked; yes captures, no in a fresh session captures nothing', async () => {
    const env = await boot();
    const yes = env.visitor();
    await yes.approveCap();
    const held = await yes.start('tv-sony');
    expect(held.attempts[0]?.review.decision).toBe('ask');
    expect(held.attempts[0]?.review.card?.lines).toHaveLength(1);
    expect(result(held, 0, 'tv.screen_size')?.state).toBe('contradictory');
    const paid = await yes.answerAll(held, 'yes');
    expect(paid.attempts[0]?.outcome).toEqual({ decision: 'capture', amountCents: SONY_CENTS });

    const no = env.visitor();
    await no.approveCap();
    const refused = await no.answerAll(await no.start('tv-sony'), 'no');
    expect(refused.attempts[0]?.outcome?.decision).toBe('return_to_agent');
    expect(refused.events.map((ev) => ev.type)).toContain('not_captured');
    expect(refused.cap.heldCents).toBe(0);
    expect(refused.cap.capturedCents).toBe(0);
  });

  it('tv-wall: the Panasonic mount is asked and refused; the LG is asked and captured', async () => {
    const v = (await boot()).visitor();
    await v.approveCap();
    const first = await v.start('tv-wall');
    expect(first.attempts[0]?.review.decision).toBe('ask');
    expect(result(first, 0, 'tv.wall_mount')?.state).toBe('never_asked');

    const second = await v.answerAll(first, 'no');
    expect(second.attempts[0]?.outcome?.decision).toBe('return_to_agent');
    expect(second.attempts[1]?.review.decision).toBe('ask');

    const done = await v.answerAll(second, 'yes');
    expect(done.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: LG_CENTS });
  });
});

describe('payments and sessions over HTTP', () => {
  it('review-off: the Sony is captured at once at its price', async () => {
    const v = (await boot()).visitor();
    await v.approveCap();
    const run = await v.start('tv-sony', 'off');
    expect(run.status).toBe('done');
    expect(run.attempts[0]?.outcome).toEqual({ decision: 'capture', amountCents: SONY_CENTS });
  });

  it('reset-voids: reset after a capture voids the authorization exactly once', async () => {
    const env = await boot();
    const v = env.visitor();
    await v.approveCap();
    await v.start('dryer-spain');
    const before = v.cookie;

    const res = await v.reset();
    expect(res.status).toBe(204);
    expect(v.cookie).not.toBe(before);
    expect(env.paypal.calls('void')).toHaveLength(1);
    expect(env.paypal.events().map((ev) => ev.event_type)).toContain(
      'PAYMENT.AUTHORIZATION.VOIDED',
    );
    expect(await v.cap()).toBeNull();
  });

  it('answers-twice: the same answers twice give one capture and equal responses', async () => {
    const env = await boot();
    const v = env.visitor();
    await v.approveCap();
    const held = await v.start('tv-sony');
    const line = held.attempts[0]?.review.card?.lines[0]?.lineId ?? '';
    const body = JSON.stringify({ attemptNo: 1, answers: { [line]: 'yes' } });
    const post = () =>
      v.request(API.runAnswers(held.runId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });

    const first = await (await post()).json();
    const second = await (await post()).json();
    expect(second).toEqual(first);
    expect(env.paypal.calls('capture')).toHaveLength(1);
  });

  it('cap-exhausted: with a $50.00 cap the Sony is not captured and the notice says why', async () => {
    const v = (await boot({ CAP_AMOUNT_CENTS: '5000' })).visitor();
    await v.approveCap();
    const run = await v.start('tv-sony');
    const last = run.attempts.at(-1);
    expect(last?.outcome?.decision).toBe('return_to_agent');
    expect(last?.outcome?.amountCents).toBe(0);
    expect(run.notices.join(' ')).toContain('The spending cap has $50.00 left.');
    expect(run.cap.capturedCents).toBe(0);
  });

  it('two-sessions: two visitors get independent caps', async () => {
    const env = await boot();
    const a = env.visitor();
    const b = env.visitor();
    await a.approveCap();
    await b.approveCap();
    await a.start('tv-sony', 'off');

    expect((await a.cap())?.capturedCents).toBe(SONY_CENTS);
    const other = await b.cap();
    expect(other?.capturedCents).toBe(0);
    expect(other?.capId).not.toBe((await a.cap())?.capId);
  });

  it('session-lost: an unknown cookie gets a new session and no cap', async () => {
    const env = await boot();
    const v = env.visitor('fc_session=forgotten-after-a-redeploy');
    expect(await v.cap()).toBeNull();
    expect(v.cookie).toMatch(/^fc_session=/);
    expect(v.cookie).not.toBe('fc_session=forgotten-after-a-redeploy');
  });

  it('simulated-fallback: sandbox without credentials approves on the simulated page and pays', async () => {
    const v = (await boot({ PAYPAL_MODE: 'sandbox' })).visitor();
    const opened = await v.openCap('dryer-spain');
    expect(opened).toMatchObject({ mode: 'simulated', status: 'pending_approval' });
    const cap = await v.approveCap('dryer-spain');
    expect(cap.status).toBe('active');
    const run = await v.start('dryer-spain');
    expect(run.attempts.at(-1)?.outcome).toEqual({ decision: 'capture', amountCents: LURA_CENTS });
  });

  it('cap-pending: an unapproved cap stays pending and runs answer 409 cap_not_active', async () => {
    const v = (await boot({ PAYPAL_MODE: 'sandbox' })).visitor();
    const cap = await v.openCap('tv-sony');
    expect(cap.status).toBe('pending_approval');

    const res = await v.startRaw('tv-sony');
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(await res.json()).error).toBe('cap_not_active');
    expect((await v.cap())?.status).toBe('pending_approval');
  });
});
