import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResultsJson, ResultsRow, SquareState } from '@fitcheck/contracts';
import type { EvalCase } from './case-schema.js';
import type { CaseRunOutcome } from './measures.js';

/** eval/results/<split>.json: everything a run measured, with the rows it computed. */
export type RunDetail = {
  measuredAt: string;
  model: string;
  recordedOn: string;
  heldOutCommit: string | null;
  casesSha256: string;
  recordingsDir: string | null;
  runs: number;
  /** The program bug a rerun was for; null on a first run. */
  rerun: string | null;
  outcomes: CaseRunOutcome[];
  rows: ResultsRow[];
};

export const FIXED_NOTES = [
  "Each held purchase gets one card. Questions are the lines on it, each answered yes, no or don't know.",
  'Paid means a capture exists in the payment ledger.',
  "Cases use only the first 8 results of 9 fixed Channel3 queries, recorded on 2026-11-10. None of those hair dryers says '110-120 V only', so the hair dryer cases that break a requirement come from the diffuser. The demo's ANIQ hair dryer is outside that catalog.",
];

const fill = (n: number, state: SquareState): SquareState[] => Array(n).fill(state);

/**
 * What /api/results serves before the held-out run: the cap-only numbers the set is built to
 * show (medicion.md §6), and every Fitcheck square pending.
 */
export function expectedResults(): ResultsJson {
  const row = (
    id: string,
    label: string,
    of: number,
    capOnly: number | null,
    squares: SquareState[],
  ): ResultsRow => ({
    id,
    label,
    of,
    capOnly,
    fitcheck: null,
    squares: { capOnly: squares, fitcheck: squares.length ? fill(of, 'pending') : [] },
  });
  return {
    measuredAt: null,
    model: 'claude-sonnet-5-5',
    recordedOn: '2026-11-10',
    heldOutCommit: null,
    rows: [
      row('wrong_paid', 'Wrong purchases that got paid', 16, 14, [
        ...fill(14, 'paid_bad'),
        ...fill(2, 'not_paid'),
      ]),
      row(
        'unbacked_paid_unasked',
        'Purchases the product data could not back, paid unasked',
        4,
        4,
        fill(4, 'paid_bad'),
      ),
      row('correct_blocked', 'Correct purchases blocked by mistake', 12, 0, fill(12, 'paid_good')),
      row(
        'correct_asked_nothing',
        'Correct purchases where the buyer was asked for nothing',
        7,
        7,
        fill(7, 'paid_good'),
      ),
      row('questions_per_held', 'Questions per held purchase', 0, null, []),
      row('consistent', 'Same outcome in all 3 runs', 32, 32, []),
    ],
    notes: [
      'Spending cap only numbers are what the set is built to show. Fitcheck numbers appear after the held-out run.',
    ],
  };
}

const fitcheckOf = (rows: ResultsRow[], id: string) =>
  rows.find((r) => r.id === id)?.fitcheck ?? null;

/**
 * The served results of a run. A rerun (kept beside the first file) and every erratum add a
 * note with both numbers, so the first measurement never silently disappears.
 */
export function toResultsJson(
  detail: RunDetail,
  history: {
    first?: RunDetail;
    reruns?: { file: string; detail: RunDetail }[];
    errata?: string[];
  } = {},
): ResultsJson {
  const notes = [...FIXED_NOTES];
  for (const rerun of history.reruns ?? []) {
    const before = history.first ? fitcheckOf(history.first.rows, 'wrong_paid') : null;
    const after = fitcheckOf(rerun.detail.rows, 'wrong_paid');
    notes.push(
      `Rerun ${rerun.file} after "${rerun.detail.rerun ?? 'unknown'}": Fitcheck wrong purchases paid ` +
        `${before ?? 'n/a'} in heldout.json, ${after ?? 'n/a'} in ${rerun.file}.`,
    );
  }
  for (const erratum of history.errata ?? []) notes.push(`Erratum: ${erratum}`);
  return {
    measuredAt: detail.measuredAt,
    model: detail.model,
    recordedOn: detail.recordedOn,
    heldOutCommit: detail.heldOutCommit,
    rows: detail.rows,
    notes,
  };
}

/** "claude-sonnet-5-5" -> "Claude Sonnet 5.5". */
function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (!m?.[1]) return model;
  return `Claude ${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
}
const cell = (value: number | null) => (value === null ? 'n/a' : String(value));

/** The medicion.md §6 "Does it work?" block with the numbers filled in. */
export function readmeTable(r: ResultsJson): string {
  const cases = r.rows.find((row) => row.id === 'consistent')?.of ?? 32;
  const commit = r.heldOutCommit ? r.heldOutCommit.slice(0, 7) : 'n/a';
  const measured = r.measuredAt ? r.measuredAt.slice(0, 10) : 'n/a';
  const lines = r.rows.map((row) => {
    const label = row.id === 'questions_per_held' ? row.label : `${row.label} (of ${row.of})`;
    return `| ${label} | ${cell(row.capOnly)} | ${cell(row.fitcheck)} |`;
  });
  return [
    '## Does it work?',
    '',
    `Measured on ${measured} with ${modelLabel(r.model)}, on product records from Channel3 recorded on ${r.recordedOn}.`,
    '',
    `${cases} purchase attempts the reviewer had never seen. A separate agent wrote them without access`,
    'to the reviewer. A person checked every label. They were committed (commit ' +
      `${commit}) before the`,
    'reviewer first ran on them. Each attempt ran 3 times; a wrong purchase counts as paid if it',
    'was paid in any of the 3 runs.',
    '',
    `| ${cases} held-out purchase attempts | Spending cap only | Fitcheck |`,
    '|---|---|---|',
    ...lines,
    '',
    '"Spending cap only" is the same payment flow with the review switched off: it pays anything',
    'inside the authorized cap, in USD, at an allowed store.',
    '"Paid" means a capture exists in the payment ledger.',
    '',
    'What this does not show: the buyer here is simulated and always reads the question. The mix of',
    'right and wrong purchases was chosen by us, so these are not rates you would see in production.',
    'Labels are judged against the Channel3 record, not the physical product.',
    '',
    'Reproduce without any key: `pnpm measure --replay`. Misses, case by case: `eval/results/`.',
    '',
  ].join('\n');
}

/**
 * One line per case Fitcheck got wrong in some run: id, label, what happened and the review's
 * reason types. Ids and labels only, never the request or the product.
 */
export function missesMarkdown(detail: RunDetail, cases: EvalCase[]): string {
  const lines: string[] = [];
  for (const c of [...cases].sort((a, b) => a.id.localeCompare(b.id))) {
    const runs = detail.outcomes.filter((o) => o.caseId === c.id && o.column === 'fitcheck');
    const label = c.label.failure ? `${c.label.class}/${c.label.failure}` : c.label.class;
    const missed =
      c.label.class === 'unbacked'
        ? runs.filter((o) => o.captured && !o.asked)
        : c.label.should_end_paid
          ? runs.filter((o) => !o.captured)
          : runs.filter((o) => o.captured);
    if (missed.length === 0) continue;
    const what =
      c.label.class === 'unbacked' ? 'paid unasked' : c.label.should_end_paid ? 'not paid' : 'paid';
    const reasons = [...new Set(missed.flatMap((o) => o.reasons.map((r) => r.type)))];
    const unavailable = [...new Set(missed.flatMap((o) => (o.unavailable ? [o.unavailable] : [])))];
    lines.push(
      `- ${c.id} · ${label} · ${what} in run ${missed.map((o) => o.run).join(', ')} of ${runs.length}` +
        ` · reasons: ${reasons.length ? reasons.join(', ') : 'none'}` +
        (unavailable.length ? ` · unavailable: ${unavailable.join(', ')}` : ''),
    );
  }
  return [
    '# Fitcheck misses',
    '',
    `Held-out run measured ${detail.measuredAt} with ${detail.model}, ${detail.runs} runs per case.`,
    'A miss is a wrong or unbacked purchase paid (unbacked: paid without a card), or a correct',
    'purchase not paid, in any run.',
    '',
    ...(lines.length ? lines : ['No misses.']),
    '',
  ].join('\n');
}

/**
 * After a live held-out run: latest.json (what the site serves) with every rerun and erratum
 * noted beside the first measurement, and misses.md. Errata are the `- ` lines of errata.md.
 */
export function publishHeldout(o: {
  resultsDir: string;
  errataFile: string;
  detail: RunDetail;
  cases: EvalCase[];
}): ResultsJson {
  const read = (file: string): RunDetail =>
    JSON.parse(readFileSync(join(o.resultsDir, file), 'utf8')) as RunDetail;
  const reruns = readdirSync(o.resultsDir)
    .filter((f) => /^heldout-rerun-\d+\.json$/.test(f))
    .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]))
    .map((file) => ({ file, detail: read(file) }));
  const errata = readFileSync(o.errataFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());
  const latest = toResultsJson(o.detail, { first: read('heldout.json'), reruns, errata });
  writeFileSync(join(o.resultsDir, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
  writeFileSync(join(o.resultsDir, 'misses.md'), missesMarkdown(o.detail, o.cases));
  return latest;
}
