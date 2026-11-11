import type { Intent } from '../intent.js';
import type { RequirementResult } from '../review.js';
import type { Check, RunResponse } from '../runs.js';
import {
  ALWAYS_CHECKS,
  alwaysBacked,
  authorizedEvent,
  cap,
  capOnlyCaptured,
  FETCHED_AT,
  heldEvent,
  NOT_CHECKED,
  offerPrice,
  quoted,
  summaryOf,
} from './shared.js';

// Sony BRAVIA 8 UXXAg59 (pcrichard.com, $1,398.00), recorded 2026-11-10.
const TITLE = 'Sony BRAVIA 8 K65XR80 65 inch 4K HDR Smart OLED TV (2024)';
const PRICE = 139800;
const REQUEST = 'A 65-inch OLED TV for the living room. Up to $1,500.';

const intent: Intent = {
  category: 'tv',
  request: REQUEST,
  budgetCents: 150000,
  quantity: 1,
  acceptUsed: false,
  stated: {
    'tv.screen_size': { value: 65, quote: '65-inch' },
    'tv.panel_type': { value: 'OLED', quote: 'OLED' },
    'common.budget': { value: 150000, quote: 'Up to $1,500' },
  },
  triggered: {},
  notChecked: NOT_CHECKED,
  source: 'recorded',
};

const size: Check = {
  requirement: 'tv.screen_size',
  name: 'Screen size',
  fact: 'screen size',
  origin: 'stated',
  originQuote: '65-inch',
};
const panel: Check = {
  requirement: 'tv.panel_type',
  name: 'Panel type (OLED, QLED/LED)',
  fact: 'screen type',
  origin: 'stated',
  originQuote: 'OLED',
};
const budget: Check = {
  requirement: 'common.budget',
  name: 'Within budget',
  fact: 'price',
  origin: 'stated',
  originQuote: 'Up to $1,500',
};

const results: RequirementResult[] = [
  {
    ...size,
    state: 'contradictory',
    evidence: [
      quoted('title', 'Title', TITLE, '65 inch', 65, '65 in'),
      quoted(
        'key_features[3]',
        'Features, line 4',
        'Screen Size Class: 55 Inch',
        '55 Inch',
        55,
        '55 in',
      ),
    ],
  },
  {
    ...panel,
    state: 'backed',
    evidence: [
      quoted('key_features[1]', 'Features, line 2', 'Panel Type: OLED', 'OLED', 'OLED', 'OLED'),
    ],
  },
  { ...budget, state: 'backed', evidence: [offerPrice('pcrichard.com', PRICE)] },
  ...alwaysBacked('televisions', 'TV', 'pcrichard.com', PRICE),
];

/** Scenario tv-sony: the title says 65 inches and the features say 55, so the buyer gets one line. */
export const runSonyAsk: RunResponse = {
  runId: 'run_example_tv_sony',
  scenarioId: 'tv-sony',
  review: 'on',
  intent,
  checks: [size, panel, budget, ...ALWAYS_CHECKS],
  attempts: [
    {
      attemptNo: 1,
      pick: {
        productId: 'UXXAg59',
        title: TITLE,
        domain: 'pcrichard.com',
        priceCents: PRICE,
        image:
          'https://cdn.trychannel3.com/f62bed64-ccf0-40d1-8041-3a0350ae6192?aid=01M73S7DFJ794R984A8A3TT30Z&mid=Pu5r',
        agentSays: '65-inch OLED, within budget.',
      },
      review: {
        decision: 'ask',
        results,
        card: {
          title: 'Before we pay $1,398.00 for this TV',
          lines: [
            {
              lineId: 'tv.screen_size=55|65',
              requirement: 'tv.screen_size',
              type: 'contradictory',
              text: 'The listing gives two screen sizes: 65 inches (title) and 55 inches (features). Is that OK?',
            },
          ],
        },
        summary: summaryOf(results),
        reasons: [{ requirement: 'tv.screen_size', type: 'contradictory' }],
        record: { fetchedAt: FETCHED_AT, source: 'live' },
      },
      capOnly: capOnlyCaptured(PRICE),
    },
  ],
  status: 'awaiting_answers',
  cap: cap(0, PRICE),
  events: [authorizedEvent, heldEvent('pur_example_sony', PRICE, '2026-11-10T22:41:03.000Z')],
  notices: [],
};
