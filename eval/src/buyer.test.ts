import type { QuestionLine } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import { simulatedBuyer } from './buyer.js';

const line = (requirement: string): QuestionLine => ({
  lineId: `${requirement}#1`,
  requirement,
  type: 'unbacked',
  text: 'It works on 230 V',
});

describe('simulatedBuyer', () => {
  const buyer = simulatedBuyer({
    'hair_dryer.dual_voltage': { need: 'needed', value: '230 V' },
    'common.condition': { need: 'not_needed' },
  });

  it('needed answers no', () => {
    expect(buyer(line('hair_dryer.dual_voltage'))).toBe('no');
  });

  it('not_needed answers yes', () => {
    expect(buyer(line('common.condition'))).toBe('yes');
  });

  it('an unknown key answers dont_know', () => {
    expect(buyer(line('hair_dryer.cord_length'))).toBe('dont_know');
  });
});
