import { type RunResponse, RunResponseSchema } from '@fitcheck/contracts';
import { beforeEach, expect, test, vi } from 'vitest';
import { goTo } from '../../lib/browser.js';
import { activeFixtureCap, createFakeApi, FIXTURE_STORAGE_KEY } from './fake-api.js';
import { FIXTURE_RESULTS } from './results.js';
import { failedClosedRun, fixtureRun, pendingCaptureRun } from './runs.js';
import { FIXTURE_SCENARIOS } from './scenarios.js';

vi.mock('../../lib/browser.js', () => ({ goTo: vi.fn(), postForm: vi.fn() }));

beforeEach(() => {
  vi.mocked(goTo).mockClear();
});

function allYes(run: RunResponse, attemptNo: number) {
  const card = run.attempts.find((a) => a.attemptNo === attemptNo)?.review.card;
  return Object.fromEntries((card?.lines ?? []).map((l) => [l.lineId, 'yes' as const]));
}

function allNo(run: RunResponse, attemptNo: number) {
  const card = run.attempts.find((a) => a.attemptNo === attemptNo)?.review.card;
  return Object.fromEntries((card?.lines ?? []).map((l) => [l.lineId, 'no' as const]));
}

test('the four scenarios come in the Home order with their showcase chips', async () => {
  const scenarios = await createFakeApi().getScenarios();
  expect(scenarios.map((s) => [s.id, s.showcase])).toEqual([
    ['dryer-spain', 'broken'],
    ['dryer-silent', 'unbacked'],
    ['tv-sony', 'contradictory'],
    ['tv-wall', 'never_asked'],
  ]);
  expect(scenarios).toEqual(FIXTURE_SCENARIOS);
});

test('each scenario starts with the expected review decisions', async () => {
  const api = createFakeApi({ cap: activeFixtureCap() });
  const dryer = await api.startRun({ scenarioId: 'dryer-spain', review: 'on' });
  expect(dryer.attempts.map((a) => a.review.decision)).toEqual(['return_to_agent', 'capture']);
  expect(dryer.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: 2020 });
  const silent = await api.startRun({ scenarioId: 'dryer-silent', review: 'on' });
  expect(silent.attempts[0]?.pick).toMatchObject({ productId: '5swh9aC', domain: 'boscovs.com' });
  const unbacked = silent.attempts[0]?.review.results.find((r) => r.state === 'unbacked');
  expect(unbacked?.evidence).toEqual([]);
  expect(unbacked?.searched?.length).toBeGreaterThan(0);
  const sony = await api.startRun({ scenarioId: 'tv-sony', review: 'on' });
  expect(sony.status).toBe('awaiting_answers');
  expect(sony.attempts[0]?.review.card?.lines).toHaveLength(1);
  const wall = await api.startRun({ scenarioId: 'tv-wall', review: 'on' });
  expect(wall.attempts[0]?.pick).toMatchObject({ productId: '0gH7IUm', priceCents: 49999 });
  expect(
    wall.attempts[0]?.review.results.find((r) => r.requirement === 'tv.wall_mount')?.state,
  ).toBe('never_asked');
  expect(sony.cap.amountCents).toBe(300000);
  expect(new Set([dryer.runId, silent.runId, sony.runId, wall.runId]).size).toBe(4);
  expect(dryer.runId).toMatch(/^run-fx-/);
});

test('a started run shows the simulated session cap', async () => {
  const run = await createFakeApi({ cap: activeFixtureCap() }).startRun({
    scenarioId: 'tv-sony',
    review: 'on',
  });
  expect(run.cap).toMatchObject({ capId: 'cap-fx', mode: 'simulated', amountCents: 300000 });
});

test('tv-wall: no brings the LG, which asks again; yes captures it', async () => {
  const api = createFakeApi({ cap: activeFixtureCap() });
  const run = await api.startRun({ scenarioId: 'tv-wall', review: 'on' });
  const afterNo = await api.sendAnswers(run.runId, { attemptNo: 1, answers: allNo(run, 1) });
  expect(afterNo.attempts).toHaveLength(2);
  expect(afterNo.attempts[1]?.pick.productId).toBe('1U7pIWX');
  expect(afterNo.attempts[1]?.attemptNo).toBe(2);
  expect(afterNo.status).toBe('awaiting_answers');
  expect(afterNo.events.at(-1)).toMatchObject({ type: 'held', amountCents: 119999 });
  const afterYes = await api.sendAnswers(run.runId, {
    attemptNo: 2,
    answers: allYes(afterNo, 2),
  });
  expect(afterYes.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: 119999 });
  expect(afterYes.status).toBe('done');
  expect(afterYes.cap.capturedCents).toBe(119999);
  expect(afterYes.cap.heldCents).toBe(0);
});

test('a second createCap returns the same pending cap', async () => {
  const api = createFakeApi();
  const a = await api.createCap({ scenarioId: 'dryer-spain' });
  const b = await api.createCap({ scenarioId: 'dryer-spain' });
  expect(b.capId).toBe(a.capId);
  expect(b.approveUrl).toBe(a.approveUrl);
});

test('every fixture run and the failed-closed run parse with RunResponseSchema', () => {
  for (const s of FIXTURE_SCENARIOS)
    expect(() => RunResponseSchema.parse(fixtureRun(s.id))).not.toThrow();
  expect(RunResponseSchema.parse(failedClosedRun()).attempts[0]?.review.failedClosed).toBe(true);
  expect(RunResponseSchema.parse(pendingCaptureRun()).attempts[1]?.outcome).toEqual({
    decision: 'capture',
    amountCents: 0,
  });
});

test('the failed-closed run returns to the agent with no card and nothing captured', () => {
  const run = failedClosedRun();
  expect(run.attempts).toHaveLength(1);
  expect(run.attempts[0]?.review).toMatchObject({
    decision: 'return_to_agent',
    failedClosed: true,
    results: [],
    agentMessage: 'Fitcheck could not check this listing.',
  });
  expect(run.attempts[0]?.review.card).toBeUndefined();
  expect(run.attempts[0]?.outcome).toEqual({
    decision: 'return_to_agent',
    amountCents: 0,
    agentMessage: 'Fitcheck could not check this listing.',
  });
  expect(run.status).toBe('done');
});

test('the failed-intent run keeps the request and has no checks', () => {
  const run = failedClosedRun({ intentFailed: true });
  expect(run.checks).toEqual([]);
  expect(run.intent).toMatchObject({ stated: {}, triggered: {}, notChecked: [] });
  expect(run.intent.request).toBe(fixtureRun('dryer-spain').intent.request);
});

test('fixtureRun returns a fresh copy each time', () => {
  const a = fixtureRun('tv-sony');
  a.attempts.length = 0;
  expect(fixtureRun('tv-sony').attempts).toHaveLength(1);
});

test('answering all yes on the Sony captures its price once, even when sent twice', async () => {
  const api = createFakeApi({ cap: activeFixtureCap() });
  const run = await api.startRun({ scenarioId: 'tv-sony', review: 'on' });
  const price = run.attempts[0]?.pick.priceCents;
  const answers = allYes(run, 1);
  const first = await api.sendAnswers(run.runId, { attemptNo: 1, answers });
  const second = await api.sendAnswers(run.runId, { attemptNo: 1, answers });
  expect(second).toEqual(first);
  expect(second.events.filter((e) => e.type === 'captured')).toHaveLength(1);
  expect(second.events.at(-1)?.paypalId).toMatch(/^FAKE-CAPTURE-/);
  expect(second.attempts[0]?.outcome).toEqual({ decision: 'capture', amountCents: price });
  expect(second.attempts[0]?.answers).toEqual(answers);
  expect(second.cap).toMatchObject({ capturedCents: price, heldCents: 0 });
  expect(second.status).toBe('done');
});

test('answering no on the Sony ends not captured and releases the hold', async () => {
  const api = createFakeApi({ cap: activeFixtureCap() });
  const run = await api.startRun({ scenarioId: 'tv-sony', review: 'on' });
  const line = run.attempts[0]?.review.card?.lines[0];
  const done = await api.sendAnswers(run.runId, { attemptNo: 1, answers: allNo(run, 1) });
  expect(done.attempts[0]?.outcome).toEqual({
    decision: 'return_to_agent',
    amountCents: 0,
    agentMessage: `Not paid. The buyer did not accept: ${line?.text}`,
  });
  expect(done.events.at(-1)).toMatchObject({
    type: 'not_captured',
    sentence: 'The buyer did not accept. Hold released.',
    paypalCall: null,
  });
  expect(done.cap).toMatchObject({ heldCents: 0, capturedCents: 0, availableCents: 300000 });
  expect(done.status).toBe('done');
});

test('answering no on dryer-silent appends the LURA, captured at $20.20', async () => {
  const api = createFakeApi({ cap: activeFixtureCap() });
  const run = await api.startRun({ scenarioId: 'dryer-silent', review: 'on' });
  const done = await api.sendAnswers(run.runId, { attemptNo: 1, answers: allNo(run, 1) });
  expect(done.attempts).toHaveLength(2);
  expect(done.attempts[1]?.attemptNo).toBe(2);
  expect(done.attempts[1]?.pick.productId).toBe('saZdY6C');
  expect(done.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: 2020 });
  expect(done.events.at(-1)).toMatchObject({ type: 'captured', amountCents: 2020 });
  expect(done.cap).toMatchObject({ capturedCents: 2020, heldCents: 0, availableCents: 297980 });
  expect(done.status).toBe('done');
});

test('review off pays the first pick with no review', async () => {
  const api = createFakeApi({ cap: activeFixtureCap() });
  const run = await api.startRun({ scenarioId: 'dryer-spain', review: 'off' });
  expect(run.review).toBe('off');
  expect(run.attempts).toHaveLength(1);
  expect(run.attempts[0]?.outcome).toEqual({ decision: 'capture', amountCents: 2929 });
  // As apps/backend/src/runs/cap-only.ts capOnlyReview sends it: nothing was checked.
  const review = run.attempts[0]?.review;
  expect(review).toMatchObject({
    decision: 'capture',
    results: [],
    reasons: [],
    summary: { backed: 0, unbacked: 0, never_asked: 0, contradictory: 0, broken: 0 },
  });
  expect(review?.card).toBeUndefined();
  expect(review?.agentMessage).toBeUndefined();
  expect(run.events.map((e) => e.type)).toEqual(['authorized', 'captured']);
  expect(run.events.at(-1)).toMatchObject({ type: 'captured', amountCents: 2929 });
  expect(run.cap).toMatchObject({ capturedCents: 2929, heldCents: 0, availableCents: 297071 });
  expect(run.status).toBe('done');
});

test('createCap then completeSimulatedApproval activates the cap and goes to the run', async () => {
  const api = createFakeApi();
  const cap = await api.createCap({ scenarioId: 'dryer-spain' });
  expect(cap.status).toBe('pending_approval');
  expect(cap.mode).toBe('simulated');
  expect(cap.approveUrl).toMatch(/^\/cap\/approve-simulated\?token=/);
  const token = new URL(cap.approveUrl ?? '', 'http://x').searchParams.get('token') ?? '';
  await api.completeSimulatedApproval(token);
  expect((await api.getCap())?.status).toBe('active');
  expect((await api.getCap())?.availableCents).toBe(300000);
  expect(goTo).toHaveBeenCalledWith('/run/dryer-spain');
});

test('an injected run replaces the fixture for that scenario', async () => {
  const api = createFakeApi({
    cap: activeFixtureCap(),
    runs: { 'dryer-spain': failedClosedRun() },
  });
  const run = await api.startRun({ scenarioId: 'dryer-spain', review: 'on' });
  expect(run.attempts[0]?.review.failedClosed).toBe(true);
  await expect(api.getRun(run.runId)).resolves.toEqual(run);
});

test('getRun of an unknown id rejects with a 404 ApiRequestError', async () => {
  await expect(createFakeApi().getRun('nope')).rejects.toMatchObject({ status: 404 });
});

test('config plays the simulated fallback with the $3,000.00 cap', async () => {
  await expect(createFakeApi().getConfig()).resolves.toEqual({
    paypalMode: 'simulated',
    channel3Mode: 'recorded',
    reviewModel: 'claude-sonnet-5-5',
    reviewSource: 'scripted',
    capAmountCents: 300000,
  });
});

test('results mirror the server before the held-out run: six rows, Fitcheck not measured', async () => {
  const results = await createFakeApi().getResults();
  expect(results).toEqual(FIXTURE_RESULTS);
  expect(results.rows.map((r) => [r.id, r.capOnly, r.of])).toEqual([
    ['wrong_paid', 14, 16],
    ['unbacked_paid_unasked', 4, 4],
    ['correct_blocked', 0, 12],
    ['correct_asked_nothing', 7, 7],
    ['questions_per_held', null, 0],
    ['consistent', 32, 32],
  ]);
  for (const row of results.rows) {
    expect(row.fitcheck).toBeNull();
    if (row.squares.capOnly.length === 0) continue;
    expect(row.squares.capOnly).toHaveLength(row.of);
    expect(row.squares.fitcheck).toEqual(Array(row.of).fill('pending'));
  }
});

// eval/src/measures.ts: squares show what happened to the payment, so the 12 correct purchases
// the cap never blocked are 12 paid squares, not 12 empty ones.
test('correct purchases blocked by mistake: 0 of 12, and all 12 squares paid', async () => {
  const results = await createFakeApi().getResults();
  const row = results.rows.find((r) => r.id === 'correct_blocked');
  expect(row?.capOnly).toBe(0);
  expect(row?.squares.capOnly).toEqual(Array(12).fill('paid_good'));
});

test('persist keeps the state across instances and reset restores it', async () => {
  const api = createFakeApi({ persist: true });
  await api.createCap({ scenarioId: 'tv-sony' });
  const again = createFakeApi({ persist: true });
  expect((await again.getCap())?.status).toBe('pending_approval');
  expect(sessionStorage.getItem(FIXTURE_STORAGE_KEY)).not.toBeNull();
  await again.resetSession();
  expect(await again.getCap()).toBeNull();
  expect(await createFakeApi({ persist: true }).getCap()).toBeNull();
});

test('a broken session store does not break the fake API', async () => {
  sessionStorage.setItem(FIXTURE_STORAGE_KEY, '{not json');
  await expect(createFakeApi({ persist: true }).getCap()).resolves.toBeNull();
});
