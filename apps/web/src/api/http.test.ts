import { runDryerSpain } from '@fitcheck/contracts';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ZodError } from 'zod';
import { postForm } from '../lib/browser.js';
import { ApiRequestError } from './errors.js';
import { httpApi } from './http.js';

vi.mock('../lib/browser.js', () => ({ goTo: vi.fn(), postForm: vi.fn() }));

function reply(status: number, body: unknown, contentType = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(status === 204 ? null : text, {
    status,
    headers: { 'content-type': contentType },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('getRun parses the body with RunResponseSchema', async () => {
  vi.mocked(fetch).mockResolvedValue(reply(200, runDryerSpain));
  await expect(httpApi.getRun('x')).resolves.toMatchObject({
    runId: runDryerSpain.runId,
    status: 'done',
  });
  const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(url).toBe('/api/runs/x');
  expect(init?.credentials).toBe('include');
});

test('a body that drifts from the contract rejects with ZodError', async () => {
  vi.mocked(fetch).mockResolvedValue(reply(200, { ...runDryerSpain, status: 'paid' }));
  await expect(httpApi.getRun('x')).rejects.toBeInstanceOf(ZodError);
  expect(console.error).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain('/api/runs/x');
});

test('a non-2xx reply rejects with ApiRequestError carrying the status', async () => {
  vi.mocked(fetch).mockResolvedValue(reply(502, '<html>Bad gateway</html>', 'text/html'));
  const error = await httpApi.getScenarios().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiRequestError);
  expect(error).toMatchObject({
    status: 502,
    code: 'http_error',
    message: 'Request failed with status 502',
  });
});

test('an error body in the contract shape gives its code and message', async () => {
  vi.mocked(fetch).mockResolvedValue(
    reply(409, { error: 'cap_not_active', message: 'The spending cap is not active.' }),
  );
  await expect(httpApi.startRun({ scenarioId: 'dryer-spain', review: 'on' })).rejects.toMatchObject(
    { status: 409, code: 'cap_not_active', message: 'The spending cap is not active.' },
  );
});

test('resetSession accepts 204 with no body', async () => {
  vi.mocked(fetch).mockResolvedValue(reply(204, null));
  await expect(httpApi.resetSession()).resolves.toBeUndefined();
});

test('getCap accepts a null cap', async () => {
  vi.mocked(fetch).mockResolvedValue(reply(200, null));
  await expect(httpApi.getCap()).resolves.toBeNull();
});

test('createCap posts the CapCreateRequest with the scenario only', async () => {
  vi.mocked(fetch).mockResolvedValue(reply(200, { ...runDryerSpain.cap }));
  await httpApi.createCap({ scenarioId: 'dryer-spain' });
  const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(url).toBe('/api/cap');
  expect(init?.method).toBe('POST');
  expect(JSON.parse(String(init?.body))).toEqual({ scenarioId: 'dryer-spain' });
});

test('completeSimulatedApproval posts a form to the simulated approval endpoint', async () => {
  await httpApi.completeSimulatedApproval('a b');
  expect(postForm).toHaveBeenCalledWith('/api/cap/approve-simulated?token=a%20b');
  expect(fetch).not.toHaveBeenCalled();
});
