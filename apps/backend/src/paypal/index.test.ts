import { describe, expect, it } from 'vitest';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { createPaypalGateways } from './index.js';

const logger = createLogger({}, { silent: true });
const order = {
  intent: 'AUTHORIZE' as const,
  amountCents: 300000,
  customId: 'cap:x',
  requestId: 'cap:x:create',
  returnUrl: 'http://localhost/api/cap/return',
  cancelUrl: 'http://localhost/cap',
};

describe('createPaypalGateways', () => {
  it('a mock-mode server prefixes PayPal ids with its boot id, so a restart never reissues one', async () => {
    const env = loadEnv({});
    const first = createPaypalGateways(env, { logger, bootId: 'b1', deliverWebhook: undefined });
    const second = createPaypalGateways(env, { logger, bootId: 'b2', deliverWebhook: undefined });
    const a = await first.simulated.createOrder(order);
    const b = await second.simulated.createOrder(order);
    expect(a.orderId).toBe('MOCK-b1-ORDER-000001');
    expect(b.orderId).toBe('MOCK-b2-ORDER-000001');
  });

  it('a simulated gateway behind sandbox mode uses SIM and the boot id', async () => {
    const env = loadEnv({ PAYPAL_MODE: 'sandbox' });
    const g = createPaypalGateways(env, { logger, bootId: 'b1', deliverWebhook: undefined });
    expect(g.sandbox).toBeNull();
    expect((await g.simulated.createOrder(order)).orderId).toBe('SIM-b1-ORDER-000001');
  });

  it('tests can pin the prefix for readable ids', async () => {
    const g = createPaypalGateways(loadEnv({}), {
      logger,
      bootId: 'b1',
      deliverWebhook: undefined,
      idPrefix: 'MOCK',
    });
    expect((await g.simulated.createOrder(order)).orderId).toBe('MOCK-ORDER-000001');
  });
});
