import { expect, it, vi } from 'vitest';
import { createTokenSource, paypalJson } from './auth.js';

it.each([401, 403, 408, 429])(
  'treats HTTP %i as a temporary failure without changing the issue',
  async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ details: [{ issue: 'REMOTE_ISSUE' }] }, { status }));
    await expect(paypalJson('/test', {}, fetch)).rejects.toMatchObject({
      code: 'REMOTE_ISSUE',
      status: 503,
    });
  },
);
it.each([400, 404, 409, 422, 503])('preserves HTTP %i', async (status) => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ name: 'REMOTE_ERROR' }, { status }));
  await expect(paypalJson('/test', {}, fetch)).rejects.toMatchObject({
    code: 'REMOTE_ERROR',
    status,
  });
});
it.each([new TypeError('network failure'), new DOMException('aborted', 'AbortError')])(
  'maps fetch rejection to an unreachable gateway',
  async (error) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(error);
    await expect(paypalJson('/test', {}, fetch)).rejects.toMatchObject({
      code: 'PAYPAL_UNREACHABLE',
      status: 502,
    });
  },
);
it('bounds each fetch with a fifteen-second abort signal', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({}));
  try {
    await paypalJson('/test', {}, fetch);
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  } finally {
    timeout.mockRestore();
  }
});

it('caches tokens until sixty seconds before expiry and refreshes after expiry', async () => {
  let now = 0;
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () =>
      Response.json({ access_token: `token-${fetch.mock.calls.length}`, expires_in: 120 }),
    );
  const source = createTokenSource({
    clientId: 'client',
    clientSecret: 'secret',
    fetch,
    now: () => now,
  });
  expect(await source.getAccessToken()).toBe('token-1');
  now = 59_000;
  expect(await source.getAccessToken()).toBe('token-1');
  expect(fetch).toHaveBeenCalledTimes(1);
  now = 60_000;
  expect(await source.getAccessToken()).toBe('token-2');
  now = 181_000;
  expect(await source.getAccessToken()).toBe('token-3');
  expect(fetch.mock.calls[0]).toEqual([
    'https://api-m.sandbox.paypal.com/v1/oauth2/token',
    expect.objectContaining({
      method: 'POST',
      body: 'grant_type=client_credentials',
      headers: expect.objectContaining({
        Authorization: `Basic ${Buffer.from('client:secret').toString('base64')}`,
      }),
    }),
  ]);
});
