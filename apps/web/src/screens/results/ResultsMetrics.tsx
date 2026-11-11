import type { ResultsRow } from '@fitcheck/contracts';
import { SquareRow } from '../../components/SquareRow.js';
import styles from './ResultsMetrics.module.css';

/** Every measured metric: the same purchases with a spending cap only, and with Fitcheck. */
export function ResultsMetrics({
  rows,
  headingLevel,
}: {
  rows: ResultsRow[];
  headingLevel: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <>
      {rows.map((row) => {
        const unit = row.unit ? { unit: row.unit } : {};
        return (
          <div key={row.id} className={styles.metric}>
            <Heading>{row.label}</Heading>
            <div className={styles.units}>
              <SquareRow
                who="Spending cap only"
                squares={row.squares.capOnly}
                count={row.capOnly}
                of={row.of}
                label={row.label}
                {...unit}
              />
              <SquareRow
                who="Fitcheck"
                squares={row.squares.fitcheck}
                count={row.fitcheck}
                of={row.of}
                label={row.label}
                {...unit}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}
