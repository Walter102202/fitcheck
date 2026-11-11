import { loadChecklist } from '@fitcheck/checklists';
import type { Category } from '@fitcheck/contracts';
import {
  ChecklistFileSchema,
  type FactSpec,
  type FactTest,
  type RequirementSpec,
  type TestSpec,
} from './checklist-schema.js';

export type {
  AppliesWhen,
  FactSpec,
  FactTest,
  RequirementSpec,
  TestSpec,
} from './checklist-schema.js';

export type ReviewChecklist = {
  category: Category;
  noun: 'TV' | 'hair dryer';
  channel3CategorySlugs: string[];
  /** Category facts plus common facts. */
  facts: Record<string, FactSpec>;
  /** Category file order, then common file order. */
  requirements: RequirementSpec[];
  /** common.json outOfScope. */
  outOfScope: { id: string; name: string }[];
};

const NOUNS: Record<Category, ReviewChecklist['noun']> = { tv: 'TV', hair_dryer: 'hair dryer' };
const cache = new Map<Category, ReviewChecklist>();

/** Zod-parsed once and cached; throws on invalid data. */
export function getChecklist(category: Category): ReviewChecklist {
  const cached = cache.get(category);
  if (cached) return cached;
  const common = ChecklistFileSchema.parse(loadChecklist('common'));
  const own = ChecklistFileSchema.parse(loadChecklist(category));
  if (own.category !== category)
    throw new Error(`Checklist ${category} has category ${own.category}`);
  const checklist: ReviewChecklist = {
    category,
    noun: NOUNS[category],
    channel3CategorySlugs: own.channel3CategorySlugs ?? [],
    facts: { ...common.facts, ...own.facts },
    requirements: [...own.requirements, ...common.requirements],
    outOfScope: common.outOfScope.map((o) => ({ id: o.id, name: o.name })),
  };
  cache.set(category, checklist);
  return checklist;
}

/**
 * The two `whenStatedValue` requirements have no test in the data: these apply when the
 * request states the mount's maximum pattern or the available width.
 */
export const STATED_TESTS: Record<string, { test: FactTest; reasonTemplate: string }> = {
  'tv.wall_mount': {
    test: { fact: 'vesaPattern', op: 'fitsWithin', valueFrom: 'intent' },
    reasonTemplate:
      'This TV uses the VESA {vesaPattern} pattern; your mount takes up to {intentValue}.',
  },
  'tv.fits_space': {
    test: { fact: 'widthIn', op: 'max', valueFrom: 'intent' },
    reasonTemplate: 'This TV is {widthIn} inches wide; the spot is {intentValue} inches.',
  },
};

export function isFactTest(test: TestSpec | undefined): test is FactTest {
  return !!test && 'fact' in test && 'op' in test;
}

/** req.test.fact when it names a fact of the checklist, else the stated test's fact, else null. */
export function factOf(req: RequirementSpec, checklist: ReviewChecklist): string | null {
  if (isFactTest(req.test) && checklist.facts[req.test.fact]) return req.test.fact;
  const stated = STATED_TESTS[req.id];
  if (stated && checklist.facts[stated.test.fact]) return stated.test.fact;
  return null;
}

export function factLabel(req: RequirementSpec, checklist: ReviewChecklist): string | null {
  const fact = factOf(req, checklist);
  return fact ? (checklist.facts[fact]?.label ?? null) : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type CueHit = { cue: string; start: number; end: number; text: string };

/** Whole-word, case-insensitive; the hit that starts earliest (the longer cue on a tie). */
export function findCue(request: string, cues: string[]): CueHit | null {
  let best: CueHit | null = null;
  for (const cue of cues) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(cue)}(?![\\p{L}\\p{N}])`, 'iu');
    const m = re.exec(request);
    if (!m) continue;
    const hit = { cue, start: m.index, end: m.index + m[0].length, text: m[0] };
    if (!best || hit.start < best.start || (hit.start === best.start && hit.end > best.end)) {
      best = hit;
    }
  }
  return best;
}

export const TEMPLATE_PLACEHOLDERS: readonly string[] = [
  'conflicts',
  'vesaPattern',
  'widthIn',
  'screenSizeIn',
  'intentValue',
  'resolutionMax',
  'panelFamily',
  'priceSeen',
  'price',
  'budget',
  'amount',
  'domain',
  'condition',
  'purchaseQuantity',
  'quantity',
  'option',
  'brand',
  'intentBrand',
  'categorySlug',
  'category',
];

/** Fills `{name}` placeholders; throws on a placeholder with no var. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`Missing template variable: ${name}`);
    return v;
  });
}
