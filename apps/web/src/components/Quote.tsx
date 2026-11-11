import type { Evidence } from '@fitcheck/contracts';
import type { CSSProperties } from 'react';
import styles from './Quote.module.css';

export type Tone = 'backed' | 'broken' | 'clash';

/** A CSS custom property for the reveal delay, or nothing to keep the stylesheet default. */
export function delayStyle(ms: number | undefined): CSSProperties | undefined {
  return ms === undefined ? undefined : ({ '--d': `${ms}ms` } as CSSProperties);
}

/** A field of the product record, quoted, with the cited range highlighted. */
export function Quote({
  evidence,
  tone,
  markDelayMs,
}: {
  evidence: Evidence;
  tone: Tone;
  markDelayMs?: number;
}) {
  const { text } = evidence;
  const s = Math.min(Math.max(evidence.start, 0), text.length);
  const e = Math.min(Math.max(evidence.end, s), text.length);
  return (
    <figure className={styles.cite} data-tone={tone}>
      <div className={styles.head}>
        {evidence.label} <span className={styles.path}>{evidence.path}</span>
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
