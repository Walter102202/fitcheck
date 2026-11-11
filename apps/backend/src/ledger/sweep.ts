import { eq, inArray } from 'drizzle-orm';
import { caps, sessions } from '../db/schema.js';
import { gatewayFor, PAYPAL_PATHS } from '../paypal/index.js';
import {
  AUTHORIZATION_DAYS,
  expireCap,
  expireIfDue,
  type LedgerDeps,
  lockCap,
  updateCap,
  voidCap,
} from './caps.js';
import { SENTENCES, writeEvent } from './events.js';

const DAY_MS = 86_400_000;
/** Reauthorize after PayPal's 3-day honor period and well before day 29. */
export const REAUTHORIZE_AFTER_DAYS = 25;

/**
 * The stale-cap sweep, run on boot and hourly. Every judge authorizes against the same sandbox
 * buyer, so a session idle too long gets its authorization voided in PayPal. Caps nearing
 * PayPal's 29-day limit are reauthorized; caps past it expire.
 */
export async function sweepCaps(
  d: LedgerDeps,
): Promise<{ voided: number; reauthorized: number; expired: number }> {
  const counts = { voided: 0, reauthorized: 0, expired: 0 };
  const now = d.now();
  const idleBefore = now.getTime() - d.env.CAP_IDLE_VOID_MINUTES * 60_000;
  const open = await d.db
    .select({ cap: caps, lastSeenAt: sessions.lastSeenAt })
    .from(caps)
    .innerJoin(sessions, eq(caps.sessionId, sessions.id))
    .where(inArray(caps.status, ['active', 'pending_approval']));
  for (const { cap, lastSeenAt } of open) {
    try {
      const idle = lastSeenAt.getTime() < idleBefore;
      if (cap.status === 'pending_approval') {
        if (idle) {
          await expireCap(d, cap.id);
          counts.expired += 1;
        }
        continue;
      }
      if (cap.expiresAt && cap.expiresAt.getTime() <= now.getTime()) {
        await d.db.transaction(async (tx) => expireIfDue(tx, await lockCap(tx, cap.id), now));
        counts.expired += 1;
        continue;
      }
      if (idle) {
        if ((await voidCap(d, { capId: cap.id, reason: 'idle' })).status === 'voided') {
          counts.voided += 1;
        }
        continue;
      }
      if (
        cap.authorizedAt &&
        cap.authorizationId &&
        !cap.reauthorizedAt &&
        now.getTime() >= cap.authorizedAt.getTime() + REAUTHORIZE_AFTER_DAYS * DAY_MS
      ) {
        if (await reauthorize(d, cap.id)) counts.reauthorized += 1;
      }
    } catch (error) {
      d.logger.error('caps.sweep_cap_failed', {
        capId: cap.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return counts;
}

async function reauthorize(d: LedgerDeps, capId: string): Promise<boolean> {
  const [row] = await d.db.select().from(caps).where(eq(caps.id, capId));
  if (!row?.authorizationId || row.status !== 'active' || row.reauthorizedAt) return false;
  const oldId = row.authorizationId;
  const result = await gatewayFor(d.paypal, row.mode).reauthorizeAuthorization(oldId, {
    amountCents: row.amountCents - row.capturedCents,
    requestId: `reauth:${row.id}`,
  });
  return d.db.transaction(async (tx) => {
    const locked = await lockCap(tx, capId);
    if (locked.reauthorizedAt || locked.authorizationId !== oldId) return false;
    const now = d.now();
    await updateCap(
      tx,
      capId,
      {
        authorizationId: result.authorizationId,
        reauthorizedAt: now,
        expiresAt: result.expiresAt
          ? new Date(result.expiresAt)
          : new Date(now.getTime() + AUTHORIZATION_DAYS * DAY_MS),
      },
      now,
    );
    await writeEvent(tx, d, {
      capId,
      type: 'authorized',
      amountCents: locked.amountCents - locked.capturedCents,
      sentence: SENTENCES.reauthorized,
      paypalCall: { method: 'POST', path: PAYPAL_PATHS.reauthorize(oldId) },
      paypalId: result.authorizationId,
    });
    return true;
  });
}
