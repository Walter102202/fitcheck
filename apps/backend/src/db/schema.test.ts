import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, type Db } from './client.js';
import { caps, paymentEvents, purchases, sessions } from './schema.js';
import { createSession } from './sessions.js';
import { createTestDb } from './test-db.js';

/** The Postgres error code drizzle wraps in `cause`. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^\d{5}$|^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail');
}

describe('ledger schema', () => {
  let db: Db;
  let sessionId: string;
  let capId: string;
  let ids = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
  const now = () => new Date('2026-11-11T12:00:00.000Z');

  beforeAll(async () => {
    db = await createTestDb();
    sessionId = await createSession({ db, newId, now });
    capId = newId();
    await db.insert(caps).values({
      id: capId,
      sessionId,
      mode: 'mock',
      status: 'active',
      amountCents: 300000,
      orderId: 'MOCK-ORDER-000001',
    });
  });
  afterAll(async () => closeDb(db));

  it('creates a session row', async () => {
    const rows = await db.select().from(sessions);
    expect(rows.map((r) => r.id)).toEqual([sessionId]);
  });

  it('rejects a cap whose captured plus held exceeds the amount', async () => {
    const error = await failure(
      db.insert(caps).values({
        id: newId(),
        sessionId,
        mode: 'mock',
        status: 'active',
        amountCents: 300000,
        capturedCents: 250000,
        heldCents: 60000,
      }),
    );
    expect(pgCode(error)).toBe('23514');
    expect(String((error as Error).cause ?? error)).toMatch(/caps_ledger_check/);
  });

  it('rejects two purchases with the same request id', async () => {
    const purchase = {
      capId,
      runId: newId(),
      productId: 'saZdY6C',
      domain: 'walmart.com',
      amountCents: 2020,
      status: 'held' as const,
      requestId: 'capture:p1',
    };
    await db.insert(purchases).values({ ...purchase, id: newId(), attemptNo: 1 });
    const error = await failure(
      db.insert(purchases).values({ ...purchase, id: newId(), attemptNo: 2 }),
    );
    expect(pgCode(error)).toBe('23505');
  });

  it('rejects two terminal events for one purchase, and accepts held then captured', async () => {
    const purchaseId = newId();
    await db.insert(purchases).values({
      id: purchaseId,
      capId,
      runId: newId(),
      attemptNo: 1,
      productId: 'saZdY6C',
      domain: 'walmart.com',
      amountCents: 2020,
      status: 'held',
      requestId: `capture:${purchaseId}`,
    });
    const event = {
      capId,
      purchaseId,
      amountCents: 2020,
      at: now(),
      sentence: 'x',
    };
    await db.insert(paymentEvents).values({ ...event, id: newId(), type: 'held' });
    await db.insert(paymentEvents).values({ ...event, id: newId(), type: 'captured' });
    const error = await failure(
      db.insert(paymentEvents).values({ ...event, id: newId(), type: 'captured' }),
    );
    expect(pgCode(error)).toBe('23505');
    expect(String((error as Error).cause ?? error)).toMatch(/payment_events_one_terminal/);
  });
});
