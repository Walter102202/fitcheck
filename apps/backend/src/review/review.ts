import type {
  Origin,
  ProductRecord,
  RequirementResult,
  ReviewInput,
  ReviewResult,
} from '@fitcheck/contracts';
import { getChecklist } from './checklist.js';
import { evaluateCommon } from './common-checks.js';
import { decide } from './decide.js';
import { FAIL_CLOSED_MESSAGE } from './errors.js';
import { appliesTo, type Evaluation, evaluateRequirement } from './evaluate.js';
import { contextFor } from './paths.js';
import type { ReviewDeps } from './types.js';

const ORIGIN_ORDER: Origin[] = ['stated', 'triggered', 'always'];

function recordMeta(record: ProductRecord): NonNullable<ReviewResult['record']> {
  return {
    fetchedAt: record.fetchedAt,
    source: record.source,
    ...(record.recordedOn !== undefined ? { recordedOn: record.recordedOn } : {}),
  };
}

function summaryOf(results: RequirementResult[]): ReviewResult['summary'] {
  const count = (s: RequirementResult['state']) => results.filter((r) => r.state === s).length;
  return {
    backed: count('backed'),
    unbacked: count('unbacked'),
    never_asked: count('never_asked'),
    contradictory: count('contradictory'),
    broken: count('broken'),
  };
}

/** The review could not run: back to the agent, nothing captured. `record` only when one was obtained. */
export function failClosed(_now: Date, record?: ProductRecord): ReviewResult {
  return {
    decision: 'return_to_agent',
    results: [],
    agentMessage: FAIL_CLOSED_MESSAGE,
    summary: { backed: 0, unbacked: 0, never_asked: 0, contradictory: 0, broken: 0 },
    reasons: [],
    ...(record ? { record: recordMeta(record) } : {}),
    failedClosed: true,
  };
}

function evaluateAll(input: ReviewInput): Evaluation[] {
  const checklist = getChecklist(input.intent.category);
  const ctx = contextFor(input.record.product, input.purchase.domain);
  const evals: Evaluation[] = [];
  for (const req of checklist.requirements) {
    if (req.id.startsWith('common.')) {
      const e = evaluateCommon(req, input, checklist, ctx);
      if (e) evals.push(e);
    } else if (appliesTo(req, input.intent, ctx).applies) {
      evals.push(evaluateRequirement(req, input.intent, checklist, ctx));
    }
  }
  // stated, triggered, always; checklist order inside each group (the sort is stable)
  return evals.sort(
    (a, b) => ORIGIN_ORDER.indexOf(a.result.origin) - ORIGIN_ORDER.indexOf(b.result.origin),
  );
}

/** Never throws: an internal error fails closed, keeping the record it was given. */
export async function review(input: ReviewInput, deps: ReviewDeps): Promise<ReviewResult> {
  try {
    const evals = evaluateAll(input);
    const d = decide(evals, input.memory, {
      amountCents: input.purchase.amountCents,
      noun: getChecklist(input.intent.category).noun,
    });
    return {
      decision: d.decision,
      results: d.results,
      ...(d.card ? { card: d.card } : {}),
      ...(d.agentMessage !== undefined ? { agentMessage: d.agentMessage } : {}),
      summary: summaryOf(d.results),
      reasons: d.reasons,
      record: recordMeta(input.record),
    };
  } catch (err) {
    deps.logger?.warn('review failed closed', { err });
    return failClosed(deps.now(), input.record);
  }
}
