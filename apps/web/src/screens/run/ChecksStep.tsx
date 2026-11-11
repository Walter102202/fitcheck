import type { Check } from '@fitcheck/contracts';
import styles from './ChecksStep.module.css';
import { Step } from './Step.js';

/** Where a requirement came from, in the buyer's own words when there are any. */
export function originText(check: Check): string {
  if (check.origin === 'always') return 'Checked on every purchase';
  const said = `You said “${check.originQuote ?? ''}”`;
  if (check.origin === 'stated') return said;
  return `${said}. Nobody mentioned ${check.fact ?? 'it'}.`;
}

/** Step 1: what Fitcheck will check, and what it does not. */
export function ChecksStep({ checks, notChecked }: { checks: Check[]; notChecked: string[] }) {
  return (
    <Step n={1} title="What Fitcheck will check">
      {checks.length === 0 ? (
        <p role="status">Fitcheck could not read this request.</p>
      ) : (
        <>
          <ul className={styles.wants}>
            {checks.map((check) => (
              <li key={check.requirement} className={styles.want}>
                <b>{check.name}</b>
                <span>{originText(check)}</span>
              </li>
            ))}
          </ul>
          {notChecked.length > 0 && (
            <p className={`note ${styles.notChecked}`}>Not checked: {notChecked.join(', ')}.</p>
          )}
        </>
      )}
    </Step>
  );
}
