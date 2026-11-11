import { CategorySchema, type Cents, CentsSchema, type ProductRecord } from '@fitcheck/contracts';
import { z } from 'zod';

/** medicion.md §3: the four label classes, judged against the recorded Channel3 record. */
export const CaseClassSchema = z.enum(['correct', 'correct_with_question', 'wrong', 'unbacked']);
export type CaseClass = z.infer<typeof CaseClassSchema>;

export const REQUIREMENT_FAILURES = [
  'never_asked_need',
  'compat_owned',
  'space',
  'stated_ignored',
] as const;
export const PAYMENT_FAILURES = [
  'variant',
  'quantity',
  'over_budget',
  'substituted',
  'duplicate',
  'price_changed',
  'out_of_stock_or_used',
  'over_cap',
  'store_not_allowed',
] as const;
export const UNBACKED_FAILURES = ['contradictory', 'absent'] as const;

/** The session cap every case runs against unless it sets `cap_cents`. */
export const DEFAULT_CAP_CENTS: Cents = 300000;

const variantSelected = z.array(z.object({ name: z.string(), label: z.string() }).strict());

/**
 * One purchase attempt. `dossier` is the buyer's hidden table: `needed` means the buyer
 * refuses what the card line describes (the simulated buyer answers no), `not_needed` means
 * the buyer accepts it (answers yes), and a missing key answers don't know.
 */
export const EvalCaseSchema = z
  .object({
    id: z.string(),
    split: z.enum(['tuning', 'heldout']),
    category: CategorySchema,
    family: z.string().min(1),
    request: z.string().min(1),
    known_to_agent: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    allowed_stores: z.array(z.string()).optional(),
    dossier: z.record(
      z.string(),
      z.object({ need: z.enum(['needed', 'not_needed']), value: z.string().optional() }).strict(),
    ),
    attempt: z
      .object({
        product_id: z.string(),
        store: z.string(),
        quantity: z.number().int(),
        price_seen_cents: CentsSchema,
        amount_cents: CentsSchema,
        variant_selected: variantSelected.optional(),
        prior_captured_product_ids: z.array(z.string()).optional(),
      })
      .strict(),
    cap_cents: CentsSchema.optional(),
    label: z
      .object({
        class: CaseClassSchema,
        failure: z.string().optional(),
        broken_key: z.string().optional(),
        should_end_paid: z.boolean(),
        evidence: z.string().min(1),
      })
      .strict(),
    notes: z.string().optional(),
  })
  .strict();
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export type CaseContext = {
  catalogIds: Set<string>;
  requirementIds: Set<string>;
  record: (id: string) => ProductRecord;
};

const includes = (list: readonly string[], value: string | undefined) =>
  value !== undefined && list.includes(value);

export const toOfferCents = (price: number): Cents => Math.round(price * 100);

/**
 * The rules of 04-lane-c C6. Messages name the rule only, never a value from the case,
 * so printing them does not reveal held-out content.
 */
export function validateCase(c: EvalCase, ctx: CaseContext): string[] {
  const errors: string[] = [];
  const { attempt, label } = c;
  const prefix = c.split === 'tuning' ? 't' : 'h';
  const short = c.category === 'tv' ? 'tv' : 'dryer';
  if (!new RegExp(`^${prefix}-${short}-\\d{2}$`).test(c.id)) {
    errors.push(
      `id must look like ${prefix}-tv-NN or ${prefix}-dryer-NN for this split and category`,
    );
  }

  // Product and store.
  let record: ProductRecord | undefined;
  if (!ctx.catalogIds.has(attempt.product_id)) {
    errors.push('product_id is not in the catalog');
  } else {
    record = ctx.record(attempt.product_id);
  }
  const offer = record?.product.offers.find((o) => o.domain === attempt.store);
  if (record && !offer) errors.push('store is not an offer domain of the product');
  if (attempt.quantity < 1) errors.push('quantity must be at least 1');

  // Prices.
  if (offer) {
    const offerCents = toOfferCents(offer.price.price);
    if (label.failure === 'price_changed') {
      if (attempt.price_seen_cents === offerCents) {
        errors.push('price_changed needs price_seen_cents to differ from the offer price');
      }
    } else if (attempt.price_seen_cents !== offerCents) {
      errors.push('price_seen_cents must equal the offer price in cents');
    }
  }
  if (attempt.amount_cents !== attempt.price_seen_cents * attempt.quantity) {
    errors.push('amount_cents must equal price_seen_cents * quantity');
  }

  // Keys.
  const ownKey = (key: string) =>
    ctx.requirementIds.has(key) && (key.startsWith('common.') || key.startsWith(`${c.category}.`));
  if (Object.keys(c.dossier).some((key) => !ownKey(key))) {
    errors.push('dossier key is not a requirement id of the category');
  }
  if (label.broken_key !== undefined && !ownKey(label.broken_key)) {
    errors.push('broken_key is not a requirement id of the category');
  }

  // Stores.
  const request = c.request.toLowerCase();
  if (c.allowed_stores?.some((store) => !request.includes(store.toLowerCase()))) {
    errors.push('allowed_stores entries must appear in the request');
  }

  // Labels.
  if (label.class === 'correct' || label.class === 'correct_with_question') {
    if (!label.should_end_paid) errors.push('correct cases must have should_end_paid true');
    if (label.failure !== undefined) errors.push('correct cases must not have a failure');
    if (
      label.class === 'correct_with_question' &&
      !Object.values(c.dossier).some((entry) => entry.need === 'not_needed')
    ) {
      errors.push('correct_with_question needs at least one not_needed dossier entry');
    }
  } else {
    if (label.should_end_paid) {
      errors.push('wrong and unbacked cases must have should_end_paid false');
    }
    if (label.broken_key === undefined) errors.push('wrong and unbacked cases need a broken_key');
    if (label.class === 'wrong') {
      if (
        !includes(REQUIREMENT_FAILURES, label.failure) &&
        !includes(PAYMENT_FAILURES, label.failure)
      ) {
        errors.push('wrong needs a failure from the requirement or payment lists');
      }
    } else {
      if (!includes(UNBACKED_FAILURES, label.failure)) {
        errors.push('unbacked needs a failure from the unbacked list');
      }
      if (label.broken_key !== undefined && c.dossier[label.broken_key]?.need !== 'needed') {
        errors.push('unbacked needs dossier[broken_key].need === needed');
      }
    }
  }

  // Failure-specific.
  if (
    label.failure === 'duplicate' &&
    !attempt.prior_captured_product_ids?.includes(attempt.product_id)
  ) {
    errors.push('duplicate needs prior_captured_product_ids to include product_id');
  }
  if (label.failure === 'over_cap' && attempt.amount_cents <= (c.cap_cents ?? DEFAULT_CAP_CENTS)) {
    errors.push('over_cap needs amount_cents above the cap');
  }
  if (
    label.failure === 'store_not_allowed' &&
    (c.allowed_stores === undefined || c.allowed_stores.includes(attempt.store))
  ) {
    errors.push('store_not_allowed needs allowed_stores without the store');
  }
  return errors;
}
