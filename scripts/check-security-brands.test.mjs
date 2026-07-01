import { describe, expect, it } from 'vitest';

import { checkSecurityBrands } from './check-security-brands.mjs';

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
});
