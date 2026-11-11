import { type Cents, formatUsd } from './money.js';

/**
 * The ledger's sentences when the spending cap stops a purchase. The backend writes them into the
 * PayPal events and the message to the agent ("Not paid. <sentence>"); the web app reads them back
 * to offer Start over. One copy, so a wording change cannot silently drop that.
 */
export function capShortSentence(available: Cents): string {
  return `The spending cap has ${formatUsd(available)} left.`;
}

export const CAP_INACTIVE_SENTENCE = 'The spending cap is no longer active.';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const [shortHead = '', shortTail = ''] = capShortSentence(0).split(formatUsd(0));
const SHORT_AT_END = new RegExp(`${escapeRe(shortHead)}\\$[\\d,]+\\.\\d{2}${escapeRe(shortTail)}$`);

/** Which cap sentence a message ends with: too little left, no longer active, or neither. */
export function capStopIn(text: string): 'short' | 'inactive' | null {
  if (text.endsWith(CAP_INACTIVE_SENTENCE)) return 'inactive';
  if (SHORT_AT_END.test(text)) return 'short';
  return null;
}
