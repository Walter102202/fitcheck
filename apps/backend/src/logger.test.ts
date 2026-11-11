import { describe, expect, it } from 'vitest';
import { redact } from './logger.js';

describe('redact', () => {
  it('masks secrets whatever the key spelling, at any depth', () => {
    const out = redact({
      access_token: 'a',
      accessToken: 'b',
      'x-api-key': 'c',
      ANTHROPIC_API_KEY: 'd',
      PAYPAL_CLIENT_SECRET: 'e',
      headers: { Authorization: 'Bearer f' },
      body: [{ password: 'g' }],
    });
    expect(JSON.stringify(out)).not.toMatch(/"[a-g]"|Bearer/);
  });

  it('keeps ids that only look like secrets', () => {
    expect(redact({ authorizationId: '0VF52814937998046', captureId: 'x' })).toEqual({
      authorizationId: '0VF52814937998046',
      captureId: 'x',
    });
  });
});
