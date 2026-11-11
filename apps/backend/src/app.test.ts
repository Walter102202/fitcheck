import { ConfigResponseSchema } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Deps } from './deps.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';

function testDeps(source: Record<string, string> = {}): Deps {
  return {
    env: loadEnv(source),
    now: () => new Date('2026-11-11T12:00:00.000Z'),
    logger: createLogger({}, { silent: true }),
  };
}

describe('app skeleton', () => {
  it('answers /healthz', async () => {
    const res = await createApp(testDeps()).request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('serves /api/config from the default env', async () => {
    const res = await createApp(testDeps()).request('/api/config');
    expect(res.status).toBe(200);
    const config = ConfigResponseSchema.parse(await res.json());
    expect(config.paypalMode).toBe('mock');
    expect(config.channel3Mode).toBe('recorded');
    expect(config.reviewModel).toBe('claude-sonnet-5-5');
    expect(config.capAmountCents).toBe(300000);
    expect(config.sandboxBuyer).toBeUndefined();
  });

  it('shows the sandbox buyer only in sandbox mode', async () => {
    const res = await createApp(
      testDeps({
        PAYPAL_MODE: 'sandbox',
        PAYPAL_CLIENT_ID: 'id',
        PAYPAL_CLIENT_SECRET: 'secret',
        SANDBOX_BUYER_EMAIL: 'buyer@example.com',
        SANDBOX_BUYER_PASSWORD: 'pw',
      }),
    ).request('/api/config');
    const config = ConfigResponseSchema.parse(await res.json());
    expect(config.paypalMode).toBe('sandbox');
    expect(config.sandboxBuyer).toEqual({ email: 'buyer@example.com', password: 'pw' });
  });

  it('reports simulated when sandbox has no credentials', async () => {
    const res = await createApp(testDeps({ PAYPAL_MODE: 'sandbox' })).request('/api/config');
    const config = ConfigResponseSchema.parse(await res.json());
    expect(config.paypalMode).toBe('simulated');
  });

  it('rejects an invalid env with the variable names', () => {
    expect(() => loadEnv({ CAP_AMOUNT_CENTS: 'lots' })).toThrow(/CAP_AMOUNT_CENTS/);
  });
});
