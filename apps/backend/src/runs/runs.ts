import type { AnswersRequest, Attempt, Intent, RunResponse } from '@fitcheck/contracts';
import { and, desc, eq, gt } from 'drizzle-orm';
import { type ScenarioScript, scenarioById } from '../agent/scenarios.js';
import { pickFor } from '../agent/scripted-agent.js';
import { AppError } from '../api/errors.js';
import { caps, purchases, runs } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { getCap, latestCapForSession } from '../ledger/caps.js';
import { SENTENCES } from '../ledger/events.js';
import { listRunEvents, purchaseFor, releaseHold } from '../ledger/purchases.js';
import { answerAttempt, PENDING_NOTICE, processAttempt } from './attempt.js';
import type { UnavailableReason } from './ports.js';
import { singleFlight } from './single-flight.js';

/** A second start of the same run within this window returns the first one. */
export const RUN_DEDUPE_MS = 10_000;
export const PAYPAL_SIMULATED_NOTICE =
  'PayPal is simulated on this site. The video shows the same flow on the PayPal sandbox.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RunRow = typeof runs.$inferSelect;

const notFound = () => new AppError('not_found', 'Run not found', { status: 404 });

/**
 * A capture outcome as the ledger has it now: a PayPal PENDING capture is stored as captured 0,
 * and becomes Captured (or Not paid, if PayPal denied it) once the webhook settles it.
 */
async function settledAttempts(
  d: Deps,
  row: RunRow,
): Promise<{ attempts: Attempt[]; pending: boolean }> {
  if (!row.attempts.some((a) => a.outcome?.decision === 'capture')) {
    return { attempts: row.attempts, pending: false };
  }
  const bought = await d.db
    .select({
      attemptNo: purchases.attemptNo,
      status: purchases.status,
      amountCents: purchases.amountCents,
    })
    .from(purchases)
    .where(eq(purchases.runId, row.id));
  let pending = false;
  const attempts = row.attempts.map((a): Attempt => {
    if (a.outcome?.decision !== 'capture') return a;
    const purchase = bought.find((p) => p.attemptNo === a.attemptNo);
    if (purchase?.status === 'pending' || purchase?.status === 'capturing') {
      pending = true;
      return { ...a, outcome: { decision: 'capture', amountCents: 0 } };
    }
    if (purchase?.status === 'captured') {
      return { ...a, outcome: { decision: 'capture', amountCents: purchase.amountCents } };
    }
    if (purchase?.status === 'declined') {
      return {
        ...a,
        outcome: {
          decision: 'return_to_agent',
          amountCents: 0,
          agentMessage: `Not paid. ${SENTENCES.declined}`,
        },
      };
    }
    return a;
  });
  return { attempts, pending };
}

async function toResponse(d: Deps, row: RunRow): Promise<RunResponse> {
  const cap = await getCap(d, row.capId);
  const events = await listRunEvents(d.db, { capId: row.capId, runId: row.id });
  const [capRow] = await d.db
    .select({ fallback: caps.fallback })
    .from(caps)
    .where(eq(caps.id, row.capId));
  const { attempts, pending } = await settledAttempts(d, row);
  const notices = [
    ...new Set([...(capRow?.fallback ? [PAYPAL_SIMULATED_NOTICE] : []), ...row.notices]),
  ].filter((n) => pending || n !== PENDING_NOTICE);
  return {
    runId: row.id,
    scenarioId: row.scenarioId,
    review: row.review,
    intent: row.intent,
    checks: row.checks,
    attempts,
    status: row.status,
    cap,
    events,
    notices,
  };
}

async function loadRun(d: Deps, sessionId: string, runId: string): Promise<RunRow> {
  if (!UUID.test(runId)) throw notFound();
  const [row] = await d.db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.sessionId, sessionId)));
  if (!row) throw notFound();
  return row;
}

async function saveRun(d: Deps, id: string, values: Partial<Omit<RunRow, 'id'>>): Promise<RunRow> {
  const [row] = await d.db
    .update(runs)
    .set({ ...values, updatedAt: d.now() })
    .where(eq(runs.id, id))
    .returning();
  if (!row) throw notFound();
  return row;
}

const capturedIds = (attempts: Attempt[]) =>
  attempts.filter((a) => a.outcome?.decision === 'capture').map((a) => a.pick.productId);

/**
 * Plays the scenario's picks from the run's cursor. The agent gets its next pick only after
 * the review sent the last one back (not when it failed closed), or after a no on the card.
 */
async function advance(
  d: Deps,
  row: RunRow,
  scenario: ScenarioScript,
  o: { intentUnavailable?: UnavailableReason } = {},
): Promise<RunRow> {
  const attempts = [...row.attempts];
  const notices = [...row.notices];
  let { memory, cursor } = row;
  let status: RunRow['status'] = 'done';
  while (cursor < scenario.picks.length) {
    const step = scenario.picks[cursor];
    if (!step) break;
    const pickRecord = await d.channel3.getProduct(step.productId);
    const out = await processAttempt(d, {
      runId: row.id,
      capId: row.capId,
      attemptNo: attempts.length + 1,
      reviewMode: row.review,
      intent: row.intent,
      pick: pickFor(step, pickRecord),
      quantity: step.quantity,
      memory,
      capturedProductIds: capturedIds(attempts),
      pickRecord,
      ...(o.intentUnavailable && attempts.length === 0
        ? { intentUnavailable: o.intentUnavailable }
        : {}),
    });
    attempts.push(out.attempt);
    notices.push(...out.notices);
    memory = out.memory;
    cursor += 1;
    if (out.endedBy === 'waiting') {
      status = 'awaiting_answers';
      break;
    }
    const nextPick =
      row.review === 'on' &&
      ((out.endedBy === 'review' && !out.attempt.review.failedClosed) ||
        out.endedBy === 'offer_missing');
    if (!nextPick) break;
  }
  return saveRun(d, row.id, { attempts, notices, memory, cursor, status });
}

export const ABANDONED_MESSAGE = 'Not paid. The buyer left this purchase without answering.';

/**
 * A new run releases every hold this session left on a question card (lead ruling, lane A
 * review): two abandoned $1,398.00 holds would otherwise starve the rest of the demo. Each
 * release writes a not_captured event with no PayPal call, and the run ends returned to the
 * agent. A purchase the buyer answered meanwhile keeps its result.
 */
async function abandonWaitingRuns(d: Deps, sessionId: string): Promise<void> {
  const waiting = await d.db
    .select()
    .from(runs)
    .where(and(eq(runs.sessionId, sessionId), eq(runs.status, 'awaiting_answers')));
  for (const row of waiting) {
    const attempt = row.attempts.find((a) => !a.outcome && a.review.decision === 'ask');
    if (!attempt) continue;
    const purchase = await purchaseFor(d.db, { runId: row.id, attemptNo: attempt.attemptNo });
    const released = await releaseHold(d, { purchaseId: purchase.id });
    if (released.outcome !== 'not_captured') continue;
    const [current] = await d.db.select().from(runs).where(eq(runs.id, row.id));
    if (current?.status !== 'awaiting_answers') continue;
    const attempts = current.attempts.map((a) =>
      a.attemptNo === attempt.attemptNo
        ? {
            ...a,
            outcome: {
              decision: 'return_to_agent' as const,
              amountCents: 0,
              agentMessage: ABANDONED_MESSAGE,
            },
          }
        : a,
    );
    await saveRun(d, row.id, { attempts, status: 'done' });
    d.logger.info('runs.abandoned_hold_released', { runId: row.id, purchaseId: purchase.id });
  }
}

function placeholderIntent(scenario: ScenarioScript): Intent {
  return {
    category: scenario.category,
    request: scenario.request,
    quantity: 1,
    acceptUsed: false,
    stated: {},
    triggered: {},
    notChecked: [],
    source: 'model',
  };
}

export async function startRun(
  d: Deps,
  i: { sessionId: string; scenarioId: string; review: 'on' | 'off' },
): Promise<RunResponse> {
  const scenario = scenarioById(i.scenarioId);
  if (!scenario) {
    throw new AppError('unknown_scenario', `Unknown scenario ${i.scenarioId}`, { status: 404 });
  }
  return singleFlight(`run:${i.sessionId}:${i.scenarioId}:${i.review}`, async () => {
    const now = d.now();
    // A repeat of the session's latest run (a double click, a reload) gets that run back. Any
    // other run started since (the switch turned off and on again) means a fresh run.
    const [recent] = await d.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.sessionId, i.sessionId),
          gt(runs.createdAt, new Date(now.getTime() - RUN_DEDUPE_MS)),
        ),
      )
      .orderBy(desc(runs.createdAt))
      .limit(1);
    if (recent && recent.scenarioId === i.scenarioId && recent.review === i.review) {
      return toResponse(d, recent);
    }

    const cap = await latestCapForSession(d, i.sessionId);
    if (!cap || cap.status === 'pending_approval') {
      throw new AppError('cap_not_active', 'Approve a spending cap first.', { status: 409 });
    }
    await abandonWaitingRuns(d, i.sessionId);
    let intent: Intent;
    let intentUnavailable: UnavailableReason | undefined;
    try {
      intent = await d.review.extractIntent(scenario.request, scenario.category);
    } catch (error) {
      const reason = d.review.unavailableReason(error);
      if (reason === null) throw error;
      d.logger.warn('runs.intent_unavailable', { scenarioId: scenario.id, reason });
      intent = placeholderIntent(scenario);
      intentUnavailable = reason;
    }
    const checks = intentUnavailable ? [] : d.review.checksFor(intent);
    const [row] = await d.db
      .insert(runs)
      .values({
        id: d.newId(),
        sessionId: i.sessionId,
        scenarioId: scenario.id,
        review: i.review,
        status: 'done',
        capId: cap.capId,
        intent,
        checks,
        attempts: [],
        memory: {},
        notices: [],
        cursor: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('run insert returned no row');
    const played = await advance(d, row, scenario, intentUnavailable ? { intentUnavailable } : {});
    return toResponse(d, played);
  });
}

export async function getRun(
  d: Deps,
  i: { sessionId: string; runId: string },
): Promise<RunResponse> {
  return toResponse(d, await loadRun(d, i.sessionId, i.runId));
}

export async function submitAnswers(
  d: Deps,
  i: { sessionId: string; runId: string; body: AnswersRequest },
): Promise<RunResponse> {
  return singleFlight(`answers:${i.runId}:${i.body.attemptNo}`, async () => {
    const row = await loadRun(d, i.sessionId, i.runId);
    const attempt = row.attempts.find((a) => a.attemptNo === i.body.attemptNo);
    if (!attempt) throw new AppError('not_found', 'Attempt not found', { status: 404 });
    // Only the attempt on its card takes answers. Anything else (answers sent twice, a judge
    // going Back to a finished attempt, a hold the cap refused, a purchase a new run released)
    // gets the stored run unchanged: no review, no capture, no next pick.
    const card = attempt.review.card;
    const waiting =
      row.status === 'awaiting_answers' &&
      row.attempts.at(-1)?.attemptNo === attempt.attemptNo &&
      !attempt.outcome &&
      !attempt.answers &&
      attempt.review.decision === 'ask';
    if (!waiting || !card) return toResponse(d, row);
    const expected = card.lines.map((l) => l.lineId).sort();
    const given = Object.keys(i.body.answers).sort();
    if (expected.length !== given.length || expected.some((id, n) => id !== given[n])) {
      throw new AppError('invalid_answers', 'Answer every line of the card, and only those.', {
        status: 400,
      });
    }
    const out = await answerAttempt(d, {
      runId: row.id,
      capId: row.capId,
      attempt,
      answers: i.body.answers,
      memory: row.memory,
    });
    const attempts = row.attempts.map((a) => (a.attemptNo === attempt.attemptNo ? out.attempt : a));
    let saved = await saveRun(d, row.id, {
      attempts,
      memory: out.memory,
      notices: [...row.notices, ...out.notices],
      status: 'done',
    });
    const scenario = scenarioById(row.scenarioId);
    if (out.endedBy === 'answers' && row.review === 'on' && scenario) {
      saved = await advance(d, saved, scenario);
    }
    return toResponse(d, saved);
  });
}
