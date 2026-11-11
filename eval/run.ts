/**
 * pnpm measure [--split heldout|tuning] [--replay] [--runs 3] [--rerun "<reason>"]
 *
 * Live (LLM_PROVIDER=anthropic): every Fitcheck run records the model's outputs into a new
 * eval/recordings/<split>/<stamp>/run-<n>/ and the numbers go to eval/results/<split>.json.
 * Replay: re-derives the committed numbers from those recordings alone.
 * LLM_PROVIDER=mock: a dev check on Lane B's demo recordings, written to eval/results/dev/.
 * Prints counts and case ids only, never case content.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { type Env, loadEnv } from '../apps/backend/src/env.js';
import { HARNESS_NOW } from '../apps/backend/src/runs/harness.js';
import { createPorts, type ModelPort } from '../apps/backend/src/runs/ports.js';
import { EvalCaseSchema } from './src/case-schema.js';
import { EVAL_DIR, loadRecord, REPO_ROOT } from './src/catalog.js';
import { heldOutCommit, sha256File, verifyFreeze } from './src/freeze.js';
import {
  claimRecordingsDir,
  type EvalPorts,
  guardLiveRun,
  type Measured,
  measureCases,
  replayVerdict,
  runStamp,
} from './src/harness.js';
import { evalModel } from './src/model.js';
import { publishHeldout, type RunDetail } from './src/results.js';

const { values } = parseArgs({
  options: {
    split: { type: 'string', default: 'heldout' },
    replay: { type: 'boolean', default: false },
    runs: { type: 'string', default: '3' },
    rerun: { type: 'string' },
  },
});
const split = z.enum(['heldout', 'tuning']).parse(values.split);
const runs = z.coerce.number().int().min(1).max(5).parse(values.runs);

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};
const posix = (path: string) => relative(REPO_ROOT, path).replaceAll('\\', '/');

const envFile = join(REPO_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const env = loadEnv();

const casesFile = join(EVAL_DIR, 'cases', `${split}.json`);
const shaFile = join(EVAL_DIR, 'cases', `${split}.sha256`);
const resultsDir = join(EVAL_DIR, 'results');
const cases = z.array(EvalCaseSchema).parse(JSON.parse(readFileSync(casesFile, 'utf8')));
if (split === 'heldout') {
  const freeze = verifyFreeze(casesFile, shaFile);
  if (!freeze.ok) fail(`The held-out freeze check failed: ${freeze.reason}.`);
}
/** The commit that froze the cases, taken before the run writes anything. */
const commitAtStart = split === 'heldout' ? heldOutCommit(REPO_ROOT) : null;

/** The server's ports on recorded Channel3, the fixed harness clock and no citations. */
function portsWith(model: ModelPort): EvalPorts {
  const recorded: Env = { ...env, CHANNEL3_MODE: 'recorded' };
  const ports = createPorts(recorded, { now: () => HARNESS_NOW, model, citations: false });
  return { ...ports, modelName: model.modelName };
}

const CommittedSchema = z.object({
  recordingsDir: z.string().nullable(),
  runs: z.number().int().positive(),
  rows: z.array(z.unknown()),
});

type Plan = {
  kind: 'live' | 'replay' | 'dev';
  outFile: string;
  runs: number;
  recordingsDir: string | null;
  portsFor: (run: number) => EvalPorts;
  committed?: { rows: unknown[]; file: string };
};

function plan(): Plan {
  if (values.replay) {
    const file = join(resultsDir, `${split}.json`);
    if (!existsSync(file)) fail(`Nothing to replay: ${posix(file)} does not exist.`);
    const committed = CommittedSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const dir = committed.recordingsDir;
    if (!dir) return fail(`${posix(file)} has no recordingsDir to replay.`);
    return {
      kind: 'replay',
      outFile: join(resultsDir, 'replay', `${split}.json`),
      runs: committed.runs,
      recordingsDir: dir,
      portsFor: (run) =>
        portsWith(evalModel(env, { mode: 'replay', dir: join(REPO_ROOT, dir, `run-${run}`) })),
      committed: { rows: committed.rows, file: posix(file) },
    };
  }
  if (env.LLM_PROVIDER === 'mock') {
    // Lane B's mock recordings hold only the demo requests: a wiring check, not a measurement.
    return {
      kind: 'dev',
      outFile: join(resultsDir, 'dev', `${split}.json`),
      runs,
      recordingsDir: null,
      portsFor: () => {
        const ports = createPorts(
          { ...env, CHANNEL3_MODE: 'recorded' },
          { now: () => HARNESS_NOW, citations: false },
        );
        return { ...ports, modelName: 'replay' };
      },
    };
  }
  if (!env.ANTHROPIC_API_KEY) fail('A live run needs ANTHROPIC_API_KEY.');
  if (split === 'heldout' && !heldOutCommit(REPO_ROOT)) {
    fail('Commit eval/cases/heldout.json and heldout.sha256 before the live held-out run.');
  }
  const guard = guardLiveRun({
    split,
    resultsDir,
    ...(values.rerun ? { rerun: values.rerun } : {}),
  });
  if (!guard.ok) return fail(guard.message);
  const dir = join(EVAL_DIR, 'recordings', split, runStamp(new Date()));
  const claimed = claimRecordingsDir(dir);
  if (!claimed.ok) return fail(claimed.message);
  return {
    kind: 'live',
    outFile: guard.outFile,
    runs,
    recordingsDir: posix(dir),
    portsFor: (run) => {
      const runDir = join(dir, `run-${run}`);
      mkdirSync(runDir, { recursive: true });
      return portsWith(evalModel(env, { mode: 'record', dir: runDir }));
    },
  };
}

const p = plan();
console.log(`Measuring ${cases.length} ${split} cases (${p.kind}, ${p.runs} Fitcheck runs).`);
const measured: Measured = await measureCases({
  cases,
  runs: p.runs,
  portsFor: p.portsFor,
  log: (line) => console.log(line),
});

const recordedOn = [...new Set(cases.map((c) => loadRecord(c.attempt.product_id).recordedOn))]
  .filter((d): d is string => typeof d === 'string')
  .sort()
  .join(', ');
const results: RunDetail = {
  measuredAt: new Date().toISOString(),
  model: measured.modelName,
  recordedOn,
  heldOutCommit: commitAtStart,
  casesSha256: sha256File(casesFile),
  recordingsDir: p.recordingsDir,
  runs: p.runs,
  rerun: p.kind === 'live' ? (values.rerun ?? null) : null,
  outcomes: measured.outcomes,
  rows: measured.rows,
};
const writeJson = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Wrote ${posix(file)}.`);
};
writeJson(p.outFile, results);
for (const row of measured.rows) {
  console.log(
    `${row.label}: cap only ${row.capOnly ?? '-'}, Fitcheck ${row.fitcheck ?? '-'} (of ${row.of})`,
  );
}

if (p.kind === 'live' && split === 'heldout') {
  publishHeldout({
    resultsDir,
    errataFile: join(EVAL_DIR, 'cases', 'errata.md'),
    detail: results,
    cases,
  });
  console.log('Wrote eval/results/latest.json and eval/results/misses.md.');
}

if (p.kind === 'replay' && p.committed) {
  const verdict = replayVerdict(measured, {
    rows: p.committed.rows as Measured['rows'],
    file: p.committed.file,
  });
  console.log(verdict.message);
  if (!verdict.ok) process.exitCode = 1;
}
