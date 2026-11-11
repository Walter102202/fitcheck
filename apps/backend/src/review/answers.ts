import type { Answer, QuestionCard, TaskMemory } from '@fitcheck/contracts';
import { getChecklist } from './checklist.js';
import { notPaid } from './errors.js';

function requirementName(id: string): string {
  for (const category of ['tv', 'hair_dryer'] as const) {
    const req = getChecklist(category).requirements.find((r) => r.id === id);
    if (req) return req.name;
  }
  return id;
}

/**
 * Pure and sync. A missing answer counts as dont_know; keys that match no line are ignored.
 * Capture only when every line is yes. Memory is a new object keyed by lineId; payment lines
 * and dont_know never change it.
 */
export function applyAnswers(
  card: QuestionCard,
  answers: Record<string, Answer>,
  memory: TaskMemory,
): { decision: 'capture' | 'return_to_agent'; memory: TaskMemory; agentMessage?: string } {
  const next: TaskMemory = { ...memory };
  const declined: string[] = [];
  for (const line of card.lines) {
    const answer: Answer = Object.hasOwn(answers, line.lineId)
      ? (answers[line.lineId] ?? 'dont_know')
      : 'dont_know';
    if (answer !== 'yes') {
      const name = requirementName(line.requirement);
      declined.push(answer === 'dont_know' ? `${name} (not sure)` : name);
    }
    if (line.type === 'payment' || answer === 'dont_know') continue;
    next[line.lineId] = answer === 'yes' ? 'not_needed' : 'needed';
  }
  if (declined.length === 0) return { decision: 'capture', memory: next };
  return {
    decision: 'return_to_agent',
    memory: next,
    agentMessage: notPaid(`The buyer did not approve: ${declined.join('; ')}.`),
  };
}
