import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { holdPurchase, settleCapture } from '../../apps/backend/src/ledger/purchases.js';
import { activeCap } from '../../apps/backend/src/runs/harness.js';
import {
  createRecordedChannel3,
  createStubReviewPort,
} from '../../apps/backend/src/runs/review-stub.js';
import type { EvalCase } from './case-schema.js';
import {
  claimRecordingsDir,
  createEvalDeps,
  type EvalDeps,
  guardLiveRun,
  measureCases,
  replayVerdict,
  runCase,
} from './harness.js';
import { capturedFor } from './ledger-read.js';

let ctx: EvalDeps | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

/** The Sony TV at pcrichard.com, $1,398.00: the stub review asks one line about it. */
function sonyCase(over: Partial<EvalCase> = {}, attempt: Partial<EvalCase['attempt']> = {}) {
  const c: EvalCase = {
    id: 't-tv-90',
    split: 'tuning',
    category: 'tv',
    family: 'sony',
    request: 'A 65-inch OLED TV for the living room. Up to $1,500.',
    known_to_agent: {},
    dossier: {},
    attempt: {
      product_id: 'UXXAg59',
      store: 'pcrichard.com',
      quantity: 1,
      price_seen_cents: 139800,
      amount_cents: 139800,
      ...attempt,
    },
    label: { class: 'correct', should_end_paid: true, evidence: 'e' },
    ...over,
  };
  return c;
}
/** The 120 V hair dryer at walmart.com, $29.29: the stub review returns it to the agent. */
const dryerCase = (): EvalCase => ({
  id: 't-dryer-90',
  split: 'tuning',
  category: 'hair_dryer',
  family: 'aniq',
  request: 'A hair dryer for my trip to Spain next week. Under $40.',
  known_to_agent: {},
  dossier: {},
  attempt: {
    product_id: 'cv7t721',
    store: 'walmart.com',
    quantity: 1,
    price_seen_cents: 2929,
    amount_cents: 2929,
  },
  label: {
    class: 'wrong',
    failure: 'stated_ignored',
    broken_key: 'hair_dryer.dual_voltage',
    should_end_paid: false,
    evidence: 'e',
  },
});

async function evalDeps(review = createStubReviewPort()) {
  ctx = await createEvalDeps({ review, channel3: createRecordedChannel3() });
  return ctx.deps;
}

describe('measurement harness', () => {
  it('a store-not-allowed case is not paid under cap only', async () => {
    const deps = await evalDeps();
    const c = sonyCase({
      request: 'A 65-inch OLED TV from bestbuy.com, up to $1,500.',
      allowed_stores: ['bestbuy.com'],
    });
    const out = await runCase(deps, c, 'cap_only', 1);
    expect(out).toMatchObject({
      caseId: 't-tv-90',
      column: 'cap_only',
      run: 1,
      captured: false,
      capturedCents: 0,
      asked: false,
      lines: 0,
      decision: 'return_to_agent',
      failedClosed: false,
      unavailable: null,
    });
  });

  it('a case the cap allows is paid under cap only, for the amount the agent saw', async () => {
    const deps = await evalDeps();
    const out = await runCase(deps, dryerCase(), 'cap_only', 1);
    expect(out).toMatchObject({ captured: true, capturedCents: 2929, decision: 'capture' });
  });

  it('capture read from the ledger agrees with the mock gateway', async () => {
    const deps = await evalDeps();
    const out = await runCase(deps, dryerCase(), 'cap_only', 1);
    expect(out.captured).toBe(true);
    // A capture the ledger records without PayPal ever capturing it is a harness error.
    const { cap } = await activeCap(deps);
    const purchaseId = deps.newId();
    const ref = {
      capId: cap.capId,
      purchaseId,
      runId: deps.newId(),
      attemptNo: 1,
      productId: 'cv7t721',
      domain: 'walmart.com',
      amountCents: 2929,
    };
    await holdPurchase(deps, ref);
    expect(await capturedFor(deps, purchaseId)).toEqual({ captured: false, capturedCents: 0 });
    await settleCapture(deps, { purchaseId, captureId: 'X', status: 'COMPLETED' });
    await expect(capturedFor(deps, purchaseId)).rejects.toThrow(/disagree/);
  });

  it('the duplicate case passes prior captured ids to the review', async () => {
    const review = createStubReviewPort();
    const deps = await evalDeps(review);
    await runCase(deps, sonyCase({}, { prior_captured_product_ids: ['UXXAg59'] }), 'fitcheck', 1);
    expect(review.inputs.map((i) => i.capturedProductIds)).toEqual([['UXXAg59']]);
  });

  it('an ask is answered from the dossier: needed is a no, not_needed a yes', async () => {
    const deps = await evalDeps();
    const lineRequirement = 'tv.screen_size';
    const refused = await runCase(
      deps,
      sonyCase({ dossier: { [lineRequirement]: { need: 'needed' } } }),
      'fitcheck',
      1,
    );
    const accepted = await runCase(
      deps,
      sonyCase({ dossier: { [lineRequirement]: { need: 'not_needed' } } }),
      'fitcheck',
      1,
    );
    const unknown = await runCase(deps, sonyCase(), 'fitcheck', 1);
    expect(refused).toMatchObject({ asked: true, lines: 1, decision: 'ask', captured: false });
    expect(accepted).toMatchObject({ asked: true, captured: true, capturedCents: 139800 });
    expect(unknown).toMatchObject({ asked: true, captured: false });
  });

  it('records the card lines the buyer saw, and a stop by the cap', async () => {
    const deps = await evalDeps();
    const asked = await runCase(
      deps,
      sonyCase({ dossier: { 'tv.screen_size': { need: 'needed' } } }),
      'fitcheck',
      1,
    );
    expect(asked).toMatchObject({ cardRequirements: ['tv.screen_size'], capRefused: false });
    // The cap refuses the hold, so the card never reaches the buyer.
    const short = await runCase(deps, sonyCase({ cap_cents: 1000 }), 'fitcheck', 1);
    expect(short).toMatchObject({ captured: false, cardRequirements: [], capRefused: true });
    const shortCapOnly = await runCase(deps, { ...dryerCase(), cap_cents: 1000 }, 'cap_only', 1);
    expect(shortCapOnly).toMatchObject({ captured: false, capRefused: true });
    const paid = await runCase(deps, dryerCase(), 'cap_only', 1);
    expect(paid).toMatchObject({ captured: true, cardRequirements: [], capRefused: false });
  });

  it('an intent failure is a failed-closed case-run, not a crash', async () => {
    const deps = await evalDeps(createStubReviewPort({ throwOnIntent: 'model_error' }));
    const out = await runCase(deps, dryerCase(), 'fitcheck', 1);
    expect(out).toMatchObject({
      captured: false,
      capturedCents: 0,
      failedClosed: true,
      unavailable: 'model_error',
    });
  });

  it('replay exits non-zero when a recording is missing', async () => {
    const measured = await measureCases({
      cases: [dryerCase()],
      runs: 1,
      portsFor: () => ({
        review: createStubReviewPort({ throwOnIntent: 'no_recording' }),
        channel3: createRecordedChannel3(),
        modelName: 'replay',
      }),
    });
    expect(measured.outcomes).toHaveLength(2);
    expect(replayVerdict(measured, { rows: measured.rows, file: 'eval/results/x.json' })).toEqual({
      ok: false,
      message: 'Replay missed 1 model calls.',
    });
  });

  it('replay matches only the committed rows', async () => {
    const measured = await measureCases({
      cases: [dryerCase()],
      runs: 1,
      portsFor: () => ({
        review: createStubReviewPort(),
        channel3: createRecordedChannel3(),
        modelName: 'replay',
      }),
    });
    const file = 'eval/results/heldout.json';
    expect(replayVerdict(measured, { rows: measured.rows, file })).toEqual({
      ok: true,
      message: 'Matches eval/results/heldout.json.',
    });
    const changed = structuredClone(measured.rows);
    if (changed[0]) changed[0].fitcheck = 99;
    expect(replayVerdict(measured, { rows: changed, file }).ok).toBe(false);
  });

  it('refuses a second live held-out run without --rerun', () => {
    const dir = mkdtempSync(join(tmpdir(), 'results-'));
    const recordingsDir = join(mkdtempSync(join(tmpdir(), 'recordings-')), 'heldout');
    const guard = (o: { split?: 'heldout' | 'tuning'; rerun?: string } = {}) =>
      guardLiveRun({ split: o.split ?? 'heldout', resultsDir: dir, recordingsDir, ...o });
    expect(guard()).toEqual({ ok: true, outFile: join(dir, 'heldout.json') });
    writeFileSync(join(dir, 'heldout.json'), '{}');
    expect(guard().ok).toBe(false);
    expect(guard({ rerun: 'model outage' })).toEqual({
      ok: true,
      outFile: join(dir, 'heldout-rerun-1.json'),
    });
    writeFileSync(join(dir, 'heldout-rerun-1.json'), '{}');
    expect(guard({ rerun: 'again' })).toEqual({
      ok: true,
      outFile: join(dir, 'heldout-rerun-2.json'),
    });
    writeFileSync(join(dir, 'tuning.json'), '{}');
    expect(guard({ split: 'tuning' })).toEqual({ ok: true, outFile: join(dir, 'tuning.json') });
  });

  it('a live held-out run that crashed before writing results still blocks a second run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'results-'));
    const recordingsDir = join(mkdtempSync(join(tmpdir(), 'recordings-')), 'heldout');
    // The crashed run left its recordings and no results file.
    mkdirSync(join(recordingsDir, '20261111-1900', 'run-1'), { recursive: true });
    const refused = guardLiveRun({ split: 'heldout', resultsDir: dir, recordingsDir });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.message).toContain('--rerun');
    expect(
      guardLiveRun({ split: 'heldout', resultsDir: dir, recordingsDir, rerun: 'crash in run 2' }),
    ).toEqual({ ok: true, outFile: join(dir, 'heldout.json') });
  });

  it('refuses an existing recordings directory', () => {
    const base = mkdtempSync(join(tmpdir(), 'recordings-'));
    const taken = join(base, 'taken');
    mkdirSync(taken);
    expect(claimRecordingsDir(taken).ok).toBe(false);
    const fresh = join(base, 'heldout', '20261111-1900');
    expect(claimRecordingsDir(fresh)).toEqual({ ok: true });
    expect(existsSync(fresh)).toBe(true);
  });
});
