import { API, CapCreateRequestSchema } from '@fitcheck/contracts';
import { Hono } from 'hono';
import { scenarioById } from '../../agent/scenarios.js';
import type { Deps } from '../../deps.js';
import {
  type CapRow,
  completeApproval,
  expireCap,
  findCapByOrder,
  latestCapForSession,
  openCap,
  voidCap,
} from '../../ledger/caps.js';
import { PaypalError } from '../../paypal/index.js';
import { singleFlight } from '../../runs/single-flight.js';
import { AppError } from '../errors.js';
import { parseBody } from '../http.js';
import { type ApiEnv, startSession } from '../session.js';

const RETURN_FAILED = '/cap?error=paypal';

const capNotFound = () => new AppError('not_found', 'Spending cap not found', { status: 404 });

type OwnCap = CapRow & { orderId: string };

/** The session's cap for a PayPal order token, or null when the token is not this session's. */
async function ownCap(
  deps: Deps,
  sessionId: string,
  token: string | undefined,
): Promise<OwnCap | null> {
  if (!token) return null;
  const row = await findCapByOrder(deps, token);
  return row?.sessionId === sessionId ? { ...row, orderId: token } : null;
}

/** Completes the approval; true when the cap is now usable. PayPal refusals are false. */
async function approveAndAuthorize(deps: Deps, row: OwnCap): Promise<boolean> {
  try {
    if (row.mode !== 'sandbox') await deps.paypal.simulated.approve(row.orderId);
    const cap = await completeApproval(deps, { orderId: row.orderId });
    return cap.status === 'active' || cap.status === 'exhausted';
  } catch (error) {
    if (!(error instanceof PaypalError)) throw error;
    deps.logger.warn('caps.approval_failed', { capId: row.id, code: error.code });
    await expireIfForgotten(deps, row, error);
    return false;
  }
}

/**
 * A simulated order a restart forgot can never be approved: the cap expires, so the next
 * POST /api/cap opens a new one instead of handing back the dead one.
 */
async function expireIfForgotten(deps: Deps, row: OwnCap, error: PaypalError): Promise<void> {
  if (row.mode !== 'sandbox' && error.status === 404) await expireCap(deps, row.id);
}

export function capRoutes(deps: Deps): Hono<ApiEnv> {
  return new Hono<ApiEnv>()
    .get(API.cap, async (c) => c.json(await latestCapForSession(deps, c.var.sessionId)))
    .post(API.cap, async (c) => {
      const { scenarioId } = await parseBody(c, CapCreateRequestSchema);
      if (scenarioId !== undefined && !scenarioById(scenarioId)) {
        throw new AppError('unknown_scenario', `Unknown scenario ${scenarioId}`, { status: 404 });
      }
      const sessionId = c.var.sessionId;
      // A double-click opens one cap: two would leave the buyer approving the wrong one.
      const cap = await singleFlight(`cap:open:${sessionId}`, () =>
        openCap(deps, { sessionId, returnScenarioId: scenarioId ?? null }),
      );
      return c.json(cap);
    })
    .post(API.capApproveSimulated, async (c) => {
      const token = c.req.query('token');
      const row = await ownCap(deps, c.var.sessionId, token);
      if (row?.mode !== 'simulated') throw capNotFound();
      try {
        await deps.paypal.simulated.approve(row.orderId);
      } catch (error) {
        if (!(error instanceof PaypalError)) throw error;
        deps.logger.warn('caps.approval_failed', { capId: row.id, code: error.code });
        await expireIfForgotten(deps, row, error);
        return c.redirect(RETURN_FAILED, 303);
      }
      return c.redirect(`${API.capReturn}?token=${encodeURIComponent(row.orderId)}`, 303);
    })
    .get(API.capReturn, async (c) => {
      const row = await ownCap(deps, c.var.sessionId, c.req.query('token'));
      if (!row || !(await approveAndAuthorize(deps, row))) return c.redirect(RETURN_FAILED, 303);
      return c.redirect(row.returnScenarioId ? `/run/${row.returnScenarioId}` : '/', 303);
    })
    .post(API.sessionReset, async (c) => {
      const cap = await latestCapForSession(deps, c.var.sessionId);
      if (cap?.status === 'active') {
        try {
          await voidCap(deps, { capId: cap.capId, reason: 'reset' });
        } catch (error) {
          if (!(error instanceof PaypalError)) throw error;
          // The idle sweep voids it later; the visitor still gets a fresh start.
          deps.logger.warn('caps.reset_void_failed', { capId: cap.capId, code: error.code });
        }
      } else if (cap?.status === 'pending_approval') {
        await expireCap(deps, cap.capId);
      }
      await startSession(deps, c);
      return c.body(null, 204);
    });
}
