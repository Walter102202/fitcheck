import {
  ApiErrorSchema,
  ConfigResponseSchema,
  RunResponseSchema,
  ScenarioSchema,
} from '@fitcheck/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../app.js';
import { createCap } from '../ledger/caps.js';
import { createHarness } from '../runs/harness.js';
import { verifySession } from './session.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness;
afterEach(async () => h?.close());

/** A visitor: the cookie from the first request, and the session id inside it. */
async function visitor(app: ReturnType<typeof createApp>) {
  const res = await app.request('/api/config');
  const token = /fc_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const session = verifySession(token, h.deps.env.SESSION_SECRET, h.deps.now());
  if (!session) throw new Error('no session cookie');
  return { cookie: `fc_session=${token}`, sessionId: session.sid };
}
async function withCap(app: ReturnType<typeof createApp>) {
  const v = await visitor(app);
  await createCap(h.deps, {
    sessionId: v.sessionId,
    mode: 'mock',
    amountCents: 300000,
    returnScenarioId: null,
    fallback: false,
  });
  return v;
}
const post = (app: ReturnType<typeof createApp>, path: string, cookie: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('runs API', () => {
  it('GET /api/scenarios returns the four scenarios in order', async () => {
    h = await createHarness();
    const res = await createApp(h.deps).request('/api/scenarios');
    const scenarios = z.array(ScenarioSchema).parse(await res.json());
    expect(scenarios.map((s) => s.id)).toEqual([
      'dryer-spain',
      'dryer-silent',
      'tv-sony',
      'tv-wall',
    ]);
    expect(scenarios.map((s) => s.request)).toEqual([
      'A hair dryer for my trip to Spain next week. Under $40.',
      'The cheapest hair dryer you can find for my trip to Spain.',
      'A 65-inch OLED TV for the living room. Up to $1,500.',
      'Replace the TV on our living room wall with a 65-inch, up to $1,600.',
    ]);
    expect(scenarios.map((s) => s.showcase)).toEqual([
      'broken',
      'unbacked',
      'contradictory',
      'never_asked',
    ]);
    expect(scenarios.every((s) => s.image.startsWith('https://'))).toBe(true);
  });

  it('POST /api/runs parses as RunResponse, and GET returns the same run', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const { cookie } = await withCap(app);
    const res = await post(app, '/api/runs', cookie, { scenarioId: 'dryer-spain', review: 'on' });
    expect(res.status).toBe(200);
    const run = RunResponseSchema.parse(await res.json());
    expect(run.attempts).toHaveLength(2);
    const again = await app.request(`/api/runs/${run.runId}`, { headers: { cookie } });
    expect(RunResponseSchema.parse(await again.json())).toEqual(run);
  });

  it('POST /api/runs with an unknown scenario is 404 unknown_scenario', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const { cookie } = await withCap(app);
    const res = await post(app, '/api/runs', cookie, { scenarioId: 'nope', review: 'on' });
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(await res.json()).error).toBe('unknown_scenario');
  });

  it('POST /api/runs with no cap is 409 cap_not_active', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const { cookie } = await visitor(app);
    const res = await post(app, '/api/runs', cookie, { scenarioId: 'dryer-spain', review: 'on' });
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(await res.json())).toEqual({
      error: 'cap_not_active',
      message: 'Approve a spending cap first.',
    });
  });

  it('POST /api/runs with a bad body is 400', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const { cookie } = await withCap(app);
    const res = await post(app, '/api/runs', cookie, {
      scenarioId: 'dryer-spain',
      review: 'maybe',
    });
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(await res.json()).error).toBe('invalid_request');
  });

  it('GET /api/runs/:id from another session is 404', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const { cookie } = await withCap(app);
    const run = RunResponseSchema.parse(
      await (
        await post(app, '/api/runs', cookie, { scenarioId: 'dryer-spain', review: 'on' })
      ).json(),
    );
    const other = await visitor(app);
    const res = await app.request(`/api/runs/${run.runId}`, { headers: { cookie: other.cookie } });
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(await res.json()).error).toBe('not_found');
    const junk = await app.request('/api/runs/not-a-uuid', { headers: { cookie } });
    expect(junk.status).toBe(404);
  });

  it('POST /api/runs/:id/answers with a wrong lineId is 400 invalid_answers', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const { cookie } = await withCap(app);
    const run = RunResponseSchema.parse(
      await (await post(app, '/api/runs', cookie, { scenarioId: 'tv-sony', review: 'on' })).json(),
    );
    const res = await post(app, `/api/runs/${run.runId}/answers`, cookie, {
      attemptNo: 1,
      answers: { 'tv.wrong': 'yes' },
    });
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(await res.json()).error).toBe('invalid_answers');
    const lineId = run.attempts[0]?.review.card?.lines[0]?.lineId ?? '';
    const ok = await post(app, `/api/runs/${run.runId}/answers`, cookie, {
      attemptNo: 1,
      answers: { [lineId]: 'yes' },
    });
    const done = RunResponseSchema.parse(await ok.json());
    expect(done.status).toBe('done');
    expect(done.cap.capturedCents).toBe(139800);
  });

  it('GET /api/config reports simulated when sandbox has no credentials', async () => {
    h = await createHarness({ env: { PAYPAL_MODE: 'sandbox', ...buyer } });
    const res = await createApp(h.deps).request('/api/config');
    const config = ConfigResponseSchema.parse(await res.json());
    expect(config.paypalMode).toBe('simulated');
    expect(config.capAmountCents).toBe(300000);
    expect(config.sandboxBuyer).toBeUndefined();
  });

  it('GET /api/config shows the sandbox buyer only in sandbox mode', async () => {
    h = await createHarness({
      env: {
        PAYPAL_MODE: 'sandbox',
        PAYPAL_CLIENT_ID: 'id',
        PAYPAL_CLIENT_SECRET: 'secret',
        ...buyer,
      },
    });
    const sandbox = ConfigResponseSchema.parse(
      await (await createApp(h.deps).request('/api/config')).json(),
    );
    expect(sandbox.paypalMode).toBe('sandbox');
    expect(sandbox.sandboxBuyer).toEqual({ email: 'buyer@example.com', password: 'pw' });
    await h.close();
    h = await createHarness({ env: buyer });
    const mock = ConfigResponseSchema.parse(
      await (await createApp(h.deps).request('/api/config')).json(),
    );
    expect(mock.paypalMode).toBe('mock');
    expect(mock.sandboxBuyer).toBeUndefined();
  });

  it('an unknown API path is a JSON 404', async () => {
    h = await createHarness();
    const res = await createApp(h.deps).request('/api/nope');
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(await res.json()).error).toBe('not_found');
  });
});

const buyer = { SANDBOX_BUYER_EMAIL: 'buyer@example.com', SANDBOX_BUYER_PASSWORD: 'pw' };
