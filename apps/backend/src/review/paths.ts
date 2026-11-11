// Reader for the path grammar of requisitos-common.json.
import { type Channel3Product, formatUsd } from '@fitcheck/contracts';

export type Offer = Channel3Product['offers'][number];
export type ProductContext = { product: Channel3Product; offer: Offer | null; domain: string };
export type Field = {
  path: string;
  label: string;
  /** Short source for `{conflicts}`: "title", "features", "pcrichard.com". */
  source: string;
  text: string;
  offerDomain?: string;
};

/** The first offer whose domain equals `domain`, case-insensitive. */
export function chosenOffer(product: Channel3Product, domain: string): Offer | null {
  const d = domain.toLowerCase();
  return product.offers.find((o) => o.domain.toLowerCase() === d) ?? null;
}

export function contextFor(product: Channel3Product, domain: string): ProductContext {
  return { product, offer: chosenOffer(product, domain), domain };
}

/** "$1,398.00" for USD, else "1398 EUR". */
export function offerPriceText(offer: Offer): string {
  return offer.price.currency === 'USD'
    ? formatUsd(Math.round(offer.price.price * 100))
    : `${offer.price.price} ${offer.price.currency}`;
}

function offerLabel(domain: string): string {
  return `Store offer, ${domain}`;
}

function offerField(offer: Offer, field: string): Field[] {
  const base = {
    path: `offer.${field}`,
    label: offerLabel(offer.domain),
    source: offer.domain,
    offerDomain: offer.domain,
  };
  switch (field) {
    case 'price.price':
      return [{ ...base, text: offerPriceText(offer) }];
    case 'availability':
      return [{ ...base, text: offer.availability }];
    case 'condition':
      return offer.condition === null ? [] : [{ ...base, text: offer.condition }];
    case 'domain':
      return [{ ...base, text: offer.domain }];
    case 'dimensions':
      return offer.dimensions ? [{ ...base, text: dimensionsText(offer.dimensions) }] : [];
    default:
      throw new Error(`Unknown offer path: offer.${field}`);
  }
}

type Dimensions = NonNullable<Offer['dimensions']>;

/** "length 1.5 in, width 48.2 in, height 27.8 in" (absent measures left out). */
export function dimensionsText(d: Dimensions): string {
  const parts: string[] = [];
  for (const key of ['length', 'width', 'height'] as const) {
    const m = d[key];
    if (m) parts.push(`${key} ${m.number} ${m.unit}`);
  }
  return parts.join(', ');
}

/** Every field the pattern names that exists on the product; [] when none does. */
export function readPath(pattern: string, ctx: ProductContext): Field[] {
  const p = ctx.product;
  if (pattern === 'title') {
    return [{ path: 'title', label: 'Title', source: 'title', text: p.title }];
  }
  if (pattern === 'description') {
    return p.description
      ? [{ path: 'description', label: 'Description', source: 'description', text: p.description }]
      : [];
  }
  if (pattern === 'key_features[]') {
    return (p.key_features ?? []).map((text, i) => ({
      path: `key_features[${i}]`,
      label: `Features, line ${i + 1}`,
      source: 'features',
      text,
    }));
  }
  if (pattern.startsWith('structured_attributes.')) {
    const key = pattern.slice('structured_attributes.'.length);
    return (p.structured_attributes?.[key] ?? []).map((text) => ({
      path: pattern,
      label: `Attribute: ${key}`,
      source: 'attribute',
      text,
    }));
  }
  if (pattern === 'brands[].name') {
    return p.brands.map((b, i) => ({
      path: `brands[${i}].name`,
      label: 'Brand',
      source: 'brand',
      text: b.name,
    }));
  }
  if (pattern === 'category.slug') {
    return p.category
      ? [{ path: 'category.slug', label: 'Category', source: 'category', text: p.category.slug }]
      : [];
  }
  const selected = /^variants\.selected\[(.+)\]$/.exec(pattern);
  if (selected?.[1] !== undefined) {
    const names = selected[1].split('|').map((n) => n.toLowerCase());
    return (p.variants?.selected ?? [])
      .filter((s) => names.includes(s.name.toLowerCase()))
      .map((s) => ({
        path: `variants.selected[${s.name}]`,
        label: `Selected variant, ${s.name}`,
        source: 'selected variant',
        text: s.label,
      }));
  }
  if (pattern === 'variants.options[]') {
    return (p.variants?.options ?? []).map((o, i) => ({
      path: `variants.options[${i}]`,
      label: 'Variant options',
      source: 'variant options',
      text: o.name,
    }));
  }
  if (pattern.startsWith('offer.')) {
    return ctx.offer ? offerField(ctx.offer, pattern.slice('offer.'.length)) : [];
  }
  if (pattern.startsWith('offers[].')) {
    const field = pattern.slice('offers[].'.length);
    return p.offers.flatMap((o) =>
      offerField(o, field).map((f) => ({ ...f, path: `offers[${p.offers.indexOf(o)}].${field}` })),
    );
  }
  throw new Error(`Unknown evidence path: ${pattern}`);
}

function patternLabel(pattern: string, ctx: ProductContext): string {
  if (pattern === 'title') return 'Title';
  if (pattern === 'description') return 'Description';
  if (pattern === 'key_features[]') return 'Features';
  if (pattern.startsWith('structured_attributes.')) {
    return `Attribute: ${pattern.slice('structured_attributes.'.length)}`;
  }
  if (pattern.startsWith('variants.selected[')) return 'Selected variant';
  if (pattern === 'variants.options[]') return 'Variant options';
  if (pattern === 'brands[].name') return 'Brand';
  if (pattern === 'category.slug') return 'Category';
  if (pattern.startsWith('offer.')) return offerLabel(ctx.domain);
  if (pattern.startsWith('offers[].')) return 'Other store offers';
  throw new Error(`Unknown evidence path: ${pattern}`);
}

/** One label per evidence pattern, present or not, distinct, in pattern order. */
export function searchedLabels(patterns: string[], ctx: ProductContext): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    const label = patternLabel(p, ctx);
    if (!out.includes(label)) out.push(label);
  }
  return out;
}
