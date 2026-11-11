import type { Evidence } from '@fitcheck/contracts';
import type { CSSProperties } from 'react';
import styles from './Quote.module.css';

export type Tone = 'backed' | 'broken' | 'clash';

/** A CSS custom property for the reveal delay, or nothing to keep the stylesheet default. */
export function delayStyle(ms: number | undefined): CSSProperties | undefined {
  return ms === undefined ? undefined : ({ '--d': `${ms}ms` } as CSSProperties);
}

/**
 * A field of the product record, quoted, with the cited range highlighted. The head names the
 * field and its record path (`field`), or, for a reader with no context such as the Home
 * specimen, says it comes from the store's listing and leaves the path out (`listing`).
 */
export function Quote({
  evidence,
  tone,
  markDelayMs,
  head = 'field',
}: {
  evidence: Evidence;
  tone: Tone;
  markDelayMs?: number;
  head?: 'field' | 'listing';
}) {
  const { text } = evidence;
  const s = Math.min(Math.max(evidence.start, 0), text.length);
  const e = Math.min(Math.max(evidence.end, s), text.length);
  return (
    <figure className={styles.cite} data-tone={tone}>
      <div className={styles.head}>
        {head === 'listing' ? (
          `${evidence.label}, from the store’s listing`
        ) : (
          <>
            {evidence.label} <span className={styles.path}>{evidence.path}</span>
          </>
        )}
      </div>
      <blockquote>
        {text.slice(0, s)}
        {e > s && (
          <mark data-tone={tone} style={delayStyle(markDelayMs)}>
            {text.slice(s, e)}
          </mark>
        )}
        {text.slice(e)}
      </blockquote>
    </figure>
  );
}

/** Nothing to quote: the fields Fitcheck searched and found silent. */
export function QuoteNone({ fact, searched }: { fact?: string; searched?: string[] }) {
  return (
    <figure className={styles.cite} data-tone="none">
      <div className={styles.head}>Looked in, found nothing about {fact ?? 'this'}</div>
      {searched && searched.length > 0 && (
        <ul className={styles.looked}>
          {searched.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      )}
    </figure>
  );
}
