import { describe, expect, it } from 'vitest';
import { readPath, searchedLabels } from './paths.js';
import { ctxFor, recordedProduct, withProduct } from './testing.js';

describe('readPath', () => {
  it('expands key_features with 1-based labels', () => {
    const f = readPath('key_features[]', ctxFor('UXXAg59', 'pcrichard.com'))[3];
    expect(f).toMatchObject({
      path: 'key_features[3]',
      label: 'Features, line 4',
      source: 'features',
      text: 'Screen Size Class: 55 Inch',
    });
  });

  it('reads the selected variant by name', () => {
    expect(readPath('variants.selected[Size]', ctxFor('1U7pIWX', 'lg.com'))).toEqual([
      {
        path: 'variants.selected[Size]',
        label: 'Selected variant, Size',
        source: 'selected variant',
        text: '65"',
      },
    ]);
  });

  it('reads the chosen offer', () => {
    expect(readPath('offer.price.price', ctxFor('UXXAg59', 'pcrichard.com'))[0]).toMatchObject({
      path: 'offer.price.price',
      label: 'Store offer, pcrichard.com',
      source: 'pcrichard.com',
      text: '$1,398.00',
    });
    expect(readPath('offer.availability', ctxFor('UXXAg59', 'beachcamera.com'))[0]).toMatchObject({
      text: 'OutOfStock',
      offerDomain: 'beachcamera.com',
    });
  });

  it('reads structured attributes, brands and the category', () => {
    const ctx = ctxFor('UXXAg59', 'pcrichard.com');
    expect(readPath('structured_attributes.vesa-mounting-pattern', ctx)).toEqual([
      {
        path: 'structured_attributes.vesa-mounting-pattern',
        label: 'Attribute: vesa-mounting-pattern',
        source: 'attribute',
        text: '300 x 300 mm',
      },
    ]);
    expect(readPath('category.slug', ctx)[0]).toMatchObject({
      label: 'Category',
      text: 'televisions',
    });
    expect(readPath('brands[].name', ctx)[0]).toMatchObject({
      path: 'brands[0].name',
      label: 'Brand',
    });
  });

  it('returns nothing for a missing field', () => {
    const r = withProduct(recordedProduct('cv7t721'), (p) => {
      p.description = null;
    });
    const ctx = { product: r.product, offer: null, domain: 'walmart.com' };
    expect(readPath('description', ctx)).toEqual([]);
    expect(readPath('offer.price.price', ctx)).toEqual([]);
    expect(readPath('structured_attributes.no-such-key', ctx)).toEqual([]);
  });

  it('a non-USD offer shows the price with its currency', () => {
    const r = withProduct(recordedProduct('UXXAg59'), (p) => {
      const o = p.offers[0];
      if (o) o.price.currency = 'EUR';
    });
    const ctx = { product: r.product, offer: r.product.offers[0] ?? null, domain: 'pcrichard.com' };
    expect(readPath('offer.price.price', ctx)[0]?.text).toBe('1398 EUR');
  });
});

describe('searchedLabels', () => {
  it('names every pattern, present or not', () => {
    expect(
      searchedLabels(['title', 'key_features[]', 'description'], ctxFor('5swh9aC', 'boscovs.com')),
    ).toEqual(['Title', 'Features', 'Description']);
    expect(
      searchedLabels(['structured_attributes.vesa-mounting-pattern'], ctxFor('7ZfAuSE', 'qvc.com')),
    ).toEqual(['Attribute: vesa-mounting-pattern']);
    expect(
      searchedLabels(
        ['offer.condition', 'structured_attributes.cosmetic-condition', 'title'],
        ctxFor('UXXAg59', 'pcrichard.com'),
      ),
    ).toEqual(['Store offer, pcrichard.com', 'Attribute: cosmetic-condition', 'Title']);
  });
});
