import type { RequirementResult } from '@fitcheck/contracts';
import type { CSSProperties } from 'react';
import { markDelayMs, rowDelayMs } from '../lib/motion.js';
import { ContradictionPair } from './ContradictionPair.js';
import { Quote, QuoteNone } from './Quote.js';
import { RequirementChip } from './RequirementChip.js';
import styles from './RequirementRow.module.css';

function Evidence({ result, delay }: { result: RequirementResult; delay: number }) {
  const { state, evidence } = result;
  const none = (
    <QuoteNone
      {...(result.fact === undefined ? {} : { fact: result.fact })}
      {...(result.searched === undefined ? {} : { searched: result.searched })}
    />
  );
  const quotes = (tone: 'backed' | 'broken' | 'clash', items = evidence) => (
    <>
      {items.map((ev) => (
        <Quote key={`${ev.path}:${ev.start}`} evidence={ev} tone={tone} markDelayMs={delay} />
      ))}
    </>
  );

  switch (state) {
    case 'backed':
      return quotes('backed');
    case 'broken':
      return quotes('broken');
    case 'contradictory': {
      const [left, right, ...rest] = evidence;
      if (!left || !right) return quotes('clash');
      return (
        <>
          <ContradictionPair left={left} right={right} markDelayMs={delay} />
          {quotes('clash', rest)}
        </>
      );
    }
    case 'unbacked':
      return none;
    case 'never_asked':
      return evidence.length > 0 ? quotes('backed') : none;
    default:
      return null;
  }
}

/** One requirement: its state, its name, and the listing's words about it. */
export function RequirementRow({ result, index }: { result: RequirementResult; index: number }) {
  if (result.state === 'not_applicable') return null;
  const wide = result.state === 'contradictory' && result.evidence.length >= 2;
  return (
    <div
      className={styles.check}
      style={{ '--d': `${rowDelayMs(index)}ms` } as CSSProperties}
      {...(result.state === 'backed' ? {} : { 'data-flag': '' })}
      {...(wide ? { 'data-wide': '' } : {})}
    >
      <span>
        <RequirementChip state={result.state} />
      </span>
      <div className={styles.req}>
        <b>{result.name}</b>
        {result.note && <span>{result.note}</span>}
      </div>
      <div className={styles.evidence}>
        <Evidence result={result} delay={markDelayMs(index)} />
      </div>
    </div>
  );
}
