import { describe, expect, it } from 'vitest';

import {
  checkSecurityBrands,
  defaultReachabilityRoots,
  deriveRequiredSecurityDecisions,
  rawSecurityPrimitiveRoots,
  requiredSecurityDecisions,
  validateReachabilityRoots,
} from './check-security-brands.mjs';

function runFixture(files, decisions) {
  return checkSecurityBrands({
    decisions,
    exists: (relativePath) => Object.hasOwn(files, relativePath),
    readText: (relativePath) => files[relativePath] ?? '',
    repoRoot: '/fixture',
  });
}

describe('security decision brand gate', () => {
  it('accepts classifier and wire-emitter wrappers', () => {
    const result = runFixture(
      {
        'packages/server/src/canary.ts': `
import { securityClassifier, wireEmitter } from '@kovojs/core/internal/security-markers';
export const classifyCanary = securityClassifier('canary.classify', function (value) { return Boolean(value); });
export const emitCanary = wireEmitter('canary.emit', function (value) { return String(value); });
`,
      },
      [
        {
          file: 'packages/server/src/canary.ts',
          kind: 'classifier',
          names: ['classifyCanary'],
        },
        {
          file: 'packages/server/src/canary.ts',
          kind: 'wire-emitter',
          names: ['emitCanary'],
        },
      ],
    );

    expect(result.findings).toEqual([]);
  });

  it('rejects the unbranded security-decision canary', () => {
    const result = runFixture(
      {
        'packages/server/src/canary.ts': `
export function classifyCanary(value) {
  return Boolean(value);
}
`,
      },
      [
        {
          file: 'packages/server/src/canary.ts',
          kind: 'classifier',
          names: ['classifyCanary'],
        },
      ],
    );

    expect(result.findings).toContain(
      'packages/server/src/canary.ts:2: classifyCanary is an unbranded security-decision function; wrap it with securityClassifier()',
    );
  });

  it('rejects the wrong security-decision brand family', () => {
    const result = runFixture(
      {
        'packages/server/src/canary.ts': `
import { wireEmitter } from '@kovojs/core/internal/security-markers';
export const classifyCanary = wireEmitter('canary.classify', function (value) { return Boolean(value); });
`,
      },
      [
        {
          file: 'packages/server/src/canary.ts',
          kind: 'classifier',
          names: ['classifyCanary'],
        },
      ],
    );

    expect(result.findings).toContain(
      'packages/server/src/canary.ts:3: classifyCanary uses wireEmitter() but expected securityClassifier()',
    );
  });

  it('derives the brand denominator from reachable security-decision callees', () => {
    const files = {
      'packages/server/src/canary.ts': `
import { securityClassifier } from '@kovojs/core/internal/security-markers';
export const enforceManagedSql = securityClassifier('canary.root', function (value) {
  return reachableUnbrandedCanary(value);
});
export function reachableUnbrandedCanary(value) {
  return Boolean(value);
}
`,
    };
    const result = checkSecurityBrands({
      exists: (relativePath) => Object.hasOwn(files, relativePath),
      readText: (relativePath) => files[relativePath] ?? '',
      repoRoot: '/fixture',
      reachabilityFiles: ['packages/server/src/canary.ts'],
      reachabilityRoots: [
        { file: 'packages/server/src/canary.ts', kind: 'classifier', name: 'enforceManagedSql' },
      ],
      requireUnbrandedReachable: true,
    });

    expect(result.findings).toContain(
      'packages/server/src/canary.ts:6: reachableUnbrandedCanary is an unbranded security-decision function; wrap it with securityClassifier()',
    );
  });

  it('uses raw primitive roots instead of the declared security-decision list by default', () => {
    const declaredRoots = requiredSecurityDecisions.flatMap((decision) =>
      decision.names.map((name) => ({ file: decision.file, kind: decision.kind, name })),
    );

    expect(defaultReachabilityRoots).toBe(rawSecurityPrimitiveRoots);
    expect(rawSecurityPrimitiveRoots).not.toEqual(declaredRoots);
    expect(rawSecurityPrimitiveRoots.map((root) => `${root.file}#${root.name}`)).toContain(
      'packages/server/src/response-posture.ts#emitToWire',
    );
  });

  it('fails when an encoded raw primitive root drifts out of the graph', () => {
    const files = {
      'packages/server/src/response-posture.ts': `
export function renamedEmitToWire(value) {
  return value;
}
`,
    };

    expect(
      validateReachabilityRoots({
        exists: (relativePath) => Object.hasOwn(files, relativePath),
        files: ['packages/server/src/response-posture.ts'],
        readText: (relativePath) => files[relativePath] ?? '',
        roots: [
          {
            direction: 'callers',
            file: 'packages/server/src/response-posture.ts',
            kind: 'wire-emitter',
            name: 'emitToWire',
          },
        ],
      }),
    ).toContain(
      'packages/server/src/response-posture.ts: raw security primitive root emitToWire is missing from the reachability graph',
    );
  });

  it('follows reachable callees across relative imports', () => {
    const files = {
      'packages/server/src/root.ts': `
import { securityClassifier } from '@kovojs/core/internal/security-markers';
import { classifyImportedCanary } from './leaf.js';
export const enforceManagedSql = securityClassifier('canary.root', function (value) {
  return classifyImportedCanary(value);
});
`,
      'packages/server/src/leaf.ts': `
import { securityClassifier } from '@kovojs/core/internal/security-markers';
export const classifyImportedCanary = securityClassifier('canary.imported', function (value) {
  return Boolean(value);
});
`,
    };
    const decisions = deriveRequiredSecurityDecisions({
      exists: (relativePath) => Object.hasOwn(files, relativePath),
      files: Object.keys(files),
      readText: (relativePath) => files[relativePath] ?? '',
      roots: [
        { file: 'packages/server/src/root.ts', kind: 'classifier', name: 'enforceManagedSql' },
      ],
    });

    expect(decisions).toEqual([
      {
        file: 'packages/server/src/leaf.ts',
        kind: 'classifier',
        names: ['classifyImportedCanary'],
      },
      {
        file: 'packages/server/src/root.ts',
        kind: 'classifier',
        names: ['enforceManagedSql'],
      },
    ]);
  });
});
