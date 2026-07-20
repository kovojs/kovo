import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildDecidedSurfaceArtifact,
  defaultDecidedSurfacePath,
  validateDecidedSurfaceArtifact,
} from './decided-surface-gate.mjs';
import { repoRoot } from './lib/repo-root.mjs';

describe('aggregate decided-surface gate', () => {
  it('binds all three declared finite fragments to exact numerators and denominators', () => {
    const document = JSON.parse(readFileSync(`${repoRoot()}/${defaultDecidedSurfacePath}`, 'utf8'));
    expect(validateDecidedSurfaceArtifact(document)).toMatchObject({
      findings: [],
      ok: true,
      summary: { decided: 2877, percent: 100, total: 2877 },
    });
    expect(document.fragments).toMatchObject([
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

  it('fails closed on a changed numerator, denominator, source digest, or subject protocol', () => {
    const original = buildDecidedSurfaceArtifact({
      codeSubjectSha: '0123456789abcdef0123456789abcdef01234567',
    });
    for (const mutate of [
      (document) => (document.fragments[0].decided -= 1),
      (document) => (document.fragments[1].total += 1),
      (document) => (document.subject.sources.sha256 = '0'.repeat(64)),
      (document) => (document.subject.evidenceCommit = 'embed HEAD after commit'),
    ]) {
      const mutant = structuredClone(original);
      mutate(mutant);
      expect(validateDecidedSurfaceArtifact(mutant).ok).toBe(false);
    }
  });

  it('rejects a non-exact code-subject identifier', () => {
    expect(() => buildDecidedSurfaceArtifact({ codeSubjectSha: 'HEAD' })).toThrow(
      'full lowercase Git commit SHA',
    );
  });
});
