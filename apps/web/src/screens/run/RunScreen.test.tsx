import {
  formatUsd,
  type RunResponse,
  runDryerSilent,
  runDryerSpain,
  runSonyAsk,
} from '@fitcheck/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ZodError } from 'zod';
import { ApiRequestError } from '../../api/errors.js';
import { activeFixtureCap, createFakeApi } from '../../api/fixtures/fake-api.js';
import { failedClosedRun, fixtureRun, pendingCaptureRun } from '../../api/fixtures/runs.js';
import { FIXTURE_SCENARIOS } from '../../api/fixtures/scenarios.js';
import { goTo } from '../../lib/browser.js';
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

test('step 1 says scripted requirements were written by hand', async () => {
  renderApp({ route: '/run/dryer-spain', api: withCap() });
  expect(
    await screen.findByText(
      'These requirements were written by hand for the four demo requests. With a model key, Claude Sonnet 5.5 reads them from the request.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(/read these requirements/)).toBeNull();
});

test('step 1 says recorded requirements are Claude’s recorded answer', async () => {
  const api = withCap();
  vi.spyOn(api, 'getConfig').mockResolvedValue({
    paypalMode: 'simulated',
    channel3Mode: 'recorded',
    reviewModel: 'claude-sonnet-5-5',
    reviewSource: 'recorded',
    capAmountCents: 300000,
  });
  renderApp({ route: '/run/dryer-spain', api });
  expect(
    await screen.findByText(
      'Claude Sonnet 5.5 read these requirements from this request earlier. This page replays its recorded answer.',
    ),
  ).toBeInTheDocument();
});

test('step 3 folds the backed every-purchase rows; flagged rows and the verdict stay in view', async () => {
  renderApp({ route: '/run/dryer-spain', api: withCap() });
  await screen.findByText('Second pick');
  const step3 = document.querySelector('[data-step="3"]') as HTMLElement;
  const results = (runDryerSpain.attempts[0]?.review.results ?? []).filter(
    (r) => r.state !== 'not_applicable',
  );
  const routine = results.filter((r) => r.state === 'backed' && r.origin === 'always');
  const fold = step3.querySelector('details') as HTMLElement;
  expect(fold).not.toHaveAttribute('open');
  expect(fold.querySelector('summary')).toHaveTextContent(
    `${routine.length} more checked on every purchase, all backed`,
  );
  for (const r of routine) expect(within(fold).getByText(r.name)).toBeInTheDocument();
  // The broken row and the buyer's own backed row stay outside the fold.
  for (const r of results.filter((x) => !routine.includes(x))) {
    expect(within(step3).getByText(r.name)).toBeInTheDocument();
    expect(within(fold).queryByText(r.name)).toBeNull();
  }
  expect(within(step3).getByText('9 backed, 1 broken.')).toBeInTheDocument();
});

test('steps number on across picks instead of starting again at 1', async () => {
  renderApp({ route: '/run/dryer-spain', api: withCap() });
  await screen.findByText('Second pick');
  const steps = [...document.querySelectorAll('[data-step]')];
  expect(steps.map((s) => s.getAttribute('data-step'))).toEqual(['1', '2', '3', '4', '5']);
  expect(steps.map((s) => s.querySelector('h2')?.textContent)).toEqual([
    'What Fitcheck will check',
    'The agent picked',
    'Fitcheck checked the listing',
    'The agent picked again',
    'Fitcheck checked the listing',
  ]);
});

test('review off: no requirements step, and the capture does not read as a success', async () => {
  const price = formatUsd(runDryerSilent.attempts[0]?.pick.priceCents ?? 0);
  renderApp({ route: '/run/dryer-silent?review=off', api: withCap() });
  await waitFor(() => expect(document.querySelector('[data-kind]')).not.toBeNull());
  expect(screen.queryByRole('heading', { name: 'What Fitcheck will check' })).toBeNull();
  expect(screen.queryByText(/read these requirements/)).toBeNull();
  const steps = [...document.querySelectorAll('[data-step]')];
  expect(steps.map((s) => s.getAttribute('data-step'))).toEqual(['1', '2']);
  expect(document.querySelector('[data-kind="captured"]')).toBeNull();
  const unchecked = document.querySelector('[data-kind="unchecked"]');
  expect(unchecked).toHaveTextContent(`Captured ${price}. Nobody checked the listing.`);
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

test('a record from the recorded copy never says it was fetched again', async () => {
  const run = structuredClone(runDryerSpain);
  for (const attempt of run.attempts) {
    const record = attempt.review.record;
    if (record) attempt.review.record = { ...record, source: 'recorded', recordedOn: '2026-11-10' };
  }
  renderApp({
    route: '/run/dryer-spain',
    api: createFakeApi({ cap: activeFixtureCap(), runs: { 'dryer-spain': run } }),
  });
  expect(
    (await screen.findAllByText('Copy recorded from Channel3 on 2026-11-10.', { exact: false }))
      .length,
  ).toBe(2);
  expect(screen.queryByText(/fetched again/)).toBeNull();
});

test('a failed-closed attempt shows no record line, since no fresh record was read', async () => {
  // Lane C keeps the pick-time record on an attempt whose re-fetch failed.
  const run = failedClosedRun();
  const first = run.attempts[0];
  if (!first) throw new Error('failedClosedRun has no attempt');
  first.review.record = { fetchedAt: '2026-11-10T22:39:58.000Z', source: 'live' };
  renderApp({
    route: '/run/dryer-spain',
    api: createFakeApi({ cap: activeFixtureCap(), runs: { 'dryer-spain': run } }),
  });
  expect(
    (await screen.findAllByText('Fitcheck could not check this listing.')).length,
  ).toBeGreaterThan(0);
  expect(screen.queryByText(/fetched again|Copy recorded/)).toBeNull();
  expect(screen.queryByText(/Nothing is taken from the agent’s word/)).toBeNull();
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
  expect(strip).toHaveTextContent('You did not accept every line');
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

test('a ?run= from another visit offers to run the purchase again, and that starts one run', async () => {
  const api = withCap();
  const start = vi.spyOn(api, 'startRun');
  renderApp({ route: '/run/dryer-spain?run=run-from-someone-else', api });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('This purchase is from another visit.');
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Run it again' }));
  await screen.findByText('Second pick');
  expect(start).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledWith({ scenarioId: 'dryer-spain', review: 'on' });
  await waitFor(() =>
    expect(screen.getByTestId('location').textContent).toMatch(/^\/run\/dryer-spain\?run=run-fx-/),
  );
});

test('a reply that drifts from the contract shows a readable error, not the schema dump', async () => {
  const api = withCap();
  vi.spyOn(api, 'startRun').mockRejectedValueOnce(
    new ZodError([{ code: 'custom', path: ['runId'], message: 'Invalid input', input: 1 }]),
  );
  renderApp({ route: '/run/dryer-spain', api });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('This purchase did not load.');
  expect(alert).toHaveTextContent('The server’s reply did not match what this page expects.');
  expect(alert.textContent).not.toMatch(/[[{]/);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('a network failure says the server did not answer', async () => {
  const api = withCap();
  vi.spyOn(api, 'startRun').mockRejectedValueOnce(new TypeError('Failed to fetch'));
  renderApp({ route: '/run/dryer-spain', api });
  expect(await screen.findByRole('alert')).toHaveTextContent('The server did not answer.');
});

const CAP_SHORT = 'Not paid. The spending cap has $168.81 left.';

/** tv-sony after the cap refused the hold: the review asked, but the attempt ended at once. */
function sonyRefusedByCap(): RunResponse {
  const run = structuredClone(runSonyAsk);
  const first = run.attempts[0];
  if (!first) throw new Error('runSonyAsk has no attempt');
  first.outcome = { decision: 'return_to_agent', amountCents: 0, agentMessage: CAP_SHORT };
  return { ...run, status: 'done' };
}

test('a hold the cap refused shows not captured in step 3 too, and no card', async () => {
  renderApp({
    route: '/run/tv-sony',
    api: createFakeApi({ cap: activeFixtureCap(), runs: { 'tv-sony': sonyRefusedByCap() } }),
  });
  const strip = await waitFor(() => {
    const el = document.querySelector('[data-kind="not_captured"]');
    if (!el) throw new Error('no strip yet');
    return el;
  });
  expect(strip).toHaveTextContent(`Sent to the agent: ${CAP_SHORT}`);
  const steps = screen.getByTestId('steps');
  expect(within(steps).getByText('Nothing was captured. The reason is below.')).toBeInTheDocument();
  expect(within(steps).queryByText('The payment waits and the buyer gets one card.')).toBeNull();
  expect(within(steps).queryByText('On hold')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Send answers' })).toBeNull();
});

/** The same refusal with the cap really short: $168.81 left, less than the TV. */
function sonyCapRanOut(): RunResponse {
  const run = sonyRefusedByCap();
  const available = 16881;
  return {
    ...run,
    cap: {
      ...run.cap,
      heldCents: 0,
      capturedCents: run.cap.amountCents - available,
      availableCents: available,
    },
    notices: ['The spending cap has $168.81 left.'],
  };
}

test('when the cap has too little left, the run offers Start over with one line on what it does', async () => {
  const api = createFakeApi({ cap: activeFixtureCap(), runs: { 'tv-sony': sonyCapRanOut() } });
  const reset = vi.spyOn(api, 'resetSession');
  renderApp({ route: '/run/tv-sony', api });
  const button = await screen.findByRole('button', { name: 'Start over' });
  const strip = document.querySelector('[data-kind="not_captured"]');
  expect(strip).toContainElement(button);
  expect(strip).toHaveTextContent(
    'Starting over releases this cap and asks you to approve a new one.',
  );
  fireEvent.click(button);
  await waitFor(() => expect(goTo).toHaveBeenCalledWith('/?reset=done'));
  expect(reset).toHaveBeenCalledTimes(1);
});

test('a refusal that is not the cap, or one the review made, offers no Start over', async () => {
  const declined = sonyRefusedByCap();
  const attempt = declined.attempts[0];
  if (attempt) {
    attempt.outcome = {
      decision: 'return_to_agent',
      amountCents: 0,
      agentMessage: 'Not paid. PayPal declined the capture.',
    };
  }
  const first = renderApp({
    route: '/run/tv-sony',
    api: createFakeApi({ cap: activeFixtureCap(), runs: { 'tv-sony': declined } }),
  });
  await waitFor(() => expect(document.querySelector('[data-kind="not_captured"]')).not.toBeNull());
  expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
  first.unmount();
  renderApp({ route: '/run/dryer-spain', api: withCap() });
  await screen.findByText('Second pick');
  expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
});

/** tv-sony after an all-yes card that the ledger refused: answers kept, outcome not paid. */
function sonyYesRefused(sentence: string, cap: Partial<RunResponse['cap']>): RunResponse {
  const run = sonyRefusedByCap();
  const first = run.attempts[0];
  const line = first?.review.card?.lines[0];
  if (!first || !line) throw new Error('runSonyAsk has no card');
  first.answers = { [line.lineId]: 'yes' };
  first.outcome = {
    decision: 'return_to_agent',
    amountCents: 0,
    agentMessage: `Not paid. ${sentence}`,
  };
  return { ...run, cap: { ...run.cap, ...cap }, notices: [sentence] };
}

const withRun = (scenarioId: string, run: RunResponse) =>
  createFakeApi({ cap: activeFixtureCap(), runs: { [scenarioId]: run } });

test('an all-yes card the cap refused says the payment did not go through, and offers Start over', async () => {
  const run = sonyYesRefused('The spending cap has $168.81 left.', {
    heldCents: 0,
    capturedCents: 300000 - 16881,
    availableCents: 16881,
  });
  renderApp({ route: '/run/tv-sony', api: withRun('tv-sony', run) });
  const button = await screen.findByRole('button', { name: 'Start over' });
  const strip = document.querySelector('[data-kind="not_captured"]');
  expect(strip).toContainElement(button);
  expect(strip).toHaveTextContent(
    'You answered yes to every line, but the payment did not go through.',
  );
  expect(strip).toHaveTextContent(
    'Sent to the agent: Not paid. The spending cap has $168.81 left.',
  );
  expect(strip?.textContent).not.toMatch(/did not accept/);
});

test('a cap that is no longer active offers Start over that asks for a new cap', async () => {
  const run = sonyYesRefused('The spending cap is no longer active.', {
    status: 'expired',
    heldCents: 0,
  });
  renderApp({ route: '/run/tv-sony', api: withRun('tv-sony', run) });
  const button = await screen.findByRole('button', { name: 'Start over' });
  const strip = document.querySelector('[data-kind="not_captured"]');
  expect(strip).toContainElement(button);
  expect(strip).toHaveTextContent('Starting over asks you to approve a new cap.');
});

test('the README path: a later purchase the short cap refuses also offers Start over', async () => {
  // Purchases 1-3, then the Sony again with the review off: the wall TV's hold is refused.
  const wall = fixtureRun('tv-wall');
  const first = wall.attempts[0];
  if (!first) throw new Error('tv-wall has no attempt');
  const sentence = 'The spending cap has $163.60 left.';
  const run: RunResponse = {
    ...wall,
    attempts: [
      {
        ...first,
        outcome: {
          decision: 'return_to_agent',
          amountCents: 0,
          agentMessage: `Not paid. ${sentence}`,
        },
      },
    ],
    status: 'done',
    cap: { ...wall.cap, heldCents: 0, capturedCents: 300000 - 16360, availableCents: 16360 },
    notices: [sentence],
  };
  renderApp({ route: '/run/tv-wall', api: withRun('tv-wall', run) });
  expect(await screen.findByRole('button', { name: 'Start over' })).toBeInTheDocument();
});

test('a capture PayPal is still confirming shows as pending, not as captured $0.00', async () => {
  renderApp({ route: '/run/dryer-spain', api: withRun('dryer-spain', pendingCaptureRun()) });
  await screen.findByText('Second pick');
  const strip = document.querySelector('[data-kind="pending"]');
  expect(strip).toHaveTextContent('PayPal is still confirming this capture.');
  expect(strip?.textContent).not.toMatch(/\$0\.00/);
  expect(document.querySelector('[data-kind="captured"]')).toBeNull();
  expect(screen.queryByText(/PayPal captured \$0\.00/)).toBeNull();
  // Step 5's verdict does not claim a capture either.
  const step5 = document.querySelector('[data-step="5"]') as HTMLElement;
  expect(within(step5).queryByText('Captured')).toBeNull();
});

test('with the review off, the strip follows what PayPal did, not the cap-only forecast', async () => {
  const api = withCap();
  const run = sonyRefusedByCap();
  vi.spyOn(api, 'startRun').mockResolvedValue({ ...run, review: 'off', runId: 'run-off' });
  renderApp({ route: '/run/tv-sony?review=off', api });
  const strip = await waitFor(() => {
    const el = document.querySelector('[data-kind]');
    if (!el) throw new Error('no strip yet');
    return el;
  });
  expect(strip).toHaveAttribute('data-kind', 'not_captured');
  expect(strip).toHaveTextContent('$0.00');
  expect(strip).toHaveTextContent(`Sent to the agent: ${CAP_SHORT}`);
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
  expect(screen.getByText('Captured $29.29. Nobody checked the listing.')).toBeInTheDocument();
  expect(screen.queryByText('With a spending cap only')).toBeNull();
  expect(screen.getByRole('radio', { name: 'Off: spending cap only' })).toBeChecked();
  expect(screen.getByTestId('location').textContent).toMatch(/review=off/);
});

test('a pending capture says so once, in the strip, not again in the notices', async () => {
  renderApp({ route: '/run/dryer-spain', api: withRun('dryer-spain', pendingCaptureRun()) });
  await screen.findByText('Second pick');
  expect(screen.getAllByText('PayPal is still confirming this capture.')).toHaveLength(1);
  expect(
    document
      .querySelector('[data-kind="pending"]')
      ?.textContent?.includes('PayPal is still confirming this capture.'),
  ).toBe(true);
});

test('a cap stop says the cap sentence and the new-cap step once, in the strip', async () => {
  const run = sonyYesRefused('The spending cap is no longer active.', {
    status: 'expired',
    heldCents: 0,
  });
  run.notices = [
    'The spending cap is no longer active.',
    'Approve a new spending cap to keep buying.',
    'Channel3 did not answer. Showing the copy recorded on 2026-11-10.',
  ];
  renderApp({ route: '/run/tv-sony', api: withRun('tv-sony', run) });
  await screen.findByRole('button', { name: 'Start over' });
  expect(screen.queryByText('Approve a new spending cap to keep buying.')).toBeNull();
  const banner = screen
    .getByText('Channel3 did not answer. Showing the copy recorded on 2026-11-10.')
    .closest('ul');
  expect(banner?.textContent).not.toMatch(/no longer active/);
  expect(screen.getAllByText(/The spending cap is no longer active\./)).toHaveLength(1);
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
