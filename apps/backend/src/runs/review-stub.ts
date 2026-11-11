import { readFileSync } from 'node:fs';
import { loadChecklist } from '@fitcheck/checklists';
import {
  type Check,
  type Intent,
  type ProductRecord,
  ProductRecordSchema,
  type ReviewInput,
  type ReviewResult,
  type RunResponse,
  runDryerSilent,
  runDryerSpain,
  runSonyAsk,
} from '@fitcheck/contracts';
import { FIXTURES_DIR } from '../agent/scenarios.js';
import type { Channel3Port, ReviewPort, UnavailableReason } from './ports.js';

/** Stand-ins for Lane B's two error classes. */
export class StubReviewUnavailableError extends Error {
  constructor(readonly reason: UnavailableReason) {
    super(`review unavailable: ${reason}`);
    this.name = 'StubReviewUnavailableError';
  }
}
export class StubChannel3UnavailableError extends Error {
  constructor(readonly productId: string) {
    super(`Channel3 unavailable and no recording for ${productId}`);
    this.name = 'StubChannel3UnavailableError';
  }
}

export const RECORDED_NOTICE =
  'Channel3 did not answer. Showing the copy recorded on Nov 10, 2026.';
export const COULD_NOT_CHECK = 'Fitcheck could not check this listing.';
const ZERO = { backed: 0, unbacked: 0, never_asked: 0, contradictory: 0, broken: 0 };
const EXAMPLES: RunResponse[] = [runDryerSpain, runDryerSilent, runSonyAsk];
const TV_WALL_REQUEST = 'Replace the TV on our living room wall with a 65-inch, up to $1,600.';

function tvName(id: string): string {
  return loadChecklist('tv').requirements.find((r) => r.id === id)?.name ?? id;
}
function tvWallChecks(): Check[] {
  return [
    {
      requirement: 'tv.screen_size',
      name: tvName('tv.screen_size'),
      fact: 'screen size',
      origin: 'stated',
      originQuote: '65-inch',
    },
    {
      requirement: 'tv.wall_mount',
      name: tvName('tv.wall_mount'),
      fact: 'wall-mount pattern',
      origin: 'triggered',
      originQuote: 'on our living room wall',
    },
  ];
}

const reviewOf = (run: RunResponse, attempt: number): ReviewResult => {
  const review = run.attempts[attempt]?.review;
  if (!review) throw new Error(`example ${run.runId} has no attempt ${attempt}`);
  return review;
};
function defaultReviews(): Record<string, ReviewResult> {
  const sonyAsk = reviewOf(runSonyAsk, 0);
  return {
    cv7t721: reviewOf(runDryerSpain, 0),
    saZdY6C: reviewOf(runDryerSpain, 1),
    '5swh9aC': reviewOf(runDryerSilent, 0),
    UXXAg59: sonyAsk,
    // Until Lane B lands only the shape matters: a one-line ask.
    '0gH7IUm': sonyAsk,
    '1U7pIWX': sonyAsk,
  };
}

const recordMeta = (record: ProductRecord) => ({
  fetchedAt: record.fetchedAt,
  source: record.source,
  ...(record.recordedOn ? { recordedOn: record.recordedOn } : {}),
});

/**
 * The review port until Lane B lands: the foundation's example runs, by request and product.
 * `inputs` records every review input, for tests.
 */
export function createStubReviewPort(
  o: { byProduct?: Record<string, ReviewResult>; throwOnIntent?: UnavailableReason } = {},
): ReviewPort & { inputs: ReviewInput[] } {
  const reviews = { ...defaultReviews(), ...o.byProduct };
  const inputs: ReviewInput[] = [];
  const failClosed = (_now: Date, record?: ProductRecord): ReviewResult => ({
    decision: 'return_to_agent',
    results: [],
    agentMessage: COULD_NOT_CHECK,
    summary: ZERO,
    reasons: [],
    failedClosed: true,
    ...(record ? { record: recordMeta(record) } : {}),
  });
  return {
    inputs,
    async extractIntent(request, category): Promise<Intent> {
      if (o.throwOnIntent) throw new StubReviewUnavailableError(o.throwOnIntent);
      const example = EXAMPLES.find((run) => run.intent.request === request);
      if (example) return structuredClone(example.intent);
      return {
        category,
        request,
        quantity: 1,
        acceptUsed: false,
        stated: {},
        triggered: {},
        notChecked: [],
        source: 'recorded',
      };
    },
    checksFor(intent) {
      const example = EXAMPLES.find((run) => run.intent.request === intent.request);
      if (example) return structuredClone(example.checks);
      if (intent.request === TV_WALL_REQUEST) return tvWallChecks();
      return [];
    },
    async review(input) {
      inputs.push(structuredClone(input));
      const review = reviews[input.purchase.productId] ?? reviews.saZdY6C;
      if (!review) throw new Error('stub has no default review');
      return { ...structuredClone(review), record: recordMeta(input.record) };
    },
    applyAnswers(card, answers, memory) {
      const memoryAfter = { ...memory };
      for (const line of card.lines) {
        memoryAfter[line.lineId] = answers[line.lineId] === 'yes' ? 'not_needed' : 'needed';
      }
      const refused = card.lines.find((line) => (answers[line.lineId] ?? 'dont_know') !== 'yes');
      if (!refused) return { decision: 'capture', memory: memoryAfter };
      return {
        decision: 'return_to_agent',
        memory: memoryAfter,
        agentMessage: `Not paid. The buyer did not say yes to: ${refused.text}.`,
      };
    },
    failClosed,
    unavailableReason(err) {
      if (err instanceof StubReviewUnavailableError) return err.reason;
      if (err instanceof StubChannel3UnavailableError) return 'channel3';
      return null;
    },
  };
}

/**
 * Channel3 from `fixtures/channel3/`. An array override returns its items in call order (the
 * last one repeats), and `'unavailable'` throws as if live failed with no recording.
 */
export function createRecordedChannel3(
  o: {
    mode?: 'live' | 'recorded';
    overrides?: Record<string, ProductRecord | (ProductRecord | 'unavailable')[]>;
  } = {},
): Channel3Port {
  const mode = o.mode ?? 'recorded';
  const calls = new Map<string, number>();
  return {
    mode,
    async getProduct(productId) {
      const override = o.overrides?.[productId];
      if (override) {
        const n = calls.get(productId) ?? 0;
        calls.set(productId, n + 1);
        const item = Array.isArray(override)
          ? override[Math.min(n, override.length - 1)]
          : override;
        if (!item || item === 'unavailable') throw new StubChannel3UnavailableError(productId);
        return structuredClone(item);
      }
      try {
        return ProductRecordSchema.parse(
          JSON.parse(readFileSync(new URL(`${productId}.json`, FIXTURES_DIR), 'utf8')),
        );
      } catch {
        throw new StubChannel3UnavailableError(productId);
      }
    },
    noticeFor(record) {
      return mode === 'live' && record.source === 'recorded' ? RECORDED_NOTICE : null;
    },
  };
}
