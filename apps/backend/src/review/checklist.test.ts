import type { Category } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import {
  factLabel,
  factOf,
  findCue,
  getChecklist,
  type RequirementSpec,
  renderTemplate,
  STATED_TESTS,
  TEMPLATE_PLACEHOLDERS,
} from './checklist.js';

function req(category: Category, id: string): RequirementSpec {
  const r = getChecklist(category).requirements.find((x) => x.id === id);
  if (!r) throw new Error(`no requirement ${id}`);
  return r;
}

describe('getChecklist', () => {
  it('parses common, tv and hair_dryer', () => {
    const tv = getChecklist('tv');
    expect(tv.noun).toBe('TV');
    expect(tv.channel3CategorySlugs).toEqual(['televisions']);
    expect(tv.requirements.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        'tv.screen_size',
        'tv.wall_mount',
        'tv.fits_space',
        'common.budget',
        'common.price_unchanged',
      ]),
    );
    const dryer = getChecklist('hair_dryer');
    expect(dryer.noun).toBe('hair dryer');
    expect(dryer.requirements.map((r) => r.id)).toContain('hair_dryer.dual_voltage');
    expect(dryer.requirements.map((r) => r.id)).not.toContain('tv.screen_size');
  });

  it('puts category requirements first, then common ones, and merges the facts', () => {
    const tv = getChecklist('tv');
    expect(tv.requirements[0]?.id).toBe('tv.screen_size');
    expect(tv.requirements.at(-1)?.id).toBe('common.brand');
    expect(Object.keys(tv.facts)).toEqual(expect.arrayContaining(['screenSizeIn', 'priceCents']));
    expect(tv.outOfScope.map((o) => o.name)).toContain('Return policy');
  });

  it('is cached', () => {
    expect(getChecklist('tv')).toBe(getChecklist('tv'));
  });
});

describe('templates', () => {
  it('every placeholder in line texts and reason templates is known', () => {
    const texts: string[] = [];
    for (const c of ['tv', 'hair_dryer'] as const) {
      for (const r of getChecklist(c).requirements) {
        texts.push(...Object.values(r.line ?? {}).filter((t): t is string => !!t));
        if (r.reasonTemplate) texts.push(r.reasonTemplate);
      }
    }
    for (const s of Object.values(STATED_TESTS)) texts.push(s.reasonTemplate);
    const names = texts.flatMap((t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(TEMPLATE_PLACEHOLDERS).toContain(n);
  });

  it('renderTemplate fills and rejects unknown placeholders', () => {
    expect(renderTemplate('{a} and {b}', { a: '1', b: '2' })).toBe('1 and 2');
    expect(() => renderTemplate('{a}', {})).toThrow('a');
  });

  it('STATED_TESTS cover exactly the requirements with whenStatedValue', () => {
    const withStated = getChecklist('tv')
      .requirements.filter((r) => r.whenStatedValue)
      .map((r) => r.id);
    expect(withStated.sort()).toEqual(Object.keys(STATED_TESTS).sort());
    expect(Object.keys(STATED_TESTS).sort()).toEqual(['tv.fits_space', 'tv.wall_mount']);
  });
});

describe('findCue', () => {
  it('matches whole words only, case-insensitive, earliest first', () => {
    expect(findCue('Replace our living-room TV', ['replace'])?.text).toBe('Replace');
    expect(findCue('it is mounted', ['mount'])).toBeNull();
    expect(findCue('it is mounted', ['mount', 'mounted'])?.text).toBe('mounted');
    expect(findCue('a travel-size dryer', ['travel'])?.text).toBe('travel');
    expect(findCue('A hair dryer for my trip to Spain', ['Spain', 'trip'])?.text).toBe('trip');
  });

  it('returns the offsets of the hit as written', () => {
    const hit = findCue('Replace the TV on our living room wall', ['wall', 'mount']);
    expect(hit).toEqual({ cue: 'wall', start: 34, end: 38, text: 'wall' });
  });
});

describe('fact labels', () => {
  it('every fact has a plain-words label', () => {
    expect(
      factLabel(req('hair_dryer', 'hair_dryer.dual_voltage'), getChecklist('hair_dryer')),
    ).toBe('voltage');
    expect(factLabel(req('tv', 'tv.wall_mount'), getChecklist('tv'))).toBe('wall-mount pattern');
    expect(factLabel(req('tv', 'tv.fits_space'), getChecklist('tv'))).toBe('width');
    expect(factLabel(req('tv', 'tv.screen_size'), getChecklist('tv'))).toBe('screen size');
    expect(factLabel(req('tv', 'common.budget'), getChecklist('tv'))).toBe('price');
    expect(factLabel(req('tv', 'common.quantity'), getChecklist('tv'))).toBeNull();
    expect(factOf(req('tv', 'common.variant_pinned'), getChecklist('tv'))).toBeNull();
    expect(factOf(req('tv', 'common.no_duplicate'), getChecklist('tv'))).toBeNull();
  });
});
