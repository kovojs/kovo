import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDecidedSurfaceArtifact,
  decidedSurfaceSourcePaths,
  validateDecidedSurfaceArtifact,
} from './decided-surface-gate.mjs';
import { repoRoot } from './lib/repo-root.mjs';

const sourceRoot = repoRoot();
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-decided-surface-'));
  temporaryRoots.push(root);
  for (const relativePath of decidedSurfaceSourcePaths) {
    const destination = path.join(root, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(sourceRoot, relativePath), destination);
  }
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'decided-surface@example.test']);
  git(root, ['config', 'user.name', 'Decided Surface Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'measured inputs']);
  const subjectSha = git(root, ['rev-parse', 'HEAD']);
  return {
    artifact: buildDecidedSurfaceArtifact({ codeSubjectSha: subjectSha, repoRoot: root }),
    root,
    subjectSha,
  };
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stderr}${result.stdout}`);
  return result.stdout.trim();
}

describe('aggregate decided-surface gate', () => {
  it('binds all three declared finite fragments to a real commit and exact source inputs', () => {
    const { artifact, root } = fixture();
    expect(validateDecidedSurfaceArtifact(artifact, { repoRoot: root })).toMatchObject({
      findings: [],
      ok: true,
      summary: { decided: 2877, percent: 100, total: 2877 },
    });
    expect(artifact.fragments).toMatchObject([
      { decided: 2508, id: 'provenance-transition-pairs', total: 2508 },
      {
        decided: 363,
        denominator: {
          maximumOwnerViaDepth: 4,
          shapes: [
            { checkedModels: 3, depth: 0, expectedModels: 3 },
            { checkedModels: 9, depth: 1, expectedModels: 9 },
            { checkedModels: 27, depth: 2, expectedModels: 27 },
            { checkedModels: 81, depth: 3, expectedModels: 81 },
            { checkedModels: 243, depth: 4, expectedModels: 243 },
          ],
        },
        id: 'postgres-owner-policy-models',
        total: 363,
      },
      { decided: 6, id: 'grammar-decision-obligations', total: 6 },
    ]);
  });

  it('fails closed on numerator, denominator, source, protocol, or subject drift', () => {
    const { artifact, root } = fixture();
    for (const mutate of [
      (document) => (document.fragments[0].decided -= 1),
      (document) => (document.fragments[1].total += 1),
      (document) => (document.subject.sources.sha256 = '0'.repeat(64)),
      (document) => (document.subject.evidenceCommit = 'embed HEAD after commit'),
      (document) => (document.subject.codeSubjectSha = '0'.repeat(40)),
    ]) {
      const mutant = structuredClone(artifact);
      mutate(mutant);
      expect(validateDecidedSurfaceArtifact(mutant, { repoRoot: root }).ok).toBe(false);
    }

    writeFileSync(path.join(root, decidedSurfaceSourcePaths[0]), '// drifted after measurement\n');
    expect(validateDecidedSurfaceArtifact(artifact, { repoRoot: root }).ok).toBe(false);
  });

  it('rejects a non-exact code-subject identifier', () => {
    expect(() => buildDecidedSurfaceArtifact({ codeSubjectSha: 'HEAD' })).toThrow(
      'full lowercase Git commit SHA',
    );
  });
});
