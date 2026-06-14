import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateApiReference } from './api-ref.mjs';

/**
 * W6 exit criteria: the API reference is generated from the real package
 * sources, every public export appears, and undocumented exports are flagged
 * with an explicit marker — never silently omitted.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Independent export list for @jiso/core straight from the type checker, so
 * the test does not trust the generator's own collection logic. */
function coreExportNames() {
  const entry = path.join(repoRoot, 'packages/core/src/index.ts');
  const config = ts.readConfigFile(path.join(repoRoot, 'tsconfig.json'), (file) =>
    ts.sys.readFile(file),
  );
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot);
  const program = ts.createProgram([entry], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entry);
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  return checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.name);
}

describe('api-ref generator', () => {
  let outDir;
  let result;
  let corePage;

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'jiso-api-ref-'));
    result = await generateApiReference({ outDir });
    corePage = await readFile(path.join(outDir, 'core.md'), 'utf8');
  }, 60_000);

  afterAll(async () => {
    await rm(outDir, { force: true, recursive: true });
  });

  it('emits one page per app-facing package', () => {
    expect(result.packages.map((pkg) => pkg.file)).toEqual([
      'core.md',
      'server.md',
      'runtime.md',
      'test.md',
      'drizzle.md',
    ]);
    for (const pkg of result.packages) expect(pkg.exports).toBeGreaterThan(0);
  });

  it('includes every public export of @jiso/core in the core page', () => {
    const names = coreExportNames();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(corePage, `missing export "${name}"`).toContain(`### \`${name}\``);
    }
    const core = result.packages.find((pkg) => pkg.name === '@jiso/core');
    expect(new Set(core.names)).toEqual(new Set(names));
  });

  it('flags undocumented exports with an explicit marker, never omits them', () => {
    const core = result.packages.find((pkg) => pkg.name === '@jiso/core');
    const headings = corePage.match(/^### `/gm) ?? [];
    const markers = corePage.match(/^\*Undocumented\.\*$/gm) ?? [];
    expect(headings.length).toBe(core.exports);
    expect(markers.length).toBe(core.exports - core.documented);
  });

  it('uses the site frontmatter convention', () => {
    expect(corePage.startsWith('---\ntitle: "@jiso/core"\n')).toBe(true);
    expect(corePage).toMatch(/^description: .+$/m);
    expect(corePage).toMatch(/^order: 1$/m);
  });

  it('emits deterministic, repo-relative output', async () => {
    expect(corePage).not.toContain(repoRoot);
    const again = await mkdtemp(path.join(tmpdir(), 'jiso-api-ref-'));
    try {
      await generateApiReference({ outDir: again });
      expect(await readFile(path.join(again, 'core.md'), 'utf8')).toBe(corePage);
    } finally {
      await rm(again, { force: true, recursive: true });
    }
  }, 60_000);

  it('renders @param/@returns as a markdown table for documented exports', () => {
    // The `component` export is documented with params + a returns row.
    const section = corePage.slice(corePage.indexOf('### `component`'));
    expect(section).toContain('| Parameter | Description |');
    expect(section).toContain('| --- | --- |');
    expect(section).toMatch(/^\| `name` \| .+\|$/m);
    expect(section).toMatch(/^\| \*\(returns\)\* \| .+\|$/m);
  });

  it('renders @example blocks as fenced ts sections after an Example marker', () => {
    const section = corePage.slice(
      corePage.indexOf('### `component`'),
      corePage.indexOf('### `route`'),
    );
    expect(section).toContain('**Example**');
    // The example is its own fenced block and imports the real export.
    const exampleStart = section.indexOf('**Example**');
    expect(section.slice(exampleStart)).toContain("import { component } from '@jiso/core';");
    // Each documented export still has exactly one signature fence.
    expect(section.match(/```ts/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('documents the app-facing export tier across packages', () => {
    // Coverage must be meaningful, not the historical "0 documented".
    const expected = {
      '@jiso/core': 40,
      '@jiso/drizzle': 4,
      '@jiso/runtime': 15,
      '@jiso/server': 70,
      '@jiso/test': 12,
    };
    for (const pkg of result.packages) {
      expect(pkg.documented, `${pkg.name} documented`).toBeGreaterThanOrEqual(expected[pkg.name]);
    }
  });
});
