import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertHistoricalSourceTreesMatch,
  buildSourceTreeSet,
  buildSourceTreeSetAtCodeSubject,
  parseExactCliArguments,
  readFileAtCodeSubject,
  SECURITY_EVIDENCE_SUBJECT_PROTOCOL,
  validateCodeSubjectSha,
} from './security-evidence-subject.mjs';

describe('security evidence code-subject protocol', () => {
  it('requires a full immutable code SHA and explicitly excludes the self-referential evidence SHA', () => {
    expect(validateCodeSubjectSha('0123456789abcdef0123456789abcdef01234567')).toBe(
      '0123456789abcdef0123456789abcdef01234567',
    );
    expect(SECURITY_EVIDENCE_SUBJECT_PROTOCOL).toEqual({
      schema: 'kovo.security-evidence-subject/v1',
      codeSubject: expect.stringContaining('before this evidence artifact is written'),
      evidenceCommit: expect.stringContaining('self-referential'),
    });
    expect(() => validateCodeSubjectSha('HEAD')).toThrow('full lowercase Git commit SHA');
  });

  it('accepts each writer argument once and rejects missing, duplicate, unknown, or valueless flags', () => {
    const options = {
      command: '--write',
      optionalFlags: ['--historical-subject'],
      optionalValueFlags: ['--review-file'],
      valueFlags: ['--subject-sha', '--reason'],
    };
    expect(
      parseExactCliArguments(
        [
          '--write',
          '--subject-sha',
          '0123456789abcdef0123456789abcdef01234567',
          '--reason',
          'reviewed refresh',
          '--historical-subject',
          '--review-file',
          'review.json',
        ],
        options,
      ),
    ).toEqual({
      write: true,
      'subject-sha': '0123456789abcdef0123456789abcdef01234567',
      reason: 'reviewed refresh',
      'historical-subject': true,
      'review-file': 'review.json',
    });
    for (const args of [
      ['--write', '--subject-sha', 'a'.repeat(40)],
      ['--write', '--write', '--subject-sha', 'a'.repeat(40), '--reason', 'x'],
      ['--write', '--subject-sha', '--reason', 'x'],
      ['--write', '--subject-sha', 'a'.repeat(40), '--reason', 'x', '--unknown'],
      ['--write', '--subject-sha', 'a'.repeat(40), '--reason', 'x', '--review-file'],
      [
        '--write',
        '--subject-sha',
        'a'.repeat(40),
        '--reason',
        'x',
        '--review-file',
        'one',
        '--review-file',
        'two',
      ],
    ]) {
      expect(() => parseExactCliArguments(args, options)).toThrow();
    }
  });

  it('binds complete source-tree membership, modes, paths, and bytes at retained commits', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-security-evidence-tree-'));
    try {
      mkdirSync(path.join(root, 'packages/example/src/nested'), { recursive: true });
      writeFileSync(path.join(root, 'packages/example/src/index.ts'), 'export const value = 1;\n');
      writeFileSync(
        path.join(root, 'packages/example/src/nested/tool.ts'),
        '#!/usr/bin/env node\n',
      );
      chmodSync(path.join(root, 'packages/example/src/nested/tool.ts'), 0o755);
      runGit(root, ['init', '-q']);
      runGit(root, ['config', 'user.email', 'evidence@example.test']);
      runGit(root, ['config', 'user.name', 'Evidence Test']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-qm', 'producer tree']);
      const subjectSha = runGit(root, ['rev-parse', 'HEAD']).trim();
      const current = buildSourceTreeSet({
        repoRoot: root,
        roots: ['packages/example/src'],
      });
      expect(
        buildSourceTreeSetAtCodeSubject({
          repoRoot: root,
          roots: ['packages/example/src'],
          subjectSha,
        }),
      ).toEqual(current);
      expect(current.roots).toEqual([
        expect.objectContaining({ fileCount: 2, root: 'packages/example/src' }),
      ]);
      expect(() =>
        assertHistoricalSourceTreesMatch({
          repoRoot: root,
          roots: ['packages/example/src'],
          subjectSha,
        }),
      ).not.toThrow();

      writeFileSync(path.join(root, 'packages/example/src/new-producer.ts'), 'export {};\n');
      expect(() => buildSourceTreeSet({ repoRoot: root, roots: ['packages/example/src'] })).toThrow(
        'must be clean and fully tracked',
      );
      expect(() =>
        assertHistoricalSourceTreesMatch({
          repoRoot: root,
          roots: ['packages/example/src'],
          subjectSha,
        }),
      ).toThrow('must be clean and fully tracked');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('reads only canonical retained regular files, never symlink blobs', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-security-evidence-file-'));
    try {
      mkdirSync(path.join(root, 'evidence'), { recursive: true });
      writeFileSync(path.join(root, 'evidence/source.ts'), 'export const value = 1;\n');
      symlinkSync('source.ts', path.join(root, 'evidence/link.ts'));
      runGit(root, ['init', '-q']);
      runGit(root, ['config', 'user.email', 'evidence@example.test']);
      runGit(root, ['config', 'user.name', 'Evidence Test']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-qm', 'retained files']);
      const subjectSha = runGit(root, ['rev-parse', 'HEAD']).trim();

      expect(
        readFileAtCodeSubject({
          relativePath: 'evidence/source.ts',
          repoRoot: root,
          subjectSha,
        }).toString('utf8'),
      ).toBe('export const value = 1;\n');
      expect(() =>
        readFileAtCodeSubject({
          relativePath: 'evidence/link.ts',
          repoRoot: root,
          subjectSha,
        }),
      ).toThrow('not one regular file');
      for (const relativePath of [
        './evidence/source.ts',
        'evidence//source.ts',
        'evidence/../source.ts',
        'evidence\\source.ts',
        'evidence/\u202esource.ts',
      ]) {
        expect(() => readFileAtCodeSubject({ relativePath, repoRoot: root, subjectSha })).toThrow(
          'unique safe relative paths',
        );
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stderr}${result.stdout}`);
  return result.stdout;
}
