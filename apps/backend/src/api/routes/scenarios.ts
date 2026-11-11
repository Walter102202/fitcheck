import { API } from '@fitcheck/contracts';
import { Hono } from 'hono';
import { scenarioList } from '../../agent/scenarios.js';
import type { ApiEnv } from '../session.js';

export function scenarioRoutes(): Hono<ApiEnv> {
  return new Hono<ApiEnv>().get(API.scenarios, (c) => c.json(scenarioList()));
}
