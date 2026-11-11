import {
  type Attempt,
  type Cents,
  type Check,
  type Evidence,
  formatUsd,
  type RequirementResult,
  type RunResponse,
  runDryerSilent,
  runDryerSpain,
  runSonyAsk,
} from '@fitcheck/contracts';
import { PANASONIC_IMAGE } from './scenarios.js';

// Fixture runs for fixture mode and tests. dryer-spain, dryer-silent and tv-sony are the
// contract examples; tv-wall is built here from the products recorded on 2026-11-10.

const LG_IMAGE =
  'https://cdn.trychannel3.com/d72a85c3-e362-44bd-b3d6-a6d4e90e0c26?aid=01M73RZT1BKC20QEE81MET2QYT&mid=g0qz';
const PANASONIC_TITLE = 'Panasonic 65" W80C 4K UHD QLED+ Fire TV (2026)';
const WALL_REQUEST = 'Replace the TV on our living room wall with a 65-inch, up to $1,600.';
const FAILED = 'Fitcheck could not check this listing.';

function whole(path: string, label: string, text: string, value: Evidence['value']): Evidence {
  return { path, label, text, start: 0, end: text.length, value, display: text };
}

function quoted(
  path: string,
  label: string,
  text: string,
  quote: string,
  value: Evidence['value'],
  display: string,
): Evidence {
  const start = text.indexOf(quote);
  return { path, label, text, start, end: start + quote.length, value, display };
}

function offerPrice(domain: string, cents: Cents): Evidence {
  return {
    ...whole('offer.price.price', `Store offer, ${domain}`, (cents / 100).toFixed(2), cents),
    display: formatUsd(cents),
  };
}

const ALWAYS: Check[] = runSonyAsk.checks.filter((c) => c.origin === 'always');

/** The always checks, backed by one TV offer. */
function alwaysBacked(domain: string, cents: Cents): RequirementResult[] {
  const price = offerPrice(domain, cents);
  const evidence: Record<string, Evidence[]> = {
    'common.category_match': [
      { ...whole('category.slug', 'Category', 'televisions', 'televisions'), display: 'TV' },
    ],
    'common.price_unchanged': [price],
    'common.amount_matches': [price],
    'common.in_stock': [
      {
        ...whole('offer.availability', `Store offer, ${domain}`, 'InStock', 'InStock'),
        display: 'In stock',
      },
    ],
    'common.condition_new': [
      { ...whole('offer.condition', `Store offer, ${domain}`, 'new', 'new'), display: 'New' },
    ],
    'common.merchant': [whole('offer.domain', `Store offer, ${domain}`, domain, domain)],
  };
  return ALWAYS.map((check) => ({
    ...check,
    state: 'backed' as const,
    evidence: evidence[check.requirement] ?? [],
  }));
}

function summaryOf(results: RequirementResult[]) {
  const summary = { backed: 0, unbacked: 0, never_asked: 0, contradictory: 0, broken: 0 };
  for (const { state } of results) if (state !== 'not_applicable') summary[state] += 1;
  return summary;
}

function capOnlyCaptured(cents: Cents): Attempt['capOnly'] {
  return {
    outcome: 'captured',
    amountCents: cents,
    sentence: `${formatUsd(cents)} is inside the cap, so it is captured the moment the agent asks. Nobody looks at the listing.`,
  };
}

const wallSize: Check = {
  requirement: 'tv.screen_size',
  name: 'Screen size',
  fact: 'screen size',
  origin: 'stated',
  originQuote: '65-inch',
};
const wallMount: Check = {
  requirement: 'tv.wall_mount',
  name: 'Fits the wall mount the buyer already has',
  fact: 'wall-mount pattern',
  origin: 'triggered',
  originQuote: 'on our living room wall',
};
const wallBudget: Check = {
  requirement: 'common.budget',
  name: 'Within budget',
  fact: 'price',
  origin: 'stated',
  originQuote: 'up to $1,600',
};

function vesa(pattern: string, value: string): Evidence {
  return {
    path: 'structured_attributes.vesa-mounting-pattern',
    label: 'Attribute: vesa-mounting-pattern',
    text: pattern,
    start: 0,
    end: pattern.length,
    value,
    display: pattern,
  };
}

function wallAttempt(opts: {
  attemptNo: number;
  pick: Attempt['pick'];
  size: Evidence;
  mount: Evidence;
}): Attempt {
  const { pick } = opts;
  const results: RequirementResult[] = [
    { ...wallSize, state: 'backed', evidence: [opts.size] },
    { ...wallMount, state: 'never_asked', evidence: [opts.mount] },
    { ...wallBudget, state: 'backed', evidence: [offerPrice(pick.domain, pick.priceCents)] },
    ...alwaysBacked(pick.domain, pick.priceCents),
  ];
  return {
    attemptNo: opts.attemptNo,
    pick,
    review: {
      decision: 'ask',
      results,
      card: {
        title: `Before we pay ${formatUsd(pick.priceCents)} for this TV`,
        lines: [
          {
            lineId: `tv.wall_mount=${String(opts.mount.value)}`,
            requirement: 'tv.wall_mount',
            type: 'never_asked',
            text: `This TV uses the VESA ${opts.mount.display} wall-mount pattern (the hole spacing on its back). Does your mount support it?`,
          },
        ],
      },
      summary: summaryOf(results),
      reasons: [{ requirement: 'tv.wall_mount', type: 'never_asked' }],
      record: { fetchedAt: '2026-11-10T22:43:00.000Z', source: 'live' },
    },
    capOnly: capOnlyCaptured(pick.priceCents),
  };
}

/** tv-wall, attempt 2: the LG B6 the agent picks after a "no" on the Panasonic. */
export function tvWallSecondAttempt(): Attempt {
  return wallAttempt({
    attemptNo: 2,
    pick: {
      productId: '1U7pIWX',
      title: 'LG OLED evo AI B6 4K Smart TV 2026',
      domain: 'lg.com',
      priceCents: 119999,
      image: LG_IMAGE,
      agentSays: '65-inch from lg.com, within budget.',
    },
    size: quoted('variants.Size', 'Variant: Size', '65"', '65"', 65, '65 in'),
    mount: vesa('200 x 200 mm', '200x200'),
  });
}

/** dryer-silent, attempt 2: the LURA the agent picks after a "no" on the Conair. */
export function luraAttempt(): Attempt {
  const lura = runDryerSpain.attempts[1];
  if (!lura) throw new Error('runDryerSpain has no second attempt');
  return { ...structuredClone(lura), attemptNo: 2 };
}

function tvWallRun(): RunResponse {
  const base = structuredClone(runSonyAsk);
  const first = wallAttempt({
    attemptNo: 1,
    pick: {
      productId: '0gH7IUm',
      title: PANASONIC_TITLE,
      domain: 'beachcamera.com',
      priceCents: 49999,
      image: PANASONIC_IMAGE,
      agentSays: '65-inch, well under budget.',
    },
    size: quoted('title', 'Title', PANASONIC_TITLE, '65"', 65, '65 in'),
    mount: vesa('300 x 300 mm', '300x300'),
  });
  const authorized = base.events[0];
  if (!authorized) throw new Error('runSonyAsk has no authorized event');
  return {
    ...base,
    runId: 'run_example_tv_wall',
    scenarioId: 'tv-wall',
    intent: {
      ...base.intent,
      request: WALL_REQUEST,
      budgetCents: 160000,
      stated: {
        'tv.screen_size': { value: 65, quote: '65-inch' },
        'common.budget': { value: 160000, quote: 'up to $1,600' },
      },
      triggered: { 'tv.wall_mount': { quote: 'on our living room wall' } },
    },
    checks: [wallSize, wallMount, wallBudget, ...ALWAYS],
    attempts: [first],
    status: 'awaiting_answers',
    cap: {
      ...base.cap,
      capturedCents: 0,
      heldCents: 49999,
      availableCents: base.cap.amountCents - 49999,
    },
    events: [
      authorized,
      {
        eventId: 'evt_held_pur_example_wall',
        purchaseId: 'pur_example_wall',
        type: 'held',
        amountCents: 49999,
        at: '2026-11-10T22:43:04.000Z',
        sentence: 'No capture sent to PayPal.',
        paypalCall: null,
      },
    ],
  };
}

const BUILDERS: Record<string, () => RunResponse> = {
  'dryer-spain': () => structuredClone(runDryerSpain),
  'dryer-silent': () => structuredClone(runDryerSilent),
  'tv-sony': () => structuredClone(runSonyAsk),
  'tv-wall': tvWallRun,
};

export function hasFixtureRun(scenarioId: string): boolean {
  return scenarioId in BUILDERS;
}

/** A fresh deep copy of the scenario's run. */
export function fixtureRun(scenarioId: string): RunResponse {
  const build = BUILDERS[scenarioId];
  if (!build) throw new Error(`No fixture run for scenario ${scenarioId}`);
  return build();
}

/**
 * The review could not run: dryer-spain cut to attempt 1, returned to the agent, nothing
 * captured. With `intentFailed`, the request itself could not be read either, as lane C
 * stores it when extractIntent fails.
 */
export function failedClosedRun(opts: { intentFailed?: boolean } = {}): RunResponse {
  const run = structuredClone(runDryerSpain);
  const first = run.attempts[0];
  const authorized = run.events[0];
  if (!first || !authorized) throw new Error('runDryerSpain has no first attempt');
  const failed: RunResponse = {
    ...run,
    attempts: [
      {
        ...first,
        review: {
          decision: 'return_to_agent',
          failedClosed: true,
          results: [],
          summary: { backed: 0, unbacked: 0, never_asked: 0, contradictory: 0, broken: 0 },
          reasons: [],
          agentMessage: FAILED,
        },
        outcome: { decision: 'return_to_agent', amountCents: 0, agentMessage: FAILED },
      },
    ],
    status: 'done',
    cap: { ...run.cap, capturedCents: 0, heldCents: 0, availableCents: run.cap.amountCents },
    events: [
      authorized,
      {
        eventId: 'evt_not_captured_pur_failed',
        purchaseId: 'pur_failed',
        type: 'not_captured',
        amountCents: first.pick.priceCents,
        at: '2026-11-10T22:40:05.000Z',
        sentence: 'No capture sent to PayPal.',
        paypalCall: null,
      },
    ],
  };
  if (opts.intentFailed) {
    failed.checks = [];
    failed.intent = {
      category: run.intent.category,
      request: run.intent.request,
      quantity: 1,
      acceptUsed: false,
      stated: {},
      triggered: {},
      notChecked: [],
      source: 'recorded',
    };
  }
  return failed;
}

/** The run notice while PayPal has not confirmed a capture (apps/backend/src/runs/attempt.ts). */
export const PENDING_NOTICE = 'PayPal is still confirming this capture.';

/**
 * dryer-spain with the second pick's capture accepted by PayPal but not confirmed yet: the
 * backend stores it as a capture of 0 and adds the pending notice until a later read settles it.
 */
export function pendingCaptureRun(): RunResponse {
  const run = structuredClone(runDryerSpain);
  const second = run.attempts[1];
  if (!second) throw new Error('runDryerSpain has no second attempt');
  second.outcome = { decision: 'capture', amountCents: 0 };
  return {
    ...run,
    cap: {
      ...run.cap,
      capturedCents: 0,
      heldCents: second.pick.priceCents,
      availableCents: run.cap.amountCents - second.pick.priceCents,
    },
    events: run.events.filter((e) => e.type !== 'captured'),
    notices: [PENDING_NOTICE],
  };
}
