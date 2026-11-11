import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { heldOutCommit, sha256File, verifyFreeze, writeFreeze } from './freeze.js';

function tempCases(): { dir: string; cases: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), 'freeze-'));
  const cases = join(dir, 'heldout.json');
  writeFileSync(cases, '[{"id":"h-01"}]\n');
  return { dir, cases, sha: join(dir, 'heldout.sha256') };
}

describe('freeze', () => {
  it('verifyFreeze passes on the file it froze', () => {
    const t = tempCases();
    const sha = writeFreeze(t.cases, t.sha);
    expect(sha).toBe(sha256File(t.cases));
    expect(verifyFreeze(t.cases, t.sha)).toEqual({ ok: true, sha });
  });

  it('writes the sha file in sha256sum format', () => {
    const t = tempCases();
    writeFreeze(t.cases, t.sha);
    expect(readFileSync(t.sha, 'utf8')).toMatch(/^[0-9a-f]{64} {2}heldout\.json\n$/);
  });

  it('verifyFreeze fails with mismatch after a one-byte change', () => {
    const t = tempCases();
    const sha = writeFreeze(t.cases, t.sha);
    appendFileSync(t.cases, ' ');
    const result = verifyFreeze(t.cases, t.sha);
    expect(result).toMatchObject({ ok: false, reason: 'mismatch', expected: sha });
    expect(result.ok === false && result.actual).toBe(sha256File(t.cases));
  });

  it('verifyFreeze fails with missing when there is no sha file', () => {
    const t = tempCases();
    expect(verifyFreeze(t.cases, t.sha)).toEqual({ ok: false, reason: 'missing' });
  });

  it('verifyFreeze fails with missing when there is no cases file', () => {
    const t = tempCases();
    writeFreeze(t.cases, t.sha);
    expect(verifyFreeze(join(t.dir, 'absent.json'), t.sha)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('heldOutCommit returns null for an uncommitted file and the commit once committed', () => {
    const repo = mkdtempSync(join(tmpdir(), 'freeze-repo-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
        cwd: repo,
        encoding: 'utf8',
      }).trim();
    git('init', '-q');
    mkdirSync(join(repo, 'eval', 'cases'), { recursive: true });
    writeFileSync(join(repo, 'README.md'), 'x\n');
    git('add', 'README.md');
    git('commit', '-q', '-m', 'init');
    const cases = join(repo, 'eval', 'cases', 'heldout.json');
    writeFileSync(cases, '[]\n');
    writeFreeze(cases, join(repo, 'eval', 'cases', 'heldout.sha256'));
    expect(heldOutCommit(repo)).toBeNull();
    git('add', 'eval');
    git('commit', '-q', '-m', 'freeze');
    const head = git('rev-parse', 'HEAD');
    expect(heldOutCommit(repo)).toBe(head);
    appendFileSync(cases, ' ');
    expect(heldOutCommit(repo)).toBeNull();
  });
});
