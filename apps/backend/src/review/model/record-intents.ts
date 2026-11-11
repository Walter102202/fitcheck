// Records the scenario intents with the real model, overwriting the hand recordings.
// Run from apps/backend once ANTHROPIC_API_KEY is in the root .env:
//   pnpm --filter @fitcheck/backend exec tsx --conditions=development src/review/model/record-intents.ts
// Never hand-edit a live recording; report a changed outcome to the main session first.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Category } from '@fitcheck/contracts';
import { extractIntent } from '../intent.js';
import { createAiSdkModelPort } from './ai-sdk.js';
import {
  createFileRecordingStore,
  createRecordingModelPort,
  DEFAULT_RECORDINGS_DIR,
} from './recordings.js';

for (const file of ['./.env', '../.env', '../../.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

const apiKey = process.env.ANTHROPIC_API_KEY;
const modelName = process.env.REVIEW_MODEL || 'claude-sonnet-5-5';
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is required (root .env).');
  process.exit(1);
}

type Request = { scenarioId: string; category: Category; request: string };
const requests = JSON.parse(
  readFileSync(join(DEFAULT_RECORDINGS_DIR, 'requests.json'), 'utf8'),
) as Request[];

const model = createRecordingModelPort(
  createAiSdkModelPort(createAnthropic({ apiKey })(modelName), modelName),
  createFileRecordingStore(DEFAULT_RECORDINGS_DIR),
);

let failed = false;
for (const { scenarioId, category, request } of requests) {
  try {
    const intent = await extractIntent(request, category, { model });
    console.log(JSON.stringify({ scenarioId, intent }, null, 2));
  } catch (err) {
    failed = true;
    console.error(scenarioId, err instanceof Error ? err.message : String(err));
  }
}
process.exit(failed ? 1 : 0);
