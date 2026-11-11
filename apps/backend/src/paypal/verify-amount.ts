import type { Cents } from '@fitcheck/contracts';
import { AppError } from '../api/errors.js';
import { fromPaypalAmount } from './amount.js';

/** Validate PayPal decimal money only at the integration boundary. */
export function verifyCaptureAmount(value: unknown, expectedCents: Cents): void {
  const amount =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  let cents: number | undefined;
  if (amount.currency_code === 'USD' && typeof amount.value === 'string') {
    try {
      cents = fromPaypalAmount(amount.value);
    } catch {
      /* Invalid decimal amounts fail below. */
    }
  }
  if (cents !== expectedCents)
    throw new AppError('payment_mismatch', 'PayPal amount or currency differs from the purchase', {
      status: 409,
    });
}
