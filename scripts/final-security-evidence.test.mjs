import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseFinalSecurityEvidenceArguments,
  writeFinalSecurityEvidence,
  writeFinalSecurityEvidenceFiles,
} from './final-security-evidence.mjs';
import { assertCleanCurrentCodeSubject } from './lib/security-evidence-subject.mjs';

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function cleanRepository() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-final-evidence-'));
  temporaryRoots.push(root);
  writeFileSync(path.join(root, 'seed.txt'), 'committed\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'final-evidence@example.test']);
  git(root, ['config', 'user.name', 'Final Evidence Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'clean code subject']);
  return { root, subjectSha: git(root, ['rev-parse', 'HEAD']) };
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stderr}${result.stdout}`);
  return result.stdout.trim();
}

function fixtureOperations(codeSubjectSha, overrides = {}) {
  return {
    buildDecidedSurfaceArtifact: () => ({ subject: { codeSubjectSha } }),
    collectSecurityConvergenceSnapshot: () => ({ metric: 'live' }),
    readBaseline: () => ({ schema: 'fixture' }),
    updateSecurityConvergenceRecord: () => ({
      currentSnapshot: { measuredCodeSha: codeSubjectSha },
    }),
    validateDecidedSurfaceArtifact: () => ({ findings: [], ok: true }),
    validateSecurityConvergenceRecord: () => ({ findings: [], ok: true }),
    ...overrides,
  };
}

describe('final security evidence orchestrator', () => {
  it('asserts one clean subject and writes both validated artifacts with that subject', () => {
    const { root, subjectSha } = cleanRepository();
    const assertClean = vi.fn(assertCleanCurrentCodeSubject);
    const result = writeFinalSecurityEvidence({
      codeSubjectSha: subjectSha,
      operations: fixtureOperations(subjectSha, {
        assertCleanCurrentCodeSubject: assertClean,
      }),
      reason: 'final v1 candidate',
      repoRoot: root,
    });

    expect(assertClean).toHaveBeenCalledTimes(1);
    expect(result.codeSubjectSha).toBe(subjectSha);
    expect(
      JSON.parse(
        readFileSync(path.join(root, 'security/security-convergence-baseline.json'), 'utf8'),
      ).currentSnapshot.measuredCodeSha,
    ).toBe(subjectSha);
    expect(
      JSON.parse(readFileSync(path.join(root, 'security/decided-surface.json'), 'utf8')).subject
        .codeSubjectSha,
    ).toBe(subjectSha);
  });

  it('does not write either artifact when pre-write construction or validation fails', () => {
    const { root, subjectSha } = cleanRepository();
    expect(() =>
      writeFinalSecurityEvidence({
        codeSubjectSha: subjectSha,
        operations: fixtureOperations(subjectSha, {
          validateDecidedSurfaceArtifact: () => {
            throw new Error('late validation failed');
          },
        }),
        reason: 'final v1 candidate',
        repoRoot: root,
      }),
    ).toThrow('late validation failed');
    expect(existsSync(path.join(root, 'security/security-convergence-baseline.json'))).toBe(false);
    expect(existsSync(path.join(root, 'security/decided-surface.json'))).toBe(false);
  });

  it('rejects mismatched subjects before writing', () => {
    const { root, subjectSha } = cleanRepository();
    expect(() =>
      writeFinalSecurityEvidence({
        codeSubjectSha: subjectSha,
        operations: fixtureOperations(subjectSha, {
          buildDecidedSurfaceArtifact: () => ({
            subject: { codeSubjectSha: '0'.repeat(40) },
          }),
        }),
        reason: 'final v1 candidate',
        repoRoot: root,
      }),
    ).toThrow('must name the same requested code subject');
    expect(existsSync(path.join(root, 'security/security-convergence-baseline.json'))).toBe(false);
    expect(existsSync(path.join(root, 'security/decided-surface.json'))).toBe(false);
  });

  it('rolls back the complete file set when a later write fails', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-final-evidence-write-'));
    temporaryRoots.push(root);
    const first = path.join(root, 'first.json');
    const second = path.join(root, 'second.json');
    writeFileSync(first, 'old first\n');
    writeFileSync(second, 'old second\n');
    let writes = 0;

    expect(() =>
      writeFinalSecurityEvidenceFiles(
        [
          { contents: 'new first\n', path: first },
          { contents: 'new second\n', path: second },
        ],
        {
          writeFileSync(filePath, value, encoding) {
            writes += 1;
            if (writes === 2) throw new Error('second write failed');
            writeFileSync(filePath, value, encoding);
          },
        },
      ),
    ).toThrow('second write failed');
    expect(readFileSync(first, 'utf8')).toBe('old first\n');
    expect(readFileSync(second, 'utf8')).toBe('old second\n');
  });

  it('requires one explicit writer invocation and both subject arguments', () => {
    expect(
      parseFinalSecurityEvidenceArguments([
        '--write',
        '--subject-sha',
        '0123456789abcdef0123456789abcdef01234567',
        '--reason',
        'final v1 candidate',
      ]),
    ).toEqual({
      reason: 'final v1 candidate',
      'subject-sha': '0123456789abcdef0123456789abcdef01234567',
      write: true,
    });
    expect(() => parseFinalSecurityEvidenceArguments(['--write'])).toThrow(
      'argument --subject-sha is required exactly once',
    );
  });
});
