// Model-proposed citations: the model may propose the quote shown for free-text evidence. Code
// accepts a quote only when it is verbatim in the field and the same normalizer reads the same
// value from it. Citations never change a state, a note or a decision.
import type { Evidence, RequirementResult } from '@fitcheck/contracts';
import { z } from 'zod';
import { factOf, type ReviewChecklist } from './checklist.js';
import { TEXT_NORMALIZERS, type Value, valueKey } from './normalize.js';
import { type ProductContext, readPath } from './paths.js';
import { findQuote, MAX_EXCERPT, makeExcerpt } from './text.js';

export const CitationDraftSchema = z.strictObject({
  citations: z.array(
    z.strictObject({ requirement: z.string(), path: z.string(), quote: z.string() }),
  ),
});
export type CitationDraft = z.infer<typeof CitationDraftSchema>;

export type CitationRequest = {
  requirement: string;
  fact: string;
  patterns: string[];
  values: { value: Value; display: string }[];
};

const CITABLE_STATES = new Set(['backed', 'broken', 'contradictory', 'never_asked']);

/** Requirements checked with a model citation whose state carries evidence. */
export function citationRequests(
  results: RequirementResult[],
  checklist: ReviewChecklist,
): CitationRequest[] {
  const out: CitationRequest[] = [];
  for (const r of results) {
    if (!CITABLE_STATES.has(r.state)) continue;
    const req = checklist.requirements.find((x) => x.id === r.requirement);
    if (!req || req.check !== 'code_with_model_citation') continue;
    const factId = factOf(req, checklist);
    const fact = factId ? checklist.facts[factId] : undefined;
    if (!factId || !fact) continue;
    const values: CitationRequest['values'] = [];
    for (const e of r.evidence) {
      if (e.value === null || values.some((v) => valueKey(v.value) === valueKey(e.value ?? ''))) {
        continue;
      }
      values.push({ value: e.value, display: e.display });
    }
    out.push({ requirement: r.requirement, fact: factId, patterns: fact.evidence, values });
  }
  return out;
}

export function verifyCitation(
  p: CitationDraft['citations'][number],
  ctx: ProductContext,
  checklist: ReviewChecklist,
  results: RequirementResult[],
): { ok: true; requirement: string; evidence: Evidence } | { ok: false; error: string } {
  const request = citationRequests(results, checklist).find((r) => r.requirement === p.requirement);
  if (!request) return { ok: false, error: `no citation was asked for "${p.requirement}"` };
  const fact = checklist.facts[request.fact];
  const make = fact ? TEXT_NORMALIZERS[fact.normalizer] : undefined;
  if (!fact || !make) return { ok: false, error: `"${request.fact}" has no text normalizer` };

  const field = request.patterns
    .flatMap((pattern) => readPath(pattern, ctx))
    .find((f) => f.path === p.path);
  if (!field) return { ok: false, error: `path "${p.path}" is not evidence for ${p.requirement}` };
  if (p.quote.length > MAX_EXCERPT) {
    return { ok: false, error: `quote is longer than ${MAX_EXCERPT} characters` };
  }
  const at = findQuote(field.text, p.quote);
  if (!at) return { ok: false, error: `quote "${p.quote}" is not in ${p.path}` };
  const quote = field.text.slice(at.start, at.end);
  // The field is shown around the quote (whole when short), so a short quote keeps its context.
  const shown = makeExcerpt(field.text, at.start, at.end);

  const result = results.find((r) => r.requirement === p.requirement);
  const samePath = (result?.evidence ?? []).filter((e) => e.path === p.path);
  for (const m of make(fact)(quote)) {
    const existing = samePath.find(
      (e) => e.value !== null && valueKey(e.value) === valueKey(m.value),
    );
    if (existing) {
      return {
        ok: true,
        requirement: p.requirement,
        evidence: {
          ...existing,
          label: field.label,
          text: shown.text,
          start: shown.start + m.start,
          end: shown.start + m.end,
        },
      };
    }
  }
  return { ok: false, error: `quote "${p.quote}" does not state a value code found in ${p.path}` };
}

/** Replaces the evidence item with the same requirement, path and value; nothing else changes. */
export function applyCitations(
  results: RequirementResult[],
  accepted: { requirement: string; evidence: Evidence }[],
): RequirementResult[] {
  return results.map((r) => {
    const mine = accepted.filter((a) => a.requirement === r.requirement);
    if (mine.length === 0) return r;
    const evidence = r.evidence.map((e) => {
      const hit = mine.find(
        (a) =>
          a.evidence.path === e.path &&
          e.value !== null &&
          a.evidence.value !== null &&
          valueKey(a.evidence.value) === valueKey(e.value),
      );
      return hit ? hit.evidence : e;
    });
    return { ...r, evidence };
  });
}
