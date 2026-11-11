import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { createFakeApi } from '../api/fixtures/fake-api.js';
import { GITHUB_URL } from '../lib/links.js';
import { renderApp, renderWithProviders } from '../test/render.js';
import { TopBar } from './TopBar.js';

vi.mock('../lib/browser.js', () => ({ goTo: vi.fn(), postForm: vi.fn() }));

test('shows the PayPal and Channel3 modes from /api/config', async () => {
  renderWithProviders(<TopBar />);
  expect(await screen.findByText(/PayPal:/)).toHaveTextContent('PayPal: simulated');
  expect(screen.getByText(/Channel3:/)).toHaveTextContent('Channel3: recorded copy');
});

test('a sandbox and live config reads as such', async () => {
  const api = createFakeApi();
  vi.spyOn(api, 'getConfig').mockResolvedValue({
    paypalMode: 'sandbox',
    channel3Mode: 'live',
    reviewModel: 'claude-sonnet-5-5',
    capAmountCents: 300000,
  });
  renderWithProviders(<TopBar />, { api });
  expect(await screen.findByText(/PayPal:/)).toHaveTextContent('PayPal: sandbox');
  expect(screen.getByText(/Channel3:/)).toHaveTextContent('Channel3: live');
});

test('the mode chips are absent while the config loads', () => {
  const api = createFakeApi();
  vi.spyOn(api, 'getConfig').mockReturnValue(new Promise(() => {}));
  renderWithProviders(<TopBar />, { api });
  expect(screen.queryByText(/PayPal:/)).toBeNull();
  expect(screen.queryByText(/Channel3:/)).toBeNull();
});

test('the wordmark goes home and GitHub goes to the repo', () => {
  renderWithProviders(<TopBar />);
  expect(screen.getByRole('link', { name: 'Fitcheck' })).toHaveAttribute('href', '/');
  expect(screen.getByRole('link', { name: 'Results' })).toHaveAttribute('href', '/results');
  expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', GITHUB_URL);
});

test('Run a purchase is current everywhere except Results', async () => {
  const run = renderApp({ route: '/run/dryer-spain' });
  expect(screen.getByRole('link', { name: 'Run a purchase' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  run.unmount();
  renderApp({ route: '/results' });
  expect(screen.getByRole('link', { name: 'Results' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Run a purchase' })).not.toHaveAttribute('aria-current');
});
