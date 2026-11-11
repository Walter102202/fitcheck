import type { RequirementResult } from '../review.js';
import type { RunResponse } from '../runs.js';
import {
  ALWAYS_CHECKS,
  alwaysBacked,
  authorizedEvent,
  cap,
  capOnlyCaptured,
  dryerIntent,
  FETCHED_AT,
  heldEvent,
  summaryOf,
} from './shared.js';

// Conair 1875 Watt 5swh9aC (boscovs.com, $14.99), recorded 2026-11-10. Its listing
// says nothing about voltage.
const PRICE = 1499;
const REQUEST = 'The cheapest hair dryer you can find for my trip to Spain.';

const voltage = {
  requirement: 'hair_dryer.dual_voltage',
  name: 'Works on 220-240 V outlets abroad',
  fact: 'voltage',
  origin: 'triggered' as const,
  originQuote: 'trip to Spain',
};

const results: RequirementResult[] = [
  {
    ...voltage,
    state: 'unbacked',
    evidence: [],
    searched: ['Title', 'Features', 'Description', 'Attributes'],
  },
  ...alwaysBacked('hair-dryers', 'Hair dryer', 'boscovs.com', PRICE),
];

/** Scenario dryer-silent: the listing is silent on voltage, so the buyer gets one line. */
export const runDryerSilent: RunResponse = {
  runId: 'run_example_dryer_silent',
  scenarioId: 'dryer-silent',
  review: 'on',
  intent: dryerIntent(REQUEST, undefined),
  checks: [voltage, ...ALWAYS_CHECKS],
  attempts: [
    {
      attemptNo: 1,
      pick: {
        productId: '5swh9aC',
        title: 'Conair 1875 Watt Hair Dryer',
        domain: 'boscovs.com',
        priceCents: PRICE,
        image:
          'https://cdn.trychannel3.com/40074a8c-077d-430b-ae39-2f119be387b2?aid=01M73S7S518GGHEDBSYZHAM2TS&mid=7uRn',
        agentSays: 'Cheapest one in stock.',
      },
      review: {
        decision: 'ask',
        results,
        card: {
          title: 'Before we pay $14.99 for this hair dryer',
          lines: [
            {
              lineId: 'hair_dryer.dual_voltage',
              requirement: 'hair_dryer.dual_voltage',
              type: 'unbacked',
              text: 'The listing does not say this dryer works on 220-240 V outlets, which Europe and most of the world use. Is that OK?',
            },
          ],
        },
        summary: summaryOf(results),
        reasons: [{ requirement: 'hair_dryer.dual_voltage', type: 'unbacked' }],
        record: { fetchedAt: FETCHED_AT, source: 'live' },
      },
      capOnly: capOnlyCaptured(PRICE),
    },
  ],
  status: 'awaiting_answers',
  cap: cap(0, PRICE),
  events: [authorizedEvent, heldEvent('pur_example_conair', PRICE, '2026-11-10T22:42:10.000Z')],
  notices: [],
};
