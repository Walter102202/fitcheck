// The four canonical scenarios, end to end on recorded products: intent from the recorded
// drafts (replay, no key), review, answers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Category,
  Intent,
  RequirementResult,
  ReviewInput,
  ReviewResult,
  TaskMemory,
} from '@fitcheck/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { factLabel, getChecklist } from './checklist.js';
import { applyAnswers, extractIntent, review } from './index.js';
import {
  createFileRecordingStore,
  createReplayModelPort,
  DEFAULT_RECORDINGS_DIR,
} from './model/recordings.js';
import { purchaseFor, recordedProduct } from './testing.js';

type Request = { scenarioId: string; category: Category; request: string };
const requests = JSON.parse(
  readFileSync(join(DEFAULT_RECORDINGS_DIR, 'requests.json'), 'utf8'),
) as Request[];

const deps = { now: () => new Date('2026-11-11T12:00:00.000Z') };
const intents = new Map<string, Intent>();
const produced: ReviewResult[] = [];

beforeAll(async () => {
  const model = createReplayModelPort(createFileRecordingStore(DEFAULT_RECORDINGS_DIR));
  for (const r of requests)
    intents.set(r.scenarioId, await extractIntent(r.request, r.category, { model }));
});

function runner(scenarioId: string) {
  return async (productId: string, domain: string, o: { memory?: TaskMemory } = {}) => {
    const intent = intents.get(scenarioId);
    if (!intent) throw new Error(`no intent for ${scenarioId}`);
    const record = recordedProduct(productId);
    const input: ReviewInput = {
      intent,
      record,
      purchase: purchaseFor(record, domain),
      memory: o.memory ?? {},
      capturedProductIds: [],
    };
    const result = await review(input, deps);
    produced.push(result);
    return result;
  };
}

function row(r: ReviewResult, requirement: string): RequirementResult | undefined {
  return r.results.find((x) => x.requirement === requirement);
}

describe('scenarios', () => {
  it('dryer-spain: the ANIQ goes back, then the LURA is captured', async () => {
    const at = runner('dryer-spain');
    const a1 = await at('cv7t721', 'walmart.com');
    expect(a1.decision).toBe('return_to_agent');
    expect(row(a1, 'hair_dryer.dual_voltage')).toMatchObject({
      state: 'broken',
      evidence: [{ text: 'Note: For use with 110V–120V outlets only.', display: '110-120 V only' }],
    });
    expect(a1.agentMessage).toBe(
      'Not paid. The listing says it only works on 110-120 V outlets; the buyer is taking it abroad. Pick an offer whose listing states 220-240 V or dual voltage.',
    );
    const a2 = await at('saZdY6C', 'walmart.com');
    expect(a2.decision).toBe('capture');
  });

  it('dryer-silent: the Conair 1875 gets a one-line card; yes captures; after a no, the LURA is captured', async () => {
    const at = runner('dryer-silent');
    const r = await at('5swh9aC', 'boscovs.com');
    expect(r.card).toEqual({
      title: 'Before we pay $14.99 for this hair dryer',
      lines: [
        {
          lineId: 'hair_dryer.dual_voltage',
          requirement: 'hair_dryer.dual_voltage',
          type: 'unbacked',
          text: 'The listing does not say this dryer works on 220-240 V outlets, which Europe and most of the world use. Is that OK?',
        },
      ],
    });
    expect(row(r, 'hair_dryer.dual_voltage')).toMatchObject({
      state: 'unbacked',
      fact: 'voltage',
      evidence: [],
      searched: ['Title', 'Features', 'Description'],
      originQuote: 'my trip to Spain',
    });
    if (!r.card) throw new Error('expected a card');
    expect(applyAnswers(r.card, { 'hair_dryer.dual_voltage': 'yes' }, {}).decision).toBe('capture');
    const { memory } = applyAnswers(r.card, { 'hair_dryer.dual_voltage': 'no' }, {});
    expect((await at('saZdY6C', 'walmart.com', { memory })).decision).toBe('capture');
  });

  it('tv-sony: one contradiction line and no wall line; yes captures, no or dont_know does not', async () => {
    const at = runner('tv-sony');
    const r = await at('UXXAg59', 'pcrichard.com');
    expect(r.card).toEqual({
      title: 'Before we pay $1,398.00 for this TV',
      lines: [
        {
          lineId: 'tv.screen_size=55|65',
          requirement: 'tv.screen_size',
          type: 'contradictory',
          text: 'The listing gives two screen sizes: 65 inches (title) and 55 inches (features). Is that OK?',
        },
      ],
    });
    expect(r.results.map((x) => x.requirement)).not.toContain('tv.wall_mount');
    const card = r.card;
    if (!card) throw new Error('expected a card');
    expect(applyAnswers(card, { 'tv.screen_size=55|65': 'yes' }, {}).decision).toBe('capture');
    expect(applyAnswers(card, { 'tv.screen_size=55|65': 'no' }, {}).decision).toBe(
      'return_to_agent',
    );
    expect(applyAnswers(card, { 'tv.screen_size=55|65': 'dont_know' }, {}).decision).toBe(
      'return_to_agent',
    );
  });

  it('tv-wall: the Panasonic asks about 300 x 300; after a no, the LG B6 asks about 200 x 200 and yes captures', async () => {
    const at = runner('tv-wall');
    const p = await at('0gH7IUm', 'beachcamera.com');
    expect(p.card?.lines).toEqual([
      {
        lineId: 'tv.wall_mount=300x300',
        requirement: 'tv.wall_mount',
        type: 'never_asked',
        text: 'This TV uses the VESA 300 x 300 mm wall-mount pattern (the hole spacing on its back). Does your mount support it?',
      },
    ]);
    if (!p.card) throw new Error('expected a card');
    const no = applyAnswers(p.card, { 'tv.wall_mount=300x300': 'no' }, {});
    expect(no).toMatchObject({
      decision: 'return_to_agent',
      memory: { 'tv.wall_mount=300x300': 'needed' },
    });
    const lg = await at('1U7pIWX', 'lg.com', { memory: no.memory });
    expect(lg.card?.lines.map((l) => [l.lineId, l.type])).toEqual([
      ['tv.wall_mount=200x200', 'never_asked'],
    ]);
    if (!lg.card) throw new Error('expected a card');
    expect(applyAnswers(lg.card, { 'tv.wall_mount=200x200': 'yes' }, no.memory).decision).toBe(
      'capture',
    );
  });

  it('every result of every scenario run fills searched and fact as the contract says', () => {
    expect(produced.length).toBeGreaterThanOrEqual(7);
    const labels = new Map<string, string | null>();
    for (const c of ['tv', 'hair_dryer'] as const) {
      const checklist = getChecklist(c);
      for (const req of checklist.requirements) labels.set(req.id, factLabel(req, checklist));
    }
    for (const r of produced) {
      for (const x of r.results) {
        if (x.state === 'unbacked') {
          expect(x.searched?.length, x.requirement).toBeGreaterThan(0);
          expect(x.evidence).toEqual([]);
        } else {
          expect(x, x.requirement).not.toHaveProperty('searched');
        }
        const label = labels.get(x.requirement);
        if (label) expect(x.fact).toBe(label);
        else expect(x, x.requirement).not.toHaveProperty('fact');
      }
    }
  });
});
