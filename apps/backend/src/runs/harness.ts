import type { Cap, Cents } from '@fitcheck/contracts';
import { closeDb } from '../db/client.js';
import { createSession } from '../db/sessions.js';
import { createTestDb } from '../db/test-db.js';
import type { Deps } from '../deps.js';
import { loadEnv } from '../env.js';
import { createCap } from '../ledger/caps.js';
import { createLogger } from '../logger.js';
import { createPaypalGateways, type MockPaypalGateway } from '../paypal/index.js';
import type { Channel3Port, ReviewPort } from './ports.js';
import { createRecordedChannel3, createStubReviewPort } from './review-stub.js';

export const HARNESS_NOW = new Date('2026-11-11T12:00:00.000Z');

/** Sequential uuids, so ids in a test are stable and readable. */
export function sequentialIds(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

/**
 * Tests only: in-memory PGlite with migrations, a fixed and settable clock, a silent logger,
 * sequential ids and the in-memory PayPal gateway (the `mock` env default).
 */
export async function createHarness(
  o: {
    env?: Partial<Record<string, string>>;
    now?: Date;
    review?: ReviewPort;
    channel3?: Channel3Port;
  } = {},
): Promise<{
  deps: Deps;
  paypal: MockPaypalGateway;
  clock: { set(d: Date): void };
  close(): Promise<void>;
}> {
  const db = await createTestDb();
  const env = loadEnv({ DATABASE_URL: 'pglite://memory', ...o.env });
  let current = o.now ?? HARNESS_NOW;
  const now = () => new Date(current.getTime());
  const logger = createLogger({}, { silent: true });
  const paypal = createPaypalGateways(env, {
    logger,
    bootId: 'test0000',
    now,
    deliverWebhook: async () => {},
  });
  const deps: Deps = {
    env,
    now,
    logger,
    db,
    newId: sequentialIds(),
    paypal,
    channel3: o.channel3 ?? createRecordedChannel3(),
    review: o.review ?? createStubReviewPort(),
  };
  return {
    deps,
    // The gateway behind mock and simulated caps. Reassigning deps.paypal.simulated (a
    // restart) is visible through deps, not through this reference.
    paypal: paypal.simulated,
    clock: {
      set(d: Date) {
        current = d;
      },
    },
    close: () => closeDb(db),
  };
}

/** A new session with an active mock cap. */
export async function activeCap(
  deps: Deps,
  o: { amountCents?: Cents } = {},
): Promise<{ sessionId: string; cap: Cap }> {
  const sessionId = await createSession(deps);
  const cap = await createCap(deps, {
    sessionId,
    mode: 'mock',
    amountCents: o.amountCents ?? deps.env.CAP_AMOUNT_CENTS,
    returnScenarioId: null,
    fallback: false,
  });
  return { sessionId, cap };
}
