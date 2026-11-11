import { ApiErrorSchema, CapSchema, RunResponseSchema } from '@fitcheck/contracts';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { caps } from '../db/schema.js';
import { getCap, listCapEvents } from '../ledger/caps.js';
import { createPaypalGateways, PaypalError, type PaypalGateway } from '../paypal/index.js';
import { createHarness } from '../runs/harness.js';
import { PAYPAL_SIMULATED_NOTICE } from '../runs/runs.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;
type App = ReturnType<typeof createApp>;
let h: Harness;
afterEach(async () => h?.close());

/** Sandbox mode without credentials: every cap is simulated, with the fallback notice. */
const FALLBACK_ENV = { PAYPAL_MODE: 'sandbox' };

/** The last fc_session cookie a response set (a reset may set two). */
function cookieFrom(res: Response): string {
  const all = [...(res.headers.get('set-cookie') ?? '').matchAll(/fc_session=([^;]+)/g)];
  const token = all.at(-1)?.[1];
  if (!token) throw new Error('no session cookie');
  return `fc_session=${token}`;
}
async function visitor(app: App): Promise<string> {
  return cookieFrom(await app.request('/api/config'));
}
function postJson(app: App, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function openCap(app: App, cookie: string, body: unknown = {}) {
  const res = await postJson(app, '/api/cap', cookie, body);
  expect(res.status).toBe(200);
  return CapSchema.parse(await res.json());
}
async function currentCap(app: App, cookie: string) {
  const res = await app.request('/api/cap', { headers: { cookie } });
  expect(res.status).toBe(200);
  return CapSchema.nullable().parse(await res.json());
}
function tokenOf(approveUrl: string | undefined): string {
  const token = new URL(approveUrl ?? '', 'http://x').searchParams.get('token');
  if (!token) throw new Error('no token in approveUrl');
  return token;
}
const capReturn = (app: App, cookie: string, token: string) =>
  app.request(`/api/cap/return?token=${encodeURIComponent(token)}`, { headers: { cookie } });

describe('cap API', () => {
  it('POST /api/cap in mock mode returns an active cap with no approveUrl', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const cap = await openCap(app, await visitor(app));
    expect(cap.mode).toBe('mock');
    expect(cap.status).toBe('active');
    expect(cap.availableCents).toBe(300000);
    expect(cap.approveUrl).toBeUndefined();
  });

  it('POST /api/cap twice returns the same cap', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const first = await openCap(app, cookie);
    const second = await openCap(app, cookie, { scenarioId: 'tv-sony' });
    expect(second.capId).toBe(first.capId);
    expect(await h.deps.db.select().from(caps)).toHaveLength(1);
  });

  it('two concurrent POST /api/cap open one cap', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const [a, b] = await Promise.all([openCap(app, cookie), openCap(app, cookie)]);
    expect(a.capId).toBe(b.capId);
    expect(await h.deps.db.select().from(caps)).toHaveLength(1);
  });

  it('POST /api/cap accepts an empty body', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const res = await postJson(app, '/api/cap', await visitor(app));
    expect(res.status).toBe(200);
    expect(CapSchema.parse(await res.json()).status).toBe('active');
  });

  it('POST /api/cap ignores a mode in the body', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const cap = await openCap(app, await visitor(app), {
      scenarioId: 'tv-sony',
      mode: 'simulated',
    });
    expect(cap.mode).toBe('mock');
  });

  it('POST /api/cap with an unknown scenario is 404 unknown_scenario', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const res = await postJson(app, '/api/cap', await visitor(app), { scenarioId: 'nope' });
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(await res.json()).error).toBe('unknown_scenario');
    expect(await h.deps.db.select().from(caps)).toHaveLength(0);
  });

  it('sandbox without credentials falls back to simulated with the notice', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const cap = await openCap(app, cookie, { scenarioId: 'dryer-spain' });
    expect(cap.mode).toBe('simulated');
    expect(cap.status).toBe('pending_approval');
    expect(cap.approveUrl).toMatch(/^\/cap\/approve-simulated\?token=SIM-/);
    expect((await capReturn(app, cookie, tokenOf(cap.approveUrl))).status).toBe(303);
    const res = await postJson(app, '/api/runs', cookie, {
      scenarioId: 'dryer-spain',
      review: 'on',
    });
    expect(res.status).toBe(200);
    const run = RunResponseSchema.parse(await res.json());
    expect(run.notices).toContain(PAYPAL_SIMULATED_NOTICE);
    expect(PAYPAL_SIMULATED_NOTICE).toBe(
      'PayPal is simulated on this site. The video shows the same flow on the PayPal sandbox.',
    );
  });

  it('a sandbox error at order creation falls back to simulated', async () => {
    h = await createHarness({
      env: { PAYPAL_MODE: 'sandbox', PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret' },
    });
    const calls: string[] = [];
    h.deps.paypal.sandbox = {
      createOrder: async (i: { requestId: string }) => {
        calls.push(i.requestId);
        throw new PaypalError('PAYPAL_UNREACHABLE', 502);
      },
    } as unknown as PaypalGateway;
    const app = createApp(h.deps);
    const cap = await openCap(app, await visitor(app), { scenarioId: 'tv-sony' });
    expect(calls).toHaveLength(1);
    expect(cap.mode).toBe('simulated');
    expect(cap.approveUrl).toMatch(/^\/cap\/approve-simulated\?token=SIM-/);
    const [row] = await h.deps.db.select().from(caps).where(eq(caps.id, cap.capId));
    expect(row?.fallback).toBe(true);
  });

  it('simulated approval returns to the run', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const cap = await openCap(app, cookie, { scenarioId: 'tv-sony' });
    const token = tokenOf(cap.approveUrl);
    const approve = await postJson(
      app,
      `/api/cap/approve-simulated?token=${encodeURIComponent(token)}`,
      cookie,
    );
    expect(approve.status).toBe(303);
    expect(approve.headers.get('location')).toBe(
      `/api/cap/return?token=${encodeURIComponent(token)}`,
    );
    const back = await capReturn(app, cookie, token);
    expect(back.status).toBe(303);
    expect(back.headers.get('location')).toBe('/run/tv-sony');
    expect((await currentCap(app, cookie))?.status).toBe('active');
  });

  it('the simulated return alone completes the approval', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const cap = await openCap(app, cookie, { scenarioId: 'tv-sony' });
    const back = await capReturn(app, cookie, tokenOf(cap.approveUrl));
    expect(back.headers.get('location')).toBe('/run/tv-sony');
    expect((await currentCap(app, cookie))?.status).toBe('active');
  });

  it('without a scenario the return goes to /', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const cap = await openCap(app, cookie);
    const back = await capReturn(app, cookie, tokenOf(cap.approveUrl));
    expect(back.status).toBe(303);
    expect(back.headers.get('location')).toBe('/');
  });

  it('the PayPal return twice authorizes once', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const cap = await openCap(app, cookie, { scenarioId: 'tv-sony' });
    const token = tokenOf(cap.approveUrl);
    await capReturn(app, cookie, token);
    const again = await capReturn(app, cookie, token);
    expect(again.headers.get('location')).toBe('/run/tv-sony');
    const events = await listCapEvents(h.deps.db, cap.capId);
    expect(events.filter((e) => e.type === 'authorized')).toHaveLength(1);
  });

  it('an abandoned approval leaves the cap pending and runs are refused', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    await openCap(app, cookie, { scenarioId: 'tv-sony' });
    expect((await currentCap(app, cookie))?.status).toBe('pending_approval');
    const res = await postJson(app, '/api/runs', cookie, { scenarioId: 'tv-sony', review: 'on' });
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(await res.json()).error).toBe('cap_not_active');
  });

  it("a return with another session's token goes to /cap?error=paypal", async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const owner = await visitor(app);
    const cap = await openCap(app, owner, { scenarioId: 'tv-sony' });
    const token = tokenOf(cap.approveUrl);
    const stranger = await visitor(app);
    const back = await capReturn(app, stranger, token);
    expect(back.status).toBe(303);
    expect(back.headers.get('location')).toBe('/cap?error=paypal');
    const approve = await postJson(
      app,
      `/api/cap/approve-simulated?token=${encodeURIComponent(token)}`,
      stranger,
    );
    expect(approve.status).toBe(404);
    expect(ApiErrorSchema.parse(await approve.json()).error).toBe('not_found');
    expect((await currentCap(app, owner))?.status).toBe('pending_approval');
    expect(h.paypal.calls('authorize')).toEqual([]);
  });

  it('an unknown token on the return goes to /cap?error=paypal', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const back = await capReturn(app, await visitor(app), 'SIM-nope');
    expect(back.status).toBe(303);
    expect(back.headers.get('location')).toBe('/cap?error=paypal');
  });

  it('a PayPal refusal to authorize goes to /cap?error=paypal', async () => {
    h = await createHarness({
      env: { PAYPAL_MODE: 'sandbox', PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret' },
    });
    const approveUrl = 'https://www.sandbox.paypal.com/checkoutnow?token=SB-ORDER-1';
    h.deps.paypal.sandbox = {
      createOrder: async () => ({ orderId: 'SB-ORDER-1', approveUrl, raw: {} }),
      authorizeOrder: async () => {
        throw new PaypalError('ORDER_NOT_APPROVED', 422);
      },
    } as unknown as PaypalGateway;
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const cap = await openCap(app, cookie, { scenarioId: 'tv-sony' });
    expect(cap).toMatchObject({ mode: 'sandbox', status: 'pending_approval', approveUrl });
    const back = await capReturn(app, cookie, 'SB-ORDER-1');
    expect(back.status).toBe(303);
    expect(back.headers.get('location')).toBe('/cap?error=paypal');
    expect((await currentCap(app, cookie))?.status).toBe('pending_approval');
  });

  it('an expired simulated order goes to /cap?error=paypal', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const cap = await openCap(app, cookie, { scenarioId: 'tv-sony' });
    h.paypal.expireOrder(tokenOf(cap.approveUrl));
    const back = await capReturn(app, cookie, tokenOf(cap.approveUrl));
    expect(back.headers.get('location')).toBe('/cap?error=paypal');
    expect((await currentCap(app, cookie))?.status).toBe('pending_approval');
  });

  it('approve-simulated refuses a mock cap', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    await openCap(app, cookie);
    const [row] = await h.deps.db.select().from(caps);
    const res = await postJson(
      app,
      `/api/cap/approve-simulated?token=${encodeURIComponent(row?.orderId ?? '')}`,
      cookie,
    );
    expect(res.status).toBe(404);
  });

  it('reset voids the authorization in PayPal and starts a new session', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const cap = await openCap(app, cookie);
    const res = await postJson(app, '/api/session/reset', cookie);
    expect(res.status).toBe(204);
    const fresh = cookieFrom(res);
    expect(fresh).not.toBe(cookie);
    expect(await currentCap(app, fresh)).toBeNull();
    expect((await getCap(h.deps, cap.capId)).status).toBe('voided');
    const events = await listCapEvents(h.deps.db, cap.capId);
    expect(events.at(-1)).toMatchObject({
      type: 'voided',
      paypalCall: {
        method: 'POST',
        path: `/v2/payments/authorizations/${cap.authorizationId}/void`,
      },
    });
    expect(h.paypal.calls('void')).toEqual([`void:${cap.capId}`]);
  });

  it('reset expires a cap still waiting for approval', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const cap = await openCap(app, cookie, { scenarioId: 'tv-sony' });
    const res = await postJson(app, '/api/session/reset', cookie);
    expect(res.status).toBe(204);
    expect((await getCap(h.deps, cap.capId)).status).toBe('expired');
    expect(h.paypal.calls('void')).toEqual([]);
  });

  it('reset still answers 204 when PayPal refuses the void', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const cap = await openCap(app, cookie);
    h.paypal.failNext('void', { httpStatus: 503 });
    const res = await postJson(app, '/api/session/reset', cookie);
    expect(res.status).toBe(204);
    expect(await currentCap(app, cookieFrom(res))).toBeNull();
    expect((await getCap(h.deps, cap.capId)).status).toBe('active');
  });

  it('reset with no cap still answers 204', async () => {
    h = await createHarness();
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const res = await postJson(app, '/api/session/reset', cookie);
    expect(res.status).toBe(204);
    expect(cookieFrom(res)).not.toBe(cookie);
  });

  /** A server restart: a new simulated gateway that never saw the old orders. */
  function restart() {
    h.deps.paypal.simulated = createPaypalGateways(h.deps.env, {
      logger: h.deps.logger,
      bootId: 'restart1',
      deliverWebhook: undefined,
    }).simulated;
  }

  it('after a restart, POST /api/cap replaces a pending simulated cap', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const old = await openCap(app, cookie, { scenarioId: 'tv-sony' });
    restart();
    const fresh = await openCap(app, cookie, { scenarioId: 'tv-sony' });
    expect(fresh.capId).not.toBe(old.capId);
    expect(fresh.status).toBe('pending_approval');
    expect(fresh.approveUrl).toMatch(/token=SIM-restart1-/);
    expect((await getCap(h.deps, old.capId)).status).toBe('expired');
  });

  it('after a restart, approving the forgotten order expires the cap and shows the error', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const old = await openCap(app, cookie, { scenarioId: 'tv-sony' });
    const token = tokenOf(old.approveUrl);
    restart();
    const approve = await postJson(
      app,
      `/api/cap/approve-simulated?token=${encodeURIComponent(token)}`,
      cookie,
    );
    expect(approve.status).toBe(303);
    expect(approve.headers.get('location')).toBe('/cap?error=paypal');
    expect((await getCap(h.deps, old.capId)).status).toBe('expired');
    expect(await currentCap(app, cookie)).toMatchObject({ status: 'expired' });
  });

  it('after a restart, the PayPal return of the forgotten order expires the cap', async () => {
    h = await createHarness({ env: FALLBACK_ENV });
    const app = createApp(h.deps);
    const cookie = await visitor(app);
    const old = await openCap(app, cookie, { scenarioId: 'tv-sony' });
    restart();
    const back = await capReturn(app, cookie, tokenOf(old.approveUrl));
    expect(back.headers.get('location')).toBe('/cap?error=paypal');
    expect((await getCap(h.deps, old.capId)).status).toBe('expired');
  });
});
