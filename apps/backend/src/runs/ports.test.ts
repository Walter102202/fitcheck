import { describe, expect, it } from 'vitest';
import { Channel3UnavailableError } from '../channel3/index.js';
import { loadEnv } from '../env.js';
import { ReviewUnavailableError } from '../review/index.js';
import { createPorts } from './ports.js';

const now = () => new Date('2026-11-11T12:00:00.000Z');

describe('createPorts', () => {
  it('live Channel3 without a key fails at createPorts', () => {
    expect(() => createPorts(loadEnv({ CHANNEL3_MODE: 'live' }), { now })).toThrow(
      /CHANNEL3_API_KEY/,
    );
  });

  it('the Anthropic provider without a key fails at createPorts', () => {
    expect(() => createPorts(loadEnv({ LLM_PROVIDER: 'anthropic' }), { now })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("the default ports run Lane B's review on its recordings and the recorded Channel3", async () => {
    const { review, channel3 } = createPorts(loadEnv({}), { now });
    const intent = await review.extractIntent(
      'A hair dryer for my trip to Spain next week. Under $40.',
      'hair_dryer',
    );
    expect(intent).toMatchObject({ category: 'hair_dryer', source: 'recorded' });
    expect(review.checksFor(intent).length).toBeGreaterThan(0);
    expect(channel3.mode).toBe('recorded');
    const record = await channel3.getProduct('cv7t721');
    expect(record.product.id).toBe('cv7t721');
    expect(channel3.noticeFor(record)).toBeNull();
  });

  it("maps Lane B's unavailable errors to a reason, and nothing else", () => {
    const { review } = createPorts(loadEnv({}), { now });
    expect(review.unavailableReason(new ReviewUnavailableError('no_recording'))).toBe(
      'no_recording',
    );
    expect(review.unavailableReason(new Channel3UnavailableError('x'))).toBe('channel3');
    expect(review.unavailableReason(new Error('boom'))).toBeNull();
  });

  it('an unrecorded request fails with no_recording under the mock provider', async () => {
    const { review } = createPorts(loadEnv({}), { now });
    const error = await review
      .extractIntent('A request nobody recorded, under $12.', 'hair_dryer')
      .catch((e: unknown) => e);
    expect(review.unavailableReason(error)).toBe('no_recording');
  });
});
