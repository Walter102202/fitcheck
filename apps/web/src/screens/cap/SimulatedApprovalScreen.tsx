import { formatUsd } from '@fitcheck/contracts';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAppConfig } from '../../api/config.js';
import { useFitcheckApi } from '../../api/context.js';
import type { FitcheckApi } from '../../api/types.js';
import { useQuery } from '../../api/use-query.js';
import { Button, ButtonLink } from '../../components/Button.js';
import { useOnPageRestore } from '../../lib/page-restore.js';
import styles from './SimulatedApprovalScreen.module.css';

const loadCap = (api: FitcheckApi) => api.getCap();

/**
 * The approval page of the automatic simulated fallback. It says what it is, and it
 * borrows nothing from PayPal's look.
 */
export function SimulatedApprovalScreen() {
  const api = useFitcheckApi();
  const [params] = useSearchParams();
  const token = params.get('token');
  const config = useAppConfig();
  const cap = useQuery(loadCap, 'cap');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const guard = useRef(false);

  // Back to this page after approving: the form post left it locked.
  useOnPageRestore(() => {
    guard.current = false;
    setPending(false);
  });

  const amountCents = cap.data?.amountCents ?? config.data?.capAmountCents;

  async function approve() {
    if (!token || guard.current) return;
    guard.current = true;
    setPending(true);
    setFailed(false);
    try {
      await api.completeSimulatedApproval(token);
    } catch {
      guard.current = false;
      setPending(false);
      setFailed(true);
    }
  }

  return (
    <div className={`wrap ${styles.page}`}>
      <h1 className={styles.title}>PayPal (simulated)</h1>
      <div className={`sheet ${styles.sheet}`}>
        {token ? (
          <>
            <p>
              This site is simulating PayPal for this visit. This is not PayPal’s page, and no money
              moves.
            </p>
            {amountCents !== undefined && (
              <p className={styles.question}>
                Approve a spending cap of {formatUsd(amountCents)} for your shopping agent?
              </p>
            )}
            {failed && (
              <p className={styles.alert} role="alert">
                PayPal did not answer. Try again.
              </p>
            )}
            <div className={styles.actions}>
              <Button onClick={approve} disabled={pending}>
                Approve the cap
              </Button>
              <ButtonLink to="/cap?cancelled=1" variant="quiet">
                Cancel
              </ButtonLink>
            </div>
          </>
        ) : (
          <>
            <p>This approval link has no token.</p>
            <p>
              <Link to="/cap">Back to the cap</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
