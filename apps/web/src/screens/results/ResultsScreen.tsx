import type { ResultsJson } from '@fitcheck/contracts';
import type { FitcheckApi } from '../../api/types.js';
import { useQuery } from '../../api/use-query.js';
import { Button } from '../../components/Button.js';
import { SquareLegend } from '../../components/SquareRow.js';
import { ResultsMetrics } from './ResultsMetrics.js';
import styles from './ResultsScreen.module.css';

// Lane C confirms the command at integration.
const REPLAY_COMMAND = 'pnpm measure --replay';

const loadResults = (api: FitcheckApi) => api.getResults();

function measuredLine(results: ResultsJson): string {
  if (!results.measuredAt) return 'The held-out run has not been committed yet.';
  const commit = results.heldOutCommit
    ? ` Held-out set committed in ${results.heldOutCommit.slice(0, 7)}.`
    : '';
  return `Measured on ${results.measuredAt.slice(0, 10)} with ${results.model}.${commit}`;
}

/** The held-out measurement: unit squares, counts, and what it does not show. */
export function ResultsScreen() {
  const results = useQuery(loadResults, 'results');
  const data = results.data;
  const pending = data
    ? data.rows.some((r) => [...r.squares.capOnly, ...r.squares.fitcheck].includes('pending'))
    : false;

  return (
    <div className="wrap">
      <div className={styles.head}>
        <h1 className={styles.title}>Does it work? 32 purchases Fitcheck had never seen.</h1>
        <p className={styles.lede}>
          A separate agent wrote the 32 attempts without access to the reviewer. A person checked
          every label. They were committed before the reviewer first ran on them. Each attempt ran 3
          times; a wrong purchase counts as paid if it was paid in any of the 3 runs.
        </p>
        {data && (
          <>
            <SquareLegend pending={pending} />
            <p className="note">{measuredLine(data)}</p>
          </>
        )}
      </div>

      {results.error && !data ? (
        <div className={styles.error} role="alert">
          <p>The results did not load.</p>
          <Button onClick={() => void results.refetch()}>Try again</Button>
        </div>
      ) : data ? (
        <div className={`sheet ${styles.sheet}`}>
          <ResultsMetrics rows={data.rows} headingLevel={2} />
          <div className={styles.limits}>
            <h2>What this does not show</h2>
            {data.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <p className="note mono">Reproduce without any key: {REPLAY_COMMAND}</p>
          </div>
        </div>
      ) : (
        <p role="status">Loading the results…</p>
      )}
    </div>
  );
}
