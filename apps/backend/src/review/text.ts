// Verbatim quote matching and evidence excerpts.

export const MAX_EXCERPT = 160;

const SINGLE_QUOTES = /[‘’‚‛′]/;
const DOUBLE_QUOTES = /[“”„‟″]/;
const DASHES = /[‐-―−]/;

type Normalized = { text: string; from: number[]; to: number[] };

/**
 * NFKC, straight quotes, `-` for dashes, whitespace runs collapsed to one space, lowercase.
 * `from[i]`/`to[i]` give the original range of normalized character i.
 */
function normalizeWithMap(s: string): Normalized {
  let text = '';
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of s) {
    const start = i;
    i += ch.length;
    if (/\s/.test(ch)) {
      if (text.endsWith(' ')) {
        to[to.length - 1] = i;
        continue;
      }
      text += ' ';
      from.push(start);
      to.push(i);
      continue;
    }
    let mapped = ch;
    if (SINGLE_QUOTES.test(ch)) mapped = "'";
    else if (DOUBLE_QUOTES.test(ch)) mapped = '"';
    else if (DASHES.test(ch)) mapped = '-';
    const out = mapped.normalize('NFKC').toLowerCase();
    for (const c of out) {
      text += c;
      from.push(start);
      to.push(i);
    }
  }
  return { text, from, to };
}

/** Offsets in `haystack` of `quote`, compared loosely (case, quotes, dashes, spacing); null if absent. */
export function findQuote(haystack: string, quote: string): { start: number; end: number } | null {
  const needle = normalizeWithMap(quote.trim()).text;
  if (needle.length === 0) return null;
  const hay = normalizeWithMap(haystack);
  const at = hay.text.indexOf(needle);
  if (at < 0) return null;
  const start = hay.from[at];
  const end = hay.to[at + needle.length - 1];
  if (start === undefined || end === undefined) return null;
  return { start, end };
}

/** Equal when compared loosely (case, quotes, dashes, spacing): `65"` equals `65”`. */
export function looseEqual(a: string, b: string): boolean {
  return normalizeWithMap(a.trim()).text === normalizeWithMap(b.trim()).text;
}

const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);

/**
 * The text itself when short; else the sentence holding the match when that is short;
 * else a window centred on the match, cut at word boundaries with `…` at each cut end.
 * Offsets are relative to the returned text.
 */
export function makeExcerpt(
  text: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  if (text.length <= MAX_EXCERPT) return { text, start, end };

  // the sentence holding the whole match
  const boundary = /(?<=[.!?])\s+/g;
  let sentenceStart = 0;
  for (;;) {
    const m = boundary.exec(text);
    const sentenceEnd = m ? m.index : text.length;
    if (start >= sentenceStart && end <= sentenceEnd) {
      if (sentenceEnd - sentenceStart <= MAX_EXCERPT) {
        return {
          text: text.slice(sentenceStart, sentenceEnd),
          start: start - sentenceStart,
          end: end - sentenceStart,
        };
      }
      break;
    }
    if (!m || sentenceStart > start) break;
    sentenceStart = m.index + m[0].length;
  }

  // a centred window; two characters are kept for the ellipses
  const matchLen = end - start;
  if (matchLen >= MAX_EXCERPT - 2) {
    const cut = Math.min(end, start + MAX_EXCERPT);
    return { text: text.slice(start, cut), start: 0, end: cut - start };
  }
  const room = MAX_EXCERPT - 2 - matchLen;
  let left = Math.floor(room / 2);
  let right = room - left;
  if (start - left < 0) {
    right += left - start;
    left = start;
  }
  if (end + right > text.length) {
    left += end + right - text.length;
    right = text.length - end;
  }
  let from = Math.max(0, start - left);
  let to = Math.min(text.length, end + right);

  if (from > 0 && !isSpace(text[from - 1])) {
    let k = from;
    while (k < start && !isSpace(text[k])) k++;
    from = k;
  }
  while (from < start && isSpace(text[from])) from++;
  if (to < text.length && !isSpace(text[to])) {
    let k = to;
    while (k > end && !isSpace(text[k - 1])) k--;
    to = k;
  }
  while (to > end && isSpace(text[to - 1])) to--;

  const lead = from > 0 ? '…' : '';
  const tail = to < text.length ? '…' : '';
  return {
    text: `${lead}${text.slice(from, to)}${tail}`,
    start: start - from + lead.length,
    end: end - from + lead.length,
  };
}
