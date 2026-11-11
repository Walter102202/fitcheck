import { fileURLToPath } from 'node:url';
import { API } from '@fitcheck/contracts';
import { Hono } from 'hono';
import { mountStatic, notFound, onError } from './api/http.js';
import { configRoutes } from './api/routes/config.js';
import { runRoutes } from './api/routes/runs.js';
import { scenarioRoutes } from './api/routes/scenarios.js';
import { type ApiEnv, withSession } from './api/session.js';
import type { Deps } from './deps.js';

export { configFrom } from './api/routes/config.js';

/** The JSON API, the PayPal webhook and the built web app, in one Hono app. */
export function createApp(deps: Deps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.onError(onError<ApiEnv>(deps.logger));
  app.get(API.healthz, (c) => c.json({ ok: true }));
  app.use('/api/*', withSession(deps));
  for (const routes of [configRoutes(deps), scenarioRoutes(), runRoutes(deps)]) {
    app.route('/', routes);
  }
  app.all('/api/*', notFound);
  app.notFound(notFound);
  mountStatic(
    app,
    deps.env.WEB_DIST_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url)),
  );
  return app;
}
