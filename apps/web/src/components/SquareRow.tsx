import type { SquareState } from '@fitcheck/contracts';
import styles from './SquareRow.module.css';

/** One row of unit squares: each square is one purchase. */
export function SquareRow({
  who,
  squares,
  count,
  of,
  label,
}: {
  who: string;
  squares: SquareState[];
  count: number | null;
  of: number;
  label: string;
}) {
  const measured = count !== null;
  return (
    <div className={styles.unitRow}>
      <span className={styles.who}>{who}</span>
      <span
        className={styles.squares}
        role="img"
        aria-label={measured ? `${count} of ${of}: ${label}` : `Not measured yet: ${label}`}
      >
        {squares.map((state, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: squares are positional and never reorder
          <i key={i} className={styles.sq} data-state={state} />
        ))}
      </span>
      <span className={styles.count} {...(measured ? {} : { 'data-pending': '' })}>
        {measured ? `${count} of ${of}` : 'Not measured yet'}
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
