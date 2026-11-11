import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ResultsJson, ResultsJsonSchema } from '@fitcheck/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createHarness } from '../runs/harness.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;
let h: Harness;
afterEach(async () => h?.close());

const results = (o: Partial<ResultsJson>): ResultsJson => ({
  measuredAt: null,
  model: 'claude-sonnet-5-5',
  recordedOn: '2026-11-10',
  heldOutCommit: null,
  rows: [],
  notes: [],
  ...o,
});

describe('GET /api/results', () => {
  it('serves expected.json until latest.json exists, then latest.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'results-'));
    writeFileSync(join(dir, 'expected.json'), JSON.stringify(results({ notes: ['expected'] })));
    h = await createHarness({ env: { EVAL_RESULTS_DIR: dir } });
    const app = createApp(h.deps);
    const first = await app.request('/api/results');
    expect(first.status).toBe(200);
    expect(ResultsJsonSchema.parse(await first.json()).notes).toEqual(['expected']);
    writeFileSync(
      join(dir, 'latest.json'),
      JSON.stringify(results({ measuredAt: '2026-11-11T20:00:00.000Z', notes: ['latest'] })),
    );
    const second = ResultsJsonSchema.parse(await (await app.request('/api/results')).json());
    expect(second).toMatchObject({ measuredAt: '2026-11-11T20:00:00.000Z', notes: ['latest'] });
  });

  it('an invalid results file is a 500', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'results-'));
    writeFileSync(join(dir, 'expected.json'), JSON.stringify({ rows: 'nope' }));
    h = await createHarness({ env: { EVAL_RESULTS_DIR: dir } });
    const res = await createApp(h.deps).request('/api/results');
    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toMatchObject({ error: 'internal_error' });
  });

  it('serves the repository expected.json by default', async () => {
    h = await createHarness();
    const res = await createApp(h.deps).request('/api/results');
    expect(res.status).toBe(200);
    const served = ResultsJsonSchema.parse(await res.json());
    expect(served.rows.map((r) => r.id)[0]).toBe('wrong_paid');
  });
});
