import type { RequirementResult } from '../review.js';
import type { RunResponse } from '../runs.js';
import {
  ALWAYS_CHECKS,
  alwaysBacked,
  authorizedEvent,
  cap,
  capOnlyCaptured,
  capturedEvent,
  dryerIntent,
  FETCHED_AT,
  notCapturedEvent,
  offerPrice,
  quoted,
  summaryOf,
} from './shared.js';

// ANIQ cv7t721 (walmart.com, $29.29): its description, recorded 2026-11-10.
const ANIQ_DESCRIPTION =
  'The ANIEKIN 1875W Hair Dryer is built for quick efficient drying with powerful airflow and advanced hair protection technology. Whether you re at home or traveling this compact and lightweight blow dryer delivers smooth salon-quality results for all hair types. Fast Drying with 1875W Power Features a high-performance motor that delivers strong airflow for fast drying. The constant temperature system helps prevent heat damage and promotes healthier hair. Ionic & Ceramic Technology Reduces frizz and static while adding shine. Negative ions lock in moisture and leave hair smooth soft and manageable. Compact & Lightweight Weighs just 0.8 lbs for easy handling and travel. Ergonomic handle ensures comfort and the removable filter prevents hair from getting caught. 2 Styling Attachments Included Comes with a concentrator for precise styling and a diffuser to enhance curls and volume. Ideal for all hair textures. Adjustable Settings & Safety Features Multiple heat and speed options with a cool shot button for setting styles. Built-in overheat protection and auto shut-off for added safety. Note: For use with 110V–120V outlets only. Perfect for daily use or on-the-go styling the ANIEKIN hair dryer brings professional results to your routine.';

const REQUEST = 'A hair dryer for my trip to Spain next week. Under $40.';
const RETURNED =
  'Not paid. The listing says it only works on 110-120 V outlets; the buyer is taking it abroad. Pick an offer whose listing states 220-240 V or dual voltage.';

const budget = {
  requirement: 'common.budget',
  name: 'Within budget',
  fact: 'price',
  origin: 'stated' as const,
  originQuote: 'Under $40',
};
const voltage = {
  requirement: 'hair_dryer.dual_voltage',
  name: 'Works on 220-240 V outlets abroad',
  fact: 'voltage',
  origin: 'triggered' as const,
  originQuote: 'trip to Spain',
};

const aniqResults: RequirementResult[] = [
  { ...budget, state: 'backed', evidence: [offerPrice('walmart.com', 2929)] },
  {
    ...voltage,
    state: 'broken',
    evidence: [
      quoted(
        'description',
        'Description',
        ANIQ_DESCRIPTION,
        'Note: For use with 110V–120V outlets only.',
        '110-120',
        '110-120 V only',
      ),
    ],
  },
  ...alwaysBacked('hair-dryers', 'Hair dryer', 'walmart.com', 2929),
];

const luraResults: RequirementResult[] = [
  { ...budget, state: 'backed', evidence: [offerPrice('walmart.com', 2020)] },
  {
    ...voltage,
    state: 'backed',
    evidence: [
      quoted(
        'key_features[0]',
        'Features, line 1',
        'Dual Voltage',
        'Dual Voltage',
        'dual',
        'Dual voltage',
      ),
    ],
  },
  ...alwaysBacked('hair-dryers', 'Hair dryer', 'walmart.com', 2020),
];

/** Scenario dryer-spain: the ANIQ goes back to the agent, then the LURA is captured. */
export const runDryerSpain: RunResponse = {
  runId: 'run_example_dryer_spain',
  scenarioId: 'dryer-spain',
  review: 'on',
  intent: dryerIntent(REQUEST, 4000, 'Under $40'),
  checks: [budget, voltage, ...ALWAYS_CHECKS],
  attempts: [
    {
      attemptNo: 1,
      pick: {
        productId: 'cv7t721',
        title: 'Hair Dryer',
        domain: 'walmart.com',
        priceCents: 2929,
        image:
          'https://cdn.trychannel3.com/4d20ab81-a9a7-4d61-99e7-8f4400a00fcc?aid=01M73TC3672209M0EKP9FDHXM7&mid=BsaX',
        agentSays: 'Well equipped, compact for travel, under budget.',
      },
      review: {
        decision: 'return_to_agent',
        results: aniqResults,
        agentMessage: RETURNED,
        summary: summaryOf(aniqResults),
        reasons: [{ requirement: 'hair_dryer.dual_voltage', type: 'broken' }],
        record: { fetchedAt: FETCHED_AT, source: 'live' },
      },
      outcome: { decision: 'return_to_agent', amountCents: 0, agentMessage: RETURNED },
      capOnly: capOnlyCaptured(2929),
    },
    {
      attemptNo: 2,
      pick: {
        productId: 'saZdY6C',
        title: 'Travel Hair Dryer',
        domain: 'walmart.com',
        priceCents: 2020,
        image:
          'https://cdn.trychannel3.com/26e8d3b9-a6e7-4c5d-af30-1ad807cf8b04?aid=01M73TC2KPDF90MMH4S8FY998A&mid=BsaX',
        agentSays: 'The listing states dual voltage. Under budget.',
      },
      review: {
        decision: 'capture',
        results: luraResults,
        summary: summaryOf(luraResults),
        reasons: [],
        record: { fetchedAt: FETCHED_AT, source: 'live' },
      },
      outcome: { decision: 'capture', amountCents: 2020 },
      capOnly: capOnlyCaptured(2020),
    },
  ],
  status: 'done',
  cap: cap(2020, 0),
  events: [
    authorizedEvent,
    notCapturedEvent('pur_example_1', 2929, '2026-11-10T22:40:05.000Z'),
    capturedEvent('pur_example_2', 2020, '2026-11-10T22:40:12.000Z', '3C679366HH908993F'),
  ],
  notices: [],
};
