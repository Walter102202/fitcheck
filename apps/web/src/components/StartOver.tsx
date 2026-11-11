import { type ReactNode, useRef, useState } from 'react';
import { useFitcheckApi } from '../api/context.js';
import { goTo } from '../lib/browser.js';
import { Button } from './Button.js';
import styles from './StartOver.module.css';

/** Home reads this flag to confirm the reset, then drops it from the URL. */
export const RESET_DONE = '/?reset=done';

/**
 * Releases this visit's cap and clears its purchases (POST /api/session/reset), then reloads
 * home, which confirms it. A failure says so and leaves the button ready for another try.
 */
export function StartOverButton({
  children,
  variant = 'quiet',
}: {
  children: ReactNode;
  variant?: 'primary' | 'quiet';
}) {
  const api = useFitcheckApi();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const guard = useRef(false);
  async function startOver() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await api.resetSession();
    } catch {
      guard.current = false;
      setBusy(false);
      setFailed(true);
      return;
    }
    goTo(RESET_DONE);
  }
  return (
    <>
      <Button variant={variant} size="small" onClick={startOver} disabled={busy}>
        {children}
      </Button>
      {failed && (
        <span className={styles.failed} role="alert">
          Start over did not go through. Try again.
        </span>
      )}
    </>
  );
}

/** Shown on the confirmation after a reset. */
export const RESET_NOTICE =
  'You started over. Your spending cap was released and your purchases were cleared. The next purchase asks you to approve a new cap.';
