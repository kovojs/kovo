import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { documentedApiEntries, generateApiReference } from './api-ref.mjs';

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
  // Mirror the generator: @internal/@generated exports are non-public framework
  // contracts, excluded from the public reference, so they are not expected on
  // the page either.
  const isNonPublic = (symbol) => {
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return (resolved.declarations ?? []).some((decl) => {
      let node = decl;
      if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
        node = node.parent.parent;
      }
      return ts
        .getJSDocTags(node)
        .some((tag) => ['internal', 'generated'].includes(tag.tagName.getText()));
    });
  };
  return checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => !isNonPublic(symbol))
    .map((symbol) => symbol.name);
}

function packageManifest(overrides = {}) {
  return {
    apiRef: {
      description: 'A fixture package.',
      order: 1,
      slug: 'fixture',
    },
    dir: 'core',
    kind: 'library',
    name: '@kovojs/fixture',
    visibility: 'public',
    ...overrides,
  };
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

  it('emits one page per documented package, with app-facing subpaths on that page', () => {
    expect(result.packages.map((pkg) => pkg.file)).toEqual([
      'core.md',
      'server.md',
      'runtime.md',
      'test.md',
      'drizzle.md',
      'style.md',
      'better-auth.md',
      'cli.md',
    ]);
    expect(result.packages.find((pkg) => pkg.name === '@kovojs/server').subpaths).toContain(
      '@kovojs/server/app-shell/vite',
    );
    expect(result.packages.find((pkg) => pkg.name === '@kovojs/test').subpaths).toContain(
      '@kovojs/test/verifier-sql',
    );
    for (const pkg of result.packages) expect(pkg.exports).toBeGreaterThan(0);
  });

  it('normalizes manifest-declared public doc entries and rejects non-public docs pages', () => {
    expect(
      documentedApiEntries([
        packageManifest({
          apiRef: {
            description: 'A fixture package.',
            entries: ['.', { path: './build', slug: 'fixture-build' }],
            generatedEntries: ['./generated'],
            order: 1,
            slug: 'fixture',
          },
        }),
      ]).map((pkg) => [pkg.name, pkg.slug, pkg.entries.map((entry) => entry.entryPath)]),
    ).toEqual([
      ['@kovojs/fixture', 'fixture', ['.', './build']],
    ]);

    expect(() =>
      documentedApiEntries([
        packageManifest({
          apiRef: {
            description: 'A fixture package.',
            entries: ['./internal'],
            internalEntries: ['./internal'],
            order: 1,
            slug: 'fixture',
          },
        }),
      ]),
    ).toThrow(/overlaps a generated\/internal subpath/);

    expect(() =>
      documentedApiEntries([
        packageManifest({
          apiRef: {
            description: 'A fixture package.',
            entries: ['./generated'],
            order: 1,
            slug: 'fixture',
          },
        }),
      ]),
    ).toThrow(/overlaps a generated\/internal subpath/);
  });

  it('includes every public export of @kovojs/core in the core page', () => {
    const names = coreExportNames();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(corePage, `missing export "${name}"`).toContain(`#### \`${name}\``);
    }
    const core = result.packages.find((pkg) => pkg.name === '@kovojs/core');
    expect(new Set(core.names)).toEqual(new Set(names));
  });

  it('flags undocumented exports with an explicit marker, never omits them', () => {
    const core = result.packages.find((pkg) => pkg.name === '@kovojs/core');
    const headings = corePage.match(/^#### `/gm) ?? [];
    const markers = corePage.match(/^\*Undocumented\.\*$/gm) ?? [];
    expect(headings.length).toBe(core.exports);
    expect(markers.length).toBe(core.exports - core.documented);
  });

  it('does not emit non-public API tags or pages for generated/internal subpaths', async () => {
    for (const pkg of result.packages) {
      const page = await readFile(path.join(outDir, pkg.file), 'utf8');
      expect(page, `${pkg.file} leaked @internal`).not.toContain('@internal');
      expect(page, `${pkg.file} leaked @generated`).not.toContain('@generated');
      expect(
        pkg.file,
        'generated/internal subpaths must not receive public docs pages',
      ).not.toMatch(/(?:^|-)(?:generated|internal)(?:-|\.md$)/);
    }
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
    const section = corePage.slice(corePage.indexOf('#### `component`'));
    expect(section).toContain('| Parameter | Type | Description |');
    expect(section).toContain('| --- | --- | --- |');
    expect(section).toMatch(/^\| `definition` \|.*\|.+\|$/m);
    expect(section).toMatch(/^\| \*\(returns\)\* \|.*\|.+\|$/m);
  });

  it('renders parameter types from the real signature and links documented types', () => {
    const section = corePage.slice(
      corePage.indexOf('#### `component`'),
      corePage.indexOf('#### `route`'),
    );
    // The return type is the documented `Component` type, linked to its anchor;
    // the type-parameter `Definition` stays plain text. Type cells are inline
    // `<code>` HTML so generics survive the GFM table.
    expect(section).toMatch(/\| \*\(returns\)\* \| <code><a href="#component-\d+">Component<\/a>/);
    // Generics are HTML-escaped so `<` / `>` cannot be parsed as tags.
    expect(section).toContain('&lt;Definition&gt;');
  });

  it('emits a per-package sidebar manifest grouped by subpath, with anchors and source links', async () => {
    const manifest = JSON.parse(await readFile(path.join(outDir, 'core.sidebar.json'), 'utf8'));
    expect(manifest.package).toBe('@kovojs/core');
    expect(manifest.slug).toBe('core');

    expect(manifest.subpaths).toHaveLength(1);
    expect(manifest.subpaths[0].importPath).toBe('@kovojs/core');
    expect(manifest.subpaths[0].sourceHref).toMatch(
      /^https:\/\/github\.com\/kovojs\/kovo\/blob\/main\/.+/,
    );
    expect(manifest.subpaths[0].sourceHref).not.toContain(repoRoot);

    const functions = manifest.subpaths[0].categories.find(
      (category) => category.title === 'Functions',
    );
    expect(functions.anchor).toBe('kovojscore-functions');
    const component = functions.symbols.find((symbol) => symbol.name === 'component');
    // The anchor matches the page heading id (slugify), so deep links resolve.
    expect(component.anchor).toBe('component');
    expect(component.kind).toBe('function');
    expect(component.sourceHref).toMatch(/\/packages\/core\/.+#L\d+$/);

    // Every symbol on the page is represented in the manifest (no silent drops).
    const manifestNames = manifest.subpaths.flatMap((subpath) =>
      subpath.categories.flatMap((category) => category.symbols.map((symbol) => symbol.name)),
    );
    const core = result.packages.find((pkg) => pkg.name === '@kovojs/core');
    expect(new Set(manifestNames)).toEqual(new Set(core.names));

    const testManifest = JSON.parse(await readFile(path.join(outDir, 'test.sidebar.json'), 'utf8'));
    expect(testManifest.subpaths.map((subpath) => subpath.importPath)).toContain(
      '@kovojs/test/assertions',
    );
    expect(testManifest.subpaths.map((subpath) => subpath.importPath)).toContain(
      '@kovojs/test/verifier-sql',
    );
  });

  it('renders @example blocks as fenced ts sections after an Example marker', () => {
    const section = corePage.slice(
      corePage.indexOf('#### `component`'),
      corePage.indexOf('#### `route`'),
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
      '@kovojs/better-auth': 13,
      '@kovojs/compiler': 12,
      '@kovojs/cli': 8,
      '@kovojs/test': 12,
    };
    for (const pkg of result.packages) {
      expect(pkg.documented, `${pkg.name} documented`).toBeGreaterThanOrEqual(expected[pkg.name]);
    }
  });
});
