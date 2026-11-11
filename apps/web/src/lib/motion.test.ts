import { expect, test } from 'vitest';
import { ledgerDelayMs, markDelayMs, rowDelayMs } from './motion.js';

test('reveal timing', () => {
  expect([rowDelayMs(0), rowDelayMs(3), markDelayMs(3), ledgerDelayMs(4)]).toEqual([
    0, 300, 500, 1000,
  ]);
});
