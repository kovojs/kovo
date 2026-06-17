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

/** Independent export list for @kovojs/core straight from the type checker, so
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
  // Mirror the generator: @internal exports are framework internals, excluded from
  // the public reference, so they are not expected on the page either.
  const isInternal = (symbol) => {
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return (resolved.declarations ?? []).some((decl) => {
      let node = decl;
      if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
        node = node.parent.parent;
      }
      return ts.getJSDocTags(node).some((tag) => tag.tagName.getText() === 'internal');
    });
  };
  return checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => !isInternal(symbol))
    .map((symbol) => symbol.name);
}

describe('api-ref generator', () => {
  let outDir;
  let result;
  let corePage;

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'kovo-api-ref-'));
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
      'style.md',
      'better-auth.md',
      'compiler.md',
      'cli.md',
    ]);
    for (const pkg of result.packages) expect(pkg.exports).toBeGreaterThan(0);
  });

  it('includes every public export of @kovojs/core in the core page', () => {
    const names = coreExportNames();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(corePage, `missing export "${name}"`).toContain(`### \`${name}\``);
    }
    const core = result.packages.find((pkg) => pkg.name === '@kovojs/core');
    expect(new Set(core.names)).toEqual(new Set(names));
  });

  it('flags undocumented exports with an explicit marker, never omits them', () => {
    const core = result.packages.find((pkg) => pkg.name === '@kovojs/core');
    const headings = corePage.match(/^### `/gm) ?? [];
    const markers = corePage.match(/^\*Undocumented\.\*$/gm) ?? [];
    expect(headings.length).toBe(core.exports);
    expect(markers.length).toBe(core.exports - core.documented);
  });

  it('uses the site frontmatter convention', () => {
    expect(corePage.startsWith('---\ntitle: "@kovojs/core"\n')).toBe(true);
    expect(corePage).toMatch(/^description: .+$/m);
    expect(corePage).toMatch(/^order: 1$/m);
  });

  it('emits deterministic, repo-relative output', async () => {
    expect(corePage).not.toContain(repoRoot);
    const again = await mkdtemp(path.join(tmpdir(), 'kovo-api-ref-'));
    try {
      await generateApiReference({ outDir: again });
      expect(await readFile(path.join(again, 'core.md'), 'utf8')).toBe(corePage);
    } finally {
      await rm(again, { force: true, recursive: true });
    }
  }, 60_000);

  it('renders @param/@returns as a markdown table with a Type column', () => {
    // The `component` export is documented with a param + a returns row.
    const section = corePage.slice(corePage.indexOf('### `component`'));
    expect(section).toContain('| Parameter | Type | Description |');
    expect(section).toContain('| --- | --- | --- |');
    expect(section).toMatch(/^\| `definition` \|.*\|.+\|$/m);
    expect(section).toMatch(/^\| \*\(returns\)\* \|.*\|.+\|$/m);
  });

  it('renders parameter types from the real signature and links documented types', () => {
    const section = corePage.slice(
      corePage.indexOf('### `component`'),
      corePage.indexOf('### `route`'),
    );
    // The return type is the documented `Component` type, linked to its anchor;
    // the type-parameter `Definition` stays plain text. Type cells are inline
    // `<code>` HTML so generics survive the GFM table.
    expect(section).toMatch(/\| \*\(returns\)\* \| <code><a href="#component">Component<\/a>/);
    // Generics are HTML-escaped so `<` / `>` cannot be parsed as tags.
    expect(section).toContain('&lt;Definition&gt;');
  });

  it('emits a per-package sidebar manifest with categories, anchors, and source links', async () => {
    const manifest = JSON.parse(await readFile(path.join(outDir, 'core.sidebar.json'), 'utf8'));
    expect(manifest.package).toBe('@kovojs/core');
    expect(manifest.slug).toBe('core');
    expect(manifest.sourceHref).toMatch(/^https:\/\/github\.com\/kovojs\/kovo\/blob\/main\/.+/);
    expect(manifest.sourceHref).not.toContain(repoRoot);

    const functions = manifest.categories.find((category) => category.title === 'Functions');
    expect(functions.anchor).toBe('functions');
    const component = functions.symbols.find((symbol) => symbol.name === 'component');
    // The anchor matches the page heading id (slugify), so deep links resolve.
    expect(component.anchor).toBe('component');
    expect(component.kind).toBe('function');
    expect(component.sourceHref).toMatch(/\/packages\/core\/.+#L\d+$/);

    // Every symbol on the page is represented in the manifest (no silent drops).
    const manifestNames = manifest.categories.flatMap((category) =>
      category.symbols.map((symbol) => symbol.name),
    );
    const core = result.packages.find((pkg) => pkg.name === '@kovojs/core');
    expect(new Set(manifestNames)).toEqual(new Set(core.names));
  });

  it('renders @example blocks as fenced ts sections after an Example marker', () => {
    const section = corePage.slice(
      corePage.indexOf('### `component`'),
      corePage.indexOf('### `route`'),
    );
    expect(section).toContain('**Example**');
    // The example is its own fenced block and imports the real export.
    const exampleStart = section.indexOf('**Example**');
    expect(section.slice(exampleStart)).toContain("import { component } from '@kovojs/core';");
    // Each documented export still has exactly one signature fence.
    expect(section.match(/```ts/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('documents the app-facing export tier across packages', () => {
    // Coverage must be meaningful, not the historical "0 documented".
    const expected = {
      '@kovojs/core': 40,
      '@kovojs/drizzle': 4,
      '@kovojs/runtime': 15,
      '@kovojs/server': 70,
      '@kovojs/style': 20,
      '@kovojs/test': 12,
      '@kovojs/better-auth': 30,
      '@kovojs/compiler': 12,
      kovo: 8,
    };
    for (const pkg of result.packages) {
      expect(pkg.documented, `${pkg.name} documented`).toBeGreaterThanOrEqual(expected[pkg.name]);
    }
  });
});
