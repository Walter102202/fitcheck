// The global styles load first, so every component's CSS Module comes after them and wins
// over `.wrap` and the base rules wherever both set the same property.
import './styles/fonts.css';
import './styles/tokens.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { httpApi } from './api/http.js';
import { FIXTURES_MODE } from './api/mode.js';
import type { FitcheckApi } from './api/types.js';
import { App } from './app.js';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
const container = root;

// The fake API is imported only in fixture mode, so it stays out of the production bundle.
async function pickApi(): Promise<FitcheckApi> {
  if (!FIXTURES_MODE) return httpApi;
  const { createFakeApi } = await import('./api/fixtures/fake-api.js');
  return createFakeApi({ persist: true });
}

void pickApi().then((api) => {
  createRoot(container).render(
    <StrictMode>
      <App api={api} />
    </StrictMode>,
  );
});
