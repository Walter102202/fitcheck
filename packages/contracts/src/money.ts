import { z } from 'zod';

/** Money is integer cents everywhere; it becomes text only through `formatUsd`. */
export const CentsSchema = z.number().int().nonnegative();
export type Cents = z.infer<typeof CentsSchema>;

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 139800 -> "$1,398.00"; 0 -> "$0.00". */
export function formatUsd(cents: Cents): string {
  return usd.format(cents / 100);
}
