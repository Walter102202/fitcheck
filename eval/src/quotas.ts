import type { Category } from '@fitcheck/contracts';
import {
  type EvalCase,
  PAYMENT_FAILURES,
  REQUIREMENT_FAILURES,
  UNBACKED_FAILURES,
} from './case-schema.js';

type Split = 'tuning' | 'heldout';

/** The failure group in a quota key: `wrong:requirement:space`, `unbacked:data:absent`. */
function groupOf(failure: string): 'requirement' | 'payment' | 'data' | null {
  if ((REQUIREMENT_FAILURES as readonly string[]).includes(failure)) return 'requirement';
  if ((PAYMENT_FAILURES as readonly string[]).includes(failure)) return 'payment';
  if ((UNBACKED_FAILURES as readonly string[]).includes(failure)) return 'data';
  return null;
}

/** `correct`, `correct_with_question`, or `<class>:<group>:<failure>`. */
export function quotaKey(c: EvalCase): string {
  const { class: cls, failure } = c.label;
  if (failure === undefined) return cls;
  return `${cls}:${groupOf(failure) ?? 'unknown'}:${failure}`;
}

const pay = (failures: string[]) =>
  Object.fromEntries(failures.map((f) => [`wrong:payment:${f}`, 1]));

/**
 * medicion.md §4 split by category (plan.md §13). Hair dryers take their requirement
 * failures from the diffuser and voltage; TVs from the wall mount and the space.
 */
export const QUOTAS: Record<Split, Record<Category, Record<string, number>>> = {
  tuning: {
    tv: {
      correct: 2,
      correct_with_question: 1,
      'wrong:requirement:compat_owned': 1,
      'wrong:requirement:stated_ignored': 1,
      ...pay(['over_budget', 'store_not_allowed']),
      'unbacked:data:contradictory': 1,
    },
    hair_dryer: {
      correct: 2,
      correct_with_question: 1,
      'wrong:requirement:never_asked_need': 1,
      'wrong:requirement:stated_ignored': 1,
      ...pay(['price_changed', 'out_of_stock_or_used']),
      'unbacked:data:absent': 1,
    },
  },
  heldout: {
    tv: {
      correct: 4,
      correct_with_question: 2,
      'wrong:requirement:compat_owned': 2,
      'wrong:requirement:space': 1,
      'wrong:requirement:stated_ignored': 1,
      ...pay(['variant', 'over_budget', 'over_cap', 'store_not_allowed']),
      'unbacked:data:contradictory': 2,
    },
    hair_dryer: {
      correct: 3,
      correct_with_question: 3,
      'wrong:requirement:never_asked_need': 2,
      'wrong:requirement:stated_ignored': 1,
      ...pay(['quantity', 'substituted', 'duplicate', 'price_changed', 'out_of_stock_or_used']),
      'unbacked:data:absent': 2,
    },
  },
};

const isPayment = (key: string) => key.startsWith('wrong:payment:');

function count(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/**
 * Quotas per category, except payment types, which are counted across both categories
 * (a payment type may move when the catalog has no product for it; the case says so in
 * `notes`). Also: unique families and unique category + request within the split, and,
 * given the other split, disjoint families and product ids.
 */
export function validateCaseSet(cases: EvalCase[], split: Split, other?: EvalCase[]): string[] {
  const errors: string[] = [];
  const families = new Set<string>();
  const requests = new Set<string>();
  for (const c of cases) {
    if (c.split !== split) errors.push(`${c.id}: split is not ${split}`);
    if (families.has(c.family)) errors.push(`${c.id}: family repeats another case in the split`);
    families.add(c.family);
    const request = `${c.category}\n${c.request}`;
    if (requests.has(request)) errors.push(`${c.id}: category and request repeat another case`);
    requests.add(request);
  }

  const quotas = QUOTAS[split];
  for (const category of ['tv', 'hair_dryer'] as const) {
    const actual = count(cases.filter((c) => c.category === category).map(quotaKey));
    const expected = quotas[category];
    for (const key of new Set([...Object.keys(expected), ...actual.keys()])) {
      if (isPayment(key)) continue;
      const want = expected[key] ?? 0;
      const got = actual.get(key) ?? 0;
      if (want !== got) errors.push(`quota ${category} ${key}: expected ${want}, got ${got}`);
    }
  }
  const paymentActual = count(cases.map(quotaKey).filter(isPayment));
  const paymentExpected = new Map<string, number>();
  for (const category of ['tv', 'hair_dryer'] as const) {
    for (const [key, n] of Object.entries(quotas[category])) {
      if (isPayment(key)) paymentExpected.set(key, (paymentExpected.get(key) ?? 0) + n);
    }
  }
  for (const key of new Set([...paymentExpected.keys(), ...paymentActual.keys()])) {
    const want = paymentExpected.get(key) ?? 0;
    const got = paymentActual.get(key) ?? 0;
    if (want !== got) errors.push(`quota ${key}: expected ${want}, got ${got}`);
  }
  for (const c of cases) {
    const key = quotaKey(c);
    if (isPayment(key) && quotas[c.category][key] === undefined && !c.notes?.trim()) {
      errors.push(`${c.id}: a payment type moved to another category needs notes`);
    }
  }

  if (other) {
    const otherFamilies = new Set(other.map((c) => c.family));
    const otherProducts = new Set(other.map((c) => c.attempt.product_id));
    for (const c of cases) {
      if (otherFamilies.has(c.family))
        errors.push(`${c.id}: family is also used in the other split`);
      if (otherProducts.has(c.attempt.product_id)) {
        errors.push(`${c.id}: product_id is also used in the other split`);
      }
    }
  }
  return errors;
}
