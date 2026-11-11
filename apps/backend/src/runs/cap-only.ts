import {
  type Attempt,
  type Cap,
  type Cents,
  formatUsd,
  type ProductRecord,
  type ReviewResult,
} from '@fitcheck/contracts';
import { SENTENCES } from '../ledger/events.js';

/**
 * The "spending cap only" baseline: pay anything inside what is left of the cap, in USD, at an
 * allowed store. Nobody looks at the listing.
 */
export function capOnlyCheck(i: {
  cap: Cap;
  amountCents: Cents;
  currency: string;
  domain: string;
  allowedStores?: string[];
}): Attempt['capOnly'] {
  const refuse = (sentence: string) => ({
    outcome: 'not_captured' as const,
    amountCents: i.amountCents,
    sentence,
  });
  if (i.allowedStores && !i.allowedStores.includes(i.domain)) {
    return refuse(`${i.domain} is not a store you allowed.`);
  }
  if (i.currency !== 'USD') return refuse(`The offer is in ${i.currency}. The cap is in USD.`);
  if (i.cap.status !== 'active' || i.amountCents > i.cap.availableCents) {
    return refuse(
      i.cap.status === 'active' ? SENTENCES.capShort(i.cap.availableCents) : SENTENCES.capInactive,
    );
  }
  const amount = formatUsd(i.amountCents);
  return {
    outcome: 'captured',
    amountCents: i.amountCents,
    sentence: `${amount} is inside the cap, so it is captured the moment the agent asks. Nobody looks at the listing.`,
  };
}

const ZERO = { backed: 0, unbacked: 0, never_asked: 0, contradictory: 0, broken: 0 };

/** The attempt's review when the review is switched off: the cap-only verdict, nothing checked. */
export function capOnlyReview(
  record: ProductRecord | undefined,
  capOnly: Attempt['capOnly'],
): ReviewResult {
  const meta = record
    ? {
        record: {
          fetchedAt: record.fetchedAt,
          source: record.source,
          ...(record.recordedOn ? { recordedOn: record.recordedOn } : {}),
        },
      }
    : {};
  if (capOnly.outcome === 'captured') {
    return { decision: 'capture', results: [], summary: ZERO, reasons: [], ...meta };
  }
  return {
    decision: 'return_to_agent',
    results: [],
    agentMessage: `Not paid. ${capOnly.sentence}`,
    summary: ZERO,
    reasons: [],
    ...meta,
  };
}
