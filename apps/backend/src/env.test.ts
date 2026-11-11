import { describe, expect, it } from 'vitest';
import { InvalidEnvError, loadEnv, paypalModeFor, sandboxBuyerFor } from './env.js';

const creds = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret' };
const buyer = { SANDBOX_BUYER_EMAIL: 'buyer@example.com', SANDBOX_BUYER_PASSWORD: 'pw' };

describe('env', () => {
  it('accepts sandbox mode without credentials and runs it simulated', () => {
    const env = loadEnv({ PAYPAL_MODE: 'sandbox' });
    expect(paypalModeFor(env)).toBe('simulated');
  });

  it('is sandbox with both credentials and mock by default', () => {
    expect(paypalModeFor(loadEnv({ PAYPAL_MODE: 'sandbox', ...creds }))).toBe('sandbox');
    expect(paypalModeFor(loadEnv({}))).toBe('mock');
  });

  it('defaults the cap, the idle void and the mock webhook secret', () => {
    const env = loadEnv({});
    expect(env.CAP_AMOUNT_CENTS).toBe(300000);
    expect(env.CAP_IDLE_VOID_MINUTES).toBe(120);
    expect(env.MOCK_WEBHOOK_SECRET).toBe('mock-webhook-secret');
    expect(env.EVAL_RESULTS_DIR).toBeUndefined();
  });

  it('shows the sandbox buyer only in sandbox mode with both vars', () => {
    expect(sandboxBuyerFor(loadEnv({ PAYPAL_MODE: 'sandbox', ...creds, ...buyer }))).toEqual({
      email: 'buyer@example.com',
      password: 'pw',
    });
    expect(sandboxBuyerFor(loadEnv({ ...buyer }))).toBeNull();
    expect(sandboxBuyerFor(loadEnv({ PAYPAL_MODE: 'sandbox', ...buyer }))).toBeNull();
  });

  it('refuses the default session secret on https', () => {
    expect(() => loadEnv({ RENDER_EXTERNAL_URL: 'https://fitcheck.onrender.com' })).toThrow(
      InvalidEnvError,
    );
    try {
      loadEnv({ RENDER_EXTERNAL_URL: 'https://fitcheck.onrender.com' });
    } catch (error) {
      expect((error as InvalidEnvError).variables).toContain('SESSION_SECRET');
    }
  });

  it('falls back from APP_URL to RENDER_EXTERNAL_URL', () => {
    const env = loadEnv({
      RENDER_EXTERNAL_URL: 'https://fitcheck.onrender.com/',
      SESSION_SECRET: 's3cret',
    });
    expect(env.APP_URL).toBe('https://fitcheck.onrender.com');
  });
});
