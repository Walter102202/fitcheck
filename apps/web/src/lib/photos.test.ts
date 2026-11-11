import { expect, test } from 'vitest';
import { photosEnabled } from './photos.js';

test('photosEnabled follows ?photos and remembers off', () => {
  expect(photosEnabled('?photos=off')).toBe(false);
  expect(photosEnabled('')).toBe(false);
  expect(photosEnabled('?photos=on')).toBe(true);
  expect(photosEnabled('')).toBe(true);
});

test('photos are on by default', () => {
  expect(photosEnabled('?other=1')).toBe(true);
});
