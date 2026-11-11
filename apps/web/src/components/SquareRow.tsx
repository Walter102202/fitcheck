import type { SquareState } from '@fitcheck/contracts';
import styles from './SquareRow.module.css';

type Missing = 'not_measured' | 'does_not_apply';

/** The count column: "14 of 16" for a count, "1.2" for a mean; words when there is no number. */
function countText(
  count: number | null,
  of: number,
  unit: 'count' | 'mean',
  missing: Missing,
): string {
  if (count === null) return missing === 'does_not_apply' ? 'Does not apply' : 'Not measured yet';
  return unit === 'mean' ? String(count) : `${count} of ${of}`;
}

/** One row of unit squares: each square is one purchase. */
export function SquareRow({
  who,
  squares,
  count,
  of,
  label,
  unit = 'count',
  missing = 'not_measured',
}: {
  who: string;
  squares: SquareState[];
  count: number | null;
  of: number;
  label: string;
  /** From the results row; absent means a count. */
  unit?: 'count' | 'mean';
  /** What a null count means here: the cap-only column of a mean row does not apply. */
  missing?: Missing;
}) {
  const text = countText(count, of, unit, missing);
  return (
    <div className={styles.unitRow}>
      <span className={styles.who}>{who}</span>
      <span className={styles.squares} role="img" aria-label={`${text}: ${label}`}>
        {squares.map((state, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: squares are positional and never reorder
          <i key={i} className={styles.sq} data-state={state} />
        ))}
      </span>
      <span className={styles.count} {...(count === null ? { 'data-pending': '' } : {})}>
        {text}
      </span>
    </div>
  );
}

const LEGEND: { state: SquareState; text: string }[] = [
  { state: 'paid_bad', text: 'Happened, and it is bad' },
  { state: 'paid_good', text: 'Happened, and it is good' },
  { state: 'not_paid', text: 'Did not happen' },
];

export function SquareLegend({ pending }: { pending: boolean }) {
  const items = pending
    ? [...LEGEND, { state: 'pending' as const, text: 'Not measured yet' }]
    : LEGEND;
  return (
    <div className={styles.legend}>
      {items.map((item) => (
        <span key={item.state}>
          <i className={styles.sq} data-state={item.state} />
          {item.text}
        </span>
      ))}
    </div>
  );
}
