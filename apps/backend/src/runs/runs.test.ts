import { readFileSync } from 'node:fs';
import {
  type ProductRecord,
  ProductRecordSchema,
  type RunResponse,
  RunResponseSchema,
  runDryerSilent,
  runDryerSpain,
} from '@fitcheck/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from '../agent/scenarios.js';
import { createSession } from '../db/sessions.js';
import { createCap } from '../ledger/caps.js';
import { PENDING_NOTICE, processAttempt } from './attempt.js';
import { activeCap, createHarness } from './harness.js';
import { createRecordedChannel3, createStubReviewPort } from './review-stub.js';
import { getRun, startRun, submitAnswers } from './runs.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness;
afterEach(async () => h?.close());

const fixture = (id: string): ProductRecord =>
  ProductRecordSchema.parse(JSON.parse(readFileSync(new URL(`${id}.json`, FIXTURES_DIR), 'utf8')));
const withPrice = (id: string, price: number): ProductRecord => {
  const record = structuredClone(fixture(id));
  for (const offer of record.product.offers) offer.price.price = price;
  return record;
};
const allYes = (run: RunResponse) => {
  const card = run.attempts.at(-1)?.review.card;
  return Object.fromEntries((card?.lines ?? []).map((l) => [l.lineId, 'yes' as const]));
};
const allNo = (run: RunResponse) => {
  const card = run.attempts.at(-1)?.review.card;
  return Object.fromEntries((card?.lines ?? []).map((l) => [l.lineId, 'no' as const]));
};
const answer = (
  sessionId: string,
  run: RunResponse,
  answers: Record<string, 'yes' | 'no' | 'dont_know'>,
) =>
  submitAnswers(h.deps, {
    sessionId,
    runId: run.runId,
    body: { attemptNo: run.attempts.at(-1)?.attemptNo ?? 1, answers },
  });

describe('runs', () => {
  it('dryer-spain with review on: ANIQ not captured, LURA captured', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    expect(RunResponseSchema.parse(run)).toEqual(run);
    expect(run.attempts.map((a) => a.outcome?.decision)).toEqual(['return_to_agent', 'capture']);
    expect(run.attempts.map((a) => a.outcome?.amountCents)).toEqual([0, 2020]);
    expect(run.attempts[0]?.outcome?.agentMessage).toBe(
      runDryerSpain.attempts[0]?.review.agentMessage,
    );
    expect(run.attempts[1]?.outcome?.agentMessage).toBeUndefined();
    expect(run.events.map((e) => e.type)).toEqual(['authorized', 'not_captured', 'captured']);
    expect(run.events.map((e) => e.amountCents)).toEqual([300000, 2929, 2020]);
    expect(run.cap.capturedCents).toBe(2020);
    expect(run.attempts[0]?.capOnly.outcome).toBe('captured');
    expect(run.status).toBe('done');
    expect(run.checks).toEqual(runDryerSpain.checks);
    expect(
      run.checks.every(
        (c) =>
          c.fact !== undefined ||
          c.requirement === 'common.quantity' ||
          c.requirement === 'common.no_duplicate',
      ),
    ).toBe(true);
    expect(run.attempts[0]?.pick.agentSays).toBe(
      'This hair dryer is $29.29 at walmart.com, under your $40 budget.',
    );
  });

  it('dryer-spain with review off captures the first pick', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'off' });
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]?.outcome).toEqual({ decision: 'capture', amountCents: 2929 });
    expect(run.cap.capturedCents).toBe(2929);
    expect(run.checks).toEqual(runDryerSpain.checks);
    expect(run.status).toBe('done');
  });

  it('tv-sony holds and waits', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    expect(run.status).toBe('awaiting_answers');
    expect(run.attempts[0]?.review.card?.lines).toHaveLength(1);
    expect(run.attempts[0]?.outcome).toBeUndefined();
    expect(run.events.at(-1)).toMatchObject({
      type: 'held',
      sentence: 'No capture sent to PayPal.',
      paypalCall: null,
    });
    expect(run.cap.heldCents).toBe(139800);
  });

  it('answers sent twice return the same final state', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    const first = await answer(sessionId, run, allYes(run));
    const second = await answer(sessionId, run, allNo(run));
    expect(second).toEqual(first);
    expect(first.status).toBe('done');
    expect(first.attempts[0]?.outcome).toEqual({ decision: 'capture', amountCents: 139800 });
    expect(first.events.filter((e) => e.type === 'captured')).toHaveLength(1);
  });

  it('answers sent at the same time capture once', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    const [a, b] = await Promise.all([
      answer(sessionId, run, allYes(run)),
      answer(sessionId, run, allYes(run)),
    ]);
    expect(b).toEqual(a);
    expect(
      h.paypal.events().filter((e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED'),
    ).toHaveLength(1);
  });

  it('a no on tv-sony releases the hold', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    const done = await answer(sessionId, run, allNo(run));
    expect(done.status).toBe('done');
    expect(done.cap.heldCents).toBe(0);
    expect(done.events.at(-1)).toMatchObject({ type: 'not_captured' });
    expect(done.attempts[0]?.outcome).toEqual({
      decision: 'return_to_agent',
      amountCents: 0,
      agentMessage: `Not paid. The buyer did not say yes to: ${run.attempts[0]?.review.card?.lines[0]?.text}.`,
    });
  });

  it('dryer-silent shows the unbacked voltage and, after a no, the dual-voltage Conair', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-silent', review: 'on' });
    const voltage = run.attempts[0]?.review.results.find(
      (r) => r.requirement === 'hair_dryer.dual_voltage',
    );
    expect(voltage?.state).toBe('unbacked');
    expect(voltage?.searched?.length).toBeGreaterThan(0);
    expect(voltage?.evidence).toEqual([]);
    expect(run.checks).toEqual(runDryerSilent.checks);
    const done = await answer(sessionId, run, allNo(run));
    expect(done.attempts).toHaveLength(2);
    expect(done.attempts[0]?.outcome?.agentMessage).toBeTruthy();
    expect(done.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: 3799 });
    expect(done.status).toBe('done');
  });

  it('tv-wall: a no on the Panasonic, then yes on the LG, captures 119999', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'tv-wall', review: 'on' });
    expect(run.checks.map((c) => c.requirement)).toEqual(['tv.screen_size', 'tv.wall_mount']);
    const afterNo = await answer(sessionId, run, allNo(run));
    expect(afterNo.status).toBe('awaiting_answers');
    expect(afterNo.attempts.map((a) => a.pick.productId)).toEqual(['0gH7IUm', '1U7pIWX']);
    const done = await answer(sessionId, afterNo, allYes(afterNo));
    expect(done.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: 119999 });
    expect(done.status).toBe('done');
  });

  it('all four scenarios fit in one $3,000.00 cap', async () => {
    h = await createHarness();
    const { sessionId, cap } = await activeCap(h.deps);
    await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    const silent = await startRun(h.deps, { sessionId, scenarioId: 'dryer-silent', review: 'on' });
    await answer(sessionId, silent, allYes(silent));
    const sony = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    await answer(sessionId, sony, allYes(sony));
    const wall = await startRun(h.deps, { sessionId, scenarioId: 'tv-wall', review: 'on' });
    const lg = await answer(sessionId, wall, allNo(wall));
    const last = await answer(sessionId, lg, allYes(lg));
    expect(last.cap.capId).toBe(cap.capId);
    expect(last.cap.status).toBe('active');
    expect(last.cap.capturedCents).toBe(263318);
  });

  it('starting the same run twice at once returns one run', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const [a, b] = await Promise.all([
      startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' }),
      startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' }),
    ]);
    expect(b.runId).toBe(a.runId);
    expect(
      h.paypal.events().filter((e) => e.event_type === 'PAYMENT.CAPTURE.COMPLETED'),
    ).toHaveLength(1);
    const again = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    expect(again.runId).toBe(a.runId);
  });

  it('a new run releases the hold of a purchase left on its question card', async () => {
    h = await createHarness();
    const { sessionId, cap } = await activeCap(h.deps);
    const first = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    expect(first.status).toBe('awaiting_answers');
    // Within the dedupe window the same run comes back, hold and all.
    const same = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    expect(same.runId).toBe(first.runId);
    expect(same.cap.heldCents).toBe(139800);
    h.clock.set(new Date(Date.parse('2026-11-11T12:00:00.000Z') + 60_000));
    const second = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    expect(second.runId).not.toBe(first.runId);
    expect(second.cap.heldCents).toBe(139800);
    expect(second.cap.availableCents).toBe(cap.amountCents - 139800);
    const left = await getRun(h.deps, { sessionId, runId: first.runId });
    expect(left.status).toBe('done');
    expect(left.attempts[0]?.outcome).toEqual({
      decision: 'return_to_agent',
      amountCents: 0,
      agentMessage: 'Not paid. The buyer left this purchase without answering.',
    });
    expect(left.events.at(-1)).toMatchObject({ type: 'not_captured', paypalCall: null });
    expect(h.paypal.calls('capture')).toEqual([]);
  });

  it('review on, off and on again inside the dedupe window starts a fresh card', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const at = (s: number) =>
      h.clock.set(new Date(Date.parse('2026-11-11T12:00:00.000Z') + s * 1000));
    const first = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    at(2);
    await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'off' });
    at(4);
    const again = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    expect(again.runId).not.toBe(first.runId);
    expect(again.status).toBe('awaiting_answers');
    expect(again.attempts[0]?.review.card?.lines).toHaveLength(1);
    expect(again.cap.heldCents).toBe(139800);
  });

  it('answers to a purchase released by a new run change nothing', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const first = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    h.clock.set(new Date(Date.parse('2026-11-11T12:00:00.000Z') + 60_000));
    await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    const late = await answer(sessionId, first, allYes(first));
    expect(late.status).toBe('done');
    expect(late.attempts[0]?.outcome?.decision).toBe('return_to_agent');
    expect(late.events.filter((e) => e.type === 'captured')).toHaveLength(0);
  });

  it('a run without an approved cap is refused', async () => {
    h = await createHarness();
    const sessionId = await createSession(h.deps);
    await expect(
      startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' }),
    ).rejects.toMatchObject({
      code: 'cap_not_active',
      status: 409,
      message: 'Approve a spending cap first.',
    });
    await createCap(h.deps, {
      sessionId,
      mode: 'simulated',
      amountCents: 300000,
      returnScenarioId: null,
      fallback: true,
    });
    await expect(
      startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' }),
    ).rejects.toMatchObject({ code: 'cap_not_active', status: 409 });
  });

  it('an unknown scenario is 404', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    await expect(
      startRun(h.deps, { sessionId, scenarioId: 'nope', review: 'on' }),
    ).rejects.toMatchObject({ code: 'unknown_scenario', status: 404 });
  });

  it('a cap short of the price ends the run with the cap sentence', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps, { amountCents: 1000 });
    const run = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]?.outcome).toEqual({
      decision: 'return_to_agent',
      amountCents: 0,
      agentMessage: 'Not paid. The spending cap has $10.00 left.',
    });
    expect(run.events.at(-1)?.sentence).toBe('The spending cap has $10.00 left.');
    expect(run.notices).toContain('The spending cap has $10.00 left.');
    expect(run.status).toBe('done');
  });

  it('captures the re-fetched offer price times quantity', async () => {
    h = await createHarness({
      channel3: createRecordedChannel3({
        overrides: { saZdY6C: [withPrice('saZdY6C', 20.2), withPrice('saZdY6C', 25)] },
      }),
    });
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    expect(run.attempts[1]?.pick.priceCents).toBe(2020);
    expect(run.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: 2500 });
    expect(run.cap.capturedCents).toBe(2500);
  });

  it('review failing closed captures nothing', async () => {
    const stub = createStubReviewPort();
    h = await createHarness({
      review: createStubReviewPort({
        byProduct: { cv7t721: stub.failClosed(new Date(), fixture('cv7t721')) },
      }),
    });
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]?.review.failedClosed).toBe(true);
    expect(run.events.map((e) => e.type)).toEqual(['authorized', 'not_captured']);
    expect(h.paypal.calls('capture')).toEqual([]);
    expect(run.status).toBe('done');
  });

  it('intent extraction failure fails the first attempt closed', async () => {
    h = await createHarness({ review: createStubReviewPort({ throwOnIntent: 'model_error' }) });
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    expect(RunResponseSchema.parse(run)).toEqual(run);
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]?.review.failedClosed).toBe(true);
    expect(run.attempts[0]?.outcome).toEqual({
      decision: 'return_to_agent',
      amountCents: 0,
      agentMessage: 'Fitcheck could not check this listing.',
    });
    expect(run.events.map((e) => e.type)).toEqual(['authorized', 'not_captured']);
    expect(h.paypal.calls('capture')).toEqual([]);
    expect(run.checks).toEqual([]);
    expect(run.intent).toMatchObject({
      category: 'hair_dryer',
      quantity: 1,
      source: 'model',
      stated: {},
    });
    expect(run.status).toBe('done');
  });

  it('intent extraction failure with review off still captures', async () => {
    h = await createHarness({ review: createStubReviewPort({ throwOnIntent: 'model_error' }) });
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'off' });
    expect(run.attempts[0]?.outcome).toEqual({ decision: 'capture', amountCents: 2929 });
  });

  it('a Channel3 re-fetch with no recording fails closed', async () => {
    h = await createHarness({
      channel3: createRecordedChannel3({
        overrides: { cv7t721: [fixture('cv7t721'), 'unavailable'] },
      }),
    });
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]?.review.failedClosed).toBe(true);
    expect(run.attempts[0]?.review.record?.source).toBe('recorded');
    expect(h.paypal.calls('capture')).toEqual([]);
    expect(run.status).toBe('done');
  });

  it('the Channel3 fallback adds the recorded-copy notice', async () => {
    h = await createHarness({ channel3: createRecordedChannel3({ mode: 'live' }) });
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    const notice = 'Channel3 did not answer. Showing the copy recorded on Nov 10, 2026.';
    expect(run.notices.filter((n) => n === notice)).toHaveLength(1);
  });

  it('memory from a no reaches the next review', async () => {
    const stub = createStubReviewPort();
    h = await createHarness({ review: stub });
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'tv-wall', review: 'on' });
    const card = run.attempts[0]?.review.card;
    if (!card) throw new Error('no card');
    const expected = stub.applyAnswers(card, allNo(run), {}).memory;
    await answer(sessionId, run, allNo(run));
    const lgInput = stub.inputs.find((i) => i.purchase.productId === '1U7pIWX');
    expect(lgInput?.memory).toEqual(expected);
    expect(Object.keys(expected).length).toBeGreaterThan(0);
  });

  it('a simulated fallback cap adds the PayPal notice', async () => {
    h = await createHarness();
    const sessionId = await createSession(h.deps);
    const cap = await createCap(h.deps, {
      sessionId,
      mode: 'simulated',
      amountCents: 300000,
      returnScenarioId: null,
      fallback: true,
    });
    const orderId = cap.approveUrl?.split('token=')[1] ?? '';
    await h.paypal.approve(orderId);
    const { completeApproval } = await import('../ledger/caps.js');
    await completeApproval(h.deps, { orderId });
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    expect(run.notices).toContain(
      'PayPal is simulated on this site. The video shows the same flow on the PayPal sandbox.',
    );
  });

  it('answers to a run of another session are 404, and bad keys are 400', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    const other = await createSession(h.deps);
    await expect(answer(other, run, allYes(run))).rejects.toMatchObject({ status: 404 });
    await expect(answer(sessionId, run, { wrong: 'yes' })).rejects.toMatchObject({
      code: 'invalid_answers',
      status: 400,
    });
  });

  it('answers on a finished dryer-silent run change nothing', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-silent', review: 'on' });
    const done = await answer(sessionId, run, allNo(run));
    expect(done.attempts).toHaveLength(2);
    const captures = h.paypal.calls('capture').length;
    // The judge goes Back and sends different answers to the first, finished attempt.
    const back = await submitAnswers(h.deps, {
      sessionId,
      runId: run.runId,
      body: { attemptNo: 1, answers: allYes(run) },
    });
    expect(back).toEqual(done);
    // And answers to an attempt that never had a card.
    const second = await submitAnswers(h.deps, {
      sessionId,
      runId: run.runId,
      body: { attemptNo: 2, answers: {} },
    });
    expect(second).toEqual(done);
    expect(h.paypal.calls('capture')).toHaveLength(captures);
  });

  it('answers to a card whose hold the cap refused change nothing', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps, { amountCents: 1000 });
    const run = await startRun(h.deps, { sessionId, scenarioId: 'tv-wall', review: 'on' });
    expect(run.status).toBe('done');
    const again = await answer(sessionId, run, allNo(run));
    expect(again).toEqual(run);
  });

  it('a PENDING capture shows on hold, then captured once PayPal settles it', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    h.paypal.failNext('capture', 'PENDING');
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    expect(run.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: 0 });
    expect(run.notices).toContain(PENDING_NOTICE);
    expect(PENDING_NOTICE).toBe('PayPal is still confirming this capture.');
    const pending = h.paypal.events().find((e) => e.event_type === 'PAYMENT.CAPTURE.PENDING');
    await h.paypal.settlePending(String(pending?.resource.id), 'COMPLETED');
    const settled = await getRun(h.deps, { sessionId, runId: run.runId });
    expect(settled.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: 2020 });
    expect(settled.notices).not.toContain(PENDING_NOTICE);
    expect(settled.cap.capturedCents).toBe(2020);
  });

  it('a PENDING capture PayPal later denies shows not paid', async () => {
    h = await createHarness();
    const { sessionId } = await activeCap(h.deps);
    h.paypal.failNext('capture', 'PENDING');
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    const pending = h.paypal.events().find((e) => e.event_type === 'PAYMENT.CAPTURE.PENDING');
    await h.paypal.settlePending(String(pending?.resource.id), 'DENIED');
    const denied = await getRun(h.deps, { sessionId, runId: run.runId });
    expect(denied.attempts[1]?.outcome).toEqual({
      decision: 'return_to_agent',
      amountCents: 0,
      agentMessage: 'Not paid. PayPal declined the capture.',
    });
    expect(denied.notices).not.toContain(PENDING_NOTICE);
    expect(denied.cap.heldCents).toBe(0);
  });

  /** The review allows the ANIQ, but its walmart.com offer is gone when Fitcheck re-fetches. */
  function offerVanishes() {
    const aniq = fixture('cv7t721');
    const gone = structuredClone(aniq);
    for (const offer of gone.product.offers) offer.domain = 'elsewhere.example';
    const allow = runDryerSpain.attempts[1]?.review;
    if (!allow) throw new Error('example has no LURA review');
    return {
      review: createStubReviewPort({ byProduct: { cv7t721: allow } }),
      channel3: createRecordedChannel3({ overrides: { cv7t721: [aniq, gone] } }),
    };
  }

  it('an allowed capture with no offer at re-fetch ends offer_missing', async () => {
    h = await createHarness(offerVanishes());
    const { cap } = await activeCap(h.deps);
    const pickRecord = await h.deps.channel3.getProduct('cv7t721');
    const out = await processAttempt(h.deps, {
      runId: h.deps.newId(),
      capId: cap.capId,
      attemptNo: 1,
      reviewMode: 'on',
      intent: runDryerSpain.intent,
      pick: {
        productId: 'cv7t721',
        title: 'ANIQ',
        domain: 'walmart.com',
        priceCents: 2929,
        image: null,
        agentSays: '',
      },
      quantity: 1,
      memory: {},
      capturedProductIds: [],
      pickRecord,
    });
    expect(out.endedBy).toBe('offer_missing');
    expect(out.attempt.outcome).toEqual({
      decision: 'return_to_agent',
      amountCents: 0,
      agentMessage: 'Fitcheck could not check this listing.',
    });
    expect(h.paypal.calls('capture')).toEqual([]);
  });

  it('after an offer_missing attempt the run plays the next pick', async () => {
    h = await createHarness(offerVanishes());
    const { sessionId } = await activeCap(h.deps);
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    expect(run.attempts.map((a) => a.outcome?.decision)).toEqual(['return_to_agent', 'capture']);
    expect(run.attempts[1]?.outcome?.amountCents).toBe(2020);
  });
});
