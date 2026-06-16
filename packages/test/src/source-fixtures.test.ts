import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

import {
  cssScopeRules,
  cssSourceDirectives,
  drizzleQueryBehaviorSourceFixtures,
  forbiddenBrowserArchitectureFacts,
  forbiddenBrowserArchitectureProjectFact,
  moduleImportFailureFact,
  projectDirectoryNames,
  projectFilePaths,
  projectFileSources,
  projectJsonFile,
  projectPackageManifestFacts,
  projectQueryBehaviorFacts,
  projectQueryDiagnosticFacts,
  projectSourceLineFacts,
  projectSourceSiteFact,
  projectSourceSiteFacts,
  projectSourceSiteSummaryFact,
  projectTouchGraphBehaviorFacts,
} from './source-fixtures.js';

describe('@kovojs/test source fixture seam', () => {
  it('extracts Tailwind source directives without keeping a local kovo-check parser', () => {
    expect(
      cssSourceDirectives(
        [
          '@import "tailwindcss";',
          '  @source "../index.html";',
          '@source inline("bg-emerald-50 text-emerald-700");',
        ].join('\n'),
      ),
    ).toEqual(['"../index.html"', 'inline("bg-emerald-50 text-emerald-700")']);
  });

  it('extracts structured CSS scope rules from generated component styles', () => {
    expect(
      cssScopeRules(
        [
          '.global { color: red; }',
          '  @scope (doc-card) to (:scope [kovo-c]) {',
          '    .title { color: teal; }',
          '  }',
        ].join('\n'),
      ),
    ).toEqual([
      {
        limit: ':scope [kovo-c]',
        raw: '@scope (doc-card) to (:scope [kovo-c]) {',
        scope: 'doc-card',
      },
    ]);
  });

  it('projects allowed module import failures without caller-side substring checks', () => {
    expect(
      moduleImportFailureFact(new Error('Cannot load: packages/core/src/diagnostics.js'), [
        '__filename is not defined in ES module scope',
        'packages/core/src/diagnostics.js',
      ]),
    ).toEqual({
      allowed: true,
      matchedReason: 'packages/core/src/diagnostics.js',
    });
    expect(
      moduleImportFailureFact(new Error('Cannot load unrelated module'), [
        '__filename is not defined in ES module scope',
      ]),
    ).toEqual({
      allowed: false,
      matchedReason: null,
    });
  });

  it('turns generated graph source sites into path and line facts', () => {
    expect(projectSourceSiteFact('examples/commerce/src/app.ts:42')).toEqual({
      line: 42,
      path: 'examples/commerce/src/app.ts',
    });
    expect(
      projectSourceSiteFacts([
        'examples/commerce/src/app.ts:42',
        'examples/commerce/src/app.ts:47',
      ]),
    ).toEqual([
      { line: 42, path: 'examples/commerce/src/app.ts' },
      { line: 47, path: 'examples/commerce/src/app.ts' },
    ]);
    expect(() => projectSourceSiteFact('examples/commerce/src/app.ts')).toThrow(
      'Project source site includes a line number: examples/commerce/src/app.ts',
    );
    expect(() => projectSourceSiteFact('examples/commerce/src/app.ts:0')).toThrow(
      'Project source site line is positive: examples/commerce/src/app.ts:0',
    );
  });

  it('summarizes generated graph source sites without inline Set membership checks', () => {
    expect(
      projectSourceSiteSummaryFact([
        'examples/commerce/src/app.ts:42',
        'examples/commerce/src/app.ts:47',
        'examples/commerce/src/cart.ts:5',
      ]),
    ).toEqual({
      count: 3,
      linesArePositive: true,
      paths: ['examples/commerce/src/app.ts', 'examples/commerce/src/cart.ts'],
    });
  });

  it('resolves source-site lines without pinning callers to raw line parsing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-test-source-lines-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(
        join(root, 'src/cart.ts'),
        ['const cart = domain("cart");', 'db.write("cart_items", item);', ''].join('\n'),
      );

      await expect(projectSourceLineFacts(root, ['src/cart.ts:2'])).resolves.toEqual([
        {
          line: 2,
          path: 'src/cart.ts',
          sourceLine: 'db.write("cart_items", item);',
        },
      ]);
      await expect(projectSourceLineFacts(root, ['src/cart.ts:4'])).rejects.toThrow(
        'Project source site resolves to a source line: src/cart.ts:4',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('loads structured project file and package-directory facts for kovo-check gates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-test-project-source-'));
    try {
      await mkdir(join(root, 'packages/runtime/src'), { recursive: true });
      await mkdir(join(root, 'packages/runtime/docs'), { recursive: true });
      await mkdir(join(root, 'packages/compiler/src'), { recursive: true });
      await writeFile(join(root, 'packages/compiler/package.json'), '{}');
      await writeFile(join(root, 'packages/runtime/package.json'), '{"name":"@kovojs/runtime"}');
      await writeFile(join(root, 'packages/runtime/src/index.ts'), 'export const runtime = true;');
      await writeFile(join(root, 'packages/runtime/docs/readme.md'), '# Runtime');
      await writeFile(join(root, 'packages/compiler/src/index.test.ts'), 'export {};');

      expect(await projectDirectoryNames({ rootPath: root, directory: 'packages' })).toEqual([
        'packages/compiler',
        'packages/runtime',
      ]);
      expect(
        await projectFilePaths({
          rootPath: root,
          directory: 'packages',
          include: (path) => path.endsWith('.ts') && path.includes('/src/'),
        }),
      ).toEqual(['packages/compiler/src/index.test.ts', 'packages/runtime/src/index.ts']);
      expect(
        await projectFileSources({
          rootPath: root,
          directory: 'packages',
          include: (path) => path.endsWith('.ts') && !path.endsWith('.test.ts'),
        }),
      ).toEqual([
        { path: 'packages/runtime/src/index.ts', source: 'export const runtime = true;' },
      ]);
      expect(await projectJsonFile(root, 'packages/runtime/package.json')).toEqual({
        name: '@kovojs/runtime',
      });
      expect(await projectPackageManifestFacts({ rootPath: root, directory: 'packages' })).toEqual([
        {
          directory: 'compiler',
          manifest: {},
        },
        {
          directory: 'runtime',
          manifest: { name: '@kovojs/runtime' },
        },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('audits framework source for forbidden browser architecture through a project fixture', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-test-browser-architecture-'));
    try {
      await mkdir(join(root, 'packages/runtime/src'), { recursive: true });
      await mkdir(join(root, 'packages/runtime/test'), { recursive: true });
      await mkdir(join(root, 'packages/compiler/src'), { recursive: true });
      await writeFile(
        join(root, 'packages/runtime/src/loader.ts'),
        [
          'customElements.define("cart-row", class extends HTMLElement {});',
          'window.addEventListener("unload", () => {});',
          '',
        ].join('\n'),
      );
      await writeFile(
        join(root, 'packages/runtime/src/loader.test.ts'),
        'customElements.define("allowed-test", class extends HTMLElement {});',
      );
      await writeFile(join(root, 'packages/compiler/src/index.ts'), 'export const ok = true;');

      await expect(
        forbiddenBrowserArchitectureProjectFact({
          rootPath: root,
          ts,
        }),
      ).resolves.toEqual({
        checkedFileCount: 2,
        clean: false,
        violations: [
          {
            column: 1,
            fileName: 'packages/runtime/src/loader.ts',
            label: 'customElements.define',
            line: 1,
            site: 'packages/runtime/src/loader.ts:1:1',
          },
          {
            column: 1,
            fileName: 'packages/runtime/src/loader.ts',
            label: 'addEventListener unload',
            line: 2,
            site: 'packages/runtime/src/loader.ts:2:1',
          },
        ],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('provides Drizzle query source fixtures without local kovo-check source bodies', () => {
    const fixtures = drizzleQueryBehaviorSourceFixtures();

    expect(Object.keys(fixtures).sort()).toEqual([
      'exemptRead',
      'exemptWriteTouch',
      'importedSchemaProject',
      'nonKeyPredicate',
      'opaqueProjection',
      'selectShape',
    ]);
    expect(fixtures.selectShape).toMatchObject([
      {
        fileName: 'cart.queries.ts',
      },
    ]);
    expect(fixtures.selectShape[0]?.source).toContain('innerJoin(products');
    expect(fixtures.importedSchemaProject.map((fixture) => fixture.fileName)).toEqual([
      'cart.schema.ts',
      'order.schema.ts',
      'cart.queries.ts',
    ]);
  });

  it('projects query, diagnostic, and touch graph facts for source-derived gates', () => {
    const queryFacts = [
      {
        diagnostics: [
          {
            code: 'KV410',
            message: 'Opaque query projection requires a declared output schema.',
            severity: 'error',
            site: 'cart.queries.ts:4',
          },
        ],
        instanceKey: { domain: 'cart', key: 'arg:cartId' },
        query: 'cart',
        reads: ['cart'],
        shape: { count: 'number' },
        site: 'cart.queries.ts:4',
      },
      {
        query: 'product',
        reads: ['product'],
        shape: { sku: 'string' },
        site: 'product.queries.ts:4',
      },
    ];

    expect(projectQueryBehaviorFacts(queryFacts)).toEqual(queryFacts);
    expect(projectQueryDiagnosticFacts(queryFacts)).toEqual([
      {
        code: 'KV410',
        message: 'Opaque query projection requires a declared output schema.',
        severity: 'error',
        site: 'cart.queries.ts:4',
      },
    ]);
    expect(
      projectTouchGraphBehaviorFacts({
        addItem: {
          touches: [{ domain: 'cart', keys: 'arg:cartId', site: 'cart.domain.ts:9', via: 'cart' }],
        },
      }),
    ).toEqual({
      addItem: {
        reads: [],
        touches: [{ domain: 'cart', keys: 'arg:cartId', site: 'cart.domain.ts:9', via: 'cart' }],
        unresolved: [],
      },
    });
  });

  it('returns structured forbidden browser architecture facts from TSX source', () => {
    const facts = forbiddenBrowserArchitectureFacts(
      ts,
      'packages/runtime/src/browser.tsx',
      [
        'customElements.define("x-card", XCard);',
        'host.attachShadow({ mode: "open" });',
        'window.addEventListener("unload", cleanup);',
        'window.addEventListener("pagehide", cleanup);',
        'router = createBrowserRouter(routes);',
        'hydrateRoot(root, <App />);',
        'window.onunload = cleanup;',
        'export const View = () => <script type="importmap" />;',
        'export const Safe = () => <script type="application/json" />;',
      ].join('\n'),
    );

    expect(
      facts.map(({ column, fileName, label, line, site }) => ({
        column,
        fileName,
        label,
        line,
        site,
      })),
    ).toEqual([
      {
        column: 1,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'customElements.define',
        line: 1,
        site: 'packages/runtime/src/browser.tsx:1:1',
      },
      {
        column: 1,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'attachShadow',
        line: 2,
        site: 'packages/runtime/src/browser.tsx:2:1',
      },
      {
        column: 1,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'addEventListener unload',
        line: 3,
        site: 'packages/runtime/src/browser.tsx:3:1',
      },
      {
        column: 10,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'createBrowserRouter',
        line: 5,
        site: 'packages/runtime/src/browser.tsx:5:10',
      },
      {
        column: 1,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'hydrateRoot',
        line: 6,
        site: 'packages/runtime/src/browser.tsx:6:1',
      },
      {
        column: 1,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'onunload',
        line: 7,
        site: 'packages/runtime/src/browser.tsx:7:1',
      },
      {
        column: 35,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'importmap script',
        line: 8,
        site: 'packages/runtime/src/browser.tsx:8:35',
      },
    ]);
  });
});
