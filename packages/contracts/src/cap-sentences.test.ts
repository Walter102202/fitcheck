import { describe, expect, it } from 'vitest';
import { CAP_INACTIVE_SENTENCE, capShortSentence, capStopIn } from './cap-sentences.js';

describe('cap sentences', () => {
  it('say how much is left, or that the cap is no longer active', () => {
    expect(capShortSentence(16360)).toBe('The spending cap has $163.60 left.');
    expect(capShortSentence(0)).toBe('The spending cap has $0.00 left.');
    expect(CAP_INACTIVE_SENTENCE).toBe('The spending cap is no longer active.');
  });

  it('are found at the end of the message sent to the agent', () => {
    expect(capStopIn(`Not paid. ${capShortSentence(123456)}`)).toBe('short');
    expect(capStopIn(`Not paid. ${CAP_INACTIVE_SENTENCE}`)).toBe('inactive');
    expect(capStopIn(capShortSentence(5))).toBe('short');
  });

  it('match nothing else', () => {
    expect(capStopIn('Not paid. PayPal declined the capture.')).toBeNull();
    expect(capStopIn('Not paid. The buyer did not approve: Screen size.')).toBeNull();
    expect(capStopIn('The spending cap has plenty left.')).toBeNull();
    expect(capStopIn('')).toBeNull();
  });
});
