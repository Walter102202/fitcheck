import type { AnswersRequest, Attempt, Intent, RunResponse } from '@fitcheck/contracts';
import { and, desc, eq, gt } from 'drizzle-orm';
import { type ScenarioScript, scenarioById } from '../agent/scenarios.js';
import { pickFor } from '../agent/scripted-agent.js';
import { AppError } from '../api/errors.js';
import { caps, runs } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { getCap, latestCapForSession } from '../ledger/caps.js';
import { listRunEvents } from '../ledger/purchases.js';
import { answerAttempt, processAttempt } from './attempt.js';
import type { UnavailableReason } from './ports.js';
import { singleFlight } from './single-flight.js';

/** A second start of the same run within this window returns the first one. */
export const RUN_DEDUPE_MS = 10_000;
export const PAYPAL_SIMULATED_NOTICE =
  'PayPal is simulated on this site. The video shows the same flow on the PayPal sandbox.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RunRow = typeof runs.$inferSelect;

const notFound = () => new AppError('not_found', 'Run not found', { status: 404 });

async function toResponse(d: Deps, row: RunRow): Promise<RunResponse> {
  const cap = await getCap(d, row.capId);
  const events = await listRunEvents(d.db, { capId: row.capId, runId: row.id });
  const [capRow] = await d.db
    .select({ fallback: caps.fallback })
    .from(caps)
    .where(eq(caps.id, row.capId));
  const notices = [
    ...new Set([...(capRow?.fallback ? [PAYPAL_SIMULATED_NOTICE] : []), ...row.notices]),
  ];
  return {
    runId: row.id,
    scenarioId: row.scenarioId,
    review: row.review,
    intent: row.intent,
    checks: row.checks,
    attempts: row.attempts,
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
      row.review === 'on' && out.endedBy === 'review' && !out.attempt.review.failedClosed;
    if (!nextPick) break;
  }
  return saveRun(d, row.id, { attempts, notices, memory, cursor, status });
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
    const [recent] = await d.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.sessionId, i.sessionId),
          eq(runs.scenarioId, i.scenarioId),
          eq(runs.review, i.review),
          gt(runs.createdAt, new Date(now.getTime() - RUN_DEDUPE_MS)),
        ),
      )
      .orderBy(desc(runs.createdAt))
      .limit(1);
    if (recent) return toResponse(d, recent);

    const cap = await latestCapForSession(d, i.sessionId);
    if (!cap || cap.status === 'pending_approval') {
      throw new AppError('cap_not_active', 'Approve a spending cap first.', { status: 409 });
    }
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
    // Answers already sent: the stored run, unchanged, even if these answers differ.
    if (attempt.answers) return toResponse(d, row);
    const card = attempt.review.card;
    if (attempt.review.decision !== 'ask' || !card) {
      throw new AppError('answers_not_expected', 'This purchase is not waiting for answers.', {
        status: 409,
      });
    }
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
