import { formatUsd, runDryerSilent, runDryerSpain, runSonyAsk } from '@fitcheck/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ApiRequestError } from '../../api/errors.js';
import { activeFixtureCap, createFakeApi } from '../../api/fixtures/fake-api.js';
import { failedClosedRun, fixtureRun } from '../../api/fixtures/runs.js';
import { FIXTURE_SCENARIOS } from '../../api/fixtures/scenarios.js';
import { renderApp } from '../../test/render.js';

vi.mock('../../lib/browser.js', () => ({ goTo: vi.fn(), postForm: vi.fn() }));

const withCap = () => createFakeApi({ cap: activeFixtureCap() });
const sonyLine = runSonyAsk.attempts[0]?.review.card?.lines[0];

function answer(label: 'Yes' | 'No' | 'Don’t know') {
  fireEvent.click(within(screen.getByTestId('steps')).getByLabelText(label));
  fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
}

test('starts one run under StrictMode and writes its id to the URL', async () => {
  const api = withCap();
  const start = vi.spyOn(api, 'startRun');
  renderApp({ route: '/run/dryer-spain', api, strict: true });
  await screen.findByText('Second pick');
  expect(start).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledWith({ scenarioId: 'dryer-spain', review: 'on' });
  // Under StrictMode the router commits the new URL a tick after the run renders.
  await waitFor(() =>
    expect(screen.getByTestId('location').textContent).toMatch(/^\/run\/dryer-spain\?run=run-fx-/),
  );
  expect(start).toHaveBeenCalledTimes(1);
});

test('reloading with ?run= reads that run and starts none', async () => {
  const api = withCap();
  const { runId } = await api.startRun({ scenarioId: 'tv-sony', review: 'on' });
  const start = vi.spyOn(api, 'startRun');
  const get = vi.spyOn(api, 'getRun');
  renderApp({ route: `/run/tv-sony?run=${runId}`, api });
  expect(await screen.findByRole('button', { name: 'Send answers' })).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith(runId);
  expect(start).not.toHaveBeenCalled();
});

test('no active cap sends the visitor to the cap page for this purchase', async () => {
  const api = createFakeApi({ cap: null });
  const start = vi.spyOn(api, 'startRun');
  renderApp({ route: '/run/dryer-spain', api });
  await waitFor(() =>
    expect(screen.getByTestId('location').textContent).toBe('/cap?scenario=dryer-spain'),
  );
  expect(start).not.toHaveBeenCalled();
});

test('a voided cap also sends the visitor to the cap page', async () => {
  const api = createFakeApi({ cap: { ...activeFixtureCap(), status: 'voided' } });
  renderApp({ route: '/run/tv-sony', api });
  await waitFor(() =>
    expect(screen.getByTestId('location').textContent).toBe('/cap?scenario=tv-sony'),
  );
});

test('dryer-spain: broken first pick, then the LURA captured', async () => {
  renderApp({ route: '/run/dryer-spain', api: withCap() });
  expect(
    await screen.findByRole('heading', { level: 1, name: runDryerSpain.intent.request }),
  ).toBeInTheDocument();
  expect(
    await screen.findByText('Purchase 1 of 4, made by a scripted shopping agent'),
  ).toBeInTheDocument();
  expect(screen.getByText('First pick')).toBeInTheDocument();
  expect(screen.getByText('The agent picked again')).toBeInTheDocument();
  expect(screen.getByText('9 backed, 1 broken.')).toBeInTheDocument();
  expect(screen.getByText('Everything is backed.')).toBeInTheDocument();
  const [first, second] = document.querySelectorAll('[data-kind]');
  expect(first).toHaveTextContent('$0.00');
  expect(first).toHaveTextContent(
    `Sent to the agent: ${runDryerSpain.attempts[0]?.review.agentMessage}`,
  );
  expect(second).toHaveTextContent('PayPal captured $20.20 from the $3,000.00 cap.');
  expect(
    screen.getByRole('link', { name: `Next purchase: ${FIXTURE_SCENARIOS[1]?.title}` }),
  ).toHaveAttribute('href', '/run/dryer-silent');
  const panel = screen.getByRole('complementary', { name: 'What PayPal did' });
  expect(within(panel).getByText('With a spending cap only')).toBeInTheDocument();
});

test('the record line says when Channel3 was asked again', async () => {
  renderApp({ route: '/run/dryer-spain', api: withCap() });
  expect(
    (
      await screen.findAllByText('Record fetched again from Channel3 at 22:40:00.', {
        exact: false,
      })
    ).length,
  ).toBe(2);
  expect(
    screen.getAllByText('Nothing is taken from the agent’s word.', { exact: false }).length,
  ).toBe(2);
});

test('tv-sony: the pair, then yes captures the price', async () => {
  const price = formatUsd(runSonyAsk.attempts[0]?.pick.priceCents ?? 0);
  renderApp({ route: '/run/tv-sony', api: withCap() });
  expect(await screen.findByText('65 in')).toBeInTheDocument();
  expect(screen.getByText('55 in')).toBeInTheDocument();
  expect(within(screen.getByTestId('steps')).getAllByRole('radiogroup')).toHaveLength(1);
  answer('Yes');
  expect(
    await screen.findByText(`PayPal captured ${price} from the $3,000.00 cap.`),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send answers' })).toBeNull();
});

test('tv-sony: a no ends not captured and shows what was sent to the agent', async () => {
  renderApp({ route: '/run/tv-sony', api: withCap() });
  await screen.findByRole('button', { name: 'Send answers' });
  answer('No');
  await waitFor(() => expect(document.querySelector('[data-kind="not_captured"]')).not.toBeNull());
  const strip = document.querySelector('[data-kind="not_captured"]');
  expect(strip).toHaveTextContent('$0.00');
  expect(strip).toHaveTextContent(
    `Sent to the agent: Not paid. The buyer did not accept: ${sonyLine?.text}`,
  );
  const panel = screen.getByRole('complementary', { name: 'What PayPal did' });
  expect(panel.querySelector('[data-type="not_captured"]')).not.toBeNull();
  expect(
    screen.getByRole('link', { name: 'Next purchase: A 65-inch TV for the wall' }),
  ).toBeDefined();
});

test('dryer-silent: the unbacked row lists the fields searched; no brings a captured second pick', async () => {
  renderApp({ route: '/run/dryer-silent', api: withCap() });
  expect(await screen.findByText('Not in the listing')).toBeInTheDocument();
  expect(screen.getByText(/Looked in, found nothing about/)).toBeInTheDocument();
  const unbacked = runDryerSilent.attempts[0]?.review.results.find((r) => r.state === 'unbacked');
  for (const label of unbacked?.searched ?? []) expect(screen.getByText(label)).toBeInTheDocument();
  answer('No');
  expect(await screen.findByText('Second pick')).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: runDryerSilent.attempts[0]?.pick.title ?? 'missing' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Travel Hair Dryer' })).toBeInTheDocument();
  const strips = document.querySelectorAll('[data-kind]');
  expect(strips[strips.length - 1]).toHaveTextContent(
    'PayPal captured $20.20 from the $3,000.00 cap.',
  );
});

test('a failed-closed review shows the message, not captured, and no card', async () => {
  renderApp({
    route: '/run/dryer-spain',
    api: createFakeApi({ cap: activeFixtureCap(), runs: { 'dryer-spain': failedClosedRun() } }),
  });
  expect(
    (await screen.findAllByText('Fitcheck could not check this listing.')).length,
  ).toBeGreaterThan(0);
  expect(within(screen.getByTestId('steps')).queryAllByRole('radiogroup')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Send answers' })).toBeNull();
  expect(screen.queryByText('Everything is backed.')).toBeNull();
  expect(document.querySelector('[data-kind="not_captured"]')).not.toBeNull();
  expect(document.querySelector('[data-kind="captured"]')).toBeNull();
});

test('when the request could not be read, step 1 says so instead of an empty list', async () => {
  const run = failedClosedRun({ intentFailed: true });
  renderApp({
    route: '/run/dryer-spain',
    api: createFakeApi({ cap: activeFixtureCap(), runs: { 'dryer-spain': run } }),
  });
  expect(await screen.findByText('Fitcheck could not read this request.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: run.intent.request })).toBeInTheDocument();
  expect(screen.queryByText(/^Not checked:/)).toBeNull();
  expect(screen.getAllByText('Fitcheck could not check this listing.').length).toBeGreaterThan(0);
  expect(document.querySelector('[data-kind="not_captured"]')).not.toBeNull();
});

test('a failed start shows Try again, and Try again retries', async () => {
  const api = withCap();
  const start = vi
    .spyOn(api, 'startRun')
    .mockRejectedValueOnce(
      new ApiRequestError(502, 'http_error', 'Request failed with status 502'),
    );
  renderApp({ route: '/run/dryer-spain', api });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('This purchase did not load.');
  expect(alert).toHaveTextContent('Request failed with status 502');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Second pick');
  expect(start).toHaveBeenCalledTimes(2);
});

test('switching the review off runs the same purchase as spending cap only', async () => {
  const api = withCap();
  const start = vi.spyOn(api, 'startRun');
  renderApp({ route: '/run/dryer-spain', api });
  await screen.findByText('Second pick');
  fireEvent.click(screen.getByRole('radio', { name: 'Off: spending cap only' }));
  expect(await screen.findByText('Fitcheck review is off')).toBeInTheDocument();
  expect(start.mock.lastCall?.[0]).toEqual({ scenarioId: 'dryer-spain', review: 'off' });
  expect(
    screen.getByText('Nothing was checked. The spending cap alone decides.'),
  ).toBeInTheDocument();
  expect(screen.getByText('PayPal captured $29.29 from the $3,000.00 cap.')).toBeInTheDocument();
  expect(screen.queryByText('With a spending cap only')).toBeNull();
  expect(screen.getByRole('radio', { name: 'Off: spending cap only' })).toBeChecked();
  expect(screen.getByTestId('location').textContent).toMatch(/review=off/);
});

test('notices from the run are shown', async () => {
  const notices = [
    'Channel3 did not answer. Showing the copy recorded on 2026-11-10.',
    'PayPal is simulated on this site. The video shows the same flow on the PayPal sandbox.',
  ];
  renderApp({
    route: '/run/dryer-spain',
    api: createFakeApi({
      cap: activeFixtureCap(),
      runs: { 'dryer-spain': { ...fixtureRun('dryer-spain'), notices } },
    }),
  });
  for (const notice of notices) {
    const item = await screen.findByText(notice);
    expect(item.closest('[role="status"]')).not.toBeNull();
  }
});

test('an unknown scenario says so and starts nothing', async () => {
  const api = withCap();
  const start = vi.spyOn(api, 'startRun');
  renderApp({ route: '/run/nope', api });
  expect(
    await screen.findByRole('heading', { level: 1, name: 'There is no purchase called “nope”.' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'See the four purchases' })).toHaveAttribute('href', '/');
  expect(start).not.toHaveBeenCalled();
});

test('the last purchase links back to all purchases', async () => {
  const api = withCap();
  renderApp({ route: '/run/tv-wall', api });
  await screen.findByRole('button', { name: 'Send answers' });
  answer('No');
  expect(await screen.findByText('Second pick')).toBeInTheDocument();
  answer('Yes');
  expect(await screen.findByRole('link', { name: 'Back to all purchases' })).toHaveAttribute(
    'href',
    '/',
  );
  expect(screen.getByText('PayPal captured $1,199.99 from the $3,000.00 cap.')).toBeInTheDocument();
});
