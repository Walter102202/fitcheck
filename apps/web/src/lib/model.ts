/** Display names for the review model ids the server may report. Unknown ids show as they are. */
const MODEL_NAMES: Record<string, string> = {
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

export function modelName(id: string): string {
  return MODEL_NAMES[id] ?? id;
}

export type ReviewSource = 'live' | 'recorded' | undefined;

/** Step 1's line about who read the request; recorded answers never pass for a live call. */
export function reviewerLine(id: string, source: ReviewSource): string {
  const name = modelName(id);
  if (source === 'recorded')
    return `${name} read these requirements from this request earlier. This page replays its recorded answer.`;
  return `${name} read these requirements from the request.`;
}
