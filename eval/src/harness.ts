import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentPick, Intent, ResultsRow } from '@fitcheck/contracts';
import type { Deps } from '../../apps/backend/src/deps.js';
import { answerAttempt, processAttempt } from '../../apps/backend/src/runs/attempt.js';
import { activeCap, createHarness } from '../../apps/backend/src/runs/harness.js';
import type { Channel3Port, ReviewPort } from '../../apps/backend/src/runs/ports.js';
import { simulatedBuyer } from './buyer.js';
import type { EvalCase } from './case-schema.js';
import { capturedFor } from './ledger-read.js';
import { type CaseRunOutcome, type Column, computeRows } from './measures.js';

export type { CaseRunOutcome, Column };

export type EvalDeps = { deps: Deps; close(): Promise<void> };
export type EvalPorts = { review: ReviewPort; channel3: Channel3Port; modelName: string };
export type Measured = { outcomes: CaseRunOutcome[]; rows: ResultsRow[]; modelName: string };

/**
 * The backend as the measurement drives it: in-memory PGlite with migrations, the mock PayPal
 * gateway with in-process webhooks, a fixed clock and sequential ids (the test harness, used
 * outside tests), with the review and Channel3 ports the caller chooses.
 */
export async function createEvalDeps(o: {
  review: ReviewPort;
  channel3: Channel3Port;
}): Promise<EvalDeps> {
  const h = await createHarness({ review: o.review, channel3: o.channel3 });
  return { deps: h.deps, close: h.close };
}

/** Cap only reads no request: the intent is the case's own facts, with no model. */
export function intentFromCase(c: EvalCase): Intent {
  return {
    category: c.category,
    request: c.request,
    quantity: c.attempt.quantity,
    acceptUsed: false,
    ...(c.allowed_stores ? { stores: c.allowed_stores } : {}),
    stated: {},
    triggered: {},
    notChecked: [],
    source: 'recorded',
  };
}

/**
 * One case, once, in one column: a new session with a mock cap, the case's attempt through the
 * same processAttempt the site runs, the simulated buyer on any card, then the ledger.
 */
export async function runCase(
  deps: Deps,
  c: EvalCase,
  column: Column,
  run: number,
): Promise<CaseRunOutcome> {
  const base = { caseId: c.id, column, run };
  const { cap } = await activeCap(deps, { amountCents: c.cap_cents ?? deps.env.CAP_AMOUNT_CENTS });
  let intent: Intent;
  if (column === 'fitcheck') {
    try {
      intent = await deps.review.extractIntent(c.request, c.category);
    } catch (error) {
      const reason = deps.review.unavailableReason(error);
      if (reason === null) throw error;
      return {
        ...base,
        captured: false,
        capturedCents: 0,
        asked: false,
        lines: 0,
        decision: 'return_to_agent',
        reasons: [],
        failedClosed: true,
        unavailable: reason,
      };
    }
  } else {
    intent = intentFromCase(c);
  }
  const runId = deps.newId();
  const pick: AgentPick = {
    productId: c.attempt.product_id,
    title: c.attempt.product_id,
    domain: c.attempt.store,
    priceCents: c.attempt.price_seen_cents,
    image: null,
    agentSays: '',
  };
  const out = await processAttempt(deps, {
    runId,
    capId: cap.capId,
    attemptNo: 1,
    reviewMode: column === 'fitcheck' ? 'on' : 'off',
    intent,
    pick,
    quantity: c.attempt.quantity,
    ...(c.attempt.variant_selected ? { variantSelected: c.attempt.variant_selected } : {}),
    memory: {},
    capturedProductIds: c.attempt.prior_captured_product_ids ?? [],
    ...(column === 'cap_only' && c.allowed_stores ? { allowedStores: c.allowed_stores } : {}),
  });
  const review = out.attempt.review;
  if (review.decision === 'ask' && review.card) {
    const buyer = simulatedBuyer(c.dossier);
    const answers = Object.fromEntries(review.card.lines.map((l) => [l.lineId, buyer(l)]));
    await answerAttempt(deps, {
      runId,
      capId: cap.capId,
      attempt: out.attempt,
      answers,
      memory: out.memory,
    });
  }
  return {
    ...base,
    ...(await capturedFor(deps, out.purchaseId)),
    asked: review.decision === 'ask',
    lines: review.card?.lines.length ?? 0,
    decision: review.decision,
    reasons: review.reasons,
    failedClosed: review.failedClosed === true,
    unavailable: null,
  };
}

/**
 * Every case once under cap only, then `runs` times through Fitcheck, sequentially. Run n uses
 * `portsFor(n)`, so a live run records each run into its own directory.
 */
export async function measureCases(i: {
  cases: EvalCase[];
  runs: number;
  portsFor: (run: number) => EvalPorts;
  log?: (line: string) => void;
}): Promise<Measured> {
  const first = i.portsFor(1);
  const ctx = await createEvalDeps({ review: first.review, channel3: first.channel3 });
  const summary = (label: string, list: CaseRunOutcome[]) => {
    const paid = list.filter((o) => o.captured).length;
    const closed = list.filter((o) => o.unavailable !== null).length;
    i.log?.(`${label}: ${list.length} case-runs, ${paid} paid, ${closed} unavailable`);
  };
  try {
    const outcomes: CaseRunOutcome[] = [];
    const capOnly: CaseRunOutcome[] = [];
    for (const c of i.cases) capOnly.push(await runCase(ctx.deps, c, 'cap_only', 1));
    summary('cap only', capOnly);
    outcomes.push(...capOnly);
    for (let run = 1; run <= i.runs; run += 1) {
      const ports = run === 1 ? first : i.portsFor(run);
      const deps: Deps = { ...ctx.deps, review: ports.review, channel3: ports.channel3 };
      const list: CaseRunOutcome[] = [];
      for (const c of i.cases) list.push(await runCase(deps, c, 'fitcheck', run));
      summary(`fitcheck run ${run}`, list);
      outcomes.push(...list);
    }
    return { outcomes, rows: computeRows(i.cases, outcomes), modelName: first.modelName };
  } finally {
    await ctx.close();
  }
}

/** A replay must re-derive the committed numbers from recordings alone. */
export function replayVerdict(
  measured: Pick<Measured, 'outcomes' | 'rows'>,
  committed: { rows: ResultsRow[]; file: string },
): { ok: boolean; message: string } {
  const missed = measured.outcomes.filter((o) => o.unavailable === 'no_recording').length;
  if (missed > 0) return { ok: false, message: `Replay missed ${missed} model calls.` };
  return JSON.stringify(measured.rows) === JSON.stringify(committed.rows)
    ? { ok: true, message: `Matches ${committed.file}.` }
    : { ok: false, message: `Replay differs from ${committed.file}.` };
}

/**
 * The held-out set is measured live once; a rerun needs a reason and keeps the first file. A
 * live run that started and crashed before writing results counts too: its recordings
 * directory (eval/recordings/heldout/<stamp>) is the proof it ran.
 */
export function guardLiveRun(i: {
  split: 'tuning' | 'heldout';
  resultsDir: string;
  /** eval/recordings/<split>: where live runs record. */
  recordingsDir: string;
  rerun?: string;
}): { ok: true; outFile: string } | { ok: false; message: string } {
  const first = join(i.resultsDir, `${i.split}.json`);
  if (i.split === 'tuning') return { ok: true, outFile: first };
  const rerun = Boolean(i.rerun?.trim());
  if (!existsSync(first)) {
    const started = existsSync(i.recordingsDir) && readdirSync(i.recordingsDir).length > 0;
    if (started && !rerun) {
      return {
        ok: false,
        message:
          'A live held-out run already started (eval/recordings/heldout/ is not empty) and wrote ' +
          'no results. Pass --rerun "<reason>" to measure it again.',
      };
    }
    return { ok: true, outFile: first };
  }
  if (!rerun) {
    return {
      ok: false,
      message:
        'eval/results/heldout.json exists: the held-out set is measured live once. ' +
        'Pass --rerun "<reason>" to measure it again; the first file is kept.',
    };
  }
  let n = 1;
  while (existsSync(join(i.resultsDir, `heldout-rerun-${n}.json`))) n += 1;
  return { ok: true, outFile: join(i.resultsDir, `heldout-rerun-${n}.json`) };
}

/** A live run records into a directory that did not exist: recordings are never mixed. */
export function claimRecordingsDir(dir: string): { ok: true } | { ok: false; message: string } {
  if (existsSync(dir)) return { ok: false, message: `Recordings directory exists: ${dir}` };
  mkdirSync(dir, { recursive: true });
  return { ok: true };
}

/** `yyyymmdd-hhmm` in UTC, the name of a live run's recordings directory. */
export function runStamp(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}
