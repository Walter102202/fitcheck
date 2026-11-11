import type { ComponentType } from 'react';
import { Check, CircleSlash, ICON_PROPS, Lock, Pause } from './icons.js';
import styles from './PaymentChip.module.css';

export type PaymentState = 'authorized' | 'held' | 'captured' | 'not_captured';

export const PAYMENT_LABEL: Record<PaymentState, string> = {
  authorized: 'Cap authorized',
  held: 'On hold',
  captured: 'Captured',
  not_captured: 'Not captured',
};

const ICON: Record<PaymentState, ComponentType<typeof ICON_PROPS>> = {
  authorized: Lock,
  held: Pause,
  captured: Check,
  not_captured: CircleSlash,
};

export function PaymentChip({ state }: { state: PaymentState }) {
  const Icon = ICON[state];
  return (
    <span className={styles.pay} data-state={state}>
      <Icon {...ICON_PROPS} />
      {PAYMENT_LABEL[state]}
    </span>
  );
}
