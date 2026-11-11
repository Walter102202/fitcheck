import type { Cap, ConfigResponse } from '@fitcheck/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { activeFixtureCap, createFakeApi } from '../../api/fixtures/fake-api.js';
import { goTo } from '../../lib/browser.js';
import { renderApp, restoredFromCache } from '../../test/render.js';

vi.mock('../../lib/browser.js', () => ({ goTo: vi.fn(), postForm: vi.fn() }));

const sandboxConfig: ConfigResponse = {
  paypalMode: 'sandbox',
  channel3Mode: 'live',
  reviewModel: 'claude-sonnet-5-5',
  capAmountCents: 300000,
  sandboxBuyer: { email: 'buyer@example.com', password: 'pw-123' },
};

const pendingCap: Cap = {
  capId: 'cap-1',
  mode: 'sandbox',
  status: 'pending_approval',
  amountCents: 300000,
  capturedCents: 0,
  heldCents: 0,
  availableCents: 300000,
  approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=X',
};

function sandboxApi() {
  const api = createFakeApi({ cap: null });
  vi.spyOn(api, 'getConfig').mockResolvedValue(sandboxConfig);
  return api;
}

beforeEach(() => {
  vi.mocked(goTo).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('an active cap skips straight to the purchase', async () => {
  renderApp({ route: '/cap?scenario=tv-sony', api: createFakeApi({ cap: activeFixtureCap() }) });
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/run/tv-sony'));
});

test('sandbox mode shows the cap, the test buyer and one approve button', async () => {
  renderApp({ route: '/cap', api: sandboxApi() });
  expect(await screen.findByText('buyer@example.com')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Approve a spending cap for your agent',
  );
  expect(screen.getByText(/and charges nothing yet/)).toHaveTextContent(
    'PayPal authorizes $3,000.00 and charges nothing yet.',
  );
  expect(screen.getByText('Before the first purchase, once')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'On the PayPal sandbox' })).toBeInTheDocument();
  expect(screen.getByText('pw-123')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Approve in PayPal sandbox' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Skip the login|simulate/i })).toBeNull();
  expect(
    screen.getByText(
      'If the sandbox does not answer, this site switches to simulated PayPal and says so in the PayPal panel.',
    ),
  ).toBeInTheDocument();
});

test('Copy puts the buyer email on the clipboard', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  renderApp({ route: '/cap', api: sandboxApi() });
  const email = await screen.findByText('buyer@example.com');
  const row = email.closest('li') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: 'Copy' }));
  expect(writeText).toHaveBeenCalledWith('buyer@example.com');
  expect(await within(row).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
});

test('approving in the sandbox creates the cap once and goes to PayPal', async () => {
  const api = sandboxApi();
  const create = vi.spyOn(api, 'createCap').mockResolvedValue(pendingCap);
  renderApp({ route: '/cap', api });
  const approve = await screen.findByRole('button', { name: 'Approve in PayPal sandbox' });
  fireEvent.click(approve);
  fireEvent.click(approve);
  await waitFor(() => expect(goTo).toHaveBeenCalledWith(pendingCap.approveUrl));
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({ scenarioId: 'dryer-spain' });
});

test('Back from PayPal out of the page cache unlocks the button and reads the cap again', async () => {
  const api = sandboxApi();
  vi.spyOn(api, 'createCap').mockResolvedValue(pendingCap);
  const readCap = vi.spyOn(api, 'getCap');
  renderApp({ route: '/cap', api });
  const approve = await screen.findByRole('button', { name: 'Approve in PayPal sandbox' });
  fireEvent.click(approve);
  await waitFor(() => expect(goTo).toHaveBeenCalledWith(pendingCap.approveUrl));
  expect(approve).toBeDisabled();
  const reads = readCap.mock.calls.length;
  act(() => {
    window.dispatchEvent(restoredFromCache());
  });
  await waitFor(() => expect(approve).toBeEnabled());
  expect(readCap.mock.calls.length).toBe(reads + 1);
});

test('the cap remembers which purchase to come back to', async () => {
  const api = sandboxApi();
  const create = vi.spyOn(api, 'createCap').mockResolvedValue(pendingCap);
  renderApp({ route: '/cap?scenario=tv-wall', api });
  fireEvent.click(await screen.findByRole('button', { name: 'Approve in PayPal sandbox' }));
  await waitFor(() => expect(create).toHaveBeenCalledWith({ scenarioId: 'tv-wall' }));
});

test('simulated mode shows the notice and one button', async () => {
  renderApp({ route: '/cap', api: createFakeApi({ cap: null }) });
  expect(await screen.findByText('PayPal is simulated on this site.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Approve with simulated PayPal' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve in PayPal sandbox' })).toBeNull();
  expect(screen.queryByText('On the PayPal sandbox')).toBeNull();
});

test('simulated approval follows the simulated page link', async () => {
  const api = createFakeApi({ cap: null });
  renderApp({ route: '/cap?scenario=tv-sony', api });
  fireEvent.click(await screen.findByRole('button', { name: 'Approve with simulated PayPal' }));
  await waitFor(() =>
    expect(goTo).toHaveBeenCalledWith(expect.stringMatching(/^\/cap\/approve-simulated\?token=/)),
  );
});

test('a cap that comes back active goes straight to the purchase', async () => {
  const api = createFakeApi({ cap: null });
  vi.spyOn(api, 'createCap').mockResolvedValue({ ...activeFixtureCap(), mode: 'mock' });
  renderApp({ route: '/cap?scenario=dryer-silent', api });
  fireEvent.click(await screen.findByRole('button', { name: 'Approve with simulated PayPal' }));
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/run/dryer-silent'));
  expect(goTo).not.toHaveBeenCalled();
});

test('a failed cap request says so', async () => {
  const api = createFakeApi({ cap: null });
  vi.spyOn(api, 'createCap').mockRejectedValue(new Error('down'));
  renderApp({ route: '/cap', api });
  fireEvent.click(await screen.findByRole('button', { name: 'Approve with simulated PayPal' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('PayPal did not answer. Try again.');
  expect(screen.getByRole('button', { name: 'Approve with simulated PayPal' })).toBeEnabled();
});

test('a failed PayPal return says nothing was charged', async () => {
  renderApp({ route: '/cap?error=paypal', api: createFakeApi({ cap: null }) });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'PayPal did not approve the cap. Nothing was charged. Try again.',
  );
});

test('a cancelled approval says nothing was charged', async () => {
  renderApp({ route: '/cap?cancelled=1', api: createFakeApi({ cap: null }) });
  expect(
    await screen.findByText('The cap was not approved. Nothing was charged.'),
  ).toBeInTheDocument();
});
