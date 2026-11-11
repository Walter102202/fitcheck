// Category requirements under the contradiction rule: every test and every askWhen condition is
// evaluated over every candidate value code finds, not only the cited one.
import type { Evidence, Intent, Origin, ReasonType, RequirementResult } from '@fitcheck/contracts';
import {
  type FactSpec,
  type FactTest,
  factLabel,
  factOf,
  findCue,
  getChecklist,
  isFactTest,
  type RequirementSpec,
  type ReviewChecklist,
  renderTemplate,
  STATED_TESTS,
} from './checklist.js';
import { collectCandidates } from './facts.js';
import { type Candidate, displayOf, type Value, valueKey } from './normalize.js';
import { type ProductContext, readPath, searchedLabels } from './paths.js';

export type PendingLine = { lineId: string; requirement: string; type: ReasonType; text: string };
export type Evaluation = {
  result: RequirementResult;
  line?: PendingLine;
  returnReason?: string;
  returnType?: ReasonType;
};
export type Applies = { applies: boolean; origin: Origin; originQuote?: string };

const NOT_APPLICABLE: Applies = { applies: false, origin: 'always' };

function quoteOf(intent: Intent, id: string): { originQuote?: string } {
  const q = intent.stated[id]?.quote ?? intent.triggered[id]?.quote;
  return q !== undefined ? { originQuote: q } : {};
}

/** Whether the requirement applies to this intent (and product, when there is one). */
export function appliesTo(
  req: RequirementSpec,
  intent: Intent,
  ctx: ProductContext | null,
): Applies {
  const when = req.appliesWhen;
  if ('always' in when) return { applies: true, origin: 'always' };
  if ('intentHas' in when) {
    const key = when.intentHas;
    const onIntent = key in intent ? (intent as Record<string, unknown>)[key] !== undefined : false;
    const has =
      onIntent ||
      intent.stated[key] !== undefined ||
      (when.orCues ? findCue(intent.request, when.orCues) !== null : false);
    return has ? { applies: true, origin: 'stated', ...quoteOf(intent, req.id) } : NOT_APPLICABLE;
  }
  if ('cues' in when) {
    // a buyer's stated value always applies; unlessAlsoApplies only silences a cue
    const stated = intent.stated[req.id];
    if (stated) return { applies: true, origin: 'stated', originQuote: stated.quote };
    if (when.unlessAlsoApplies) {
      const other = getChecklist(intent.category).requirements.find(
        (r) => r.id === when.unlessAlsoApplies,
      );
      if (other && appliesTo(other, intent, ctx).applies) return NOT_APPLICABLE;
    }
    const triggered = intent.triggered[req.id];
    if (triggered) return { applies: true, origin: 'triggered', originQuote: triggered.quote };
    return NOT_APPLICABLE;
  }
  if ('productHas' in when) {
    const has = ctx === null || readPath(when.productHas, ctx).length > 0;
    return has ? { applies: true, origin: 'always' } : NOT_APPLICABLE;
  }
  return NOT_APPLICABLE;
}

// ---- tests ----

function parsePattern(v: Value): [number, number] | null {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** One test on one candidate value. */
export function passes(test: FactTest, value: Value, expected: unknown, fact: FactSpec): boolean {
  const tolerance = test.tolerance ?? fact.tolerance ?? 0;
  switch (test.op) {
    case 'eq':
      if (typeof value === 'number' && typeof expected === 'number') {
        return Math.abs(value - expected) <= tolerance;
      }
      if (typeof value === 'boolean' || typeof expected === 'boolean') return value === expected;
      return valueKey(value) === valueKey(String(expected));
    case 'in': {
      const list = Array.isArray(expected) ? expected : [expected];
      return list.some((x) => valueKey(String(x)) === valueKey(value));
    }
    case 'max':
      return Number(value) <= Number(expected);
    case 'min': {
      const order = fact.values ?? [];
      const at = order.indexOf(valueKey(value));
      const need = order.indexOf(valueKey(String(expected)));
      return at >= 0 && need >= 0 && at >= need;
    }
    case 'fitsWithin': {
      const a = parsePattern(value);
      const b = parsePattern(String(expected));
      return !!a && !!b && a[0] <= b[0] && a[1] <= b[1];
    }
    default:
      return false;
  }
}

// ---- grouping and copy ----

/** Candidates grouped by value (numbers within tolerance), backing candidates first. */
export function groupCandidates(candidates: Candidate[], tolerance: number): Candidate[][] {
  const ordered = [...candidates.filter((c) => c.backing), ...candidates.filter((c) => !c.backing)];
  const groups: Candidate[][] = [];
  for (const c of ordered) {
    const group = groups.find((g) => {
      const rep = g[0];
      if (!rep) return false;
      if (typeof rep.value === 'number' && typeof c.value === 'number') {
        return Math.abs(rep.value - c.value) <= tolerance;
      }
      return valueKey(rep.value) === valueKey(c.value);
    });
    if (group) group.push(c);
    else groups.push([c]);
  }
  return groups;
}

/** "A and B", "A, B and C". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function conflictsText(groups: Candidate[][]): string {
  return joinList(
    groups.flatMap((g) => (g[0] ? [`${g[0].conflictDisplay} (${g[0].source})`] : [])),
  );
}

function sortedKeys(groups: Candidate[][]): string {
  return groups
    .flatMap((g) => (g[0] ? [valueKey(g[0].value)] : []))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .join('|');
}

/** Numbers render bare (templates add the unit); other values use their display. */
function intentDisplay(normalizer: string, value: unknown): string {
  if (typeof value === 'number') return valueKey(value);
  if (typeof value === 'string' || typeof value === 'boolean') return displayOf(normalizer, value);
  return String(value);
}

function templateVars(
  factId: string | null,
  fact: FactSpec | undefined,
  groups: Candidate[][],
  intentValue: unknown,
): Record<string, string> {
  const vars: Record<string, string> = { conflicts: conflictsText(groups) };
  const first = groups[0]?.[0];
  if (fact && first && factId) {
    const v = first.value;
    vars[factId] =
      fact.normalizer === 'widthFromOfferDimensions'
        ? Number(v).toFixed(1)
        : typeof v === 'number'
          ? valueKey(v)
          : first.evidence.display;
  }
  if (fact && intentValue !== undefined)
    vars.intentValue = intentDisplay(fact.normalizer, intentValue);
  return vars;
}

function lineText(
  req: RequirementSpec,
  type: ReasonType,
  vars: Record<string, string>,
  groups: Candidate[][],
): string {
  const template = req.line?.[type];
  if (template) return renderTemplate(template, vars);
  const name = req.name.toLowerCase();
  if (type === 'contradictory') {
    return `The listing gives different values for ${name}: ${vars.conflicts ?? ''}. Is that OK?`;
  }
  if (type === 'never_asked') {
    const display = groups[0]?.[0]?.evidence.display ?? '';
    return `The listing gives ${display} for ${name}. Is that OK?`;
  }
  return `The listing does not confirm ${name}. Is that OK?`;
}

function returnText(req: RequirementSpec, statedTest: boolean, vars: Record<string, string>) {
  const template =
    (statedTest ? STATED_TESTS[req.id]?.reasonTemplate : undefined) ?? req.reasonTemplate;
  return template ? renderTemplate(template, vars) : `${req.name}: the listing does not match.`;
}

/** Evaluates one category requirement (the caller checked appliesTo). */
export function evaluateRequirement(
  req: RequirementSpec,
  intent: Intent,
  checklist: ReviewChecklist,
  ctx: ProductContext,
): Evaluation {
  const applies = appliesTo(req, intent, ctx);
  const stated = intent.stated[req.id];
  const statedTest = stated !== undefined && STATED_TESTS[req.id] !== undefined;
  const test = statedTest
    ? STATED_TESTS[req.id]?.test
    : isFactTest(req.test)
      ? req.test
      : undefined;
  const factId = factOf(req, checklist);
  const fact = factId ? checklist.facts[factId] : undefined;
  const label = factLabel(req, checklist);
  const candidates = factId ? collectCandidates(factId, ctx, checklist) : [];

  const base = {
    requirement: req.id,
    name: req.name,
    ...(label ? { fact: label } : {}),
    origin: applies.origin,
    ...(applies.originQuote !== undefined ? { originQuote: applies.originQuote } : {}),
  };
  const tolerance = test?.tolerance ?? fact?.tolerance ?? 0;
  const groups = groupCandidates(candidates, tolerance);
  const evidenceOf = (gs: Candidate[][]): Evidence[] =>
    gs.flatMap((g) => (g[0] ? [g[0].evidence] : []));

  const intentValue = test
    ? test.valueFrom === 'intent'
      ? stated?.value
      : test.value
    : stated?.value;
  if (test && test.valueFrom === 'intent' && intentValue === undefined) {
    throw new Error(`${req.id} needs a stated value`);
  }
  const vars = templateVars(factId, fact, groups, intentValue);

  if (!candidates.some((c) => c.backing)) {
    const result: RequirementResult = {
      ...base,
      state: 'unbacked',
      evidence: [],
      searched: fact ? searchedLabels(fact.evidence, ctx) : [],
    };
    if (req.ifMissing === 'ask' || !test) {
      return {
        result,
        line: {
          lineId: req.id,
          requirement: req.id,
          type: 'unbacked',
          text: lineText(req, 'unbacked', vars, groups),
        },
      };
    }
    return {
      result,
      returnReason: `${req.name}: the listing does not match.`,
      returnType: 'unbacked',
    };
  }

  if (!test || !fact) {
    // askWhen.always: the buyer confirms the value (or picks between the values)
    if (groups.length === 1) {
      const key = valueKey(groups[0]?.[0]?.value ?? '');
      return {
        result: { ...base, state: 'never_asked', evidence: evidenceOf(groups) },
        line: {
          lineId: `${req.id}=${key}`,
          requirement: req.id,
          type: 'never_asked',
          text: lineText(req, 'never_asked', vars, groups),
        },
      };
    }
    return {
      result: { ...base, state: 'contradictory', evidence: evidenceOf(groups) },
      line: {
        lineId: `${req.id}=${sortedKeys(groups)}`,
        requirement: req.id,
        type: 'contradictory',
        text: lineText(req, 'contradictory', vars, groups),
      },
    };
  }

  const outcomes = candidates.map((c) => passes(test, c.value, intentValue, fact));
  if (outcomes.every(Boolean)) {
    return { result: { ...base, state: 'backed', evidence: evidenceOf(groups) } };
  }
  if (!outcomes.some(Boolean)) {
    return {
      result: { ...base, state: 'broken', evidence: evidenceOf(groups) },
      returnReason: returnText(req, statedTest, vars),
      returnType: 'broken',
    };
  }
  return {
    result: { ...base, state: 'contradictory', evidence: evidenceOf(groups) },
    line: {
      lineId: `${req.id}=${sortedKeys(groups)}`,
      requirement: req.id,
      type: 'contradictory',
      text: lineText(req, 'contradictory', vars, groups),
    },
  };
}
