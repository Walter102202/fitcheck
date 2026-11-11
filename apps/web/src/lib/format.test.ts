import { expect, test } from 'vitest';
import { formatClock, pickLabel, productNoun, summaryLine } from './format.js';

const zero = { backed: 0, unbacked: 0, never_asked: 0, contradictory: 0, broken: 0 };

test('formatClock', () => expect(formatClock('2026-11-10T17:05:02.000Z')).toBe('17:05:02'));

test('productNoun', () => {
  expect(productNoun('tv')).toBe('TV');
  expect(productNoun('hair_dryer')).toBe('hair dryer');
});

test('summaryLine', () => {
  expect(summaryLine({ ...zero, backed: 3, broken: 1 })).toBe('3 backed, 1 broken.');
  expect(summaryLine({ ...zero, backed: 4, contradictory: 1 })).toBe('4 backed, 1 disagrees.');
  expect(summaryLine({ ...zero, backed: 2, unbacked: 1 })).toBe('2 backed, 1 not in the listing.');
  expect(summaryLine({ ...zero, backed: 1, contradictory: 2, never_asked: 2 })).toBe(
    '1 backed, 2 disagree, 2 nobody asked.',
  );
  expect(summaryLine({ ...zero, backed: 5 })).toBe('Everything is backed.');
  expect(summaryLine({ ...zero, broken: 1 })).toBe('1 broken.');
});

test('pickLabel', () => {
  expect([1, 2, 3, 4].map(pickLabel)).toEqual([
    'First pick',
    'Second pick',
    'Third pick',
    'Pick 4',
  ]);
});
