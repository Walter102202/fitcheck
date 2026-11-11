import { fireEvent, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { createFakeApi } from '../../api/fixtures/fake-api.js';
import { FIXTURE_RESULTS } from '../../api/fixtures/results.js';
import { renderApp } from '../../test/render.js';

vi.mock('../../lib/browser.js', () => ({ goTo: vi.fn(), postForm: vi.fn() }));

test('every metric has two rows with counts', async () => {
  renderApp({ route: '/results' });
  for (const row of FIXTURE_RESULTS.rows)
    expect(await screen.findByRole('heading', { level: 2, name: row.label })).toBeInTheDocument();
  expect(screen.getAllByText('Spending cap only')).toHaveLength(6);
  expect(screen.getByText('14 of 16')).toBeInTheDocument();
  expect(screen.getAllByText('Not measured yet').length).toBeGreaterThanOrEqual(6);
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Does it work? 32 purchases Fitcheck had never seen.',
    }),
  ).toBeInTheDocument();
  expect(screen.getByText('The held-out run has not been committed yet.')).toBeInTheDocument();
});

test('the legend shows the pending square while anything is pending', async () => {
  renderApp({ route: '/results' });
  await screen.findByText('14 of 16');
  expect(screen.getByText('Paid, and it should not have been')).toBeInTheDocument();
  // Six Fitcheck rows, plus the legend.
  expect(screen.getAllByText('Not measured yet').length).toBe(7);
});

test('the notes appear under What this does not show', async () => {
  renderApp({ route: '/results' });
  expect(
    await screen.findByRole('heading', { level: 2, name: 'What this does not show' }),
  ).toBeInTheDocument();
  for (const note of FIXTURE_RESULTS.notes) expect(screen.getByText(note)).toBeInTheDocument();
  expect(screen.getByText('Reproduce without any key: pnpm measure --replay')).toBeInTheDocument();
});

test('no percentage anywhere', async () => {
  renderApp({ route: '/results' });
  await screen.findByText('14 of 16');
  expect(document.body.textContent).not.toMatch(/%/);
});

test('a committed run shows its date, model and commit', async () => {
  const api = createFakeApi();
  vi.spyOn(api, 'getResults').mockResolvedValue({
    ...FIXTURE_RESULTS,
    measuredAt: '2026-11-11T23:40:00Z',
    heldOutCommit: 'abc1234def',
  });
  renderApp({ route: '/results', api });
  expect(
    await screen.findByText(
      'Measured on 2026-11-11 with Claude Sonnet 5.5. Held-out set committed in abc1234.',
    ),
  ).toBeInTheDocument();
});

test('a failed load says so and retries', async () => {
  const api = createFakeApi();
  const load = vi.spyOn(api, 'getResults').mockRejectedValueOnce(new Error('down'));
  renderApp({ route: '/results', api });
  expect(await screen.findByRole('alert')).toHaveTextContent('The results did not load.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('14 of 16')).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(2);
});
