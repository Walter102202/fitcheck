import type { Category, ReviewResult } from '@fitcheck/contracts';

const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** 24 h, HH:MM:SS, in the browser's time zone. */
export function formatClock(iso: string): string {
  return clock.format(new Date(iso));
}

export function productNoun(category: Category): string {
  return category === 'tv' ? 'TV' : 'hair dryer';
}

/** "3 backed, 1 broken." in a fixed order; only backed reads "Everything is backed." */
export function summaryLine(s: ReviewResult['summary']): string {
  const parts: string[] = [];
  if (s.backed) parts.push(`${s.backed} backed`);
  if (s.broken) parts.push(`${s.broken} broken`);
  if (s.contradictory)
    parts.push(`${s.contradictory} ${s.contradictory === 1 ? 'disagrees' : 'disagree'}`);
  if (s.unbacked) parts.push(`${s.unbacked} not in the listing`);
  if (s.never_asked) parts.push(`${s.never_asked} nobody asked`);
  if (s.backed && parts.length === 1) return 'Everything is backed.';
  return `${parts.join(', ')}.`;
}

const ORDINAL = ['First', 'Second', 'Third'];

export function pickLabel(attemptNo: number): string {
  const word = ORDINAL[attemptNo - 1];
  return word ? `${word} pick` : `Pick ${attemptNo}`;
}
