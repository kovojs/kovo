import { describe, expect, it } from 'vitest';

import { checkFailClosedClassifiers } from './check-fail-closed-classifiers.mjs';

function runFixture(files, options = {}) {
  return checkFailClosedClassifiers({
    files: Object.keys(files),
    readText: (relativePath) => files[relativePath] ?? '',
    repoRoot: '/fixture',
    ...options,
  });
}

describe('fail-closed classifier gate', () => {
  it('accepts closed defaults with explicit positive allow branches', () => {
    const result = runFixture({
      'packages/server/src/classifier.ts': `
import { securityClassifier } from '@kovojs/core/internal/security-markers';

export const classify = securityClassifier('test.closed', function (value: { kind: string }) {
  switch (value.kind) {
    case 'known-safe':
      return true;
    default:
      return 'fail-closed';
  }
});
`,
    });

    expect(result.findings).toEqual([]);
  });

  it('rejects permissive switch defaults, terminal fallbacks, and short-circuit fallbacks', () => {
    const result = runFixture({
      'packages/server/src/classifier.ts': `
import { securityClassifier } from '@kovojs/core/internal/security-markers';

export const switchDefault = securityClassifier('test.switch', function (value: { kind: string }) {
  switch (value.kind) {
    case 'known':
      return ['known'];
    default:
      return [];
  }
});

export const terminal = securityClassifier('test.terminal', function (value: { ok: boolean }) {
  if (value.ok) return ['known'];
  return [];
});

export const shortCircuit = securityClassifier('test.short-circuit', function (value: string[] | undefined) {
  return value ?? [];
});

export const expressionBody = securityClassifier('test.expression-body', (value: string[] | undefined) => value || []);
`,
    });

    expect(result.findings).toEqual([
      expect.stringContaining(
        'switchDefault (test.switch) returns permissive `[]` from switch default',
      ),
      expect.stringContaining(
        'terminal (test.terminal) returns permissive `[]` from terminal fallback',
      ),
      expect.stringContaining('shortCircuit (test.short-circuit) uses `??` with permissive `[]`'),
      expect.stringContaining(
        'expressionBody (test.expression-body) uses `||` with permissive `[]`',
      ),
    ]);
  });

  it('rejects the planted conformance canary', () => {
    const file = 'packages/conformance-fixtures/src/fail-closed-canary.fixture.ts';
    const result = checkFailClosedClassifiers({
      files: [file],
      repoRoot: process.cwd(),
    });

    expect(result.findings).toEqual([
      expect.stringContaining(
        `${file}:6: permissiveFailClosedCanary (conformance.fail-closed-canary) uses \`??\` with permissive \`[]\``,
      ),
    ]);
  });
});
