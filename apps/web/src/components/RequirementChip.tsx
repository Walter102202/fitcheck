import type { RequirementState } from '@fitcheck/contracts';
import type { ComponentType } from 'react';
import { Check, CircleDashed, CircleHelp, EqualNot, ICON_PROPS, X } from './icons.js';
import styles from './RequirementChip.module.css';

/** The five states a requirement shows. `payment` reasons render as broken or unbacked. */
export type ShownState = Exclude<RequirementState, 'not_applicable'>;

export const REQUIREMENT_LABEL: Record<ShownState, string> = {
  backed: 'Backed',
  unbacked: 'Not in the listing',
  never_asked: 'Nobody asked',
  contradictory: 'Listing disagrees',
  broken: 'Broken',
};

const ICON: Record<ShownState, ComponentType<typeof ICON_PROPS>> = {
  backed: Check,
  unbacked: CircleDashed,
  never_asked: CircleHelp,
  contradictory: EqualNot,
  broken: X,
};

export function RequirementChip({ state }: { state: ShownState }) {
  const Icon = ICON[state];
  return (
    <span className={styles.chip} data-state={state}>
      <Icon {...ICON_PROPS} />
      {REQUIREMENT_LABEL[state]}
    </span>
  );
}
