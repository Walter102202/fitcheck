import { formatUsd, type RunResponse } from '@fitcheck/contracts';
import { PaymentChip } from '../../components/PaymentChip.js';
import { ProductImage } from '../../components/ProductImage.js';
import { Quote } from '../../components/Quote.js';
import { RequirementChip } from '../../components/RequirementChip.js';
import styles from './HomeScreen.module.css';

/** The hero's real result: the first pick of the dryer purchase, and the line that breaks it. */
export function Specimen({ run }: { run: RunResponse }) {
  const first = run.attempts[0];
  if (!first) return null;
  const broken = first.review.results.find((r) => r.state === 'broken');
  const evidence = broken?.evidence[0];
  return (
    <figure
      className={`sheet ${styles.specimen}`}
      aria-label="Example: a hair dryer that does not work in Spain"
    >
      <div className={styles.specimenHead}>
        <ProductImage src={first.pick.image} category={run.intent.category} size={56} alt="" />
        <div>
          <b>“{run.intent.request}”</b>
          <div className="note">
            The agent picked this one at {first.pick.domain} for{' '}
            <span className="mono">{formatUsd(first.pick.priceCents)}</span>
          </div>
        </div>
      </div>
      {broken && evidence && (
        <div>
          <div className={styles.specimenReq}>
            <RequirementChip state="broken" />
            <b>{broken.name}</b>
          </div>
          <Quote evidence={evidence} tone="broken" markDelayMs={600} head="listing" />
        </div>
      )}
      <div className={styles.specimenFoot}>
        <PaymentChip state="not_captured" />
        <span>PayPal captured nothing. The purchase went back to the agent.</span>
      </div>
    </figure>
  );
}
