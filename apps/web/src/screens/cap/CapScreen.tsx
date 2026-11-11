import { formatUsd } from '@fitcheck/contracts';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAppConfig } from '../../api/config.js';
import { useFitcheckApi } from '../../api/context.js';
import type { FitcheckApi } from '../../api/types.js';
import { useQuery } from '../../api/use-query.js';
import { Button } from '../../components/Button.js';
import { goTo } from '../../lib/browser.js';
import { useOnPageRestore } from '../../lib/page-restore.js';
import styles from './CapScreen.module.css';

const loadCap = (api: FitcheckApi) => api.getCap();
const loadScenarios = (api: FitcheckApi) => api.getScenarios();

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <li className={styles.row}>
      <b>{label}</b>
      <span className="mono">{value}</span>
      <Button variant="quiet" size="small" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </li>
  );
}

/** Before the first purchase, once: the visitor approves the spending cap in PayPal. */
export function CapScreen() {
  const api = useFitcheckApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const config = useAppConfig();
  const cap = useQuery(loadCap, 'cap');
  const scenarios = useQuery(loadScenarios, 'scenarios');
  const scenario = params.get('scenario') ?? scenarios.data?.[0]?.id ?? 'dryer-spain';
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const guard = useRef(false);

  // Back from PayPal: unlock the button and read the cap again, which may now be active.
  useOnPageRestore(() => {
    guard.current = false;
    setPending(false);
    void cap.refetch();
  });

  const status = cap.data?.status;
  useEffect(() => {
    if (status === 'active' || status === 'exhausted')
      navigate(`/run/${encodeURIComponent(scenario)}`, { replace: true });
  }, [status, scenario, navigate]);

  async function approve() {
    if (guard.current) return;
    guard.current = true;
    setPending(true);
    setFailed(false);
    try {
      const created = await api.createCap({ scenarioId: scenario });
      if (created.approveUrl) {
        goTo(created.approveUrl);
        return;
      }
      if (created.status === 'active') {
        navigate(`/run/${encodeURIComponent(scenario)}`);
        return;
      }
      throw new Error('The cap came back without an approval link');
    } catch {
      guard.current = false;
      setPending(false);
      setFailed(true);
    }
  }

  const settings = config.data;
  const amount = settings ? formatUsd(settings.capAmountCents) : null;
  const sandbox = settings?.paypalMode === 'sandbox';

  return (
    <div className={`wrap ${styles.page}`}>
      <div className={styles.head}>
        <p className={styles.meta}>Before the first purchase, once</p>
        <h1 className={styles.title}>Approve a spending cap for your agent</h1>
        {amount && (
          <p className={styles.lede}>
            PayPal authorizes <b className="mono">{amount}</b> and charges nothing yet. Each
            purchase Fitcheck approves is captured from it. Whatever is left at the end is released.
          </p>
        )}
      </div>

      {params.get('error') === 'paypal' && (
        <p className={styles.alert} role="alert">
          PayPal did not approve the cap. Nothing was charged. Try again.
        </p>
      )}
      {params.get('cancelled') === '1' && (
        <p className={styles.notice} role="status">
          The cap was not approved. Nothing was charged.
        </p>
      )}
      {failed && (
        <p className={styles.alert} role="alert">
          PayPal did not answer. Try again.
        </p>
      )}

      {settings && (
        <div className={`sheet ${styles.sheet}`}>
          {sandbox ? (
            <>
              <div>
                <h2 className={styles.sheetTitle}>On the PayPal sandbox</h2>
                <p className="note">
                  Log in on PayPal’s page with this test buyer. It is play money.
                </p>
              </div>
              {settings.sandboxBuyer && (
                <ul className={styles.rows}>
                  <CopyRow label="Email" value={settings.sandboxBuyer.email} />
                  <CopyRow label="Password" value={settings.sandboxBuyer.password} />
                </ul>
              )}
              <div className={styles.actions}>
                <Button onClick={approve} disabled={pending}>
                  Approve in PayPal sandbox
                </Button>
              </div>
              <p className="note">
                If the sandbox does not answer, this site switches to simulated PayPal and says so
                in the PayPal panel.
              </p>
            </>
          ) : (
            <>
              <p role="status">PayPal is simulated on this site.</p>
              <div className={styles.actions}>
                <Button onClick={approve} disabled={pending}>
                  Approve with simulated PayPal
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {config.error && !settings && (
        <p className={styles.alert} role="alert">
          PayPal did not answer. Try again.
        </p>
      )}
    </div>
  );
}
