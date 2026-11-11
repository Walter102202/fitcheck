import { runDryerSpain } from '@fitcheck/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { createFakeApi } from '../../api/fixtures/fake-api.js';
import { FIXTURE_SCENARIOS } from '../../api/fixtures/scenarios.js';
import { goTo } from '../../lib/browser.js';
import { renderApp } from '../../test/render.js';

vi.mock('../../lib/browser.js', () => ({ goTo: vi.fn(), postForm: vi.fn() }));

beforeEach(() => {
  vi.mocked(goTo).mockClear();
});

test('the hero shows the headline and the dryer that does not work in Spain', () => {
  renderApp({ route: '/' });
  expect(screen.getByRole('heading', { level: 1, name: /Your agent can pay/ })).toBeInTheDocument();
  expect(screen.getByText(runDryerSpain.intent.request, { exact: false })).toBeInTheDocument();
  expect(document.querySelector('blockquote')).toHaveTextContent(
    'For use with 110V–120V outlets only.',
  );
  expect(document.querySelector('blockquote mark')).toHaveAttribute('data-tone', 'broken');
  expect(screen.getAllByText('Not captured').length).toBeGreaterThan(0);
  expect(screen.getByText('$29.29', { exact: false })).toBeInTheDocument();
  expect(
    screen.getByText('PayPal captured nothing. The purchase went back to the agent.'),
  ).toBeInTheDocument();
});

test('one hero sentence names the reviewing model and PayPal', async () => {
  renderApp({ route: '/' });
  expect(
    await screen.findByText(
      'Claude Sonnet 5.5 turns your request into requirements, code checks each one against the listing, and only then does PayPal capture the money.',
    ),
  ).toBeInTheDocument();
});

test('the specimen quote says where the line comes from, without the field path', () => {
  renderApp({ route: '/' });
  const specimen = screen.getByRole('figure', {
    name: 'Example: a hair dryer that does not work in Spain',
  });
  expect(within(specimen).getByText('Description, from the store’s listing')).toBeInTheDocument();
  expect(specimen.textContent).not.toMatch(/Description\s+description/);
  // The price sits in body type: a monospace full stop in small prose read "$29 . 29".
  expect(within(specimen).getByText(/at walmart\.com for \$29\.29$/)).not.toContainHTML('mono');
});

// Walter, 2026-11-11: the benchmark is described, not named.
test('the footer describes the benchmark without naming it', () => {
  renderApp({ route: '/' });
  const footer = document.querySelector('footer');
  expect(footer).toHaveTextContent('A payments benchmark published on November 5, 2026 found');
  expect(footer?.textContent).not.toMatch(/visa/i);
});

test('Run the first purchase goes to the first scenario', async () => {
  renderApp({ route: '/' });
  expect(await screen.findByRole('link', { name: 'Run the first purchase' })).toHaveAttribute(
    'href',
    '/run/dryer-spain',
  );
  expect(
    screen.getByText('No account of your own and no key needed. Takes about a minute.'),
  ).toBeInTheDocument();
});

test('three outcomes', () => {
  renderApp({ route: '/' });
  expect(
    screen.getByRole('heading', { name: 'Three things can happen at the payment' }),
  ).toBeInTheDocument();
  for (const title of [
    'The listing backs every requirement',
    'The listing is silent, or disagrees with itself',
    'The listing breaks a requirement',
  ])
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
});

test('four purchases in API order, with the mockup chips and how each ends', async () => {
  renderApp({ route: '/' });
  const runs = await screen.findAllByRole('link', { name: /^Run: / });
  expect(runs.map((a) => a.getAttribute('href'))).toEqual(
    FIXTURE_SCENARIOS.map((s) => `/run/${s.id}`),
  );
  expect(runs[0]).toHaveAttribute('data-variant', 'primary');
  expect(runs[1]).toHaveAttribute('data-variant', 'quiet');
  const list = screen.getByTestId('scenarios');
  const chips = [...list.querySelectorAll('[data-state]')];
  expect(chips.map((c) => c.getAttribute('data-state'))).toEqual([
    'broken',
    'unbacked',
    'contradictory',
    'never_asked',
  ]);
  expect(chips.map((c) => c.textContent)).toEqual([
    'Broken',
    'Not in the listing',
    'Listing disagrees',
    'Nobody asked',
  ]);
  expect([...document.querySelectorAll('[data-kind="ends-in"]')].map((e) => e.textContent)).toEqual(
    FIXTURE_SCENARIOS.map((s) => s.endsIn),
  );
  const sub = within(screen.getByRole('region', { name: 'Run a purchase' })).getByText(
    /scripted shopping agent/,
  );
  expect(sub).toHaveTextContent(
    'Four purchases made by a scripted shopping agent. Product records come from a recorded Channel3 copy. Payments run on simulated PayPal: you approve the cap once on the next screen.',
  );
  expect(sub.textContent).not.toMatch(/skip the login/i);
});

test('with three purchases and a sandbox, the sub-line says so', async () => {
  const api = createFakeApi();
  vi.spyOn(api, 'getScenarios').mockResolvedValue(FIXTURE_SCENARIOS.slice(0, 3));
  vi.spyOn(api, 'getConfig').mockResolvedValue({
    paypalMode: 'sandbox',
    channel3Mode: 'live',
    reviewModel: 'claude-sonnet-5-5',
    capAmountCents: 300000,
  });
  renderApp({ route: '/', api });
  expect(await screen.findAllByRole('link', { name: /^Run: / })).toHaveLength(3);
  await waitFor(() =>
    expect(screen.getByText(/scripted shopping agent/)).toHaveTextContent(
      'Three purchases made by a scripted shopping agent. Product records come live from Channel3. Payments run on the PayPal sandbox: you approve the cap once with the test buyer shown on the next screen.',
    ),
  );
});

test('the measurement band shows the first results row', async () => {
  renderApp({ route: '/' });
  expect(
    await screen.findByRole('img', { name: '14 of 16: Wrong purchases that got paid' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('img', { name: 'Not measured yet: Wrong purchases that got paid' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'See all results and what they do not show' }),
  ).toHaveAttribute('href', '/results');
});

test('home still renders when results fail', async () => {
  const api = createFakeApi();
  vi.spyOn(api, 'getResults').mockRejectedValue(new Error('down'));
  renderApp({ route: '/', api });
  expect(await screen.findAllByRole('link', { name: /^Run: / })).toHaveLength(4);
  expect(screen.queryByRole('heading', { name: 'Wrong purchases that got paid' })).toBeNull();
});

test('while the purchases load, the band does not claim there are none', () => {
  const api = createFakeApi();
  vi.spyOn(api, 'getScenarios').mockReturnValue(new Promise(() => {}));
  renderApp({ route: '/', api });
  const band = screen.getByRole('region', { name: 'Run a purchase' });
  expect(band.textContent).not.toMatch(/purchases made by/);
  expect(band.textContent).not.toMatch(/^No |\bNo purchases\b/);
});

test('when the purchases fail, the band says so and Try again reloads them', async () => {
  const api = createFakeApi();
  const load = vi.spyOn(api, 'getScenarios').mockRejectedValueOnce(new Error('down'));
  renderApp({ route: '/', api });
  const band = screen.getByRole('region', { name: 'Run a purchase' });
  expect(await within(band).findByRole('alert')).toHaveTextContent('The purchases did not load.');
  expect(band.textContent).not.toMatch(/No purchases/);
  // The rest of the page stays.
  expect(
    screen.getByRole('heading', { name: 'Three things can happen at the payment' }),
  ).toBeInTheDocument();
  fireEvent.click(within(band).getByRole('button', { name: 'Try again' }));
  expect(await screen.findAllByRole('link', { name: /^Run: / })).toHaveLength(4);
  expect(load).toHaveBeenCalledTimes(2);
});

test('Start over resets the session and reloads home with a confirmation', async () => {
  const api = createFakeApi();
  const reset = vi.spyOn(api, 'resetSession');
  renderApp({ route: '/', api });
  fireEvent.click(
    screen.getByRole('button', { name: 'Start over: release my cap and clear my purchases' }),
  );
  await waitFor(() => expect(goTo).toHaveBeenCalledWith('/?reset=done'));
  expect(reset).toHaveBeenCalledTimes(1);
});

test('after Start over, home confirms the cap was released, once', async () => {
  renderApp({ route: '/?reset=done' });
  const notice = await screen.findByText(/^You started over\./);
  expect(notice.closest('[role="status"]')).not.toBeNull();
  expect(notice).toHaveTextContent(
    'You started over. Your spending cap was released and your purchases were cleared. The next purchase asks you to approve a new cap.',
  );
  // The flag leaves the URL, so a reload does not confirm again.
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  expect(screen.getByText(/^You started over\./)).toBeInTheDocument();
});

test('a Start over that fails says so and stays on the page', async () => {
  const api = createFakeApi();
  vi.spyOn(api, 'resetSession').mockRejectedValueOnce(new Error('down'));
  renderApp({ route: '/', api });
  fireEvent.click(
    screen.getByRole('button', { name: 'Start over: release my cap and clear my purchases' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Start over did not go through. Try again.',
  );
  expect(goTo).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Start over: release my cap and clear my purchases' }),
  ).toBeEnabled();
});
