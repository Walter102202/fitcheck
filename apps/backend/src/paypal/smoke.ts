import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadEnv } from '../env.js';
import { SandboxPaypalGateway } from './sandbox.js';

// Manual check against the real PayPal sandbox; never run in CI.
//   pnpm --filter @fitcheck/backend exec tsx --conditions=development src/paypal/smoke.ts
// It authorizes $5.00, captures $1.00 with final_capture false, then voids the rest:
// the cap pattern end to end, including a void after a partial capture.
const envFile = ['.env', '../.env', '../../.env'].map((p) => resolve(p)).find(existsSync);
if (envFile) process.loadEnvFile(envFile);
const env = loadEnv();
if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
  console.error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) in .env first.');
  process.exit(2);
}
const paypal = new SandboxPaypalGateway({
  clientId: env.PAYPAL_CLIENT_ID,
  clientSecret: env.PAYPAL_CLIENT_SECRET,
});
const run = `smoke-${Date.now()}`;
const order = await paypal.createOrder({
  intent: 'AUTHORIZE',
  amountCents: 500,
  customId: `cap:${run}`,
  requestId: `cap:${run}:create`,
  returnUrl: `${env.APP_URL}/api/cap/return`,
  cancelUrl: `${env.APP_URL}/cap?cancelled=1`,
});
console.log(`order ${order.orderId}\nApprove as the sandbox buyer: ${order.approveUrl}`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Press Enter after approving (PayPal then redirects to the return URL)... ');
rl.close();
const auth = await paypal.authorizeOrder(order.orderId, `cap:${run}:authorize`);
console.log(`authorization ${auth.authorizationId}, expires ${auth.expiresAt ?? 'unknown'}`);
const capture = await paypal.captureAuthorization(auth.authorizationId, {
  amountCents: 100,
  finalCapture: false,
  requestId: `capture:${run}`,
  invoiceId: `purchase:${run}`,
});
console.log(`capture ${capture.captureId}: ${capture.status} ${capture.amountCents} cents`);
const voided = await paypal.voidAuthorization(auth.authorizationId, `void:${run}`);
console.log(`void ${auth.authorizationId}: ${voided.status}`);
