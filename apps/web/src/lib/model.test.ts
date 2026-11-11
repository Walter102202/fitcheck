import { expect, test } from 'vitest';
import { heroLine, modelName, reviewChip, reviewerLine } from './model.js';

const SONNET = 'claude-sonnet-5-5';

test('known model ids read as their product names', () => {
  expect(modelName(SONNET)).toBe('Claude Sonnet 5.5');
  expect(modelName('claude-opus-5-5')).toBe('Claude Opus 5.5');
  expect(modelName('claude-haiku-5-5')).toBe('Claude Haiku 5.5');
});

test('an unknown id shows as it is', () => {
  expect(modelName('claude-sonnet-9-9-preview')).toBe('claude-sonnet-9-9-preview');
  expect(modelName('gpt-x')).toBe('gpt-x');
});

test('the header chip names a model only when that model answered', () => {
  expect(reviewChip(SONNET, 'live')).toEqual({ name: 'Claude Sonnet 5.5' });
  expect(reviewChip(SONNET, 'recorded')).toEqual({
    name: 'Claude Sonnet 5.5',
    detail: 'recorded answers',
  });
  expect(reviewChip(SONNET, 'scripted')).toEqual({ name: 'scripted requirements' });
  // An older server that does not say: the model, with no claim about when.
  expect(reviewChip(SONNET, undefined)).toEqual({ name: 'Claude Sonnet 5.5' });
});

test('the step 1 line is honest in every mode', () => {
  expect(reviewerLine(SONNET, 'live')).toBe(
    'Claude Sonnet 5.5 read these requirements from the request.',
  );
  expect(reviewerLine(SONNET, 'recorded')).toBe(
    'Claude Sonnet 5.5 read these requirements from this request earlier. This page replays its recorded answer.',
  );
  expect(reviewerLine(SONNET, 'scripted')).toBe(
    'These requirements were written by hand for the four demo requests. With a model key, Claude Sonnet 5.5 reads them from the request.',
  );
  expect(reviewerLine(SONNET, undefined)).toBe(
    'Claude Sonnet 5.5 read these requirements from the request.',
  );
});

test('the hero describes the product, then what this site does when no model reads live', () => {
  const product =
    'Claude Sonnet 5.5 turns your request into requirements, code checks each one against the listing, and only then does PayPal capture the money.';
  expect(heroLine(SONNET, 'live')).toBe(product);
  expect(heroLine(SONNET, 'recorded')).toBe(
    `${product} On this site, its answers to the four demo requests were recorded earlier and are replayed.`,
  );
  expect(heroLine(SONNET, 'scripted')).toBe(
    `${product} On this site, the requirements for the four demo requests are written by hand.`,
  );
});
