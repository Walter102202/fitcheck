import { describe, expect, it } from 'vitest';
import { singleFlight } from './single-flight.js';

describe('singleFlight', () => {
  it('runs fn once for two concurrent calls with the same key', async () => {
    let runs = 0;
    const fn = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { n: runs };
    };
    const [a, b] = await Promise.all([singleFlight('k', fn), singleFlight('k', fn)]);
    expect(runs).toBe(1);
    expect(a).toBe(b);
    await singleFlight('k', fn);
    expect(runs).toBe(2);
  });

  it('releases the key after a failure', async () => {
    await expect(singleFlight('boom', async () => Promise.reject(new Error('x')))).rejects.toThrow(
      'x',
    );
    expect(await singleFlight('boom', async () => 1)).toBe(1);
  });
});
