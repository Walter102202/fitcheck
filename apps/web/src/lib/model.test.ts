import { expect, test } from 'vitest';
import { modelName, reviewerLine } from './model.js';

test('known model ids read as their product names', () => {
  expect(modelName('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5');
  expect(modelName('claude-opus-5-5')).toBe('Claude Opus 5.5');
  expect(modelName('claude-haiku-5-5')).toBe('Claude Haiku 5.5');
});

test('an unknown id shows as it is', () => {
  expect(modelName('claude-sonnet-9-9-preview')).toBe('claude-sonnet-9-9-preview');
  expect(modelName('gpt-x')).toBe('gpt-x');
});

test('the step 1 line is honest about recorded answers', () => {
  expect(reviewerLine('claude-sonnet-5-5', 'live')).toBe(
    'Claude Sonnet 5.5 read these requirements from the request.',
  );
  expect(reviewerLine('claude-sonnet-5-5', 'recorded')).toBe(
    'Claude Sonnet 5.5 read these requirements from this request earlier. This page replays its recorded answer.',
  );
  // An older server that does not say: no claim about when.
  expect(reviewerLine('claude-sonnet-5-5', undefined)).toBe(
    'Claude Sonnet 5.5 read these requirements from the request.',
  );
});
