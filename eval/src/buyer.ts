import type { Answer, QuestionLine } from '@fitcheck/contracts';
import type { EvalCase } from './case-schema.js';

/**
 * The simulated buyer answers each card line from the case's hidden dossier: `needed` means
 * the buyer refuses what the line describes (no), `not_needed` accepts it (yes), and a
 * requirement the dossier does not cover is a don't know.
 */
export function simulatedBuyer(dossier: EvalCase['dossier']): (line: QuestionLine) => Answer {
  return (line) => {
    const entry = dossier[line.requirement];
    if (!entry) return 'dont_know';
    return entry.need === 'needed' ? 'no' : 'yes';
  };
}
