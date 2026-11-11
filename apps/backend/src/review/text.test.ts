import { describe, expect, it } from 'vitest';
import { recordedProduct } from './testing.js';
import { findQuote, makeExcerpt } from './text.js';

describe('findQuote', () => {
  it('ignores case, curly quotes, dashes and spacing', () => {
    expect(
      findQuote(
        'Note: For use with 110V–120V outlets only.',
        'for use with 110V-120V  outlets only',
      ),
    ).toEqual({ start: 6, end: 41 });
    expect(findQuote('LG 65” Class', '65" class')).toEqual({ start: 3, end: 12 });
  });

  it('returns null for text not in the haystack', () => {
    expect(findQuote('Replace our living-room TV', 'living room')).toBeNull();
    expect(findQuote('anything', '   ')).toBeNull();
  });
});

describe('makeExcerpt', () => {
  it('keeps short text whole', () => {
    expect(makeExcerpt('Panel Type: OLED', 12, 16)).toEqual({
      text: 'Panel Type: OLED',
      start: 12,
      end: 16,
    });
  });

  it('cuts the ANIQ description to the sentence', () => {
    const d = recordedProduct('cv7t721').product.description ?? '';
    const s = d.indexOf('For use with');
    const e = makeExcerpt(d, s, s + 'For use with 110V–120V outlets only'.length);
    expect(e.text).toBe('Note: For use with 110V–120V outlets only.');
    expect(e.text.slice(e.start, e.end)).toBe('For use with 110V–120V outlets only');
  });

  it('windows a long sentence to at most 160 characters with ellipses', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`);
    const left = words.slice(0, 40).join(' ');
    const right = words.slice(40).join(' ');
    const text = `${left} 220-240 V ${right}`;
    expect(text.length).toBeGreaterThan(400);
    const s = text.indexOf('220-240 V');
    const e = makeExcerpt(text, s, s + '220-240 V'.length);
    expect(e.text.length).toBeLessThanOrEqual(160);
    expect(e.text.startsWith('…')).toBe(true);
    expect(e.text.endsWith('…')).toBe(true);
    expect(e.text.slice(e.start, e.end)).toBe('220-240 V');
    // cut at word boundaries: no partial "wordN" fragments next to the ellipses
    expect(e.text).toMatch(/^…word\d+ /);
    expect(e.text).toMatch(/ word\d+…$/);
  });

  it('windows a match near the start without a leading ellipsis', () => {
    const text = `Dual Voltage ${'x '.repeat(200)}`;
    const e = makeExcerpt(text, 0, 12);
    expect(e.text.startsWith('Dual Voltage')).toBe(true);
    expect(e.text.endsWith('…')).toBe(true);
    expect(e.text.length).toBeLessThanOrEqual(160);
    expect(e).toMatchObject({ start: 0, end: 12 });
  });
});
