import { AnswersRequestSchema, API, RunCreateRequestSchema } from '@fitcheck/contracts';
import { Hono } from 'hono';
import type { Deps } from '../../deps.js';
import { getRun, startRun, submitAnswers } from '../../runs/runs.js';
import { parseBody } from '../http.js';
import type { ApiEnv } from '../session.js';

export function runRoutes(deps: Deps): Hono<ApiEnv> {
  return new Hono<ApiEnv>()
    .post(API.runs, async (c) => {
      const body = await parseBody(c, RunCreateRequestSchema);
      return c.json(await startRun(deps, { sessionId: c.var.sessionId, ...body }));
    })
    .get(`${API.runs}/:runId`, async (c) =>
      c.json(await getRun(deps, { sessionId: c.var.sessionId, runId: c.req.param('runId') })),
    )
    .post(`${API.runs}/:runId/answers`, async (c) => {
      const body = await parseBody(c, AnswersRequestSchema);
      return c.json(
        await submitAnswers(deps, {
          sessionId: c.var.sessionId,
          runId: c.req.param('runId'),
          body,
        }),
      );
    });
}
