// The 16 real cases of requisitos.md ("Casos reales que ya sirven"), with hand-built intents.
import type { Answer, Category, Intent, ReasonType, ReviewInput } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import { applyAnswers, review } from './index.js';
import { intentFor, purchaseFor, recordedProduct } from './testing.js';

const deps = { now: () => new Date('2026-11-11T12:00:00.000Z') };

const SIZE_65 = { 'tv.screen_size': { value: 65, quote: '65-inch' } };
const WALL = { 'tv.wall_mount': { quote: 'wall' } };
const CABINET = { 'tv.fits_space': { quote: 'cabinet' } };
const TRAVEL = { 'hair_dryer.dual_voltage': { quote: 'trip to Spain' } };
const CURLY = { 'hair_dryer.diffuser': { quote: 'curly' } };

type Case = {
  n: number;
  product: string;
  domain: string;
  category: Category;
  parts: Parameters<typeof intentFor>[2];
  decision: 'capture' | 'ask' | 'return_to_agent';
  lines?: [string, ReasonType][];
  lineIds?: string[];
  reasons?: { requirement: string; type: ReasonType }[];
  answer?: { value: Answer; decision: 'capture' | 'return_to_agent' };
};

const wallParts = { stated: SIZE_65, budgetCents: 160000, triggered: WALL };

const CASES: Case[] = [
  {
    n: 1,
    product: '0gH7IUm',
    domain: 'beachcamera.com',
    category: 'tv',
    parts: wallParts,
    decision: 'ask',
    lines: [['tv.wall_mount', 'never_asked']],
    answer: { value: 'no', decision: 'return_to_agent' },
  },
  {
    n: 2,
    product: '1U7pIWX',
    domain: 'lg.com',
    category: 'tv',
    parts: wallParts,
    decision: 'ask',
    lines: [['tv.wall_mount', 'never_asked']],
    lineIds: ['tv.wall_mount=200x200'],
    answer: { value: 'yes', decision: 'capture' },
  },
  {
    n: 3,
    product: 'JsWPLPk',
    domain: 'bestbuy.com',
    category: 'tv',
    parts: wallParts,
    decision: 'ask',
    lines: [['tv.wall_mount', 'contradictory']],
  },
  {
    n: 4,
    product: '7ZfAuSE',
    domain: 'qvc.com',
    category: 'tv',
    parts: wallParts,
    decision: 'ask',
    lines: [['tv.wall_mount', 'unbacked']],
  },
  {
    n: 5,
    product: 'giXv9lz',
    domain: 'rcwilley.com',
    category: 'tv',
    parts: { stated: SIZE_65, budgetCents: 60000, triggered: CABINET },
    decision: 'ask',
    lines: [['tv.fits_space', 'never_asked']],
  },
  {
    n: 6,
    product: 'UXXAg59',
    domain: 'pcrichard.com',
    category: 'tv',
    parts: { stated: SIZE_65, budgetCents: 150000 },
    decision: 'ask',
    lines: [['tv.screen_size', 'contradictory']],
  },
  {
    n: 7,
    product: '3KRsP5G',
    domain: 'crutchfield.com',
    category: 'tv',
    parts: { stated: SIZE_65 },
    decision: 'ask',
    lines: [['tv.screen_size', 'contradictory']],
  },
  {
    n: 8,
    product: 'UXXAg59',
    domain: 'beachcamera.com',
    category: 'tv',
    parts: { stated: SIZE_65, budgetCents: 150000 },
    decision: 'return_to_agent',
    reasons: [
      { requirement: 'common.in_stock', type: 'payment' },
      { requirement: 'common.condition_new', type: 'payment' },
    ],
  },
  {
    n: 9,
    product: 'ENqcYcj',
    domain: 'bestbuy.com',
    category: 'tv',
    parts: {
      stated: { ...SIZE_65, 'tv.resolution': { value: '4k', quote: '4K' } },
      budgetCents: 60000,
    },
    decision: 'capture',
  },
  {
    n: 10,
    product: 'cv7t721',
    domain: 'walmart.com',
    category: 'hair_dryer',
    parts: { triggered: TRAVEL, budgetCents: 4000 },
    decision: 'return_to_agent',
  },
  {
    n: 11,
    product: '5swh9aC',
    domain: 'boscovs.com',
    category: 'hair_dryer',
    parts: { triggered: TRAVEL },
    decision: 'ask',
    lines: [['hair_dryer.dual_voltage', 'unbacked']],
    answer: { value: 'no', decision: 'return_to_agent' },
  },
  {
    n: 12,
    product: 'saZdY6C',
    domain: 'walmart.com',
    category: 'hair_dryer',
    parts: { triggered: TRAVEL },
    decision: 'capture',
  },
  {
    n: 13,
    product: 'LRCibGC',
    domain: 'macys.com',
    category: 'hair_dryer',
    parts: { triggered: CURLY },
    decision: 'return_to_agent',
  },
  {
    n: 14,
    product: 'bC5Wf1F',
    domain: 'hbbeautybar.com',
    category: 'hair_dryer',
    parts: { triggered: CURLY },
    decision: 'ask',
    lines: [['hair_dryer.diffuser', 'contradictory']],
  },
  {
    n: 15,
    product: 'RxdGNA8',
    domain: 'newegg.com',
    category: 'hair_dryer',
    parts: { triggered: { ...TRAVEL, ...CURLY } },
    decision: 'capture',
  },
  {
    n: 16,
    product: '2YG1rmN',
    domain: 'cvs.com',
    category: 'hair_dryer',
    parts: {},
    decision: 'capture',
  },
];

describe('requisitos real cases', () => {
  it.each(CASES)('case $n: $product at $domain -> $decision', async (c) => {
    const record = recordedProduct(c.product);
    const intent: Intent = intentFor(c.category, `requisitos case ${c.n}`, c.parts);
    const input: ReviewInput = {
      intent,
      record,
      purchase: purchaseFor(record, c.domain),
      memory: {},
      capturedProductIds: [],
    };
    const r = await review(input, deps);
    expect(r.decision).toBe(c.decision);
    expect(r.failedClosed).toBeUndefined();
    if (c.lines) expect(r.card?.lines.map((l) => [l.requirement, l.type])).toEqual(c.lines);
    if (c.lineIds) expect(r.card?.lines.map((l) => l.lineId)).toEqual(c.lineIds);
    if (c.reasons) expect(r.reasons).toEqual(expect.arrayContaining(c.reasons));
    if (c.answer) {
      if (!r.card) throw new Error('expected a card');
      const answers = Object.fromEntries(r.card.lines.map((l) => [l.lineId, c.answer?.value]));
      expect(applyAnswers(r.card, answers, {}).decision).toBe(c.answer.decision);
    }
  });
});
