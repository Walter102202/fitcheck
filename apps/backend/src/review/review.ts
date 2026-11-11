import type {
  Origin,
  ProductRecord,
  RequirementResult,
  ReviewInput,
  ReviewResult,
} from '@fitcheck/contracts';
import { getChecklist, type ReviewChecklist } from './checklist.js';
import {
  applyCitations,
  type CitationDraft,
  CitationDraftSchema,
  citationRequests,
  verifyCitation,
} from './citations.js';
import { evaluateCommon } from './common-checks.js';
import { decide } from './decide.js';
import { FAIL_CLOSED_MESSAGE, ReviewUnavailableError } from './errors.js';
import { appliesTo, type Evaluation, evaluateRequirement } from './evaluate.js';
import { callModel, recordingKey } from './model/port.js';
import { buildCitationPrompt } from './model/prompts.js';
import { contextFor, type ProductContext, readPath } from './paths.js';
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

function contextOf(input: ReviewInput): ProductContext {
  return contextFor(input.record.product, input.purchase.domain, input.purchase.variantSelected);
}

/** What the buyer would pay now: the live USD price times the quantity, else the agent's amount. */
function payableCents(input: ReviewInput, ctx: ProductContext): number {
  const offer = ctx.offer;
  return offer && offer.price.currency === 'USD'
    ? Math.round(offer.price.price * 100) * input.intent.quantity
    : input.purchase.amountCents;
}

function evaluateAll(input: ReviewInput, ctx: ProductContext): Evaluation[] {
  const checklist = getChecklist(input.intent.category);
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

/**
 * One citation call per review, when a citation port is given and something needs a quote.
 * Rejected citations are dropped; any failure keeps the code evidence (never fails closed).
 */
async function withCitations(
  results: RequirementResult[],
  input: ReviewInput,
  ctx: ProductContext,
  checklist: ReviewChecklist,
  deps: ReviewDeps,
): Promise<RequirementResult[]> {
  const port = deps.citations;
  if (!port) return results;
  const requests = citationRequests(results, checklist);
  if (requests.length === 0) return results;
  try {
    const ids = requests.map((r) => r.requirement).sort();
    const fields = [...new Set(requests.flatMap((r) => r.patterns))].flatMap((pattern) =>
      readPath(pattern, ctx).map((f) => ({ path: f.path, text: f.text })),
    );
    const { system, prompt } = buildCitationPrompt(fields, requests);
    const draft = await callModel(
      port,
      {
        kind: 'citation',
        key: recordingKey([input.record.product.id, ...ids]),
        system,
        prompt,
        schema: CitationDraftSchema,
        input: { productId: input.record.product.id, requirements: ids },
      },
      (parsed) => ({ ok: true, value: parsed as CitationDraft }),
    );
    const accepted = draft.citations.flatMap((c) => {
      const v = verifyCitation(c, ctx, checklist, results);
      return v.ok ? [{ requirement: v.requirement, evidence: v.evidence }] : [];
    });
    return applyCitations(results, accepted);
  } catch (err) {
    const reason = err instanceof ReviewUnavailableError ? err.reason : 'error';
    warnSafely(deps, 'citations skipped', { reason });
    return results;
  }
}

/** A logger that throws must not turn a review into a throw. */
function warnSafely(deps: ReviewDeps, msg: string, fields: Record<string, unknown>): void {
  try {
    deps.logger?.warn(msg, fields);
  } catch {
    // nothing left to report to
  }
}

/** Never throws: an internal error fails closed, keeping the record it was given. */
export async function review(input: ReviewInput, deps: ReviewDeps): Promise<ReviewResult> {
  try {
    if (input.record.product.id !== input.purchase.productId) {
      throw new Error(
        `record ${input.record.product.id} is not the purchased product ${input.purchase.productId}`,
      );
    }
    const checklist = getChecklist(input.intent.category);
    const ctx = contextOf(input);
    const evals = evaluateAll(input, ctx);
    const d = decide(evals, input.memory, {
      amountCents: payableCents(input, ctx),
      noun: checklist.noun,
    });
    const results = await withCitations(d.results, input, ctx, checklist, deps);
    return {
      decision: d.decision,
      results,
      ...(d.card ? { card: d.card } : {}),
      ...(d.agentMessage !== undefined ? { agentMessage: d.agentMessage } : {}),
      summary: summaryOf(d.results),
      reasons: d.reasons,
      record: recordMeta(input.record),
    };
  } catch (err) {
    warnSafely(deps, 'review failed closed', { err });
    return failClosed(deps.now(), input.record);
  }
}
