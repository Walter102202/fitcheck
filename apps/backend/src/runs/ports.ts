import type {
  Answer,
  Category,
  Intent,
  ProductRecord,
  QuestionCard,
  ReviewInput,
  ReviewResult,
  RunResponse,
  TaskMemory,
} from '@fitcheck/contracts';
import { Channel3UnavailableError, createChannel3Gateway } from '../channel3/index.js';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import {
  applyAnswers,
  checksFor,
  createModelPort,
  extractIntent,
  failClosed,
  type ModelPort,
  ReviewUnavailableError,
  review,
} from '../review/index.js';

/**
 * The seam to Lane B. Callers see only these two ports; the C4 orchestration tests run on
 * createStubReviewPort and createRecordedChannel3 instead (runs/review-stub.ts).
 */

export type { ModelPort };

/** Why the review could not run. Every one of them fails the purchase closed. */
export type UnavailableReason = 'model_error' | 'invalid_output' | 'no_recording' | 'channel3';

export type Channel3Port = {
  mode: 'live' | 'recorded';
  /** Throws Channel3UnavailableError when live failed and no recording exists. */
  getProduct(productId: string): Promise<ProductRecord>;
  /** The recorded-copy notice, or null. */
  noticeFor(record: ProductRecord): string | null;
};

export type ReviewPort = {
  /** Throws ReviewUnavailableError after one retry. */
  extractIntent(request: string, category: Category): Promise<Intent>;
  /** Step 1, "What Fitcheck will check", with `fact`. */
  checksFor(intent: Intent): RunResponse['checks'];
  /** Never throws; `reasons` feeds the measurement. */
  review(input: ReviewInput): Promise<ReviewResult>;
  /** Pure; a missing answer is dont_know. */
  applyAnswers(
    card: QuestionCard,
    answers: Record<string, Answer>,
    memory: TaskMemory,
  ): { decision: 'capture' | 'return_to_agent'; memory: TaskMemory; agentMessage?: string };
  failClosed(now: Date, record?: ProductRecord): ReviewResult;
  /** Null when `err` is not one of Lane B's unavailable errors: rethrow it. */
  unavailableReason(err: unknown): UnavailableReason | null;
};

/**
 * Lane B's review and Channel3 behind the ports. The model defaults to the env's provider
 * (mock replays Lane B's recordings). Live Channel3 or the Anthropic provider without a key
 * throws here, so a misconfigured server fails at boot instead of failing every purchase.
 * `citations: false` (the measurement) leaves the model out of the review: citations only
 * pick which quote is shown, never a decision.
 */
export function createPorts(
  env: Env,
  o: { now: () => Date; logger?: Logger; model?: ModelPort; citations?: boolean },
): { channel3: Channel3Port; review: ReviewPort } {
  const model =
    o.model ??
    createModelPort({
      LLM_PROVIDER: env.LLM_PROVIDER,
      REVIEW_MODEL: env.REVIEW_MODEL,
      ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
    });
  const channel3 = createChannel3Gateway(
    {
      CHANNEL3_MODE: env.CHANNEL3_MODE,
      CHANNEL3_DAILY_SEARCH_LIMIT: env.CHANNEL3_DAILY_SEARCH_LIMIT,
      ...(env.CHANNEL3_API_KEY ? { CHANNEL3_API_KEY: env.CHANNEL3_API_KEY } : {}),
    },
    { now: o.now, ...(o.logger ? { logger: o.logger } : {}) },
  );
  const logger = o.logger ? { logger: o.logger } : {};
  return {
    channel3: {
      mode: channel3.mode,
      getProduct: (productId) => channel3.getProduct(productId),
      noticeFor: (record) => channel3.noticeFor(record),
    },
    review: {
      extractIntent: (request, category) => extractIntent(request, category, { model, ...logger }),
      checksFor,
      review: (input) =>
        review(input, {
          now: o.now,
          ...logger,
          ...(o.citations === false ? {} : { citations: model }),
        }),
      applyAnswers,
      failClosed,
      unavailableReason(err) {
        if (err instanceof ReviewUnavailableError) return err.reason;
        if (err instanceof Channel3UnavailableError) return 'channel3';
        return null;
      },
    },
  };
}
