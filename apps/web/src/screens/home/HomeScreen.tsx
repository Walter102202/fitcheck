import { runDryerSpain } from '@fitcheck/contracts';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAppConfig } from '../../api/config.js';
import type { FitcheckApi } from '../../api/types.js';
import { useQuery } from '../../api/use-query.js';
import { Button, ButtonLink } from '../../components/Button.js';
import { PaymentChip } from '../../components/PaymentChip.js';
import { RequirementChip } from '../../components/RequirementChip.js';
import { ScenarioRow } from '../../components/ScenarioRow.js';
import { SquareRow } from '../../components/SquareRow.js';
import { RESET_NOTICE, StartOverButton } from '../../components/StartOver.js';
import { heroLine } from '../../lib/model.js';
import styles from './HomeScreen.module.css';
import { Specimen } from './Specimen.js';

const loadScenarios = (api: FitcheckApi) => api.getScenarios();
const loadResults = (api: FitcheckApi) => api.getResults();

const COUNT_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

/** After Start over: confirm it once, and drop the flag so a reload does not repeat it. */
function useResetNotice(): boolean {
  const [params, setParams] = useSearchParams();
  const flagged = params.get('reset') === 'done';
  const [shown] = useState(flagged);
  useEffect(() => {
    if (flagged) setParams({}, { replace: true });
  }, [flagged, setParams]);
  return shown;
}

export function HomeScreen() {
  const config = useAppConfig().data;
  const resetDone = useResetNotice();
  const scenarios = useQuery(loadScenarios, 'scenarios');
  const results = useQuery(loadResults, 'results');
  const list = scenarios.data ?? [];
  const firstRow = results.data?.rows[0];

  // The count only once the list is in: "No purchases" while loading or after a failure is false.
  const purchases = scenarios.data
    ? `${COUNT_WORD[list.length] ?? list.length} purchases made by a scripted shopping agent.`
    : '';
  const records = config
    ? `Product records come ${config.channel3Mode === 'live' ? 'live from Channel3' : 'from a recorded Channel3 copy'}.`
    : '';
  const payments = !config
    ? ''
    : config.paypalMode === 'sandbox'
      ? 'Payments run on the PayPal sandbox: you approve the cap once with the test buyer shown on the next screen.'
      : 'Payments run on simulated PayPal: you approve the cap once on the next screen.';
  const purchasesSub = [purchases, records, payments].filter(Boolean).join(' ');

  return (
    <div className="wrap">
      {resetDone && (
        <p className={styles.resetNotice} role="status">
          {RESET_NOTICE}
        </p>
      )}
      <section className={styles.hero}>
        <div>
          <h1>Your agent can pay. Fitcheck checks what it’s paying for.</h1>
          <p className={styles.lede}>
            A shopping agent picks a product for you. Before PayPal captures the money, Fitcheck
            fetches the product record again and checks every requirement you have, including the
            ones nobody asked about. Each one has to be backed by a line of the store’s listing.
          </p>
          {/* The box keeps its room while /api/config loads, so the button below does not jump. */}
          <p className={styles.engine} data-testid="hero-engine">
            {config && heroLine(config.reviewModel, config.reviewSource)}
          </p>
          <div className={styles.actions}>
            <ButtonLink to={`/run/${list[0]?.id ?? 'dryer-spain'}`}>
              Run the first purchase
            </ButtonLink>
            <span className="note">
              No account of your own and no key needed. Takes about a minute.
            </span>
          </div>
        </div>
        <Specimen run={runDryerSpain} />
      </section>

      <section className={styles.band} aria-labelledby="home-outcomes">
        <h2 id="home-outcomes">Three things can happen at the payment</h2>
        <p className={styles.sub}>
          The buyer approves one spending cap in PayPal. Every purchase the agent makes is checked
          before any of that money is captured.
        </p>
        <div className={styles.outcomes}>
          <div className={styles.outcomeDef}>
            <span className={styles.chips}>
              <RequirementChip state="backed" />
            </span>
            <h3>The listing backs every requirement</h3>
            <p>
              PayPal captures the price of that purchase from the cap. The buyer is not asked
              anything.
            </p>
            <span className={styles.pay}>
              <PaymentChip state="captured" />
            </span>
          </div>
          <div className={styles.outcomeDef}>
            <span className={styles.chips}>
              <RequirementChip state="unbacked" />
              <RequirementChip state="contradictory" />
            </span>
            <h3>The listing is silent, or disagrees with itself</h3>
            <p>
              The payment waits. The buyer gets one card with up to three lines, each answered yes,
              no or don’t know.
            </p>
            <span className={styles.pay}>
              <PaymentChip state="held" />
            </span>
          </div>
          <div className={styles.outcomeDef}>
            <span className={styles.chips}>
              <RequirementChip state="broken" />
            </span>
            <h3>The listing breaks a requirement</h3>
            <p>
              Nothing is captured and the buyer is not bothered. The purchase goes back to the agent
              with the reason.
            </p>
            <span className={styles.pay}>
              <PaymentChip state="not_captured" />
            </span>
          </div>
        </div>
      </section>

      <section className={styles.band} aria-labelledby="home-purchases">
        <h2 id="home-purchases">Run a purchase</h2>
        {purchasesSub && <p className={styles.sub}>{purchasesSub}</p>}
        {scenarios.error && !scenarios.data && (
          <div className={styles.loadError} role="alert">
            <p>The purchases did not load.</p>
            <Button variant="quiet" size="small" onClick={() => void scenarios.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {list.length > 0 && (
          <div className={styles.scenarios} data-testid="scenarios">
            {list.map((scenario, i) => (
              <ScenarioRow
                key={scenario.id}
                scenario={scenario}
                to={`/run/${scenario.id}`}
                primary={i === 0}
              />
            ))}
          </div>
        )}
      </section>

      {firstRow && (
        <section className={styles.band} aria-labelledby="home-measure">
          <h2 id="home-measure">{firstRow.label}</h2>
          <p className={styles.sub}>
            32 purchase attempts Fitcheck had never seen. 16 of them were wrong. Each square is one
            wrong purchase; a filled square got paid.
          </p>
          <div className={styles.units}>
            <SquareRow
              who="Spending cap only"
              squares={firstRow.squares.capOnly}
              count={firstRow.capOnly}
              of={firstRow.of}
              label={firstRow.label}
            />
            <SquareRow
              who="Fitcheck"
              squares={firstRow.squares.fitcheck}
              count={firstRow.fitcheck}
              of={firstRow.of}
              label={firstRow.label}
            />
          </div>
          <p className={`note ${styles.more}`}>
            <Link to="/results">See all results and what they do not show</Link>
          </p>
        </section>
      )}

      <footer className={styles.foot}>
        <p>
          Why this exists: A payments benchmark published on November 5, 2026 found that shopping
          agents often pick a product that misses a requirement, because they read the buyer’s
          silence as “no constraint”. That benchmark stops before checkout. Fitcheck is the check at
          checkout.
        </p>
        <p>
          Fitcheck checks against the store’s listing, not the physical product. It does not check
          shipping, returns, warranty or tax. The store in this demo is a PayPal sandbox account;
          nothing is ordered from the real stores.
        </p>
        <p className={styles.startOver}>
          <StartOverButton>Start over: release my cap and clear my purchases</StartOverButton>
        </p>
      </footer>
    </div>
  );
}
