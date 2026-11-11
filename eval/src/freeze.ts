import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

/** The held-out files, relative to the repo root (git paths, forward slashes). */
export const HELDOUT_PATHS = ['eval/cases/heldout.json', 'eval/cases/heldout.sha256'] as const;

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Freezes the cases: writes `<64 hex>  <file name>\n` (sha256sum format) and returns the sha. */
export function writeFreeze(casesPath: string, shaPath: string): string {
  const sha = sha256File(casesPath);
  writeFileSync(shaPath, `${sha}  ${basename(casesPath)}\n`);
  return sha;
}

export type FreezeCheck =
  | { ok: true; sha: string }
  | { ok: false; reason: 'missing' | 'mismatch'; expected?: string; actual?: string };

export function verifyFreeze(casesPath: string, shaPath: string): FreezeCheck {
  if (!existsSync(casesPath) || !existsSync(shaPath)) return { ok: false, reason: 'missing' };
  const expected = /^([0-9a-f]{64}) {2}/.exec(readFileSync(shaPath, 'utf8'))?.[1];
  if (!expected) return { ok: false, reason: 'missing' };
  const actual = sha256File(casesPath);
  return actual === expected
    ? { ok: true, sha: actual }
    : { ok: false, reason: 'mismatch', expected, actual };
}

/**
 * The commit that last touched the frozen files, or null when they were never committed or have
 * uncommitted changes: a live held-out run must point at exactly the cases it measured.
 */
export function heldOutCommit(repoRoot: string): string | null {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain', '--', ...HELDOUT_PATHS) !== '') return null;
  const commit = git('log', '-1', '--format=%H', '--', ...HELDOUT_PATHS);
  return commit === '' ? null : commit;
}
