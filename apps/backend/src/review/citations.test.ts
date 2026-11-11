import type { RequirementResult, ReviewInput } from '@fitcheck/contracts';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getChecklist } from './checklist.js';
import { applyCitations, citationRequests, verifyCitation } from './citations.js';
import { review } from './index.js';
import type { ModelPort } from './model/port.js';
import {
  createFileRecordingStore,
  createReplayModelPort,
  DEFAULT_RECORDINGS_DIR,
} from './model/recordings.js';
import { ctxFor, intentFor, purchaseFor, recordedProduct } from './testing.js';

const deps = { now: () => new Date('2026-11-11T12:00:00.000Z') };
const tv = getChecklist('tv');
const dryer = getChecklist('hair_dryer');
const sonyCtx = ctxFor('UXXAg59', 'pcrichard.com');
const aniqCtx = ctxFor('cv7t721', 'walmart.com');
const replayPort = createReplayModelPort(createFileRecordingStore(DEFAULT_RECORDINGS_DIR));

function inputFor(id: string, domain: string, intent: ReviewInput['intent']): ReviewInput {
  const record = recordedProduct(id);
  return {
    intent,
    record,
    purchase: purchaseFor(record, domain),
    memory: {},
    capturedProductIds: [],
  };
}

const sonyInput = inputFor(
  'UXXAg59',
  'pcrichard.com',
  intentFor('tv', 'A 65-inch OLED TV for the living room. Up to $1,500.', {
    stated: {
      'tv.screen_size': { value: 65, quote: '65-inch' },
      'tv.panel_type': { value: 'oled', quote: 'OLED' },
    },
    budgetCents: 150000,
  }),
);
const aniqInput = inputFor(
  'cv7t721',
  'walmart.com',
  intentFor('hair_dryer', 'A hair dryer for my trip to Spain next week. Under $40.', {
    triggered: { 'hair_dryer.dual_voltage': { quote: 'my trip to Spain' } },
    budgetCents: 4000,
  }),
);

let sonyResults: RequirementResult[];
let aniqResults: RequirementResult[];
beforeAll(async () => {
  sonyResults = (await review(sonyInput, deps)).results;
  aniqResults = (await review(aniqInput, deps)).results;
});

describe('citationRequests', () => {
  it('asks only for code_with_model_citation requirements with evidence', () => {
    expect(citationRequests(sonyResults, tv)).toEqual([
      {
        requirement: 'tv.screen_size',
        fact: 'screenSizeIn',
        patterns: ['variants.selected[Size]', 'title', 'key_features[]', 'description'],
        values: [
          { value: 65, display: '65 in' },
          { value: 55, display: '55 in' },
        ],
      },
    ]);
    expect(citationRequests(aniqResults, dryer).map((r) => r.requirement)).toEqual([
      'hair_dryer.dual_voltage',
    ]);
  });
});

describe('verifyCitation', () => {
  it('accepts a verbatim citation that the normalizer reads the same', () => {
    const v = verifyCitation(
      {
        requirement: 'tv.screen_size',
        path: 'key_features[3]',
        quote: 'Screen Size Class: 55 Inch',
      },
      sonyCtx,
      tv,
      sonyResults,
    );
    expect(v.ok && v.evidence).toMatchObject({
      path: 'key_features[3]',
      label: 'Features, line 4',
      text: 'Screen Size Class: 55 Inch',
      value: 55,
      display: '55 in',
    });
    expect(v.ok && v.evidence.text.slice(v.evidence.start, v.evidence.end)).toBe('55 Inch');
  });

  it('keeps the quote as written in the field', () => {
    const v = verifyCitation(
      {
        requirement: 'hair_dryer.dual_voltage',
        path: 'description',
        quote: 'note: for use with 110V-120V outlets only.',
      },
      aniqCtx,
      dryer,
      aniqResults,
    );
    expect(v.ok && v.evidence.text).toBe('Note: For use with 110V–120V outlets only.');
  });

  it('rejects a paraphrase', () => {
    const v = verifyCitation(
      { requirement: 'tv.screen_size', path: 'title', quote: '65 inches' },
      sonyCtx,
      tv,
      sonyResults,
    );
    expect(v.ok).toBe(false);
  });

  it('rejects a quote whose value differs', () => {
    const v = verifyCitation(
      {
        requirement: 'hair_dryer.dual_voltage',
        path: 'description',
        quote: 'Whether you re at home or traveling',
      },
      aniqCtx,
      dryer,
      aniqResults,
    );
    expect(v.ok).toBe(false);
  });

  it("rejects a path outside the fact's evidence", () => {
    const v = verifyCitation(
      {
        requirement: 'tv.screen_size',
        path: 'structured_attributes.vesa-mounting-pattern',
        quote: '300 x 300 mm',
      },
      sonyCtx,
      tv,
      sonyResults,
    );
    expect(v.ok).toBe(false);
  });

  it('rejects a requirement that was not requested and a quote over 160 characters', () => {
    expect(
      verifyCitation(
        { requirement: 'tv.panel_type', path: 'key_features[1]', quote: 'Panel Type: OLED' },
        sonyCtx,
        tv,
        sonyResults,
      ).ok,
    ).toBe(false);
    expect(
      verifyCitation(
        { requirement: 'tv.screen_size', path: 'title', quote: 'x'.repeat(161) },
        sonyCtx,
        tv,
        sonyResults,
      ).ok,
    ).toBe(false);
  });
});

describe('applyCitations', () => {
  it('replaces the matching evidence item and nothing else', () => {
    const v = verifyCitation(
      { requirement: 'tv.screen_size', path: 'title', quote: '65 inch' },
      sonyCtx,
      tv,
      sonyResults,
    );
    if (!v.ok) throw new Error(v.error);
    const out = applyCitations(sonyResults, [{ requirement: v.requirement, evidence: v.evidence }]);
    const size = out.find((r) => r.requirement === 'tv.screen_size');
    expect(size?.evidence[0]).toMatchObject({ path: 'title', text: '65 inch', start: 0, end: 7 });
    expect(size?.evidence[1]).toEqual(
      sonyResults.find((r) => r.requirement === 'tv.screen_size')?.evidence[1],
    );
    expect(out.map((r) => [r.requirement, r.state, r.note])).toEqual(
      sonyResults.map((r) => [r.requirement, r.state, r.note]),
    );
  });
});

describe('the citation step in review()', () => {
  it('citations never change a state or a decision', async () => {
    const withC = await review(sonyInput, { ...deps, citations: replayPort });
    const without = await review(sonyInput, deps);
    expect(withC.decision).toBe(without.decision);
    expect(withC.results.map((r) => r.state)).toEqual(without.results.map((r) => r.state));
    expect(withC.card).toEqual(without.card);
    const size = withC.results.find((r) => r.requirement === 'tv.screen_size');
    expect(size?.evidence.map((e) => e.text)).toEqual(['65 inch', 'Screen Size Class: 55 Inch']);
  });

  it('the ANIQ recording cites the description sentence', async () => {
    const r = await review(aniqInput, { ...deps, citations: replayPort });
    expect(
      r.results.find((x) => x.requirement === 'hair_dryer.dual_voltage')?.evidence[0],
    ).toMatchObject({
      path: 'description',
      text: 'Note: For use with 110V–120V outlets only.',
      value: 'us_only',
    });
    expect(r.decision).toBe('return_to_agent');
  });

  it('a failing citation call keeps the code evidence', async () => {
    const warn = vi.fn();
    const throwingPort: ModelPort = {
      modelName: 'fake',
      recorded: false,
      async complete() {
        throw new Error('overloaded');
      },
    };
    const r = await review(sonyInput, { ...deps, citations: throwingPort, logger: { warn } });
    expect(r).toEqual(await review(sonyInput, deps));
    expect(warn).toHaveBeenCalledWith('citations skipped', expect.anything());
    expect(warn).toHaveBeenCalledWith('citations skipped', { reason: 'model_error' });
  });

  it('a review with nothing to cite makes no citation call', async () => {
    const complete = vi.fn();
    const port: ModelPort = { modelName: 'fake', recorded: false, complete };
    const lura = inputFor('2YG1rmN', 'cvs.com', intentFor('hair_dryer', 'A hair dryer.'));
    await review(lura, { ...deps, citations: port });
    expect(complete).not.toHaveBeenCalled();
  });
});
