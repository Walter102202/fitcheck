// Test-only helpers: recorded products, intents and purchases.
import {
  type Category,
  type Channel3Product,
  formatUsd,
  type Intent,
  type ProductRecord,
  type ReviewInput,
} from '@fitcheck/contracts';
import { listRecordedProducts, readRecordedProduct } from '../channel3/fixtures.js';
import { chosenOffer, contextFor, type ProductContext } from './paths.js';

export function recordedProduct(id: string): ProductRecord {
  const r = readRecordedProduct(id);
  if (!r) throw new Error(`No recorded product ${id}`);
  return r;
}

let all: ProductRecord[] | null = null;

/** Every recorded product of a Channel3 category slug. */
export function allRecorded(category: 'televisions' | 'hair-dryers'): ProductRecord[] {
  all ??= listRecordedProducts();
  return all.filter((r) => r.product.category?.slug === category);
}

/** A deep copy of the record, with the product patched. */
export function withProduct(
  record: ProductRecord,
  patch: (p: Channel3Product) => void,
): ProductRecord {
  const copy = structuredClone(record);
  patch(copy.product);
  return copy;
}

export function ctxFor(id: string, domain: string): ProductContext {
  return contextFor(recordedProduct(id).product, domain);
}

export function intentFor(
  category: Category,
  request: string,
  parts: {
    stated?: Intent['stated'];
    triggered?: Intent['triggered'];
    budgetCents?: number;
    acceptUsed?: boolean;
    stores?: string[];
    quantity?: number;
  } = {},
): Intent {
  const stated: Intent['stated'] = { ...(parts.stated ?? {}) };
  if (parts.budgetCents !== undefined) {
    stated['common.budget'] = { value: parts.budgetCents, quote: formatUsd(parts.budgetCents) };
  }
  return {
    category,
    request,
    ...(parts.budgetCents !== undefined ? { budgetCents: parts.budgetCents } : {}),
    quantity: parts.quantity ?? 1,
    acceptUsed: parts.acceptUsed ?? false,
    ...(parts.stores ? { stores: parts.stores } : {}),
    stated,
    triggered: parts.triggered ?? {},
    notChecked: [],
    source: 'recorded',
  };
}

/** purchaseId 'pur_test', taskId 'task_test', quantity 1, both amounts = the offer price (0 without an offer). */
export function purchaseFor(
  record: ProductRecord,
  domain: string,
  overrides: Partial<ReviewInput['purchase']> = {},
): ReviewInput['purchase'] {
  const offer = chosenOffer(record.product, domain);
  const cents = offer ? Math.round(offer.price.price * 100) : 0;
  return {
    purchaseId: 'pur_test',
    taskId: 'task_test',
    productId: record.product.id,
    domain,
    quantity: 1,
    priceSeenCents: cents,
    amountCents: cents,
    ...overrides,
  };
}
