import { describe, expect, it } from 'vitest';
import { fromPaypalAmount, toPaypalAmount } from './amount.js';

describe('PayPal amounts', () => {
  it('turns cents into PayPal decimals', () => {
    expect(toPaypalAmount(2020)).toBe('20.20');
    expect(toPaypalAmount(300000)).toBe('3000.00');
    expect(toPaypalAmount(0)).toBe('0.00');
    expect(toPaypalAmount(5)).toBe('0.05');
  });

  it('turns PayPal decimals into cents', () => {
    expect(fromPaypalAmount('29.29')).toBe(2929);
    expect(fromPaypalAmount('1.5')).toBe(150);
    expect(fromPaypalAmount('7')).toBe(700);
  });

  it('refuses more than two decimals', () => {
    expect(() => fromPaypalAmount('1.234')).toThrow(
      expect.objectContaining({ code: 'INVALID_PAYPAL_RESPONSE', status: 502 }),
    );
  });

  it('refuses cents that are not a non-negative integer', () => {
    expect(() => toPaypalAmount(1.5)).toThrow();
    expect(() => toPaypalAmount(-1)).toThrow();
  });
});
