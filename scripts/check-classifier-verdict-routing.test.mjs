import { describe, expect, it } from 'vitest';

import { checkClassifierVerdictRouting } from './check-classifier-verdict-routing.mjs';

function runFixture(files) {
  return checkClassifierVerdictRouting({
    files: Object.keys(files),
    readText: (relativePath) => files[relativePath] ?? '',
    repoRoot: '/fixture',
  });
}

describe('classifier verdict routing gate', () => {
  it('accepts branches that close proven-unsafe and unproven together', () => {
    const result = runFixture({
      'packages/server/src/verdict.ts': `
export function enforce(verdict) {
  if (verdict.kind === 'proven-unsafe' || verdict.kind === 'unproven') {
    throw new Error('closed');
  }
}

export function enforceElse(verdict) {
  if (verdict.kind === 'proven-unsafe') throw new Error('closed');
  else if (verdict.kind === 'unproven') throw new Error('closed');
}
`,
    });

    expect(result.findings).toEqual([]);
  });

  it('rejects proven-unsafe-only branches that drop unproven', () => {
    const result = runFixture({
      'packages/server/src/verdict.ts': `
export function enforce(verdict) {
  if (verdict.kind === 'proven-unsafe') {
    throw new Error('closed');
  }
}
`,
    });

    expect(result.findings).toEqual([
      expect.stringContaining('closes proven-unsafe without an unproven companion branch'),
    ]);
  });
});
