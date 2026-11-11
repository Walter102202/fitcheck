import {
  type Decision,
  formatUsd,
  type QuestionCard,
  type ReasonType,
  type RequirementResult,
  type ReviewResult,
  type TaskMemory,
} from '@fitcheck/contracts';
import { OVERFLOW_MESSAGE } from './errors.js';
import type { Evaluation, PendingLine } from './evaluate.js';

export const MAX_LINES = 3;
const LINE_ORDER: ReasonType[] = ['payment', 'contradictory', 'unbacked', 'never_asked', 'broken'];
const SAID_OK = 'You said this is OK earlier in this task.';
const SAID_NO = 'You said this is not OK earlier in this task.';

export type Decided = {
  decision: Decision;
  card?: QuestionCard;
  agentMessage?: string;
  reasons: ReviewResult['reasons'];
  results: RequirementResult[];
};

const reasonOf = (l: PendingLine) => ({ requirement: l.requirement, type: l.type });

/** Returns first, then remembered answers, then the card (1 to 3 lines) or an overflow. */
export function decide(
  evals: Evaluation[],
  memory: TaskMemory,
  o: { amountCents: number; noun: string },
): Decided {
  const results = evals.map((e) => ({ ...e.result }));

  const returns = evals.flatMap((e) =>
    e.returnReason !== undefined
      ? [
          {
            reason: e.returnReason,
            requirement: e.result.requirement,
            type: e.returnType ?? 'broken',
          },
        ]
      : [],
  );
  if (returns.length > 0) {
    const sentences = [...new Set(returns.map((r) => r.reason))];
    return {
      decision: 'return_to_agent',
      agentMessage: sentences.join(' '),
      reasons: returns.map((r) => ({ requirement: r.requirement, type: r.type })),
      results,
    };
  }

  const remaining: PendingLine[] = [];
  const rejected: { line: PendingLine; name: string }[] = [];
  evals.forEach((e, i) => {
    const line = e.line;
    if (!line) return;
    const remembered = line.type === 'payment' ? undefined : memory[line.lineId];
    const result = results[i];
    if (remembered === 'not_needed') {
      if (result) result.note = SAID_OK;
      return;
    }
    if (remembered === 'needed') {
      if (result) result.note = SAID_NO;
      rejected.push({ line, name: e.result.name });
      return;
    }
    remaining.push(line);
  });

  if (rejected.length > 0) {
    return {
      decision: 'return_to_agent',
      agentMessage: rejected
        .map((r) => `The buyer already said no to this point earlier in this task: ${r.name}.`)
        .join(' '),
      reasons: rejected.map((r) => reasonOf(r.line)),
      results,
    };
  }

  const lines = remaining
    .map((line, i) => ({ line, i }))
    .sort((a, b) => LINE_ORDER.indexOf(a.line.type) - LINE_ORDER.indexOf(b.line.type) || a.i - b.i)
    .map((x) => x.line);

  if (lines.length === 0) return { decision: 'capture', reasons: [], results };
  if (lines.length > MAX_LINES) {
    return {
      decision: 'return_to_agent',
      agentMessage: OVERFLOW_MESSAGE,
      reasons: lines.map(reasonOf),
      results,
    };
  }
  return {
    decision: 'ask',
    card: { title: `Before we pay ${formatUsd(o.amountCents)} for this ${o.noun}`, lines },
    reasons: lines.map(reasonOf),
    results,
  };
}
