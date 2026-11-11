import { type RenderResult, render } from '@testing-library/react';
import { type ReactNode, StrictMode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { AppConfigProvider } from '../api/config.js';
import { ApiProvider } from '../api/context.js';
import { activeFixtureCap, createFakeApi } from '../api/fixtures/fake-api.js';
import type { FitcheckApi } from '../api/types.js';
import { AppRoutes } from '../app.js';

/** Prints the current path and query, so tests can assert navigations. */
export function LocationProbe() {
  const { pathname, search } = useLocation();
  return (
    <output data-testid="location">
      {pathname}
      {search}
    </output>
  );
}

function Providers({ api, children }: { api: FitcheckApi; children: ReactNode }) {
  return (
    <ApiProvider api={api}>
      <AppConfigProvider>{children}</AppConfigProvider>
    </ApiProvider>
  );
}

/** One component under the router and providers; the default API has an active cap. */
export function renderWithProviders(
  ui: ReactNode,
  o: { api?: FitcheckApi; route?: string } = {},
): RenderResult & { api: FitcheckApi } {
  const api = o.api ?? createFakeApi({ cap: activeFixtureCap() });
  const result = render(
    <MemoryRouter initialEntries={[o.route ?? '/']}>
      <Providers api={api}>{ui}</Providers>
    </MemoryRouter>,
  );
  return { ...result, api };
}

/** The `pageshow` a browser fires when Back restores the page from its back-forward cache. */
export function restoredFromCache(): Event {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: true });
  return event;
}

/** The whole app at `route`, with a LocationProbe beside it. */
export function renderApp(o: {
  route: string;
  api?: FitcheckApi;
  strict?: boolean;
}): RenderResult & { api: FitcheckApi } {
  const api = o.api ?? createFakeApi({ cap: activeFixtureCap() });
  const tree = (
    <MemoryRouter initialEntries={[o.route]}>
      <Providers api={api}>
        <AppRoutes />
        <LocationProbe />
      </Providers>
    </MemoryRouter>
  );
  const result = render(o.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { ...result, api };
}
