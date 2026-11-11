import type { RunResponse } from '@fitcheck/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../env.js';
import { activeCap, createHarness, HARNESS_NOW } from './harness.js';
import { createPorts } from './ports.js';
import { startRun, submitAnswers } from './runs.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness;
afterEach(async () => h?.close());

/** The server's own ports with the defaults: Lane B's review on its recordings, recorded Channel3. */
async function laneB() {
  const ports = createPorts(loadEnv({}), { now: () => HARNESS_NOW });
  h = await createHarness({ review: ports.review, channel3: ports.channel3 });
  return activeCap(h.deps);
}
const answerAll = (sessionId: string, run: RunResponse, value: 'yes' | 'no') => {
  const last = run.attempts.at(-1);
  const answers = Object.fromEntries(
    (last?.review.card?.lines ?? []).map((l) => [l.lineId, value]),
  );
  return submitAnswers(h.deps, {
    sessionId,
    runId: run.runId,
    body: { attemptNo: last?.attemptNo ?? 1, answers },
  });
};

describe("the four demo scenarios on Lane B's review", () => {
  it('dryer-spain: the 120 V ANIQ is not paid, the dual-voltage LURA is', async () => {
    const { sessionId } = await laneB();
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-spain', review: 'on' });
    expect(run.attempts.map((a) => a.outcome?.decision)).toEqual(['return_to_agent', 'capture']);
    expect(run.attempts.map((a) => a.outcome?.amountCents)).toEqual([0, 2020]);
    expect(run.attempts[0]?.review.reasons.map((r) => r.type)).toContain('broken');
    expect(run.status).toBe('done');
  });

  it('dryer-silent: the voltage is unbacked and asked; a no moves to the dual-voltage Conair', async () => {
    const { sessionId } = await laneB();
    const run = await startRun(h.deps, { sessionId, scenarioId: 'dryer-silent', review: 'on' });
    expect(run.status).toBe('awaiting_answers');
    const voltage = run.attempts[0]?.review.results.find(
      (r) => r.requirement === 'hair_dryer.dual_voltage',
    );
    expect(voltage?.state).toBe('unbacked');
    const done = await answerAll(sessionId, run, 'no');
    expect(done.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: 3799 });
  });

  it('tv-sony: held with a card; a yes captures 139800', async () => {
    const { sessionId } = await laneB();
    const run = await startRun(h.deps, { sessionId, scenarioId: 'tv-sony', review: 'on' });
    expect(run.status).toBe('awaiting_answers');
    expect(run.attempts[0]?.review.card?.lines.length).toBeGreaterThan(0);
    expect(run.cap.heldCents).toBe(139800);
    const done = await answerAll(sessionId, run, 'yes');
    expect(done.attempts[0]?.outcome).toEqual({ decision: 'capture', amountCents: 139800 });
  });

  it('tv-wall: a no on the Panasonic, then a yes on the LG, captures 119999', async () => {
    const { sessionId } = await laneB();
    const run = await startRun(h.deps, { sessionId, scenarioId: 'tv-wall', review: 'on' });
    expect(run.status).toBe('awaiting_answers');
    const afterNo = await answerAll(sessionId, run, 'no');
    expect(afterNo.attempts.map((a) => a.pick.productId)).toEqual(['0gH7IUm', '1U7pIWX']);
    expect(afterNo.status).toBe('awaiting_answers');
    const done = await answerAll(sessionId, afterNo, 'yes');
    expect(done.attempts[1]?.outcome).toEqual({ decision: 'capture', amountCents: 119999 });
  });
});
