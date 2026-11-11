import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { migrateWhenReady } from './db/boot.js';
import { closeDb, createDb } from './db/client.js';
import type { Deps } from './deps.js';
import { loadEnv } from './env.js';
import { sweepCaps } from './ledger/sweep.js';
import { deliverInProcess } from './ledger/webhooks.js';
import { createLogger } from './logger.js';
import { createPaypalGateways } from './paypal/index.js';
import { createPorts } from './runs/ports.js';

// `pnpm dev` runs this package from `apps/backend`; the shared `.env` lives at the
// repo root, so the nearest one wins: the cwd, then up to two parents.
const envFile = ['.env', '../.env', '../../.env'].map((p) => resolve(p)).find(existsSync);
if (envFile) process.loadEnvFile(envFile);
const env = loadEnv();
const logger = createLogger();
const db = await createDb(env.DATABASE_URL);
await migrateWhenReady(db, logger);
const now = () => new Date();
const paypal = createPaypalGateways(env, {
  logger,
  now,
  // Per process, so a restarted server never reissues a simulated PayPal id.
  bootId: randomBytes(4).toString('hex'),
  // Simulated PayPal's webhooks go straight into the ledger, as PayPal's would over HTTP.
  deliverWebhook: (event, headers) => deliverInProcess(deps, event, headers),
});
// Lane B's Channel3 gateway throws here when CHANNEL3_MODE=live has no key: a misconfigured
// deploy fails to boot instead of serving recordings silently.
const ports = createPorts(env, { now, logger });
const deps: Deps = { env, logger, db, now, newId: randomUUID, paypal, ...ports };
const app = createApp(deps);

const sweep = async () => {
  try {
    const result = await sweepCaps(deps);
    if (result.voided + result.reauthorized + result.expired > 0) logger.info('caps.swept', result);
  } catch (error) {
    logger.error('caps.sweep_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
const server = serve({ fetch: app.fetch, port: env.PORT }, () => {
  logger.info('server.listening', { port: env.PORT, appUrl: env.APP_URL, paypal: env.PAYPAL_MODE });
  void sweep();
});
const timer = setInterval(() => void sweep(), 3_600_000);
timer.unref();

let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  server.close(() => {
    void closeDb(db).then(() => {
      process.exitCode = 0;
    });
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
