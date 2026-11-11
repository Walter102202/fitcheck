import type { QuestionCard, TaskMemory } from '@fitcheck/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAnswers, review } from './index.js';
import { intentFor, purchaseFor, recordedProduct } from './testing.js';

let card: QuestionCard;

beforeAll(async () => {
  const record = recordedProduct('UXXAg59');
  const intent = intentFor('tv', 'A 65-inch OLED TV for the living room wall. Up to $1,500.', {
    stated: {
      'tv.screen_size': { value: 65, quote: '65-inch' },
      'tv.panel_type': { value: 'oled', quote: 'OLED' },
    },
    budgetCents: 150000,
    triggered: { 'tv.wall_mount': { quote: 'wall' } },
  });
  const r = await review(
    {
      intent,
      record,
      purchase: purchaseFor(record, 'pcrichard.com'),
      memory: {},
      capturedProductIds: [],
    },
    { now: () => new Date('2026-11-11T12:00:00.000Z') },
  );
  if (!r.card) throw new Error('expected a card');
  card = r.card;
});

const paymentCard: QuestionCard = {
  title: 'Before we pay $1,398.00 for this TV',
  lines: [
    {
      lineId: 'common.price_unchanged=139800',
      requirement: 'common.price_unchanged',
      type: 'payment',
      text: 'The price changed from $1,298.00 to $1,398.00 since the agent chose it. Is that OK?',
    },
  ],
};

describe('applyAnswers', () => {
  it('all yes captures and remembers', () => {
    const out = applyAnswers(
      card,
      { 'tv.screen_size=55|65': 'yes', 'tv.wall_mount=300x300': 'yes' },
      {},
    );
    expect(out).toEqual({
      decision: 'capture',
      memory: { 'tv.screen_size=55|65': 'not_needed', 'tv.wall_mount=300x300': 'not_needed' },
    });
  });

  it('one no returns and marks the line needed', () => {
    const out = applyAnswers(
      card,
      { 'tv.screen_size=55|65': 'no', 'tv.wall_mount=300x300': 'yes' },
      {},
    );
    expect(out.decision).toBe('return_to_agent');
    expect(out.agentMessage).toBe('Not paid. The buyer did not approve: Screen size.');
    expect(out.memory['tv.screen_size=55|65']).toBe('needed');
    expect(out.memory['tv.wall_mount=300x300']).toBe('not_needed');
  });

  it('dont_know returns and leaves memory open', () => {
    const out = applyAnswers(
      card,
      { 'tv.screen_size=55|65': 'yes', 'tv.wall_mount=300x300': 'dont_know' },
      {},
    );
    expect(out.agentMessage).toBe(
      'Not paid. The buyer did not approve: Fits the wall mount the buyer already has (not sure).',
    );
    expect(out.memory).not.toHaveProperty('tv.wall_mount=300x300');
  });

  it('a missing answer counts as dont_know and extra keys are ignored', () => {
    const out = applyAnswers(card, { 'tv.screen_size=55|65': 'yes', 'tv.other=1': 'yes' }, {});
    expect(out.decision).toBe('return_to_agent');
    expect(out.agentMessage).toBe(
      'Not paid. The buyer did not approve: Fits the wall mount the buyer already has (not sure).',
    );
    expect(out.memory).toEqual({ 'tv.screen_size=55|65': 'not_needed' });
  });

  it('two declined lines are joined with a semicolon', () => {
    const out = applyAnswers(card, { 'tv.screen_size=55|65': 'no' }, {});
    expect(out.agentMessage).toBe(
      'Not paid. The buyer did not approve: Screen size; Fits the wall mount the buyer already has (not sure).',
    );
  });

  it('payment lines are never remembered', () => {
    expect(applyAnswers(paymentCard, { 'common.price_unchanged=139800': 'yes' }, {})).toEqual({
      decision: 'capture',
      memory: {},
    });
    const no = applyAnswers(paymentCard, { 'common.price_unchanged=139800': 'no' }, {});
    expect(no).toMatchObject({ decision: 'return_to_agent', memory: {} });
    expect(no.agentMessage).toBe(
      'Not paid. The buyer did not approve: Price has not changed since the agent chose it.',
    );
  });

  it('does not mutate the memory it receives', () => {
    const memory: TaskMemory = Object.freeze({ 'hair_dryer.dual_voltage': 'needed' });
    const out = applyAnswers(card, { 'tv.screen_size=55|65': 'yes' }, memory);
    expect(out.memory).toEqual({
      'hair_dryer.dual_voltage': 'needed',
      'tv.screen_size=55|65': 'not_needed',
    });
    expect(memory).toEqual({ 'hair_dryer.dual_voltage': 'needed' });
  });
});
