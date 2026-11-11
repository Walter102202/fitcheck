import type { Category } from '@fitcheck/contracts';
import { getChecklist, STATED_TESTS } from '../checklist.js';

export const INTENT_PROMPT_VERSION = 'intent-v1';

const INTENT_SYSTEM = `Fitcheck turns a shopping request into a checklist intent. You only draft quotes; code verifies every quote and computes every value.

Rules:
- Copy every quote exactly from the request, character for character. Never paraphrase.
- Never invent requirement ids. Use only the ids listed under # Checklist.
- Put a requirement in "stated" only when the buyer gives a value for it: a screen size, a resolution, a screen type, a brand, a wall mount's pattern or maximum, or the available width. The quote must contain that value.
- Put a requirement in "triggered" when the request makes a listed requirement relevant, even without one of its listed cue words. The quote is the words that make it relevant.
- "budget" is the buyer's spending limit; its quote must contain the amount. Use null when there is none.
- "quantity" only when the buyer asks for more than one or names a number; "acceptUsed" only when the buyer accepts used, refurbished or open-box; "stores" only for stores the buyer names, as domains.
- Things the buyer asked for that the checklist cannot check go in "unsupported", each with its quote.
- Never judge products, prices, stores or listings.`;

/** One line per requirement the model may use: stated ones and cue-triggered ones. */
function checklistLines(category: Category): string[] {
  const lines: string[] = [];
  for (const req of getChecklist(category).requirements) {
    if (req.id === 'common.budget') continue;
    const when = req.appliesWhen;
    const cues = 'cues' in when ? when.cues : null;
    const statable = req.origin === 'stated' || STATED_TESTS[req.id] !== undefined;
    if (!statable && !cues) continue;
    const kinds = [statable ? 'stated' : null, cues ? 'triggered' : null]
      .filter(Boolean)
      .join(' or ');
    const cueText = cues ? `; cues: ${cues.join(', ')}` : '';
    lines.push(`- ${req.id}: ${req.name} (${kinds}${cueText})`);
  }
  return lines;
}

export function buildIntentPrompt(
  request: string,
  category: Category,
): { system: string; prompt: string } {
  const prompt = [
    '# Category',
    category,
    '',
    '# Checklist',
    ...checklistLines(category),
    '',
    '# Request',
    request,
    '',
  ].join('\n');
  return { system: INTENT_SYSTEM, prompt };
}

export const CITATION_PROMPT_VERSION = 'citation-v1';

const CITATION_SYSTEM = `Fitcheck shows the buyer where a product listing states a value. Code has already found the values; you only point at the text.

Rules:
- For each request, give the listing field (its path exactly as shown under # Listing) and a quote copied exactly from that field, character for character, at most 160 characters.
- Quote only text that states one of the request's values. Prefer a short, whole sentence or list item.
- Never invent paths, values or text. Leave a request out when no field states its value.
- Never judge the product, the price or the store.`;

type CitationRequestLine = {
  requirement: string;
  fact: string;
  patterns: string[];
  values: { display: string }[];
};

/** The listing fields named by the requests' patterns, one per line with its path. */
export function buildCitationPrompt(
  fields: { path: string; text: string }[],
  requests: CitationRequestLine[],
): { system: string; prompt: string } {
  const prompt = [
    '# Listing',
    ...fields.map((f) => `- ${f.path}: ${f.text}`),
    '',
    '# Requests',
    ...requests.map(
      (r) =>
        `- ${r.requirement} (${r.fact}): values ${r.values.map((v) => v.display).join(', ')}; look in ${r.patterns.join(', ')}`,
    ),
    '',
  ].join('\n');
  return { system: CITATION_SYSTEM, prompt };
}
