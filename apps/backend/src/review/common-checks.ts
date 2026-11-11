// Payment checks against the offer the agent chose. No contradictory state here: any failing
// candidate is a failure.
import {
  type Evidence,
  formatUsd,
  type ReasonType,
  type RequirementResult,
  type ReviewInput,
} from '@fitcheck/contracts';
import {
  factLabel,
  factOf,
  isFactTest,
  type RequirementSpec,
  type ReviewChecklist,
  renderTemplate,
} from './checklist.js';
import { appliesTo, type Evaluation, groupCandidates, passes } from './evaluate.js';
import { collectCandidates } from './facts.js';
import type { Candidate } from './normalize.js';
import { type ProductContext, readPath, searchedLabels } from './paths.js';
import { findQuote, looseEqual, makeExcerpt } from './text.js';

export { chosenOffer } from './paths.js';

const brandKey = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (hay: string, word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'u').test(hay);

/** Word-bounded containment either way: "Sony" matches "a sony tv", "Sony Group" matches "sony". */
function sameBrand(listed: string, wanted: string): boolean {
  const a = brandKey(listed);
  const b = brandKey(wanted);
  return a !== '' && b !== '' && (hasWord(a, b) || hasWord(b, a));
}

/** Checks that need the chosen offer; they are skipped when the listing has no offer from the domain. */
const OFFER_CHECKS = new Set([
  'common.budget',
  'common.price_unchanged',
  'common.amount_matches',
  'common.in_stock',
  'common.condition_new',
]);
const PRICE_CHECKS = new Set(['common.budget', 'common.price_unchanged']);

function evidenceOf(candidates: Candidate[]): Evidence[] {
  return groupCandidates(candidates, 0).flatMap((g) => (g[0] ? [g[0].evidence] : []));
}

function fieldEvidence(pattern: string, ctx: ProductContext): Evidence[] {
  return readPath(pattern, ctx).map((f) => ({
    path: f.path,
    label: f.label,
    text: f.text.slice(0, 160),
    start: 0,
    end: Math.min(f.text.length, 160),
    value: f.text,
    display: f.text,
  }));
}

/**
 * Evaluates one common requirement; null when it does not apply, or when it is an offer check
 * and the listing has no offer from the purchase domain.
 */
export function evaluateCommon(
  req: RequirementSpec,
  input: ReviewInput,
  checklist: ReviewChecklist,
  ctx: ProductContext,
): Evaluation | null {
  const { intent, purchase } = input;
  const applies = appliesTo(req, intent, ctx);
  if (!applies.applies) return null;
  const offer = ctx.offer;
  if (OFFER_CHECKS.has(req.id) && !offer) return null;
  if (PRICE_CHECKS.has(req.id) && offer && offer.price.currency !== 'USD') return null;

  const label = factLabel(req, checklist);
  const base = {
    requirement: req.id,
    name: req.name,
    ...(label ? { fact: label } : {}),
    origin: applies.origin,
    ...(applies.originQuote !== undefined ? { originQuote: applies.originQuote } : {}),
  };
  const failType: ReasonType = req.reasonType ?? 'payment';
  const quantity = intent.quantity;
  const priceCents =
    offer && offer.price.currency === 'USD' ? Math.round(offer.price.price * 100) : null;
  const vars: Record<string, string> = {
    domain: purchase.domain,
    category: checklist.noun,
    quantity: String(quantity),
    purchaseQuantity: String(purchase.quantity),
    amount: formatUsd(purchase.amountCents),
    priceSeen: formatUsd(purchase.priceSeenCents),
  };
  if (priceCents !== null) vars.price = formatUsd(priceCents * quantity);
  if (intent.budgetCents !== undefined) vars.budget = formatUsd(intent.budgetCents);

  const backed = (evidence: Evidence[]): Evaluation => ({
    result: { ...base, state: 'backed', evidence },
  });
  const fail = (reason: string, evidence: Evidence[] = []): Evaluation => ({
    result: { ...base, state: 'broken', evidence },
    returnReason: reason,
    returnType: failType,
  });
  const render = (extra: Record<string, string> = {}) =>
    renderTemplate(req.reasonTemplate ?? `${req.name}: the listing does not match.`, {
      ...vars,
      ...extra,
    });

  switch (req.id) {
    case 'common.merchant': {
      if (!offer) return fail(`The listing has no offer from ${purchase.domain}.`);
      const evidence = fieldEvidence('offer.domain', ctx);
      const allowed = intent.stores?.map((s) => s.toLowerCase());
      if (allowed && !allowed.includes(purchase.domain.toLowerCase())) {
        return fail(render(), evidence);
      }
      return backed(evidence);
    }
    case 'common.quantity':
      return purchase.quantity === quantity ? backed([]) : fail(render());
    case 'common.no_duplicate':
      return input.capturedProductIds.includes(purchase.productId) ? fail(render()) : backed([]);
    case 'common.variant_pinned': {
      const test = req.test;
      const names =
        test && !isFactTest(test) && 'everyOptionNamed' in test
          ? test.everyOptionNamed.map((n) => n.toLowerCase())
          : [];
      const allOptions = ctx.product.variants?.options ?? [];
      const listed = ctx.product.variants?.selected ?? [];
      const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
      // the agent's pins must agree with the listing and name a label the listing offers
      for (const pin of purchase.variantSelected ?? []) {
        const option = allOptions.find((o) => sameName(o.name, pin.name));
        if (!option) continue;
        const name = option.name.toLowerCase();
        const current = listed.find((s) => sameName(s.name, pin.name));
        if (current && !looseEqual(current.label, pin.label)) {
          return fail(
            `The agent pinned ${name} ${pin.label}, but the listing is for ${name} ${current.label}.`,
          );
        }
        if (!option.values.some((v) => looseEqual(v.label, pin.label))) {
          return fail(`The agent pinned ${name} ${pin.label}, which the listing does not offer.`);
        }
      }
      const options = allOptions.filter(
        (o) => names.includes(o.name.toLowerCase()) && o.values.length > 1,
      );
      const selected = [...listed, ...(purchase.variantSelected ?? [])];
      for (const o of options) {
        const pinned = selected.some(
          (s) => s.name.toLowerCase() === o.name.toLowerCase() && s.label,
        );
        if (!pinned) return fail(render({ option: o.name.toLowerCase() }));
      }
      return backed(options.flatMap((o) => fieldEvidence(`variants.selected[${o.name}]`, ctx)));
    }
    case 'common.amount_matches': {
      // the agent charges what it saw; a live price change is price_unchanged's card line
      if (priceCents === null) return fail(`The ${purchase.domain} offer is not in USD.`);
      const seen = purchase.priceSeenCents * quantity;
      const evidence = fieldEvidence('offer.price.price', ctx).map((e) => ({
        ...e,
        value: priceCents,
        display: e.text,
      }));
      return purchase.amountCents === seen
        ? backed(evidence)
        : fail(render({ price: formatUsd(seen) }), evidence);
    }
    case 'common.brand': {
      // the listing's brand names; the title only when the listing names no brand at all
      const stated = intent.stated[req.id];
      const wanted = typeof stated?.value === 'string' ? stated.value : (stated?.quote ?? '');
      let named: Evidence[] = fieldEvidence('brands[].name', ctx)
        .filter((e) => e.text.trim() !== '')
        .map((e) => ({ ...e, value: e.text.trim().toLowerCase(), display: e.text.trim() }));
      const hit = named.length === 0 && stated ? findQuote(ctx.product.title, stated.quote) : null;
      if (hit) {
        const written = ctx.product.title.slice(hit.start, hit.end);
        const excerpt = makeExcerpt(ctx.product.title, hit.start, hit.end);
        named = [
          {
            path: 'title',
            label: 'Title',
            text: excerpt.text,
            start: excerpt.start,
            end: excerpt.end,
            value: written.toLowerCase(),
            display: written,
          },
        ];
      }
      if (named.length === 0) {
        const template = req.line?.unbacked ?? 'The listing does not name the brand. Is that OK?';
        return {
          result: {
            ...base,
            state: 'unbacked',
            evidence: [],
            searched: searchedLabels(checklist.facts.brand?.evidence ?? [], ctx),
          },
          line: {
            lineId: req.id,
            requirement: req.id,
            type: 'unbacked',
            text: renderTemplate(template, vars),
          },
        };
      }
      // a product may carry a second (retailer) brand: one matching brand is enough
      const matching = named.filter((e) => sameBrand(e.display, wanted));
      if (matching.length > 0) return backed(matching);
      return fail(
        render({ brand: named[0]?.display ?? '', intentBrand: stated?.quote ?? wanted }),
        named,
      );
    }
    default:
      break;
  }

  // fact-based checks: price, budget, stock, condition, category, brand
  const test = isFactTest(req.test) ? req.test : undefined;
  const factId = factOf(req, checklist);
  const fact = factId ? checklist.facts[factId] : undefined;
  if (!test || !fact || !factId) throw new Error(`${req.id} has no fact test`);

  const candidates = collectCandidates(factId, ctx, checklist);
  const stated = intent.stated[req.id];

  if (candidates.length === 0) {
    const result: RequirementResult = {
      ...base,
      state: 'unbacked',
      evidence: [],
      searched: searchedLabels(fact.evidence, ctx),
    };
    if (req.ifMissing === 'ask') {
      const type: ReasonType = failType === 'payment' ? 'payment' : 'unbacked';
      const template =
        req.line?.[type] ?? `The listing does not give the ${fact.label}. Is that OK?`;
      return {
        result,
        line: { lineId: req.id, requirement: req.id, type, text: renderTemplate(template, vars) },
      };
    }
    return {
      result,
      returnReason: `The listing does not give the ${fact.label}.`,
      returnType: failType,
    };
  }

  let expected: unknown = test.value;
  if (test.valueFrom === 'checklist.channel3CategorySlugs')
    expected = checklist.channel3CategorySlugs;
  else if (test.valueFrom === 'intent.budgetCents') expected = intent.budgetCents;
  else if (test.valueFrom === 'purchase.priceSeenCents') expected = purchase.priceSeenCents;
  else if (test.valueFrom === 'intent') expected = stated?.value;
  const multiply = test.multiplyBy === 'intent.quantity' ? quantity : 1;

  const ok = (c: Candidate) => {
    if (test.orIntentFlag === 'acceptUsed' && intent.acceptUsed) return true;
    const value = typeof c.value === 'number' ? c.value * multiply : c.value;
    return passes(test, value, expected, fact);
  };
  const failing = candidates.filter((c) => !ok(c));
  if (failing.length === 0) return backed(evidenceOf(candidates));

  const first = failing[0];
  const extra: Record<string, string> = {};
  if (factId === 'condition' && first) extra.condition = String(first.value);
  if (factId === 'categorySlug' && first) extra.categorySlug = String(first.value);

  if (req.id === 'common.price_unchanged' && priceCents !== null) {
    const note = `The price changed from ${vars.priceSeen} to ${formatUsd(priceCents)}.`;
    const template = req.line?.payment;
    return {
      result: { ...base, state: 'broken', evidence: evidenceOf(failing), note },
      line: {
        lineId: `${req.id}=${priceCents}`,
        requirement: req.id,
        type: 'payment',
        text: template
          ? renderTemplate(template, { ...vars, price: formatUsd(priceCents) })
          : `${note} Is that OK?`,
      },
    };
  }
  return fail(render(extra), evidenceOf(failing));
}
