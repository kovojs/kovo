import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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

/** Manifest-derived public import subpaths for a documented package, so subpath
 * expectations track `public-packages.json` (the api-surface source of truth)
 * instead of re-hardcoding lists that drift when the surface is narrowed. */
function manifestSubpaths(packageName) {
  const pkg = documentedApiEntries().find((entry) => entry.name === packageName);
  if (!pkg) throw new Error(`no documented entry for ${packageName}`);
  return pkg.entries.map((entry) =>
    entry.entryPath === '.'
      ? packageName
      : `${packageName}/${entry.entryPath.replace(/^\.\//, '')}`,
  );
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
  let browserPage;
  let corePage;
  let drizzlePage;
  let headlessUiPage;
  let uiPage;
  let verifyPage;

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'kovo-api-ref-'));
    result = await generateApiReference({ outDir });
    browserPage = await readFile(path.join(outDir, 'browser.md'), 'utf8');
    corePage = await readFile(path.join(outDir, 'core.md'), 'utf8');
    drizzlePage = await readFile(path.join(outDir, 'drizzle.md'), 'utf8');
    headlessUiPage = await readFile(path.join(outDir, 'headless-ui.md'), 'utf8');
    uiPage = await readFile(path.join(outDir, 'ui.md'), 'utf8');
    verifyPage = await readFile(path.join(outDir, 'verify.md'), 'utf8');
  }, 60_000);

  afterAll(async () => {
    await rm(outDir, { force: true, recursive: true });
  });

  it('emits one page per documented package, with app-facing subpaths on that page', () => {
    expect(result.packages.map((pkg) => pkg.file)).toEqual([
      'core.md',
      'icons.md',
      'server.md',
      'browser.md',
      'test.md',
      'drizzle.md',
      'headless-ui.md',
      'style.md',
      'better-auth.md',
      'ui.md',
      'cli.md',
      'verify.md',
    ]);
    expect(result.packages.find((pkg) => pkg.name === '@kovojs/server').subpaths).toContain(
      '@kovojs/server/build',
    );
    // @kovojs/test renders exactly its manifest-declared public subpaths (the
    // old verifier/page/sql-observer subpaths were internalized in the public-API
    // cleanup, so they must not appear here).
    expect(new Set(result.packages.find((pkg) => pkg.name === '@kovojs/test').subpaths)).toEqual(
      new Set(manifestSubpaths('@kovojs/test')),
    );
    for (const pkg of result.packages) expect(pkg.exports).toBeGreaterThan(0);
  });

  it('normalizes manifest-declared public doc entries and rejects non-public docs pages', () => {
    expect(
      documentedApiEntries([
        packageManifest({
          apiBoundary: {
            public: ['.', './build', './vite'],
          },
          apiRef: {
            description: 'A fixture package.',
            entries: ['.', { path: './build', slug: 'fixture-build' }],
            generatedEntries: ['./generated'],
            order: 1,
            slug: 'fixture',
          },
        }),
      ]).map((pkg) => [pkg.name, pkg.slug, pkg.entries.map((entry) => entry.entryPath)]),
    ).toEqual([['@kovojs/fixture', 'fixture', ['.', './build']]]);

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
    const root = core.symbolsBySubpath.find((subpath) => subpath.importPath === '@kovojs/core');
    expect(new Set(root.symbols.map((symbol) => symbol.name))).toEqual(new Set(names));
  });

  it('reports every generated symbol by public import path', () => {
    for (const pkg of result.packages) {
      expect(pkg.symbolsBySubpath.map((subpath) => subpath.importPath)).toEqual(pkg.subpaths);
      expect(pkg.symbolsBySubpath.flatMap((subpath) => subpath.symbols)).toHaveLength(pkg.exports);
      for (const subpath of pkg.symbolsBySubpath) {
        expect(subpath.symbols.every((symbol) => symbol.name && symbol.kind)).toBe(true);
      }
    }
  });

  it('emits every full public signature as valid TypeScript', async () => {
    let signatures = 0;
    for (const pkg of result.packages) {
      const page = await readFile(path.join(outDir, pkg.file), 'utf8');
      const lines = page.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].startsWith('#### `')) continue;
        const fence = lines.indexOf('```ts', index + 1);
        const close = lines.indexOf('```', fence + 1);
        expect(fence, `${pkg.file}:${index + 1} has no signature fence`).toBeGreaterThan(index);
        expect(close, `${pkg.file}:${index + 1} has no signature close`).toBeGreaterThan(fence);
        const signature = lines.slice(fence + 1, close).join('\n');
        const diagnostics = [ts.ScriptKind.TS, ts.ScriptKind.TSX].map(
          (kind) =>
            ts.createSourceFile(
              `${pkg.file}-${index + 1}.${kind === ts.ScriptKind.TSX ? 'tsx' : 'ts'}`,
              signature,
              ts.ScriptTarget.Latest,
              true,
              kind,
            ).parseDiagnostics,
        );
        expect(
          diagnostics.some((attempt) => attempt.length === 0)
            ? []
            : diagnostics[0].map((diagnostic) =>
                ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
              ),
          `${pkg.file}:${index + 1} emitted malformed signature`,
        ).toEqual([]);
        signatures += 1;
      }
    }
    expect(signatures).toBe(result.exports);
  });

  it('keeps the complete 11-declaration verifier family together and documented', () => {
    const verifier = result.packages.find((pkg) => pkg.name === '@kovojs/verify');
    expect(verifier).toMatchObject({
      documented: 11,
      exports: 11,
      file: 'verify.md',
      subpaths: ['@kovojs/verify'],
    });
    expect(new Set(verifier.names)).toEqual(
      new Set([
        'KOVO_CERTIFICATE_CAPABILITY_DOMAIN',
        'KovoCertificateArtifactSource',
        'KovoCertificateCapabilityKind',
        'KovoCertificateFinding',
        'KovoCertificatePolicyV1',
        'KovoCertificateRootKind',
        'KovoCertificateV1',
        'KovoCertificateVerificationResult',
        'formatCertificateVerification',
        'verifyCertificate',
        'verifyCertificateDirectory',
      ]),
    );
    expect(verifyPage.match(/^#### `/gmu)).toHaveLength(11);
    expect(verifyPage).not.toContain('*Undocumented.*');
    expect(verifyPage).toContain('**Copyable example**');
    expect(verifyPage).toContain("import { verifyCertificateDirectory } from '@kovojs/verify';");
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
      const againResult = await generateApiReference({ outDir: again });
      const names = (await readdir(outDir)).sort();
      expect((await readdir(again)).sort()).toEqual(names);
      for (const name of names) {
        expect(await readFile(path.join(again, name), 'utf8'), name).toBe(
          await readFile(path.join(outDir, name), 'utf8'),
        );
      }
      expect(againResult.manifest).toEqual(result.manifest);
    } finally {
      await rm(again, { force: true, recursive: true });
    }
  }, 60_000);

  it('seals source, package, public-manifest, and generated-file digests', () => {
    expect(result.manifest).toMatchObject({
      schema: 'kovo-api-reference-manifest/v1',
      digests: {
        outputs: expect.stringMatching(/^[a-f0-9]{64}$/),
        packages: expect.stringMatching(/^[a-f0-9]{64}$/),
        publicManifest: expect.stringMatching(/^[a-f0-9]{64}$/),
        sources: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      inputs: {
        publicManifest: {
          path: 'public-packages.json',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    });
    expect(result.manifest.inputs.packages).toHaveLength(result.packages.length);
    expect(result.manifest.inputs.sources.length).toBeGreaterThan(result.packages.length);
    expect(result.manifest.files.map((file) => file.path)).toContain('core.md');
    expect(result.manifest.files.map((file) => file.path)).toContain('core.sidebar.json');
  });

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
    expect(section).toContain('&lt;');
    expect(section).toContain('&gt;');
  });

  it('normalizes fenced @example blocks so later symbol headings stay headings', () => {
    expect(drizzlePage).toContain('#### `staticSql` {#staticsql}');
    expect(headlessUiPage).toContain(
      '#### `accordionTriggerAttributes` {#accordiontriggerattributes}',
    );
    expect(drizzlePage).not.toContain('```ts\n```ts');
    expect(headlessUiPage).not.toContain('```ts\n```ts');
  });

  it('renders reviewed JSDoc skips as non-visible directives outside the code fence', () => {
    expect(corePage).toContain(
      '<!-- kovo-sample: illustrative reason="The form descriptor depends on an app-local mutation declaration." -->',
    );
    expect(corePage).not.toContain(
      '```ts\n// kovo-sample: illustrative reason="The form descriptor depends on an app-local mutation declaration."',
    );
  });

  it('omits generated transition machinery and UI style tables from public docs', () => {
    expect(headlessUiPage).toContain('#### `accordionTriggerAttributes`');
    expect(headlessUiPage).not.toContain('#### `accordionTriggerClick`');
    expect(headlessUiPage).not.toContain('#### `AccordionTriggerEvent`');
    expect(uiPage).toContain('#### `Button`');
    expect(uiPage).not.toMatch(/^#### `.*Styles`/m);
  });

  it('renders concrete Select examples instead of cast placeholders', () => {
    expect(headlessUiPage).toContain('const value: SelectState = {');
    expect(headlessUiPage).not.toContain('const value: SelectState = {} as SelectState;');
    expect(uiPage).toContain('const state: SelectStateProps = {');
    expect(uiPage).not.toContain('const state: SelectStateProps = {};');
  });

  it('does not render mechanical cast-placeholder examples for public headless/ui refs', () => {
    expect(headlessUiPage).not.toMatch(/\{\} as [A-Z][A-Za-z0-9_$]*/);
    expect(headlessUiPage).not.toMatch(/\{\} as Parameters<typeof [A-Za-z0-9_$]+>\[\d+\]/);
    expect(uiPage).not.toMatch(/\{\} as [A-Z][A-Za-z0-9_$]*/);
    expect(uiPage).not.toMatch(/\{\} as Parameters<typeof [A-Za-z0-9_$]+>\[\d+\]/);
  });

  it('documents the public Drizzle authoring API without internal runtime metadata carriers', () => {
    const drizzle = result.packages.find((pkg) => pkg.name === '@kovojs/drizzle');
    expect(drizzle.documented).toBe(drizzle.exports);
    expect(drizzle.names).toEqual(expect.arrayContaining(['kovo', 'kovoAnalyzerSummary']));
    for (const name of [
      'extractKovoRuntimeDbMetadata',
      'KovoRuntimeDbMetadata',
      'KovoRuntimeDbTable',
      'KovoRuntimeAuthorizationClassification',
      'KovoRuntimeKeySource',
    ]) {
      expect(
        drizzlePage,
        `internal Drizzle runtime metadata export "${name}" leaked`,
      ).not.toContain(`#### \`${name}\``);
    }
  });

  it('documents analyzer summaries as inspected candidates rather than app assertions', () => {
    const start = drizzlePage.indexOf('#### `kovoAnalyzerSummary`');
    const next = drizzlePage.indexOf('\n#### `', start + 1);
    const section = drizzlePage.slice(start, next < 0 ? undefined : next);
    const normalized = section.replace(/\s+/g, ' ');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(normalized).toContain('candidate for exact structural verification');
    expect(normalized).toContain('bare identifier of a function declaration');
    expect(normalized).toContain(
      'Object properties, methods, imports, aliased marker targets, and mutable bindings',
    );
    expect(normalized).toContain('independently inspects the helper body');
    expect(normalized).toContain(
      '`const alias = provenHelper` may preserve its identity at an invocation',
    );
    expect(section).not.toContain('helper body is not inspected');
  });

  it('emits a per-package sidebar manifest grouped by subpath, with anchors and source links', async () => {
    const manifest = JSON.parse(await readFile(path.join(outDir, 'core.sidebar.json'), 'utf8'));
    expect(manifest.package).toBe('@kovojs/core');
    expect(manifest.slug).toBe('core');

    expect(new Set(manifest.subpaths.map((subpath) => subpath.importPath))).toEqual(
      new Set(manifestSubpaths('@kovojs/core')),
    );
    const root = manifest.subpaths.find((subpath) => subpath.importPath === '@kovojs/core');
    expect(root.sourceHref).toMatch(/^https:\/\/github\.com\/kovojs\/kovo\/blob\/main\/.+/);
    expect(root.sourceHref).not.toContain(repoRoot);

    const values = root.categories.find((category) => category.title === 'Values');
    expect(values.anchor).toBe('kovojscore-values');
    const component = values.symbols.find((symbol) => symbol.name === 'component');
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
    // The sidebar groups by subpath, one group per manifest-declared public
    // subpath of @kovojs/test (no internalized verifier/page/sql-observer groups).
    expect(new Set(testManifest.subpaths.map((subpath) => subpath.importPath))).toEqual(
      new Set(manifestSubpaths('@kovojs/test')),
    );
  });

  it('renders copyable @example blocks before the source-derived signature', () => {
    const section = corePage.slice(
      corePage.indexOf('#### `component`'),
      corePage.indexOf('#### `route`'),
    );
    expect(section).toContain('**Copyable example**');
    // The example is its own fenced block and imports the real export.
    const exampleStart = section.indexOf('**Copyable example**');
    expect(section.slice(exampleStart)).toContain("import { component } from '@kovojs/core';");
    expect(exampleStart).toBeLessThan(section.indexOf('**Signature**'));
    // Each documented export still has exactly one signature fence.
    expect(section.match(/```ts/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('documents every declaration in each manifest-selected app-facing entry', () => {
    // The checked decision ledger owns intentional surface shrinkage. This gate
    // prevents silent documentation drops without turning yesterday's export
    // counts into a compatibility floor.
    for (const pkg of result.packages) {
      expect(pkg.exports, `${pkg.name} exports`).toBeGreaterThan(0);
      expect(pkg.documented, `${pkg.name} documented`).toBe(pkg.exports);
    }
  });
});
