import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const compilerSrcDir = dirname(fileURLToPath(import.meta.url));
const compilerPackageDir = dirname(compilerSrcDir);

describe('compatibility path boundaries', () => {
  it('keeps capture-check helpers off the public compiler export surface', () => {
    const packageJson = JSON.parse(
      readFileSync(join(compilerPackageDir, 'package.json'), 'utf8'),
    ) as {
      exports: Record<string, string>;
    };
    const publicIndexSource = readFileSync(join(compilerSrcDir, 'index.ts'), 'utf8');

    expect(Object.keys(packageJson.exports).sort()).toEqual(['.', './graph', './package-styles']);
    expect(publicIndexSource).not.toContain('capturesUnserializableReferences');
    expect(publicIndexSource).not.toMatch(/lower\/handlers/);
  });

  it('keeps KV201 and KV230 coverage on explicit compile fixtures, not helper modes', () => {
    const compatibilitySource = readFileSync(
      join(compilerSrcDir, 'conformance-compat.test.ts'),
      'utf8',
    );
    const handlerFixtureSource = readFileSync(join(compilerSrcDir, 'handler-lowering.test.ts'), 'utf8');
    const fragmentFixtureSource = readFileSync(join(compilerSrcDir, 'fragment-targets.test.ts'), 'utf8');

    expect(compatibilitySource).toContain('source: \'<button onClick={() => window.alert("x")}>x</button>\'');
    expect(compatibilitySource).toContain('const snapshot = readSnapshot();');
    expect(compatibilitySource).not.toContain('capturesUnserializableReferences(');
    expect(handlerFixtureSource).toContain('source: \'<button onClick={() => window.alert("x")}>x</button>\'');
    expect(fragmentFixtureSource).toContain('<span>{snapshot.total}</span>');

    const forbiddenModeNames = /\b(?:allowWeakCaptures|helperMode|compatMode|weakHelper)\b/;
    expect(compatibilitySource).not.toMatch(forbiddenModeNames);
    expect(handlerFixtureSource).not.toMatch(forbiddenModeNames);
    expect(fragmentFixtureSource).not.toMatch(forbiddenModeNames);
  });
});
