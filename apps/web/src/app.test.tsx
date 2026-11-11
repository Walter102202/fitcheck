import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { createFakeApi } from './api/fixtures/fake-api.js';
import { renderApp } from './test/render.js';

vi.mock('./lib/browser.js', () => ({ goTo: vi.fn(), postForm: vi.fn() }));

test.each([
  ['/', /Your agent can pay/],
  ['/results', /Does it work\?/],
  ['/cap', /Approve a spending cap for your agent/],
  ['/somewhere', /This page does not exist/],
])('route %s renders its screen', async (route, heading) => {
  // No cap yet, so /cap stays on the approval screen instead of skipping to a purchase.
  renderApp({ route, api: createFakeApi() });
  expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
});

test('the not-found page links back to the first screen', async () => {
  renderApp({ route: '/nowhere' });
  expect(await screen.findByRole('link', { name: 'Go to the first screen' })).toHaveAttribute(
    'href',
    '/',
  );
});
