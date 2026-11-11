import type { Cents } from '@fitcheck/contracts';
import { PaypalError } from './gateway.js';

/** The only place cents become PayPal's decimal strings: 2020 -> "20.20". */
export function toPaypalAmount(cents: Cents): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new PaypalError('INVALID_AMOUNT');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** "29.29" -> 2929; anything but up to two decimals is an invalid PayPal response. */
export function fromPaypalAmount(value: string): Cents {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new PaypalError('INVALID_PAYPAL_RESPONSE', 502);
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new PaypalError('INVALID_PAYPAL_RESPONSE', 502);
  return cents;
}
