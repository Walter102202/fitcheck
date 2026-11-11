import type { ConfigResponse } from '@fitcheck/contracts';

/** Display names for the review model ids the server may report. Unknown ids show as they are. */
const MODEL_NAMES: Record<string, string> = {
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

export function modelName(id: string): string {
  return MODEL_NAMES[id] ?? id;
}

/**
 * Who wrote the requirements on this site (GET /api/config): `live`, the model reads each request;
 * `recorded`, answers that model gave earlier; `scripted`, hand-written answers, and the model is
 * only the one a live setup would call. Absent from an older server: no claim about when.
 */
export type ReviewSource = ConfigResponse['reviewSource'];

/** The header chip. A model is named only when that model wrote the answers. */
export function reviewChip(id: string, source: ReviewSource): { name: string; detail?: string } {
  if (source === 'scripted') return { name: 'scripted requirements' };
  if (source === 'recorded') return { name: modelName(id), detail: 'recorded answers' };
  return { name: modelName(id) };
}

/** Step 1's line about who read the request; recorded or scripted never pass for a live call. */
export function reviewerLine(id: string, source: ReviewSource): string {
  const name = modelName(id);
  if (source === 'scripted')
    return `These requirements were written by hand for the four demo requests. With a model key, ${name} reads them from the request.`;
  if (source === 'recorded')
    return `${name} read these requirements from this request earlier. This page replays its recorded answer.`;
  return `${name} read these requirements from the request.`;
}

/** The hero's line: what the product does, then what this site does when no model reads live. */
export function heroLine(id: string, source: ReviewSource): string {
  const product = `${modelName(id)} turns your request into requirements, code checks each one against the listing, and only then does PayPal capture the money.`;
  if (source === 'scripted')
    return `${product} On this site, the requirements for the four demo requests are written by hand.`;
  if (source === 'recorded')
    return `${product} On this site, its answers to the four demo requests were recorded earlier and are replayed.`;
  return product;
}
