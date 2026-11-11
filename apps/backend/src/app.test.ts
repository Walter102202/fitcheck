import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigResponseSchema } from '@fitcheck/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { configFrom, createApp } from './app.js';
import { loadEnv } from './env.js';
import { createHarness } from './runs/harness.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('app', () => {
  it('answers /healthz', async () => {
    h = await createHarness();
    const res = await createApp(h.deps).request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('serves /api/config from the default env', async () => {
    h = await createHarness();
    const res = await createApp(h.deps).request('/api/config');
    expect(res.status).toBe(200);
    const config = ConfigResponseSchema.parse(await res.json());
    expect(config.paypalMode).toBe('mock');
    expect(config.channel3Mode).toBe('recorded');
    expect(config.reviewModel).toBe('claude-sonnet-5-5');
    expect(config.capAmountCents).toBe(300000);
    expect(config.sandboxBuyer).toBeUndefined();
  });

  it('builds the config from env: sandbox buyer only in sandbox, simulated without credentials', () => {
    const buyer = { SANDBOX_BUYER_EMAIL: 'buyer@example.com', SANDBOX_BUYER_PASSWORD: 'pw' };
    const sandbox = configFrom(
      loadEnv({
        PAYPAL_MODE: 'sandbox',
        PAYPAL_CLIENT_ID: 'id',
        PAYPAL_CLIENT_SECRET: 's',
        ...buyer,
      }),
    );
    expect(sandbox.paypalMode).toBe('sandbox');
    expect(sandbox.sandboxBuyer).toEqual({ email: 'buyer@example.com', password: 'pw' });
    const simulated = configFrom(loadEnv({ PAYPAL_MODE: 'sandbox', ...buyer }));
    expect(simulated.paypalMode).toBe('simulated');
    expect(simulated.sandboxBuyer).toBeUndefined();
  });

  it('serves the built web app with the SPA fallback, but never for /api', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'web-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Fitcheck</title>');
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
    h = await createHarness({ env: { WEB_DIST_DIR: dist } });
    const app = createApp(h.deps);
    expect(await (await app.request('/assets/app.js')).text()).toBe('console.log(1)');
    expect(await (await app.request('/run/tv-sony')).text()).toContain('<title>Fitcheck</title>');
    const api = await app.request('/api/missing');
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: 'not_found', message: 'Route not found' });
  });

  it('rejects an invalid env with the variable names', () => {
    expect(() => loadEnv({ CAP_AMOUNT_CENTS: 'lots' })).toThrow(/CAP_AMOUNT_CENTS/);
  });
});
