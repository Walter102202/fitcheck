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
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import { createRecordedChannel3, createStubReviewPort } from './review-stub.js';

/**
 * The seam to Lane B. The shapes mirror 03-lane-b-review "Exports for lane C"; only this file
 * and eval/src/model.ts touch them, so wiring Lane B changes no caller.
 */

/** Lane B's model port, structurally, until its type is imported (C12 step 6). */
export type ModelPort = {
  readonly modelName: string;
  readonly recorded: boolean;
  complete(call: unknown): Promise<unknown>;
};

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
 * The single switch point between the stub and Lane B's review. Until Lane B lands, the stub
 * answers with the foundation's example runs and the recorded Channel3 products.
 */
export function createPorts(
  env: Env,
  _o: { now: () => Date; logger?: Logger; model?: ModelPort; citations?: boolean },
): { channel3: Channel3Port; review: ReviewPort } {
  return {
    channel3: createRecordedChannel3({ mode: env.CHANNEL3_MODE }),
    review: createStubReviewPort(),
  };
}
