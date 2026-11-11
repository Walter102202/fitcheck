import { readFileSync } from 'node:fs';

export type ChecklistName = 'common' | 'tv' | 'hair_dryer';

/**
 * The loose shape of a requirement list. Lane B owns the precise semantic schema
 * (apps/backend/src/review/checklist-schema.ts) and may tighten it.
 */
export type ChecklistData = {
  category: string;
  facts: Record<string, unknown>;
  requirements: {
    id: string;
    name: string;
    origin: string;
    appliesWhen: unknown;
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
};

const cache = new Map<ChecklistName, ChecklistData>();

/** Reads `<name>.json` from the package root; the same relative path works from src and dist. */
export function loadChecklist(name: ChecklistName): ChecklistData {
  const cached = cache.get(name);
  if (cached) return cached;
  const url = new URL(`../${name}.json`, import.meta.url);
  const data = JSON.parse(readFileSync(url, 'utf8')) as ChecklistData;
  cache.set(name, data);
  return data;
}
