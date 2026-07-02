import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkClassifierVerdictRouting } from './check-classifier-verdict-routing.mjs';

function runFixture(files, options = {}) {
  return checkClassifierVerdictRouting({
    files: Object.keys(files),
    readText: (relativePath) => files[relativePath] ?? '',
    repoRoot: '/fixture',
    ...options,
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
    expect(result.ok).toBe(false);
  });

  it('keeps verdict routing findings advisory under paranoid mode', () => {
    const result = runFixture(
      {
        'packages/server/src/verdict.ts': `
export function enforce(verdict) {
  if (verdict.kind === 'proven-unsafe') {
    throw new Error('closed');
  }
}
`,
      },
      { paranoidMode: true },
    );

    expect(result).toMatchObject({
      advisory: true,
      ok: true,
      paranoidMode: true,
    });
    expect(result.summary).toContain('advisory under KOVO_PARANOID=1');
    expect(result.summary).toContain('runtime chokes remain the proof boundary');
    expect(result.findings).toEqual([
      expect.stringContaining('closes proven-unsafe without an unproven companion branch'),
    ]);
  });

  it('scans package roots derived from security-marker imports by default', async () => {
    const repoRoot = await fixtureRoot();
    await writeFixture(
      repoRoot,
      'packages/compiler/src/validate/marker.ts',
      "import { securityClassifier } from '@kovojs/core/internal/security-markers';\n",
    );
    await writeFixture(
      repoRoot,
      'packages/compiler/src/validate/verdict.ts',
      `
export function enforce(verdict) {
  if (verdict.kind === 'proven-unsafe') {
    throw new Error('closed');
  }
}
`,
    );
    await writeFixture(
      repoRoot,
      'packages/browser/src/verdict.ts',
      `
export function unscanned(verdict) {
  if (verdict.kind === 'proven-unsafe') {
    throw new Error('closed');
  }
}
`,
    );

    const result = checkClassifierVerdictRouting({ repoRoot });

    expect(result.findings).toEqual([
      expect.stringContaining('closes proven-unsafe without an unproven companion branch'),
    ]);
    expect(result.findings[0]).toContain('packages/compiler/src/validate/verdict.ts');
    expect(result.summary).toContain('1 classifier verdict routing violation(s)');
  });
});

async function fixtureRoot() {
  return mkdir(path.join(tmpdir(), `kovo-verdict-routing-${process.pid}-${Date.now()}`), {
    recursive: true,
  });
}

async function writeFixture(rootDir, relativePath, source) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source);
}
