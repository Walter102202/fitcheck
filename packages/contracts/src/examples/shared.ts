// Builders for the example runs. Values come from the recorded Channel3 products of
// 2026-11-10 (fixtures/channel3/) so lanes A and C share one realistic fixture.
import type { Intent } from '../intent.js';
import { type Cents, formatUsd } from '../money.js';
import type { Cap, PaymentEvent } from '../payments.js';
import type { Evidence, RequirementResult } from '../review.js';
import type { Check } from '../runs.js';

export const RECORDED_ON = '2026-11-10';
export const FETCHED_AT = '2026-11-10T22:40:00.000Z';
export const CAP_CENTS = 300000;
export const AUTHORIZATION_ID = '0VF52814937998046';
export const NOT_CHECKED = ['shipping', 'returns', 'warranty', 'tax'];

/** Evidence on a quoted span of a field; the excerpt is cut to 160 characters around it. */
export function quoted(
  path: string,
  label: string,
  field: string,
  quote: string,
  value: Evidence['value'],
  display: string,
): Evidence {
  const at = field.indexOf(quote);
  if (at < 0) throw new Error(`Quote not found in ${path}: ${quote}`);
  let text = field;
  let start = at;
  if (field.length > 160) {
    const from = Math.max(0, Math.min(at - 40, field.length - 160));
    text = field.slice(from, from + 160);
    start = at - from;
  }
  return { path, label, text, start, end: start + quote.length, value, display };
}

/** Evidence on a whole short field (offer values, category slug). */
export function whole(
  path: string,
  label: string,
  text: string,
  value: Evidence['value'],
  display: string,
): Evidence {
  return { path, label, text, start: 0, end: text.length, value, display };
}

export function offerPrice(domain: string, cents: Cents): Evidence {
  return whole(
    'offer.price.price',
    `Store offer, ${domain}`,
    (cents / 100).toFixed(2),
    cents,
    formatUsd(cents),
  );
}

/** The checks every purchase gets, in the order lane B lists them. */
export const ALWAYS_CHECKS: Check[] = [
  {
    requirement: 'common.category_match',
    name: 'It is the kind of product asked for',
    fact: 'product type',
    origin: 'always',
  },
  {
    requirement: 'common.price_unchanged',
    name: 'Price has not changed since the agent chose it',
    fact: 'price',
    origin: 'always',
  },
  {
    requirement: 'common.amount_matches',
    name: 'Charged amount equals the offer price',
    fact: 'price',
    origin: 'always',
  },
  { requirement: 'common.in_stock', name: 'In stock', fact: 'stock', origin: 'always' },
  {
    requirement: 'common.condition_new',
    name: 'New, unless the buyer accepted used',
    fact: 'condition',
    origin: 'always',
  },
  { requirement: 'common.quantity', name: 'Quantity asked for', origin: 'always' },
  {
    requirement: 'common.merchant',
    name: 'The store is the one the agent chose and one the buyer allows',
    fact: 'store',
    origin: 'always',
  },
  { requirement: 'common.no_duplicate', name: 'Not already bought in this task', origin: 'always' },
];

/** Backed results for the always checks on one offer. */
export function alwaysBacked(
  categorySlug: string,
  categoryDisplay: string,
  domain: string,
  cents: Cents,
): RequirementResult[] {
  const price = offerPrice(domain, cents);
  const evidenceFor: Record<string, Evidence[]> = {
    'common.category_match': [
      whole('category.slug', 'Category', categorySlug, categorySlug, categoryDisplay),
    ],
    'common.price_unchanged': [price],
    'common.amount_matches': [price],
    'common.in_stock': [
      whole('offer.availability', `Store offer, ${domain}`, 'InStock', 'InStock', 'In stock'),
    ],
    'common.condition_new': [
      whole('offer.condition', `Store offer, ${domain}`, 'new', 'new', 'New'),
    ],
    'common.merchant': [whole('offer.domain', `Store offer, ${domain}`, domain, domain, domain)],
  };
  return ALWAYS_CHECKS.map((check) => ({
    ...check,
    state: 'backed' as const,
    evidence: evidenceFor[check.requirement] ?? [],
  }));
}

export function summaryOf(results: RequirementResult[]) {
  const summary = { backed: 0, unbacked: 0, never_asked: 0, contradictory: 0, broken: 0 };
  for (const { state } of results) if (state !== 'not_applicable') summary[state] += 1;
  return summary;
}

export function cap(capturedCents: Cents, heldCents: Cents): Cap {
  return {
    capId: 'cap_example',
    mode: 'sandbox',
    status: 'active',
    amountCents: CAP_CENTS,
    capturedCents,
    heldCents,
    availableCents: CAP_CENTS - capturedCents - heldCents,
    authorizationId: AUTHORIZATION_ID,
    expiresAt: '2026-12-09T22:39:00.000Z',
  };
}

export const authorizedEvent: PaymentEvent = {
  eventId: 'evt_authorized',
  type: 'authorized',
  amountCents: CAP_CENTS,
  at: '2026-11-10T22:39:00.000Z',
  sentence: 'Spending cap approved once in PayPal.',
  paypalCall: { method: 'POST', path: '/v2/checkout/orders/{id}/authorize' },
  paypalId: AUTHORIZATION_ID,
};

export function heldEvent(purchaseId: string, cents: Cents, at: string): PaymentEvent {
  return {
    eventId: `evt_held_${purchaseId}`,
    purchaseId,
    type: 'held',
    amountCents: cents,
    at,
    sentence: 'No capture sent to PayPal.',
    paypalCall: null,
  };
}

export function notCapturedEvent(purchaseId: string, cents: Cents, at: string): PaymentEvent {
  return {
    eventId: `evt_not_captured_${purchaseId}`,
    purchaseId,
    type: 'not_captured',
    amountCents: cents,
    at,
    sentence: 'No capture sent to PayPal.',
    paypalCall: null,
  };
}

export function capturedEvent(
  purchaseId: string,
  cents: Cents,
  at: string,
  captureId: string,
): PaymentEvent {
  return {
    eventId: `evt_captured_${purchaseId}`,
    purchaseId,
    type: 'captured',
    amountCents: cents,
    at,
    sentence: `PayPal captured ${formatUsd(cents)} from the spending cap.`,
    paypalCall: {
      method: 'POST',
      path: `/v2/payments/authorizations/${AUTHORIZATION_ID}/capture`,
      note: 'final_capture: false',
    },
    paypalId: captureId,
  };
}

export function capOnlyCaptured(cents: Cents) {
  return {
    outcome: 'captured' as const,
    amountCents: cents,
    sentence: `${formatUsd(cents)} is inside the cap, so it is captured the moment the agent asks. Nobody looks at the listing.`,
  };
}

export function dryerIntent(request: string, budgetCents: Cents | undefined, budgetQuote?: string) {
  const intent: Intent = {
    category: 'hair_dryer',
    request,
    quantity: 1,
    acceptUsed: false,
    stated: {},
    triggered: { 'hair_dryer.dual_voltage': { quote: 'trip to Spain' } },
    notChecked: NOT_CHECKED,
    source: 'recorded',
  };
  if (budgetCents !== undefined && budgetQuote) {
    intent.budgetCents = budgetCents;
    intent.stated['common.budget'] = { value: budgetCents, quote: budgetQuote };
  }
  return intent;
}
