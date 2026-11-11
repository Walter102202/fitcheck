import type { ReviewChecklist } from './checklist.js';
import {
  type Candidate,
  candidateFrom,
  PRODUCT_EXTRACTORS,
  TEXT_NORMALIZERS,
} from './normalize.js';
import { type ProductContext, readPath } from './paths.js';

/**
 * Every candidate value code finds for a fact, from every evidence path (backing) and every
 * contradictionScan path (not backing). Facts read as a maximum keep only the highest class.
 */
export function collectCandidates(
  factId: string,
  ctx: ProductContext,
  checklist: ReviewChecklist,
): Candidate[] {
  const fact = checklist.facts[factId];
  if (!fact) throw new Error(`Unknown fact: ${factId}`);

  let candidates: Candidate[];
  const extractor = PRODUCT_EXTRACTORS[fact.normalizer];
  if (extractor) {
    candidates = extractor(fact, ctx);
  } else {
    const make = TEXT_NORMALIZERS[fact.normalizer];
    if (!make) throw new Error(`Unknown normalizer: ${fact.normalizer}`);
    const normalize = make(fact);
    const read = (patterns: string[], backing: boolean) =>
      patterns.flatMap((pattern) =>
        readPath(pattern, ctx).flatMap((field) =>
          normalize(field.text).map((m) => candidateFrom(field, m, fact.normalizer, backing)),
        ),
      );
    candidates = [...read(fact.evidence, true), ...read(fact.contradictionScan ?? [], false)];
  }

  if (fact.semantics === 'max' && fact.values) {
    const order = fact.values;
    const rank = (c: Candidate) => order.indexOf(String(c.value));
    const top = Math.max(-1, ...candidates.map(rank));
    candidates = candidates.filter((c) => rank(c) === top);
  }
  return candidates;
}
