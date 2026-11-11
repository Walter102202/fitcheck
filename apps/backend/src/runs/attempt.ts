import type {
  AgentPick,
  Answer,
  Attempt,
  Intent,
  ProductRecord,
  ReviewResult,
  TaskMemory,
} from '@fitcheck/contracts';
import { toCents } from '../agent/scripted-agent.js';
import { AppError } from '../api/errors.js';
import type { Deps } from '../deps.js';
import { getCap } from '../ledger/caps.js';
import { SENTENCES } from '../ledger/events.js';
import {
  capturePurchase,
  holdPurchase,
  type LedgerResult,
  purchaseFor,
  refusePurchase,
  releaseHold,
} from '../ledger/purchases.js';
import { capOnlyCheck, capOnlyReview } from './cap-only.js';
import type { UnavailableReason } from './ports.js';

export const COULD_NOT_CHECK = 'Fitcheck could not check this listing.';
export const NEW_CAP_NOTICE = 'Approve a new spending cap to keep buying.';

export type AttemptInput = {
  runId: string;
  capId: string;
  attemptNo: number;
  reviewMode: 'on' | 'off';
  intent: Intent;
  pick: AgentPick;
  quantity: number;
  variantSelected?: { name: string; label: string }[];
  memory: TaskMemory;
  capturedProductIds: string[];
  allowedStores?: string[];
  /** The record the agent picked from; it stands in when the re-fetch fails. */
  pickRecord?: ProductRecord;
  /** The intent could not be read: with review on, this attempt fails closed. */
  intentUnavailable?: UnavailableReason;
};
export type AttemptOutcome = {
  attempt: Attempt;
  endedBy: 'capture' | 'review' | 'answers' | 'cap' | 'waiting';
  purchaseId: string;
  memory: TaskMemory;
  notices: string[];
};

/** How a ledger result ends the attempt. `review` is kept on the attempt as decided. */
function fromLedger(
  base: Omit<Attempt, 'review' | 'outcome'> & { review: ReviewResult },
  result: LedgerResult,
  memory: TaskMemory,
): AttemptOutcome {
  const common = { purchaseId: result.purchaseId, memory };
  if (result.outcome === 'captured' || result.outcome === 'pending') {
    return {
      ...common,
      attempt: { ...base, outcome: { decision: 'capture', amountCents: result.amountCents } },
      endedBy: 'capture',
      notices: [],
    };
  }
  // The ledger refused what the review allowed: the cap is short, inactive, or PayPal declined.
  const sentence = result.event.sentence;
  const notices = [sentence];
  if (result.cap.status === 'expired' || result.cap.status === 'voided') {
    notices.push(NEW_CAP_NOTICE);
  }
  return {
    ...common,
    attempt: {
      ...base,
      outcome: {
        decision: 'return_to_agent',
        amountCents: 0,
        agentMessage: `Not paid. ${sentence}`,
      },
    },
    endedBy: 'cap',
    notices,
  };
}

/**
 * One agent pick, end to end: re-fetch the record, run the review (or the cap-only check),
 * and move money in the ledger. The capture amount comes from the re-fetched offer, never
 * from the agent's word, unless the review is off.
 */
export async function processAttempt(d: Deps, i: AttemptInput): Promise<AttemptOutcome> {
  const notices: string[] = [];
  const amountCents = i.pick.priceCents * i.quantity;
  let record: ProductRecord | undefined;
  let refetchFailed = false;
  try {
    record = await d.channel3.getProduct(i.pick.productId);
    const notice = d.channel3.noticeFor(record);
    if (notice) notices.push(notice);
  } catch (error) {
    const reason = d.review.unavailableReason(error);
    if (reason === null || (i.reviewMode === 'off' && !i.pickRecord)) throw error;
    d.logger.warn('runs.refetch_unavailable', { productId: i.pick.productId, reason });
    refetchFailed = true;
    record = i.pickRecord;
  }

  const purchaseId = d.newId();
  const cap = await getCap(d, i.capId);
  const offer = record?.product.offers.find((o) => o.domain === i.pick.domain);
  const capOnly = capOnlyCheck({
    cap,
    amountCents,
    currency: offer?.price.currency ?? 'USD',
    domain: i.pick.domain,
    ...(i.allowedStores ? { allowedStores: i.allowedStores } : {}),
  });
  const ref = {
    capId: i.capId,
    purchaseId,
    runId: i.runId,
    attemptNo: i.attemptNo,
    productId: i.pick.productId,
    domain: i.pick.domain,
  };
  const withNotices = (out: AttemptOutcome): AttemptOutcome => ({
    ...out,
    notices: [...notices, ...out.notices],
  });

  if (i.reviewMode === 'off') {
    const review = capOnlyReview(record, capOnly);
    const base = { attemptNo: i.attemptNo, pick: i.pick, capOnly, review };
    if (capOnly.outcome !== 'captured') {
      await refusePurchase(d, {
        ...ref,
        amountCents,
        sentence: capOnly.sentence,
        reason: 'cap_short',
      });
      return withNotices({
        attempt: {
          ...base,
          outcome: {
            decision: 'return_to_agent',
            amountCents: 0,
            agentMessage: `Not paid. ${capOnly.sentence}`,
          },
        },
        endedBy: 'cap',
        purchaseId,
        memory: i.memory,
        notices: [],
      });
    }
    return withNotices(
      fromLedger(base, await capturePurchase(d, { ...ref, amountCents }), i.memory),
    );
  }

  const review: ReviewResult =
    i.intentUnavailable || refetchFailed || !record
      ? d.review.failClosed(d.now(), record)
      : await d.review.review({
          intent: i.intent,
          record,
          purchase: {
            purchaseId,
            taskId: i.runId,
            productId: i.pick.productId,
            domain: i.pick.domain,
            quantity: i.quantity,
            priceSeenCents: i.pick.priceCents,
            amountCents,
            ...(i.variantSelected ? { variantSelected: i.variantSelected } : {}),
          },
          memory: i.memory,
          capturedProductIds: i.capturedProductIds,
        });
  const base = { attemptNo: i.attemptNo, pick: i.pick, capOnly, review };
  const returned = (agentMessage: string): AttemptOutcome => ({
    attempt: { ...base, outcome: { decision: 'return_to_agent', amountCents: 0, agentMessage } },
    endedBy: 'review',
    purchaseId,
    memory: i.memory,
    notices: [],
  });
  const offerCents = offer ? toCents(offer.price.price) * i.quantity : null;

  if (
    review.failedClosed ||
    review.decision === 'return_to_agent' ||
    (review.decision === 'capture' && offerCents === null)
  ) {
    await refusePurchase(d, { ...ref, amountCents, sentence: SENTENCES.notSent, reason: 'review' });
    const message =
      review.decision === 'capture' ? COULD_NOT_CHECK : (review.agentMessage ?? COULD_NOT_CHECK);
    return withNotices(returned(message));
  }
  if (review.decision === 'capture') {
    const result = await capturePurchase(d, { ...ref, amountCents: offerCents ?? amountCents });
    return withNotices(fromLedger(base, result, i.memory));
  }
  // ask: hold the amount until the buyer answers.
  const held = await holdPurchase(d, { ...ref, amountCents: offerCents ?? amountCents });
  if (held.outcome !== 'held') return withNotices(fromLedger(base, held, i.memory));
  return withNotices({
    attempt: base,
    endedBy: 'waiting',
    purchaseId,
    memory: i.memory,
    notices: [],
  });
}

/** The buyer's answers to a held attempt: capture if every line is yes, else release. */
export async function answerAttempt(
  d: Deps,
  i: {
    runId: string;
    capId: string;
    attempt: Attempt;
    answers: Record<string, Answer>;
    memory: TaskMemory;
  },
): Promise<AttemptOutcome> {
  const card = i.attempt.review.card;
  if (!card)
    throw new AppError('answers_not_expected', 'This purchase has no question card.', {
      status: 409,
    });
  const applied = d.review.applyAnswers(card, i.answers, i.memory);
  const purchase = await purchaseFor(d.db, { runId: i.runId, attemptNo: i.attempt.attemptNo });
  const base = { ...i.attempt, answers: i.answers };
  if (applied.decision === 'capture') {
    const result = await capturePurchase(d, {
      capId: purchase.capId,
      purchaseId: purchase.id,
      runId: purchase.runId,
      attemptNo: purchase.attemptNo,
      productId: purchase.productId,
      domain: purchase.domain,
      amountCents: purchase.amountCents,
      fromHold: true,
    });
    return fromLedger(base, result, applied.memory);
  }
  await releaseHold(d, { purchaseId: purchase.id });
  return {
    attempt: {
      ...base,
      outcome: {
        decision: 'return_to_agent',
        amountCents: 0,
        agentMessage: applied.agentMessage ?? 'Not paid. The buyer did not say yes to every line.',
      },
    },
    endedBy: 'answers',
    purchaseId: purchase.id,
    memory: applied.memory,
    notices: [],
  };
}
