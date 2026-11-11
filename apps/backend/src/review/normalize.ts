// Text normalizers and product extractors, ported from the probe scripts
// (channel3_probe/requisitos/askrate-tv-simple.mjs and askrate-hair-simple.mjs).
import { type Evidence, formatUsd } from '@fitcheck/contracts';
import type { FactSpec } from './checklist.js';
import { dimensionsText, type Field, type Offer, type ProductContext, readPath } from './paths.js';
import { makeExcerpt } from './text.js';

export type Value = string | number | boolean;
export type Match = { value: Value; start: number; end: number };
export type TextNormalizer = (text: string) => Match[];

export type Candidate = {
  value: Value;
  evidence: Evidence;
  /** Short source for `{conflicts}`: "title", "features", "attribute", a store domain. */
  source: string;
  conflictDisplay: string;
  /** False for contradictionScan paths (other offers): they never back a requirement. */
  backing: boolean;
};

function allMatches(re: RegExp, text: string): RegExpExecArray[] {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  return [...text.matchAll(new RegExp(re.source, flags))];
}

/** Sorted by start; a match overlapping an earlier one is dropped. */
function settle(matches: Match[]): Match[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Match[] = [];
  for (const m of sorted) {
    const last = out.at(-1);
    if (last && m.start < last.end) continue;
    out.push(m);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-bounded, case-insensitive, longest term first; spaces in a term match any spacing. */
function termNormalizer(terms: Record<string, string>): TextNormalizer {
  const list = Object.keys(terms).sort((a, b) => b.length - a.length);
  const alternation = list.map((t) => escapeRegExp(t).replace(/\s+/g, '\\s*')).join('|');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'giu');
  return (text) =>
    settle(
      allMatches(re, text).map((m) => {
        const written = m[0].toLowerCase().replace(/\s+/g, '');
        const key = list.find((t) => t.toLowerCase().replace(/\s+/g, '') === written);
        return { value: key ? (terms[key] ?? '') : '', start: m.index, end: m.index + m[0].length };
      }),
    ).filter((m) => m.value !== '');
}

// ---- inches ----
const SIZE = /\b(\d{2}(?:\.\d)?)\s*(?:"|”|″|-?\s?inch(?:es)?\b|-in\b|\s?class)(?!\s*[WHD]\b)/gi;
const CM = /\b(\d{2,3}(?:\.\d)?)\s*cm\b/gi;

// Two sizes joined by a dash or "to" are a compatibility range (`43"-98"`, "32 to 70 inch"), as
// on a wall mount or a stand: neither end is the product's screen size.
const UNIT = String.raw`(?:"|”|″|-?\s?inch(?:es)?\b|-in\b)`;
const RANGE_BEFORE = new RegExp(String.raw`\d(?:\.\d)?\s*${UNIT}?\s*(?:to|-|–)\s*$`, 'i');
const RANGE_AFTER = new RegExp(String.raw`^\s*(?:to|-|–)\s*\d{2,3}(?:\.\d)?(?!\d)\s*${UNIT}`, 'i');

function skipSize(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 16), start);
  const after = text.slice(end);
  return (
    RANGE_BEFORE.test(before) ||
    RANGE_AFTER.test(after) ||
    /[x×]\s*$/i.test(before) ||
    /^\s*[x×]/i.test(after)
  );
}

const inches: TextNormalizer = (text) => {
  const out: Match[] = [];
  const add = (m: RegExpExecArray, value: number) => {
    const end = m.index + m[0].length;
    if (skipSize(text, m.index, end)) return;
    if (value < 24 || value > 120) return;
    out.push({ value, start: m.index, end });
  };
  for (const m of allMatches(SIZE, text)) add(m, Number(m[1]));
  for (const m of allMatches(CM, text)) add(m, Number(m[1]) / 2.54);
  return settle(out);
};

// ---- voltage ----
const DUAL =
  /dual[- ]voltage|dual[- ]power|universal voltage|worldwide voltage|1[01]0\s*[-–~/]\s*2[2-4]0\s*v|100\s*[-–~/]\s*240|120v\s*\/\s*240v|125v\s*\/\s*240v/gi;
const US_ONLY =
  /for use with 1[12]0\s*v(?:olts?)?(?:\s*[-–~/]\s*1[12]0\s*v(?:olts?)?)?(?:\s+outlets)?(?:\s+only)?|1[12]0\s*v(?:olts?)?\s*(?:outlets\s+)?only|standard 110\s*v(?:olts?)?(?:\s+voltage)?|120\s*v compatib\w*/gi;

/** "Not dual voltage", "non-dual voltage": a negated claim is no claim. */
const negated = (text: string, start: number) =>
  /\b(?:not|non)[\s-]*$/i.test(text.slice(Math.max(0, start - 8), start));

const voltage: TextNormalizer = (text) =>
  settle([
    ...allMatches(DUAL, text)
      .filter((m) => !negated(text, m.index))
      .map((m) => ({
        value: 'dual',
        start: m.index,
        end: m.index + m[0].length,
      })),
    ...allMatches(US_ONLY, text).map((m) => ({
      value: 'us_only',
      start: m.index,
      end: m.index + m[0].length,
    })),
  ]);

// ---- VESA ----
const VESA = /(\d{2,3})\s*[x×]\s*(\d{2,3})(?:\s*mm)?/gi;
const vesaPattern: TextNormalizer = (text) =>
  allMatches(VESA, text).map((m) => ({
    value: `${m[1]}x${m[2]}`,
    start: m.index,
    end: m.index + m[0].length,
  }));

// ---- condition ----
const CONDITION_WORDS: Record<string, string> = {
  new: 'new',
  used: 'used',
  refurbished: 'refurbished',
};
const condition: TextNormalizer = (text) => {
  const whole = CONDITION_WORDS[text.trim().toLowerCase()];
  if (whole) return [{ value: whole, start: 0, end: text.length }];
  return settle([
    ...allMatches(/\b(?:refurbished|renewed)\b/gi, text).map((m) => ({
      value: 'refurbished',
      start: m.index,
      end: m.index + m[0].length,
    })),
    ...allMatches(/\b(?:open[- ]box|pre-owned|used)\b/gi, text).map((m) => ({
      value: 'used',
      start: m.index,
      end: m.index + m[0].length,
    })),
  ]);
};

// ---- money ----
const DOLLARS = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/;

function toCents(whole: string, frac: string | undefined): number {
  return Number(whole.replace(/,/g, '')) * 100 + (frac ? Number(frac.padEnd(2, '0')) : 0);
}

// A budget quote: thousands by comma or space, a k suffix, never a number glued to a word ("$40ish").
const AMOUNT = String.raw`(\d{1,3}(?:[, ]\d{3})+|\d+)(?:\.(\d{1,2}))?([kK])?`;
const AMOUNT_END = String.raw`(?![\p{L}\p{N}])`;
const BUDGET_DOLLARS = new RegExp(String.raw`\$\s*${AMOUNT}${AMOUNT_END}`, 'u');
const BUDGET_DOLLAR_WORDS = new RegExp(String.raw`${AMOUNT}\s*(?:dollars|usd|bucks)\b`, 'iu');
const BUDGET_WORDS = new RegExp(
  String.raw`\b(?:budget(?:\s+(?:of|is))?|under|up\s+to|max(?:imum)?|at\s+most|less\s+than|no\s+more\s+than)\s*:?\s*${AMOUNT}${AMOUNT_END}`,
  'iu',
);

/**
 * A budget quote in cents: "$1,500", "Up to $2k", "$1 500", "budget 1500", "40 dollars";
 * null without an amount or when a word is glued to the number.
 */
export function parseUsdCents(text: string): number | null {
  const m = BUDGET_DOLLARS.exec(text) ?? BUDGET_DOLLAR_WORDS.exec(text) ?? BUDGET_WORDS.exec(text);
  if (m?.[1] === undefined) return null;
  const cents = toCents(m[1].replace(/ /g, ''), m[2]);
  return m[3] ? cents * 1000 : cents;
}

const usdCents: TextNormalizer = (text) => {
  const m = DOLLARS.exec(text);
  if (m?.[1] === undefined) return [];
  return [{ value: toCents(m[1], m[2]), start: m.index, end: m.index + m[0].length }];
};

/** The first number of the quote, unit optional, when it is between 10 and 200. */
export function parseStatedInches(quote: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(quote);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return n >= 10 && n <= 200 ? n : null;
}

const wholeText =
  (map: (s: string) => string): TextNormalizer =>
  (text) => {
    const v = map(text.trim());
    return v ? [{ value: v, start: 0, end: text.length }] : [];
  };

const RESOLUTION_NAMES: Record<string, string> = {
  '720p': '720p',
  '1080p': '1080p',
  '4k': '4K',
  '8k': '8K',
};

export const TEXT_NORMALIZERS: Record<string, (fact: FactSpec) => TextNormalizer> = {
  inches: () => inches,
  voltage: () => voltage,
  vesaPattern: () => vesaPattern,
  condition: () => condition,
  usdCents: () => usdCents,
  lowercase: () => wholeText((s) => s.toLowerCase()),
  brandName: () => wholeText((s) => s.toLowerCase().replace(/\s+/g, ' ')),
  resolutionClass: (fact) => {
    const terms: Record<string, string> = {};
    for (const cls of fact.values ?? []) terms[RESOLUTION_NAMES[cls] ?? cls] = cls;
    for (const [cls, syns] of Object.entries(fact.synonyms ?? {})) {
      for (const s of syns) terms[s] = cls;
    }
    return termNormalizer(terms);
  },
  panelFamily: (fact) => {
    const terms: Record<string, string> = {};
    for (const [cls, syns] of Object.entries(fact.synonyms ?? {})) {
      for (const s of syns) terms[s] = cls;
    }
    return termNormalizer(terms);
  },
};

// ---- displays ----

/** Numbers: one decimal with a trailing ".0" dropped; strings lowercase. */
export function valueKey(value: Value): string {
  if (typeof value === 'number') return String(Math.round(value * 10) / 10);
  if (typeof value === 'string') return value.toLowerCase();
  return String(value);
}

const PANEL_NAMES: Record<string, string> = {
  oled: 'OLED',
  lcd: 'LED/LCD',
  projector: 'Projector',
};
const AVAILABILITY_NAMES: Record<string, string> = {
  instock: 'In stock',
  outofstock: 'Out of stock',
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Ready to show: "65 in", "110-120 V only", "$1,398.00". `raw` is the field text, for "others". */
export function displayOf(normalizer: string, value: Value, raw?: string): string {
  switch (normalizer) {
    case 'inches':
      return `${valueKey(value)} in`;
    case 'widthFromOfferDimensions':
      return `${Number(value).toFixed(1)} in`;
    case 'resolutionClass':
      return RESOLUTION_NAMES[String(value)] ?? String(value);
    case 'panelFamily':
      return PANEL_NAMES[String(value)] ?? String(value);
    case 'vesaPattern':
      return `${String(value).replace('x', ' x ')} mm`;
    case 'voltage':
      return value === 'dual' ? 'Dual voltage' : '110-120 V only';
    case 'diffuser':
      return value === true ? 'Diffuser included' : 'No diffuser in the box';
    case 'usdCents':
      return formatUsd(Number(value));
    case 'condition':
      return capitalize(String(value));
    case 'lowercase':
      return AVAILABILITY_NAMES[String(value)] ?? raw?.trim() ?? String(value);
    default:
      return raw?.trim() ?? String(value);
  }
}

/** The value as `{conflicts}` shows it: "65 inches", "LCoS" (the term as written). */
export function conflictDisplayOf(normalizer: string, value: Value, written?: string): string {
  if (normalizer === 'inches') return `${valueKey(value)} inches`;
  if (normalizer === 'widthFromOfferDimensions') return `${Number(value).toFixed(1)} inches`;
  if (normalizer === 'panelFamily' && written) return written;
  return displayOf(normalizer, value, written);
}

/** A candidate from a field and a match inside it; the evidence is an excerpt around the match. */
export function candidateFrom(
  field: Field,
  match: Match,
  normalizer: string,
  backing: boolean,
): Candidate {
  const written = field.text.slice(match.start, match.end);
  const excerpt = makeExcerpt(field.text, match.start, match.end);
  return {
    value: match.value,
    evidence: {
      path: field.path,
      label: field.label,
      text: excerpt.text,
      start: excerpt.start,
      end: excerpt.end,
      value: match.value,
      display: displayOf(normalizer, match.value, written),
    },
    source: field.source,
    conflictDisplay: conflictDisplayOf(normalizer, match.value, written),
    backing,
  };
}

// ---- product extractors ----

const DIFFUSER = /diffuser/gi;
const NOT_IN_BOX = /^[^.;,!?]{0,30}?\b(?:sold separately|not included)\b/i;
const ITEMS_PATH = 'structured_attributes.hair-styling-items-included';

/** Diffuser mentions, without "Diffuser sold separately" or "Diffuser attachment not included". */
function diffuserMentions(text: string): RegExpExecArray[] {
  return allMatches(DIFFUSER, text).filter(
    (m) => !NOT_IN_BOX.test(text.slice(m.index + m[0].length)),
  );
}

function diffuser(fact: FactSpec, ctx: ProductContext): Candidate[] {
  const items = readPath(ITEMS_PATH, ctx);
  for (const field of items) {
    const [m] = diffuserMentions(field.text);
    if (m) {
      const match = { value: true, start: m.index, end: m.index + m[0].length };
      return [candidateFrom(field, match, 'diffuser', true)];
    }
  }
  const out: Candidate[] = [];
  for (const pattern of fact.evidence.filter((p) => p !== ITEMS_PATH)) {
    for (const field of readPath(pattern, ctx)) {
      for (const m of diffuserMentions(field.text)) {
        const match = { value: true, start: m.index, end: m.index + m[0].length };
        out.push(candidateFrom(field, match, 'diffuser', true));
      }
    }
  }
  const first = items[0];
  if (first) {
    const listed = items.map((f) => f.text).join(', ');
    const excerpt = makeExcerpt(listed, 0, 0);
    const display = displayOf('diffuser', false);
    out.push({
      value: false,
      evidence: {
        path: ITEMS_PATH,
        label: first.label,
        text: excerpt.text,
        start: 0,
        end: 0,
        value: false,
        display,
      },
      source: first.source,
      conflictDisplay: display,
      backing: true,
    });
  }
  return out;
}

type Measure = { number: number; unit: string };

function toInches(m: Measure | null): number | null {
  if (!m) return null;
  const unit = m.unit.toLowerCase();
  if (unit === 'mm') return m.number / 25.4;
  if (unit === 'cm') return m.number / 2.54;
  if (unit === 'in' || unit === 'inch' || unit === 'inches') return m.number;
  return null;
}

function widthCandidate(offer: Offer, index: number, backing: boolean): Candidate | null {
  const d = offer.dimensions;
  if (!d) return null;
  const length = toInches(d.length);
  const width = toInches(d.width);
  const key = (length ?? 0) >= (width ?? 0) ? 'length' : 'width';
  const inchesWide = Math.max(length ?? 0, width ?? 0);
  if (inchesWide <= 15) return null;
  const value = Math.round(inchesWide * 10) / 10;
  const text = dimensionsText(d);
  const measure = d[key];
  const written = measure ? `${measure.number} ${measure.unit}` : '';
  const at = measure ? text.indexOf(`${key} ${written}`) : -1;
  const start = at >= 0 ? at + key.length + 1 : 0;
  const end = at >= 0 ? start + written.length : 0;
  const display = displayOf('widthFromOfferDimensions', value);
  return {
    value,
    evidence: {
      path: backing ? 'offer.dimensions' : `offers[${index}].dimensions`,
      label: `Store offer, ${offer.domain}`,
      text,
      start,
      end,
      value,
      display,
    },
    source: offer.domain,
    conflictDisplay: conflictDisplayOf('widthFromOfferDimensions', value),
    backing,
  };
}

/** Width = max(length, width) in inches, counted over 15; the chosen offer backs, the others are scanned. */
function widthFromOfferDimensions(_fact: FactSpec, ctx: ProductContext): Candidate[] {
  const offers = ctx.product.offers;
  const chosen = ctx.offer ? offers.indexOf(ctx.offer) : -1;
  const out: Candidate[] = [];
  const own = chosen >= 0 && ctx.offer ? widthCandidate(ctx.offer, chosen, true) : null;
  if (own) out.push(own);
  offers.forEach((o, i) => {
    if (i === chosen) return;
    const c = widthCandidate(o, i, false);
    if (c) out.push(c);
  });
  return out;
}

export const PRODUCT_EXTRACTORS: Record<
  string,
  (fact: FactSpec, ctx: ProductContext) => Candidate[]
> = {
  diffuser,
  widthFromOfferDimensions,
};
