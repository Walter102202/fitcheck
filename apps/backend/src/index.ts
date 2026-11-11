import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { migrateWhenReady } from './db/boot.js';
import { createDb } from './db/client.js';
import type { Deps } from './deps.js';
import { loadEnv } from './env.js';
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
  bootId: randomBytes(4).toString('hex'),
  deliverWebhook: async () => {},
});
const ports = createPorts(env, { now, logger });
const deps: Deps = { env, logger, db, now, newId: randomUUID, paypal, ...ports };
const app = createApp(deps);
const server = serve({ fetch: app.fetch, port: env.PORT }, () => {
  logger.info('server.listening', { port: env.PORT, appUrl: env.APP_URL });
});
const shutdown = () => server.close();
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
