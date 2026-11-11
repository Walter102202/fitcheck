import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Category, type Intent, IntentSchema } from '@fitcheck/contracts';
import { describe, expect, it, vi } from 'vitest';
import { checksFor, extractIntent, type IntentDraft, verifyIntentDraft } from './intent.js';
import type { ModelPort } from './model/port.js';
import { buildIntentPrompt, INTENT_PROMPT_VERSION } from './model/prompts.js';
import {
  createFileRecordingStore,
  createReplayModelPort,
  DEFAULT_RECORDINGS_DIR,
} from './model/recordings.js';

const EMPTY: IntentDraft = {
  budget: null,
  quantity: null,
  acceptUsed: null,
  stores: [],
  stated: [],
  triggered: [],
  unsupported: [],
};
const draft = (d: Partial<IntentDraft>): IntentDraft => ({ ...EMPTY, ...d });

const SPAIN = 'A hair dryer for my trip to Spain next week. Under $40.';
const SILENT = 'The cheapest hair dryer you can find for my trip to Spain.';
const SONY = 'A 65-inch OLED TV for the living room. Up to $1,500.';
const WALL = 'Replace the TV on our living room wall with a 65-inch, up to $1,600.';

type Requests = { scenarioId: string; category: Category; request: string }[];
const requests = JSON.parse(
  readFileSync(join(DEFAULT_RECORDINGS_DIR, 'requests.json'), 'utf8'),
) as Requests;

function verified(d: IntentDraft, request: string, category: Category): Omit<Intent, 'source'> {
  const v = verifyIntentDraft(d, request, category);
  if (!v.ok) throw new Error(v.errors.join('; '));
  return v.value;
}

function errorsOf(d: IntentDraft, request: string, category: Category): string[] {
  const v = verifyIntentDraft(d, request, category);
  return v.ok ? [] : v.errors;
}

describe('verifyIntentDraft', () => {
  it('verifies the dryer-spain draft', () => {
    const v = verified(
      draft({
        budget: { quote: 'Under $40' },
        triggered: [{ requirement: 'hair_dryer.dual_voltage', quote: 'my trip to Spain' }],
      }),
      SPAIN,
      'hair_dryer',
    );
    expect(v).toMatchObject({
      category: 'hair_dryer',
      request: SPAIN,
      budgetCents: 4000,
      quantity: 1,
      acceptUsed: false,
      stated: { 'common.budget': { value: 4000, quote: 'Under $40' } },
      triggered: { 'hair_dryer.dual_voltage': { quote: 'my trip to Spain' } },
    });
    expect(v).not.toHaveProperty('stores');
    expect(v.notChecked).toEqual([
      'Return policy',
      'Warranty',
      'Shipping cost and delivery time',
      'Sales tax and total price',
    ]);
  });

  it('rejects a quote that is not in the request', () => {
    const errors = errorsOf(
      draft({ triggered: [{ requirement: 'hair_dryer.dual_voltage', quote: 'my vacation' }] }),
      SPAIN,
      'hair_dryer',
    );
    expect(errors[0]).toContain('is not in the request');
  });

  it('rejects requirement ids outside the checklist', () => {
    const errors = errorsOf(
      draft({ stated: [{ requirement: 'tv.dolby_vision', quote: 'OLED' }] }),
      SONY,
      'tv',
    );
    expect(errors).toContain('unknown or non-stated requirement "tv.dolby_vision"');
    expect(
      errorsOf(draft({ stated: [{ requirement: 'common.in_stock', quote: 'OLED' }] }), SONY, 'tv'),
    ).toContain('unknown or non-stated requirement "common.in_stock"');
  });

  it('rejects a stated value code cannot read', () => {
    const errors = errorsOf(
      draft({ stated: [{ requirement: 'tv.screen_size', quote: 'TV' }] }),
      SONY,
      'tv',
    );
    expect(errors[0]).toContain('cannot read a value');
  });

  it('rejects a budget quote without an amount', () => {
    const errors = errorsOf(draft({ budget: { quote: 'cheapest' } }), SILENT, 'hair_dryer');
    expect(errors.join(' ')).toContain('budget');
  });

  it('collects every error before answering', () => {
    const errors = errorsOf(
      draft({
        budget: { quote: 'cheap' },
        stated: [
          { requirement: 'tv.screen_size', quote: 'TV' },
          { requirement: 'tv.screen_size', quote: '65-inch' },
        ],
        triggered: [{ requirement: 'tv.wall_mount', quote: 'garage' }],
      }),
      SONY,
      'tv',
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });

  it('computes stated values from the quote, never from the model', () => {
    const v = verified(
      draft({
        budget: { quote: 'Up to $1,500' },
        stated: [
          { requirement: 'tv.screen_size', quote: '65-inch' },
          { requirement: 'tv.panel_type', quote: 'oled' },
        ],
      }),
      SONY,
      'tv',
    );
    expect(v.stated).toEqual({
      'tv.screen_size': { value: 65, quote: '65-inch' },
      'tv.panel_type': { value: 'oled', quote: 'OLED' },
      'common.budget': { value: 150000, quote: 'Up to $1,500' },
    });
  });

  it('adds cue hits the model missed', () => {
    const v = verified(EMPTY, SILENT, 'hair_dryer');
    expect(v.triggered['hair_dryer.dual_voltage']?.quote).toBe('trip');
  });

  it('the tv-sony request triggers nothing', () => {
    expect(verified(EMPTY, SONY, 'tv').triggered).toEqual({});
  });

  it('drops fits_space when the wall mount is triggered', () => {
    const v = verified(
      draft({
        budget: { quote: 'up to $1,600' },
        stated: [{ requirement: 'tv.screen_size', quote: '65-inch' }],
        triggered: [{ requirement: 'tv.wall_mount', quote: 'our living room wall' }],
      }),
      WALL,
      'tv',
    );
    expect(v.triggered).toEqual({ 'tv.wall_mount': { quote: 'our living room wall' } });
    expect(v.triggered).not.toHaveProperty('tv.fits_space');
  });

  it('a stated mount replaces the triggered one', () => {
    const request = 'Our mount takes up to 400 x 400. A 65-inch TV for that wall, up to $1,600.';
    const v = verified(
      draft({
        budget: { quote: 'up to $1,600' },
        stated: [
          { requirement: 'tv.wall_mount', quote: 'up to 400 x 400' },
          { requirement: 'tv.screen_size', quote: '65-inch' },
        ],
      }),
      request,
      'tv',
    );
    expect(v.stated['tv.wall_mount']?.value).toBe('400x400');
    expect(v.triggered).not.toHaveProperty('tv.wall_mount');
  });

  it('reads quantity, used and stores from their quotes', () => {
    const request = 'Two hair dryers, refurbished is fine, from Best Buy only.';
    const v = verified(
      draft({
        quantity: { value: 2, quote: 'Two hair dryers' },
        acceptUsed: { quote: 'refurbished is fine' },
        stores: [{ domain: 'bestbuy.com', quote: 'Best Buy' }],
        unsupported: [{ quote: 'from Best Buy only' }],
      }),
      request,
      'hair_dryer',
    );
    expect(v).toMatchObject({ quantity: 2, acceptUsed: true, stores: ['bestbuy.com'] });
    expect(v.notChecked[0]).toBe('from Best Buy only');
    expect(
      errorsOf(draft({ quantity: { value: 3, quote: 'Two hair dryers' } }), request, 'hair_dryer'),
    ).toHaveLength(1);
    expect(
      errorsOf(
        draft({ stores: [{ domain: 'walmart.com', quote: 'Best Buy' }] }),
        request,
        'hair_dryer',
      ),
    ).toHaveLength(1);
  });
});

describe('extractIntent', () => {
  it('replays the four scenario requests with no key', async () => {
    const model = createReplayModelPort(createFileRecordingStore(DEFAULT_RECORDINGS_DIR));
    expect(requests.map((r) => r.scenarioId)).toEqual([
      'dryer-spain',
      'dryer-silent',
      'tv-sony',
      'tv-wall',
    ]);
    for (const { category, request } of requests) {
      const intent = await extractIntent(request, category, { model });
      expect(intent.source).toBe('recorded');
      expect(IntentSchema.parse(intent)).toEqual(intent);
    }
    const [spain, silent, sony, wall] = await Promise.all(
      requests.map((r) => extractIntent(r.request, r.category, { model })),
    );
    expect(spain).toMatchObject({
      budgetCents: 4000,
      triggered: { 'hair_dryer.dual_voltage': {} },
    });
    expect(silent?.budgetCents).toBeUndefined();
    expect(silent?.triggered['hair_dryer.dual_voltage']).toBeDefined();
    expect(sony).toMatchObject({
      budgetCents: 150000,
      stated: { 'tv.screen_size': { value: 65 }, 'tv.panel_type': { value: 'oled' } },
      triggered: {},
    });
    expect(wall).toMatchObject({
      budgetCents: 160000,
      stated: { 'tv.screen_size': { value: 65 } },
      triggered: { 'tv.wall_mount': { quote: 'our living room wall' } },
    });
    expect(wall?.triggered).not.toHaveProperty('tv.fits_space');
  });

  it('fails closed after two invalid drafts', async () => {
    const warn = vi.fn();
    const twoInvalid: ModelPort = {
      modelName: 'fake',
      recorded: false,
      async complete() {
        return draft({ stated: [{ requirement: 'tv.screen_size', quote: '85-inch' }] });
      },
    };
    await expect(
      extractIntent(SONY, 'tv', { model: twoInvalid, logger: { warn } }),
    ).rejects.toMatchObject({
      reason: 'invalid_output',
    });
    expect(warn).toHaveBeenCalledWith(
      'intent extraction failed',
      expect.objectContaining({ reason: 'invalid_output' }),
    );
  });

  it('a live model gives source model', async () => {
    const live: ModelPort = {
      modelName: 'claude-sonnet-5-5',
      recorded: false,
      async complete() {
        return EMPTY;
      },
    };
    expect((await extractIntent(SONY, 'tv', { model: live })).source).toBe('model');
  });
});

describe('buildIntentPrompt', () => {
  it('lists the checklist with cues and the request', () => {
    const { system, prompt } = buildIntentPrompt(WALL, 'tv');
    expect(INTENT_PROMPT_VERSION).toBe('intent-v1');
    expect(system).toContain('exactly');
    expect(system).toContain('unsupported');
    expect(prompt).toContain('# Category');
    expect(prompt).toContain('# Checklist');
    expect(prompt).toContain('tv.wall_mount');
    expect(prompt).toContain('bracket');
    expect(prompt).toContain(`# Request\n${WALL}`);
    expect(prompt).not.toContain('common.in_stock');
  });
});

describe('checksFor', () => {
  const sony = verified(
    draft({
      budget: { quote: 'Up to $1,500' },
      stated: [
        { requirement: 'tv.screen_size', quote: '65-inch' },
        { requirement: 'tv.panel_type', quote: 'OLED' },
      ],
    }),
    SONY,
    'tv',
  );
  const dryerSpain = verified(
    draft({
      budget: { quote: 'Under $40' },
      triggered: [{ requirement: 'hair_dryer.dual_voltage', quote: 'my trip to Spain' }],
    }),
    SPAIN,
    'hair_dryer',
  );
  const tvWall = verified(
    draft({
      budget: { quote: 'up to $1,600' },
      stated: [{ requirement: 'tv.screen_size', quote: '65-inch' }],
      triggered: [{ requirement: 'tv.wall_mount', quote: 'our living room wall' }],
    }),
    WALL,
    'tv',
  );
  const asIntent = (v: Omit<Intent, 'source'>): Intent => ({ ...v, source: 'recorded' });

  it('checksFor the tv-sony intent', () => {
    const checks = checksFor(asIntent(sony));
    expect(checks.slice(0, 3)).toEqual([
      {
        requirement: 'tv.screen_size',
        name: 'Screen size',
        fact: 'screen size',
        origin: 'stated',
        originQuote: '65-inch',
      },
      {
        requirement: 'tv.panel_type',
        name: 'Panel type (OLED, QLED/LED)',
        fact: 'screen type',
        origin: 'stated',
        originQuote: 'OLED',
      },
      {
        requirement: 'common.budget',
        name: 'Within budget',
        fact: 'price',
        origin: 'stated',
        originQuote: 'Up to $1,500',
      },
    ]);
    expect(checks.map((c) => c.requirement)).not.toContain('tv.wall_mount');
    expect(checks.find((c) => c.requirement === 'common.quantity')).not.toHaveProperty('fact');
    expect(checks.slice(3).every((c) => c.origin === 'always')).toBe(true);
  });

  it('checksFor the dryer-spain and tv-wall intents', () => {
    expect(
      checksFor(asIntent(dryerSpain)).find((c) => c.requirement === 'hair_dryer.dual_voltage'),
    ).toEqual({
      requirement: 'hair_dryer.dual_voltage',
      name: 'Works on 220-240 V outlets abroad',
      fact: 'voltage',
      origin: 'triggered',
      originQuote: 'my trip to Spain',
    });
    expect(
      checksFor(asIntent(tvWall)).find((c) => c.requirement === 'tv.wall_mount'),
    ).toMatchObject({
      fact: 'wall-mount pattern',
      origin: 'triggered',
      originQuote: 'our living room wall',
    });
    expect(checksFor(asIntent(tvWall)).map((c) => c.requirement)).not.toContain('tv.fits_space');
  });
});
