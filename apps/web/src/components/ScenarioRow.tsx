import type { Scenario } from '@fitcheck/contracts';
import { ButtonLink } from './Button.js';
import { ProductImage } from './ProductImage.js';
import { RequirementChip } from './RequirementChip.js';
import styles from './ScenarioRow.module.css';

/** One demo purchase on Home: what the buyer asks, what the agent picks, how it ends. */
export function ScenarioRow({
  scenario,
  to,
  primary,
}: {
  scenario: Scenario;
  to: string;
  primary: boolean;
}) {
  return (
    <div className={styles.scenario}>
      <ProductImage src={scenario.image} category={scenario.category} size={72} alt="" />
      <div>
        <q>{scenario.request}</q>
        <div className={styles.picks}>{scenario.shows}</div>
        <span className={styles.endsIn} data-kind="ends-in">
          {scenario.endsIn}
        </span>
      </div>
      <span className={styles.chip}>
        <RequirementChip state={scenario.showcase} />
      </span>
      <ButtonLink
        className={styles.run}
        to={to}
        size="small"
        variant={primary ? 'primary' : 'quiet'}
        aria-label={`Run: ${scenario.title}`}
      >
        Run
      </ButtonLink>
    </div>
  );
}
