// The real Hono app over HTTP: mock PayPal, recorded Channel3, Lane B's review on its recorded
// intents, and an in-memory database. Each visitor keeps its own session cookie.
import {
  type Answer,
  API,
  type Cap,
  CapSchema,
  type RunResponse,
  RunResponseSchema,
} from '@fitcheck/contracts';
import { createApp } from '../../apps/backend/src/app.js';
import { loadEnv } from '../../apps/backend/src/env.js';
import { createHarness, HARNESS_NOW } from '../../apps/backend/src/runs/harness.js';
import { createPorts } from '../../apps/backend/src/runs/ports.js';

export type E2E = Awaited<ReturnType<typeof createE2E>>;

export async function createE2E(env: Record<string, string> = {}) {
  const ports = createPorts(loadEnv({ ...env }), { now: () => HARNESS_NOW });
  const h = await createHarness({ env, review: ports.review, channel3: ports.channel3 });
  const app = createApp(h.deps);

  function visitor(initialCookie = '') {
    let cookie = initialCookie;
    async function request(path: string, init: RequestInit = {}): Promise<Response> {
      const headers = new Headers(init.headers);
      if (cookie) headers.set('cookie', cookie);
      const res = await app.request(path, { ...init, headers });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0] ?? '';
      return res;
    }
    const json = (body: unknown): RequestInit => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    return {
      get cookie() {
        return cookie;
      },
      request,
      async cap(): Promise<Cap | null> {
        const body: unknown = await (await request(API.cap)).json();
        return body === null ? null : CapSchema.parse(body);
      },
      /** POST /api/cap only: the cap stays pending until the buyer approves it. */
      async openCap(scenarioId?: string): Promise<Cap> {
        const res = await request(API.cap, json(scenarioId ? { scenarioId } : {}));
        return CapSchema.parse(await res.json());
      },
      /**
       * Opens the cap and approves it the way the browser does. A mock cap is active at once;
       * a simulated cap (sandbox without credentials) goes through the approval page.
       */
      async approveCap(scenarioId?: string): Promise<Cap> {
        const opened = await this.openCap(scenarioId);
        if (opened.status === 'active') return opened;
        const token = new URL(opened.approveUrl ?? '', 'http://x').searchParams.get('token');
        if (!token) throw new Error(`No approval token in ${opened.approveUrl}`);
        const approve = await request(
          `${API.capApproveSimulated}?token=${encodeURIComponent(token)}`,
          { method: 'POST' },
        );
        const back = await request(approve.headers.get('location') ?? '');
        if (back.status !== 303) throw new Error(`Approval return answered ${back.status}`);
        const cap = await this.cap();
        if (!cap) throw new Error('No cap after approval');
        return cap;
      },
      async startRaw(scenarioId: string, review: 'on' | 'off' = 'on'): Promise<Response> {
        return request(API.runs, json({ scenarioId, review }));
      },
      async start(scenarioId: string, review: 'on' | 'off' = 'on'): Promise<RunResponse> {
        const res = await this.startRaw(scenarioId, review);
        if (res.status !== 200)
          throw new Error(`POST /api/runs ${res.status}: ${await res.text()}`);
        return RunResponseSchema.parse(await res.json());
      },
      /** Answers every line of the last attempt's card with one value. */
      async answerAll(run: RunResponse, value: Answer): Promise<RunResponse> {
        const last = run.attempts.at(-1);
        const answers = Object.fromEntries(
          (last?.review.card?.lines ?? []).map((line) => [line.lineId, value]),
        );
        const res = await request(
          API.runAnswers(run.runId),
          json({ attemptNo: last?.attemptNo ?? 1, answers }),
        );
        if (res.status !== 200) throw new Error(`answers ${res.status}: ${await res.text()}`);
        return RunResponseSchema.parse(await res.json());
      },
      async reset(): Promise<Response> {
        return request(API.sessionReset, { method: 'POST' });
      },
    };
  }

  return { app, deps: h.deps, paypal: h.paypal, visitor, close: h.close };
}
