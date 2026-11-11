import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { createFakeApi } from '../../api/fixtures/fake-api.js';
import { renderApp } from '../../test/render.js';

vi.mock('../../lib/browser.js', () => ({ goTo: vi.fn(), postForm: vi.fn() }));

test('the simulated page names itself and shows no image', async () => {
  const { container } = renderApp({
    route: '/cap/approve-simulated?token=t1',
    api: createFakeApi({ cap: null }),
  });
  expect(
    await screen.findByRole('heading', { level: 1, name: 'PayPal (simulated)' }),
  ).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByText(/This is not PayPal’s page/)).toBeInTheDocument();
  expect(
    await screen.findByText('Approve a spending cap of $3,000.00 for your shopping agent?'),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/cap?cancelled=1');
});

test('approving on the simulated page completes the approval with its token', async () => {
  const api = createFakeApi({ cap: null });
  const complete = vi
    .spyOn(api, 'completeSimulatedApproval')
    .mockReturnValue(new Promise(() => {}));
  renderApp({ route: '/cap/approve-simulated?token=t1', api });
  const approve = await screen.findByRole('button', { name: 'Approve the cap' });
  fireEvent.click(approve);
  fireEvent.click(approve);
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  expect(complete).toHaveBeenCalledWith('t1');
  expect(approve).toBeDisabled();
});

test('a missing token says so', async () => {
  renderApp({ route: '/cap/approve-simulated', api: createFakeApi({ cap: null }) });
  expect(await screen.findByText('This approval link has no token.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to the cap' })).toHaveAttribute('href', '/cap');
  expect(screen.queryByRole('button', { name: 'Approve the cap' })).toBeNull();
});
