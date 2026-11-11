import { describe, expect, it } from 'vitest';
import { type FactSpec, getChecklist } from './checklist.js';
import {
  displayOf,
  type Match,
  PRODUCT_EXTRACTORS,
  parseStatedInches,
  parseUsdCents,
  TEXT_NORMALIZERS,
  valueKey,
} from './normalize.js';
import { recordedProduct } from './testing.js';

const tv = getChecklist('tv');
const dryer = getChecklist('hair_dryer');

function normalizer(name: string, fact: FactSpec | undefined) {
  const make = TEXT_NORMALIZERS[name];
  if (!make || !fact) throw new Error(`missing ${name}`);
  return make(fact);
}

const inches = normalizer('inches', tv.facts.screenSizeIn);
const voltage = normalizer('voltage', dryer.facts.voltage);
const vesa = normalizer('vesaPattern', tv.facts.vesaPattern);
const res = normalizer('resolutionClass', tv.facts.resolutionMax);
const panel = normalizer('panelFamily', tv.facts.panelFamily);
const condition = normalizer('condition', tv.facts.condition);
const usd = normalizer('usdCents', tv.facts.priceCents);
const vals = (ms: Match[]) => ms.map((m) => m.value);

describe('inches', () => {
  it('reads titles, quote marks and class, not model numbers', () => {
    expect(vals(inches('Sony BRAVIA 8 K65XR80 65 inch 4K HDR Smart OLED TV (2024)'))).toEqual([65]);
    expect(vals(inches('TCL 65” Class S4 (65S451) 4K UHD HDR Smart TV'))).toEqual([65]);
    expect(vals(inches('LG AI UA7050 65" Class (65.1" Diag.)'))).toEqual([65, 65.1]);
    expect(vals(inches('Screen Size Class: 55 Inch'))).toEqual([55]);
    expect(vals(inches('65-inch'))).toEqual([65]);
  });

  it('highlights the size as written', () => {
    const t = 'Sony BRAVIA 8 K65XR80 65 inch 4K HDR Smart OLED TV (2024)';
    const [m] = inches(t);
    expect(t.slice(m?.start, m?.end)).toBe('65 inch');
  });

  it('ignores cabinet dimensions and mount ranges', () => {
    expect(inches('Dimensions (in.) (WxHxD): 48.2(w) X 27.8(h) X 1.5(d)')).toEqual([]);
    expect(inches('Wall mount fits 43 to 98 inch TVs')).toEqual([]);
    expect(inches('57.1" W x 35.7" H')).toEqual([]);
    expect(inches('12" speaker')).toEqual([]);
    expect(inches('165 cm screen')[0]?.value).toBeCloseTo(64.96, 1);
  });
});

describe('voltage', () => {
  it('reads dual and US-only phrases', () => {
    expect(vals(voltage('Dual Voltage'))).toEqual(['dual']);
    const d = recordedProduct('cv7t721').product.description ?? '';
    const [m] = voltage(d);
    expect(m?.value).toBe('us_only');
    expect(d.slice(m?.start, m?.end)).toBe('For use with 110V–120V outlets only');
    expect(
      new Set(vals(voltage('Dual Voltage (110-120V/220-240V) for international travel'))),
    ).toEqual(new Set(['dual']));
    expect(voltage('Whether you re at home or traveling')).toEqual([]);
    expect(vals(voltage('Works on 100-240V worldwide'))).toEqual(['dual']);
    expect(vals(voltage('120V only'))).toEqual(['us_only']);
  });
});

describe('other text normalizers', () => {
  it('vesaPattern normalizes spacing', () => {
    expect(vals(vesa('400 x 200 mm'))).toEqual(['400x200']);
    expect(vals(vesa('300X300'))).toEqual(['300x300']);
  });

  it('resolutionClass maps synonyms', () => {
    expect(vals(res('4K ultra HD'))).toEqual(['4k']);
    expect(vals(res('2160p'))).toEqual(['4k']);
    expect(vals(res('1920 x 1080'))).toEqual(['1080p']);
    expect(vals(res('8K'))).toEqual(['8k']);
    expect(vals(res('BRAVIA 8 K65XR80'))).toEqual([]);
  });

  it('panelFamily keeps OLED apart from LED', () => {
    expect(vals(panel('OLED'))).toEqual(['oled']);
    expect(vals(panel('QLED+ Glare Free'))).toEqual(['lcd']);
    expect(vals(panel('LCoS'))).toEqual(['projector']);
    expect(vals(panel('Samsung QD-OLED 4K'))).toEqual(['oled']);
    expect(vals(panel('Mini-LED'))).toEqual(['lcd']);
  });

  it('condition reads offer values and title terms', () => {
    expect(vals(condition('new'))).toEqual(['new']);
    expect(vals(condition('used'))).toEqual(['used']);
    expect(vals(condition('Sony 65 inch TV (Renewed)'))).toEqual(['refurbished']);
    expect(vals(condition('Open-Box LG OLED'))).toEqual(['used']);
    expect(vals(condition('Brand new 2024 model'))).toEqual([]);
  });

  it('usdCents reads formatted prices', () => {
    expect(vals(usd('$1,398.00'))).toEqual([139800]);
    expect(usd('1398 EUR')).toEqual([]);
  });
});

describe('request parsers', () => {
  it('parseUsdCents and parseStatedInches read request quotes', () => {
    expect(parseUsdCents('Up to $1,500')).toBe(150000);
    expect(parseUsdCents('Under $40')).toBe(4000);
    expect(parseUsdCents('40 dollars')).toBe(4000);
    expect(parseUsdCents('$39.99')).toBe(3999);
    expect(parseUsdCents('cheap')).toBeNull();
    expect(parseStatedInches('65-inch')).toBe(65);
    expect(parseStatedInches('the cabinet opening is 50 inches')).toBe(50);
    expect(parseStatedInches('TV')).toBeNull();
    expect(parseStatedInches('5 inches')).toBeNull();
  });
});

describe('displays and keys', () => {
  it('formats displays', () => {
    expect(displayOf('inches', 65)).toBe('65 in');
    expect(displayOf('widthFromOfferDimensions', 56.9)).toBe('56.9 in');
    expect(displayOf('resolutionClass', '4k')).toBe('4K');
    expect(displayOf('panelFamily', 'lcd')).toBe('LED/LCD');
    expect(displayOf('vesaPattern', '300x300')).toBe('300 x 300 mm');
    expect(displayOf('voltage', 'us_only')).toBe('110-120 V only');
    expect(displayOf('voltage', 'dual')).toBe('Dual voltage');
    expect(displayOf('diffuser', false)).toBe('No diffuser in the box');
    expect(displayOf('usdCents', 139800)).toBe('$1,398.00');
    expect(displayOf('lowercase', 'outofstock')).toBe('Out of stock');
    expect(displayOf('condition', 'refurbished')).toBe('Refurbished');
  });

  it('valueKey drops a trailing .0 and lowercases strings', () => {
    expect(valueKey(65)).toBe('65');
    expect(valueKey(65.14)).toBe('65.1');
    expect(valueKey('OLED')).toBe('oled');
    expect(valueKey(true)).toBe('true');
  });

  it('every normalizer named in the checklists is registered', () => {
    for (const c of [tv, dryer]) {
      for (const fact of Object.values(c.facts)) {
        const known = fact.normalizer in TEXT_NORMALIZERS || fact.normalizer in PRODUCT_EXTRACTORS;
        expect(known, fact.normalizer).toBe(true);
      }
    }
  });
});
