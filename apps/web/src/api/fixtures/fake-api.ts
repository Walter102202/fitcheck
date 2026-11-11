import {
  type Answer,
  type Attempt,
  type Cap,
  CapSchema,
  type Cents,
  type ConfigResponse,
  ConfigResponseSchema,
  formatUsd,
  type PaymentEvent,
  ResultsJsonSchema,
  type RunResponse,
  RunResponseSchema,
  ScenarioSchema,
} from '@fitcheck/contracts';
import { goTo } from '../../lib/browser.js';
import { ApiRequestError } from '../errors.js';
import type { FitcheckApi } from '../types.js';
import { FIXTURE_RESULTS } from './results.js';
import { fixtureRun, hasFixtureRun, luraAttempt, tvWallSecondAttempt } from './runs.js';
import { FIXTURE_SCENARIOS } from './scenarios.js';

export const FIXTURE_STORAGE_KEY = 'fitcheck.fixtures.v1';

const CAP_CENTS: Cents = 300000;

const CONFIG: ConfigResponse = {
  paypalMode: 'simulated',
  channel3Mode: 'recorded',
  reviewModel: 'claude-sonnet-5-5',
  // As the server reports it with LLM_PROVIDER=mock and the hand-written recordings.
  reviewSource: 'scripted',
  capAmountCents: CAP_CENTS,
};

export function activeFixtureCap(): Cap {
  return {
    capId: 'cap-fx',
    mode: 'simulated',
    status: 'active',
    amountCents: CAP_CENTS,
    capturedCents: 0,
    heldCents: 0,
    availableCents: CAP_CENTS,
  };
}

export type FakeApiOptions = {
  cap?: Cap | null;
  runs?: Partial<Record<string, RunResponse>>;
  persist?: boolean;
};

type FakeState = {
  cap: Cap | null;
  n: number;
  /** Simulated approval token -> the scenario to open after approval. */
  pending: Record<string, string>;
  runs: Record<string, RunResponse>;
};

function readStored(): FakeState | null {
  try {
    const raw = sessionStorage.getItem(FIXTURE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FakeState) : null;
  } catch {
    return null;
  }
}

function writeStored(state: FakeState | null): void {
  try {
    if (state) sessionStorage.setItem(FIXTURE_STORAGE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(FIXTURE_STORAGE_KEY);
  } catch {
    // Storage can be blocked; fixture mode then simply forgets on reload.
  }
}

function notFound(message: string): ApiRequestError {
  return new ApiRequestError(404, 'not_found', message);
}

/** The cap after moving cents between held, captured and available. */
function moveCents(cap: Cap, change: { held?: number; captured?: number }): Cap {
  const heldCents = cap.heldCents + (change.held ?? 0);
  const capturedCents = cap.capturedCents + (change.captured ?? 0);
  return {
    ...cap,
    heldCents,
    capturedCents,
    availableCents: cap.amountCents - heldCents - capturedCents,
  };
}

/**
 * The in-browser API of fixture mode and tests. Every return goes through its contract
 * schema, exactly as `httpApi` parses real replies.
 */
export function createFakeApi(opts: FakeApiOptions = {}): FitcheckApi {
  const initial = (): FakeState => ({
    cap: opts.cap ? structuredClone(opts.cap) : null,
    n: 0,
    pending: {},
    runs: {},
  });
  let state: FakeState = (opts.persist && readStored()) || initial();

  const save = () => {
    if (opts.persist) writeStored(state);
  };
  const next = () => {
    state.n += 1;
    save();
    return state.n;
  };
  const sessionCap = (): Cap => state.cap ?? activeFixtureCap();

  function capturedEvent(cents: Cents, cap: Cap): PaymentEvent {
    const n = next();
    return {
      eventId: `evt-fx-${n}`,
      purchaseId: `pur-fx-${n}`,
      type: 'captured',
      amountCents: cents,
      at: new Date().toISOString(),
      sentence: `PayPal captured ${formatUsd(cents)} from the spending cap.`,
      paypalCall: {
        method: 'POST',
        path: `/v2/payments/authorizations/${cap.authorizationId ?? '{id}'}/capture`,
        note: 'final_capture: false',
      },
      paypalId: `FAKE-CAPTURE-${n}`,
    };
  }

  function plainEvent(type: 'held' | 'not_captured', cents: Cents, sentence: string): PaymentEvent {
    const n = next();
    return {
      eventId: `evt-fx-${n}`,
      purchaseId: `pur-fx-${n}`,
      type,
      amountCents: cents,
      at: new Date().toISOString(),
      sentence,
      paypalCall: null,
    };
  }

  /** The same purchase with a spending cap only: the first pick is captured, no review. */
  function capOnlyRun(run: RunResponse): RunResponse {
    const first = run.attempts[0];
    if (!first) return run;
    const authorized = run.events.find((e) => e.type === 'authorized');
    const price = first.pick.priceCents;
    const { answers: _answers, ...attempt } = first;
    const cap = { ...run.cap, capturedCents: 0, heldCents: 0, availableCents: run.cap.amountCents };
    // apps/backend/src/runs/cap-only.ts capOnlyReview: nothing checked, the record kept.
    const { record } = first.review;
    const review: Attempt['review'] = {
      decision: 'capture',
      results: [],
      summary: { backed: 0, unbacked: 0, never_asked: 0, contradictory: 0, broken: 0 },
      reasons: [],
      ...(record ? { record } : {}),
    };
    return {
      ...run,
      review: 'off',
      attempts: [{ ...attempt, review, outcome: { decision: 'capture', amountCents: price } }],
      status: 'done',
      cap: moveCents(cap, { captured: price }),
      events: [...(authorized ? [authorized] : []), capturedEvent(price, cap)],
    };
  }

  const parseRun = (run: RunResponse) => RunResponseSchema.parse(structuredClone(run));

  return {
    async getConfig() {
      return ConfigResponseSchema.parse(structuredClone(CONFIG));
    },

    async getScenarios() {
      return ScenarioSchema.array().parse(structuredClone(FIXTURE_SCENARIOS));
    },

    async getCap() {
      return CapSchema.nullable().parse(structuredClone(state.cap));
    },

    async createCap({ scenarioId }) {
      if (state.cap && (state.cap.status === 'pending_approval' || state.cap.status === 'active'))
        return CapSchema.parse(structuredClone(state.cap));
      const token = `fx-${next()}`;
      state.pending[token] = scenarioId ?? FIXTURE_SCENARIOS[0]?.id ?? 'dryer-spain';
      state.cap = {
        capId: 'cap-fx',
        mode: 'simulated',
        status: 'pending_approval',
        amountCents: CAP_CENTS,
        capturedCents: 0,
        heldCents: 0,
        availableCents: CAP_CENTS,
        approveUrl: `/cap/approve-simulated?token=${token}`,
      };
      save();
      return CapSchema.parse(structuredClone(state.cap));
    },

    async completeSimulatedApproval(token) {
      const scenarioId = state.pending[token] ?? FIXTURE_SCENARIOS[0]?.id ?? 'dryer-spain';
      state.cap = activeFixtureCap();
      delete state.pending[token];
      save();
      goTo(`/run/${scenarioId}`);
    },

    async startRun({ scenarioId, review }) {
      const injected = opts.runs?.[scenarioId];
      if (!injected && !hasFixtureRun(scenarioId)) throw notFound('Scenario not found');
      const base = injected ? structuredClone(injected) : fixtureRun(scenarioId);
      const session = sessionCap();
      const withCap: RunResponse = {
        ...base,
        runId: `run-fx-${next()}`,
        cap: { ...base.cap, capId: session.capId, mode: session.mode },
      };
      const run = review === 'off' ? capOnlyRun(withCap) : withCap;
      state.runs[run.runId] = run;
      save();
      return parseRun(run);
    },

    async getRun(runId) {
      const run = state.runs[runId];
      if (!run) throw notFound('Run not found');
      return parseRun(run);
    },

    async sendAnswers(runId, { attemptNo, answers }) {
      const stored = state.runs[runId];
      if (!stored) throw notFound('Run not found');
      const run = structuredClone(stored);
      const attempt = run.attempts.find((a) => a.attemptNo === attemptNo);
      if (!attempt) throw new ApiRequestError(400, 'bad_attempt', 'No such attempt');
      if (attempt.answers) return parseRun(stored);

      const lines = attempt.review.card?.lines ?? [];
      const answer = (lineId: string): Answer | undefined => answers[lineId];
      const refused = lines.find((l) => answer(l.lineId) !== 'yes');
      const price = attempt.pick.priceCents;
      attempt.answers = answers;

      if (!refused) {
        attempt.outcome = { decision: 'capture', amountCents: price };
        run.events.push(capturedEvent(price, run.cap));
        run.cap = moveCents(run.cap, { held: -price, captured: price });
        run.status = 'done';
      } else {
        attempt.outcome = {
          decision: 'return_to_agent',
          amountCents: 0,
          agentMessage: `Not paid. The buyer did not accept: ${refused.text}`,
        };
        run.events.push(
          plainEvent('not_captured', price, 'The buyer did not accept. Hold released.'),
        );
        run.cap = moveCents(run.cap, { held: -price });
        run.status = 'done';
        if (run.scenarioId === 'dryer-silent' && attemptNo === 1) {
          const lura = luraAttempt();
          run.attempts.push(lura);
          run.events.push(capturedEvent(lura.pick.priceCents, run.cap));
          run.cap = moveCents(run.cap, { captured: lura.pick.priceCents });
        } else if (run.scenarioId === 'tv-wall' && attemptNo === 1) {
          const lg = tvWallSecondAttempt();
          run.attempts.push(lg);
          run.events.push(plainEvent('held', lg.pick.priceCents, 'No capture sent to PayPal.'));
          run.cap = moveCents(run.cap, { held: lg.pick.priceCents });
          run.status = 'awaiting_answers';
        }
      }
      state.runs[runId] = run;
      save();
      return parseRun(run);
    },

    async getResults() {
      return ResultsJsonSchema.parse(structuredClone(FIXTURE_RESULTS));
    },

    async resetSession() {
      state = initial();
      save();
    },
  };
}
