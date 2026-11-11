import type { Evidence } from '@fitcheck/contracts';
import styles from './ContradictionPair.module.css';
import { EqualNot, ICON_PROPS } from './icons.js';
import { Quote } from './Quote.js';

function Side({ evidence, markDelayMs }: { evidence: Evidence; markDelayMs?: number }) {
  return (
    <div className={styles.side}>
      <Quote
        evidence={evidence}
        tone="clash"
        {...(markDelayMs === undefined ? {} : { markDelayMs })}
      />
      <div className={styles.reads}>
        reads as <b>{evidence.display}</b>
      </div>
    </div>
  );
}

/** Two quotes from the same listing that disagree, side by side. */
export function ContradictionPair({
  left,
  right,
  markDelayMs,
}: {
  left: Evidence;
  right: Evidence;
  markDelayMs?: number;
}) {
  const second = markDelayMs === undefined ? undefined : markDelayMs + 300;
  return (
    <div className={styles.versus}>
      <Side evidence={left} {...(markDelayMs === undefined ? {} : { markDelayMs })} />
      <div className={styles.neq} role="img" aria-label="is not equal to">
        <EqualNot {...ICON_PROPS} size={20} strokeWidth={2.4} />
      </div>
      <Side evidence={right} {...(second === undefined ? {} : { markDelayMs: second })} />
    </div>
  );
}
