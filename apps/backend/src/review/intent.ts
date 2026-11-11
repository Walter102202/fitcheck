// Request to intent. The model drafts verbatim quotes; code verifies every quote, computes every
// value and adds the cue hits the model missed.
import type { Category, Intent, RunResponse } from '@fitcheck/contracts';
import { z } from 'zod';
import {
  factLabel,
  findCue,
  getChecklist,
  type ReviewChecklist,
  STATED_TESTS,
} from './checklist.js';
import { ReviewUnavailableError } from './errors.js';
import { appliesTo } from './evaluate.js';
import { callModel, recordingKey } from './model/port.js';
import { buildIntentPrompt } from './model/prompts.js';
import { parseStatedInches, parseUsdCents, TEXT_NORMALIZERS, type Value } from './normalize.js';
import { findQuote } from './text.js';
import type { IntentDeps } from './types.js';

const Quote = z.strictObject({ quote: z.string() });
const RequirementQuote = z.strictObject({ requirement: z.string(), quote: z.string() });

/** Strict objects, arrays rather than records (structured outputs). */
export const IntentDraftSchema = z.strictObject({
  budget: Quote.nullable(),
  quantity: z.strictObject({ value: z.number().int(), quote: z.string() }).nullable(),
  acceptUsed: Quote.nullable(),
  stores: z.array(z.strictObject({ domain: z.string(), quote: z.string() })),
  stated: z.array(RequirementQuote),
  triggered: z.array(RequirementQuote),
  unsupported: z.array(Quote),
});
export type IntentDraft = z.infer<typeof IntentDraftSchema>;

const NUMBER_WORDS: Record<number, string[]> = {
  1: ['one', 'a', 'an'],
  2: ['two', 'pair', 'couple'],
  3: ['three'],
  4: ['four'],
  5: ['five'],
  6: ['six'],
  7: ['seven'],
  8: ['eight'],
  9: ['nine'],
  10: ['ten'],
};
const USED = /\b(used|refurbished|renewed|open[- ]box|pre-owned)\b/i;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function firstMatch(normalizer: string, checklist: ReviewChecklist, factId: string, quote: string) {
  const fact = checklist.facts[factId];
  const make = TEXT_NORMALIZERS[normalizer];
  if (!fact || !make) return null;
  return make(fact)(quote)[0]?.value ?? null;
}

/** The stated value, read from the quote by code. */
function statedValue(id: string, quote: string, checklist: ReviewChecklist): Value | null {
  switch (id) {
    case 'tv.screen_size':
    case 'tv.fits_space':
      return parseStatedInches(quote);
    case 'tv.resolution':
      return firstMatch('resolutionClass', checklist, 'resolutionMax', quote);
    case 'tv.panel_type':
      return firstMatch('panelFamily', checklist, 'panelFamily', quote);
    case 'tv.wall_mount':
      return firstMatch('vesaPattern', checklist, 'vesaPattern', quote);
    case 'common.brand':
      return firstMatch('brandName', checklist, 'brand', quote);
    default:
      return null;
  }
}

const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Collects every error before answering. */
export function verifyIntentDraft(
  draft: IntentDraft,
  request: string,
  category: Category,
): { ok: true; value: Omit<Intent, 'source'> } | { ok: false; errors: string[] } {
  const checklist = getChecklist(category);
  const errors: string[] = [];
  const byId = new Map(checklist.requirements.map((r) => [r.id, r]));

  /** The quote as written in the request, or null (with an error). */
  const inRequest = (quote: string): string | null => {
    const at = findQuote(request, quote);
    if (!at) {
      errors.push(`quote "${quote}" is not in the request`);
      return null;
    }
    return request.slice(at.start, at.end);
  };

  const stated: Intent['stated'] = {};
  const seen = new Set<string>();
  for (const s of draft.stated) {
    const req = byId.get(s.requirement);
    const allowed =
      req !== undefined &&
      ((req.origin === 'stated' && req.id !== 'common.budget') ||
        STATED_TESTS[req.id] !== undefined);
    if (!allowed) {
      errors.push(`unknown or non-stated requirement "${s.requirement}"`);
      continue;
    }
    if (seen.has(s.requirement)) {
      errors.push(`duplicate stated requirement "${s.requirement}"`);
      continue;
    }
    seen.add(s.requirement);
    const quote = inRequest(s.quote);
    if (quote === null) continue;
    const value = statedValue(s.requirement, quote, checklist);
    if (value === null) {
      errors.push(`cannot read a value for ${s.requirement} from "${s.quote}"`);
      continue;
    }
    stated[s.requirement] = { value, quote };
  }

  let budgetCents: number | undefined;
  if (draft.budget) {
    const quote = inRequest(draft.budget.quote);
    if (quote !== null) {
      const cents = parseUsdCents(quote);
      if (cents === null || cents <= 0) {
        errors.push(`cannot read a budget amount from "${draft.budget.quote}"`);
      } else {
        budgetCents = cents;
        stated['common.budget'] = { value: cents, quote };
      }
    }
  }

  const triggered: Intent['triggered'] = {};
  for (const t of draft.triggered) {
    const req = byId.get(t.requirement);
    if (!req || !('cues' in req.appliesWhen)) {
      errors.push(`unknown or non-triggered requirement "${t.requirement}"`);
      continue;
    }
    const quote = inRequest(t.quote);
    if (quote !== null && !triggered[t.requirement]) triggered[t.requirement] = { quote };
  }
  for (const req of checklist.requirements) {
    const when = req.appliesWhen;
    if (!('cues' in when) || triggered[req.id]) continue;
    const hit = findCue(request, when.cues);
    if (hit) triggered[req.id] = { quote: hit.text };
  }
  const present = (id: string) => stated[id] !== undefined || triggered[id] !== undefined;
  for (const id of Object.keys(triggered)) {
    const when = byId.get(id)?.appliesWhen;
    const unless = when && 'cues' in when ? when.unlessAlsoApplies : undefined;
    if (stated[id] || (unless && present(unless))) delete triggered[id];
  }

  let quantity = 1;
  if (draft.quantity) {
    const { value, quote } = draft.quantity;
    const written = inRequest(quote);
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      errors.push(`quantity ${value} is not between 1 and 10`);
    } else if (written !== null) {
      const words = [String(value), ...(NUMBER_WORDS[value] ?? [])];
      const says = words.some((w) =>
        new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'iu').test(written),
      );
      if (says) quantity = value;
      else errors.push(`quantity quote "${quote}" does not say ${value}`);
    }
  }

  let acceptUsed = false;
  if (draft.acceptUsed) {
    const quote = inRequest(draft.acceptUsed.quote);
    if (quote !== null) {
      if (USED.test(quote)) acceptUsed = true;
      else
        errors.push(
          `acceptUsed quote "${draft.acceptUsed.quote}" does not mention used or refurbished`,
        );
    }
  }

  const stores: string[] = [];
  for (const s of draft.stores) {
    const domain = s.domain.trim().toLowerCase();
    const quote = inRequest(s.quote);
    if (!DOMAIN.test(domain)) {
      errors.push(`store "${s.domain}" is not a domain`);
      continue;
    }
    if (quote === null) continue;
    const label = letters(domain.split('.')[0] ?? '');
    if (!label || !letters(quote).includes(label)) {
      errors.push(`store quote "${s.quote}" does not name ${domain}`);
      continue;
    }
    if (!stores.includes(domain)) stores.push(domain);
  }

  const unsupported = draft.unsupported.flatMap((u) => {
    const quote = inRequest(u.quote);
    return quote === null ? [] : [quote];
  });

  if (errors.length > 0) return { ok: false, errors };
  // the out-of-scope points the intent card names (their handling mentions the card)
  const notShown = checklist.outOfScope
    .filter((o) => /\bcard\b/i.test(o.handling ?? ''))
    .map((o) => o.name);
  return {
    ok: true,
    value: {
      category,
      request,
      ...(budgetCents !== undefined ? { budgetCents } : {}),
      quantity,
      acceptUsed,
      ...(stores.length > 0 ? { stores } : {}),
      stated,
      triggered,
      notChecked: [...unsupported, ...notShown],
    },
  };
}

/** Throws ReviewUnavailableError after one retry. */
export async function extractIntent(
  request: string,
  category: Category,
  deps: IntentDeps,
): Promise<Intent> {
  const key = recordingKey([category, request.trim()]);
  const { system, prompt } = buildIntentPrompt(request, category);
  try {
    const value = await callModel(
      deps.model,
      {
        kind: 'intent',
        key,
        system,
        prompt,
        schema: IntentDraftSchema,
        input: { category, request },
      },
      (parsed) => verifyIntentDraft(parsed as IntentDraft, request, category),
    );
    return { ...value, source: deps.model.recorded ? 'recorded' : 'model' };
  } catch (err) {
    const reason = err instanceof ReviewUnavailableError ? err.reason : 'model_error';
    deps.logger?.warn('intent extraction failed', { reason, err });
    throw err instanceof ReviewUnavailableError
      ? err
      : new ReviewUnavailableError('model_error', 'Intent extraction failed', { cause: err });
  }
}

const ORIGIN_ORDER = ['stated', 'triggered', 'always'] as const;

/** Step 1 "What Fitcheck will check": every requirement that applies, stated, triggered, always. */
export function checksFor(intent: Intent): RunResponse['checks'] {
  const checklist = getChecklist(intent.category);
  return checklist.requirements
    .map((req) => ({ req, applies: appliesTo(req, intent, null) }))
    .filter((x) => x.applies.applies)
    .sort((a, b) => ORIGIN_ORDER.indexOf(a.applies.origin) - ORIGIN_ORDER.indexOf(b.applies.origin))
    .map(({ req, applies }) => {
      const fact = factLabel(req, checklist);
      return {
        requirement: req.id,
        name: req.name,
        ...(fact ? { fact } : {}),
        origin: applies.origin,
        ...(applies.originQuote !== undefined ? { originQuote: applies.originQuote } : {}),
      };
    });
}
