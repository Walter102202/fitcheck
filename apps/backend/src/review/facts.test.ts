import type { ProductRecord } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import { getChecklist } from './checklist.js';
import { collectCandidates } from './facts.js';
import { contextFor } from './paths.js';
import { allRecorded, ctxFor } from './testing.js';

const tv = getChecklist('tv');
const dryer = getChecklist('hair_dryer');

const firstDomain = (r: ProductRecord) => r.product.offers[0]?.domain ?? 'none.example';
const ctxOf = (r: ProductRecord) => contextFor(r.product, firstDomain(r));

function dryerCands(id: string) {
  return collectCandidates('diffuserIncluded', ctxFor(id, 'any.example'), dryer);
}
const values = (id: string) => dryerCands(id).map((c) => c.value);

/** Distinct numbers grouped within `tolerance` of the previous one. */
function groups(nums: number[], tolerance: number): number[][] {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const n of sorted) {
    const last = out.at(-1);
    const prev = last?.at(-1);
    if (last && prev !== undefined && n - prev <= tolerance) last.push(n);
    else out.push([n]);
  }
  return out;
}

describe('collectCandidates', () => {
  it('screen size candidates for the Sony', () => {
    const c = collectCandidates('screenSizeIn', ctxFor('UXXAg59', 'pcrichard.com'), tv);
    expect(c.map((x) => [x.value, x.evidence.label, x.evidence.display])).toEqual([
      [65, 'Title', '65 in'],
      [55, 'Features, line 4', '55 in'],
    ]);
    expect(c[1]?.evidence).toMatchObject({
      path: 'key_features[3]',
      text: 'Screen Size Class: 55 Inch',
      start: 19,
      end: 26,
    });
    expect(c.map((x) => [x.source, x.conflictDisplay, x.backing])).toEqual([
      ['title', '65 inches', true],
      ['features', '55 inches', true],
    ]);
  });

  it('a 4K TV that also lists 1920 x 1080 reads as 4K', () => {
    const c = collectCandidates('resolutionMax', ctxFor('ENqcYcj', 'bestbuy.com'), tv);
    expect(new Set(c.map((x) => x.value))).toEqual(new Set(['4k']));
  });

  it('diffuser candidates', () => {
    expect(values('cv7t721')).toEqual([true]);
    const [ghd] = dryerCands('LRCibGC');
    expect(ghd).toMatchObject({
      value: false,
      evidence: {
        path: 'structured_attributes.hair-styling-items-included',
        display: 'No diffuser in the box',
        start: 0,
        end: 0,
      },
    });
    expect(new Set(values('bC5Wf1F'))).toEqual(new Set([true, false]));
  });

  it('width uses the chosen offer and scans the others', () => {
    const abt = collectCandidates('widthIn', ctxFor('YQfWgKT', 'abt.com'), tv);
    expect(abt.filter((c) => c.backing).map((c) => c.value)).toEqual([56.7]);
    const scan = abt.filter((c) => !c.backing).map((c) => c.value);
    expect(scan).toEqual(expect.arrayContaining([42.2, 65.4]));
    expect(abt.find((c) => c.value === 42.2)?.evidence.label).toBe('Store offer, beachcamera.com');
    const rc = collectCandidates('widthIn', ctxFor('giXv9lz', 'rcwilley.com'), tv);
    expect(rc.filter((c) => c.backing).map((c) => c.value)).toEqual([56.9]);
    expect(rc[0]?.evidence.display).toBe('56.9 in');
    const bb = collectCandidates('widthIn', ctxFor('YQfWgKT', 'bestbuy.com'), tv);
    expect(bb.filter((c) => c.backing)).toEqual([]);
  });

  it('screen size over the 53 recorded TVs: 1 without a size, 5 with two', () => {
    const tvs = allRecorded('televisions');
    expect(tvs).toHaveLength(53);
    const none: string[] = [];
    const two: string[] = [];
    for (const r of tvs) {
      const c = collectCandidates('screenSizeIn', ctxOf(r), tv);
      const g = groups(
        c.map((x) => x.value as number),
        1,
      );
      if (g.length === 0) none.push(r.product.id);
      if (g.length >= 2) two.push(r.product.id);
    }
    expect(none.sort()).toEqual(['9k01plK']);
    // requisitos.md counted 6 of 53; FOOnl5V was a false positive (its mount range '43"-98"'),
    // which the normalizer now skips as a compatibility range (lead ruling 2026-11-11).
    expect(two.sort()).toEqual(['3KRsP5G', 'BNmn7U3', 'TelLVBm', 'UXXAg59', 'oQY2CWr']);
  });

  it('VESA over the 53 TVs: 37 with a pattern, 7 with two or more', () => {
    let some = 0;
    let multi = 0;
    for (const r of allRecorded('televisions')) {
      const distinct = new Set(collectCandidates('vesaPattern', ctxOf(r), tv).map((c) => c.value));
      if (distinct.size > 0) some++;
      if (distinct.size > 1) multi++;
    }
    expect([some, multi]).toEqual([37, 7]);
  });

  it('voltage over the 65 dryers: 18 dual, 3 US only, 44 silent, 0 both', () => {
    const dryers = allRecorded('hair-dryers');
    expect(dryers).toHaveLength(65);
    const tally = { dual: 0, us: 0, silent: 0, both: 0 };
    const usOnly: string[] = [];
    for (const r of dryers) {
      const v = new Set(collectCandidates('voltage', ctxOf(r), dryer).map((c) => c.value));
      if (v.has('dual') && v.has('us_only')) tally.both++;
      else if (v.has('dual')) tally.dual++;
      else if (v.has('us_only')) {
        tally.us++;
        usOnly.push(r.product.id);
      } else tally.silent++;
    }
    expect(tally).toEqual({ dual: 18, us: 3, silent: 44, both: 0 });
    expect(usOnly.sort()).toEqual(['G8RQD3T', 'UEwOX0B', 'cv7t721']);
  });

  it('diffuser over the 65 dryers: 38 included, 19 box list without one, 6 silent, 2 both', () => {
    const tally = { included: 0, without: 0, silent: 0, both: 0 };
    const both: string[] = [];
    for (const r of allRecorded('hair-dryers')) {
      const v = new Set(collectCandidates('diffuserIncluded', ctxOf(r), dryer).map((c) => c.value));
      if (v.has(true) && v.has(false)) {
        tally.both++;
        both.push(r.product.id);
      } else if (v.has(true)) tally.included++;
      else if (v.has(false)) tally.without++;
      else tally.silent++;
    }
    expect(tally).toEqual({ included: 38, without: 19, silent: 6, both: 2 });
    expect(both.sort()).toEqual(['L4kSx03', 'bC5Wf1F']);
  });
});
