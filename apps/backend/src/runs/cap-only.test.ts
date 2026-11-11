import type { Cap } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import { capOnlyCheck } from './cap-only.js';

const cap: Cap = {
  capId: 'cap-1',
  mode: 'mock',
  status: 'active',
  amountCents: 300000,
  capturedCents: 0,
  heldCents: 0,
  availableCents: 300000,
};
const base = { cap, amountCents: 2929, currency: 'USD', domain: 'walmart.com' };

describe('capOnlyCheck', () => {
  it('captures inside the cap', () => {
    expect(capOnlyCheck(base)).toEqual({
      outcome: 'captured',
      amountCents: 2929,
      sentence:
        '$29.29 is inside the cap, so it is captured the moment the agent asks. Nobody looks at the listing.',
    });
  });

  it('refuses above what is left', () => {
    expect(capOnlyCheck({ ...base, cap: { ...cap, availableCents: 1000 } })).toMatchObject({
      outcome: 'not_captured',
      sentence: 'The spending cap has $10.00 left.',
    });
  });

  it('refuses a store the buyer did not allow', () => {
    expect(
      capOnlyCheck({ ...base, domain: 'bestbuy.com', allowedStores: ['walmart.com'] }).sentence,
    ).toBe('bestbuy.com is not a store you allowed.');
  });

  it('refuses another currency', () => {
    expect(capOnlyCheck({ ...base, currency: 'EUR' }).sentence).toBe(
      'The offer is in EUR. The cap is in USD.',
    );
  });

  it('refuses on a voided cap', () => {
    expect(
      capOnlyCheck({ ...base, cap: { ...cap, status: 'voided', availableCents: 0 } }).sentence,
    ).toBe('The spending cap is no longer active.');
  });
});
