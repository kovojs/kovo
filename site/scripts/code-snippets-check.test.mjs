import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertBuiltKovoDeclarationsStayInScratch,
  checkAuthoredDocStyle,
  checkAuthoredCodeSnippets,
  collectCodeSnippets,
  extractCodeSnippets,
  writeBuiltKovoDeclarationGraph,
} from './code-snippets-check.mjs';

describe('authored code snippet extractor', () => {
  it('extracts ts and tsx fences with stable source metadata', () => {
    const markdown = [
      '# Page',
      '',
      '```ts',
      'const count = 1;',
      '```',
      '',
      '```tsx',
      'export function View() {',
      '  return <span />;',
      '}',
      '```',
    ].join('\n');

    const snippets = extractCodeSnippets(markdown, 'guides/example.md');
    expect(snippets).toHaveLength(2);
    expect(snippets[0]).toMatchObject({
      id: 'guides-example__L3',
      lang: 'ts',
      sourcePath: 'guides/example.md',
      startLine: 3,
    });
    expect(snippets[1]).toMatchObject({
      id: 'guides-example__L7',
      lang: 'tsx',
      sourcePath: 'guides/example.md',
      startLine: 7,
    });
  });

  it('treats ts fences containing JSX as tsx snippets', () => {
    const snippets = extractCodeSnippets(
      ['```ts', 'export function View() {', '  return <Button />;', '}', '```'].join('\n'),
      'page.md',
    );
    expect(snippets).toHaveLength(1);
    expect(snippets[0].lang).toBe('tsx');
  });

  it('honors reviewed illustrative directives owned by the packed sample policy', () => {
    const [snippet] = extractCodeSnippets(
      [
        '<!-- kovo-sample: illustrative reason="Requires app-local generated bindings." -->',
        '',
        '```ts',
        'useGeneratedBinding();',
        '```',
      ].join('\n'),
      'page.md',
    );
    expect(snippet.mode).toBe('reviewed');
  });

  it('leaves expected-error compilation to the packed sample gate', () => {
    const [snippet] = extractCodeSnippets(
      [
        '<!-- kovo-sample: type-error -->',
        '',
        '```ts',
        "// kovo-expected-error: Property 'oldName' does not exist",
        'value.oldName;',
        '```',
      ].join('\n'),
      'page.md',
    );
    expect(snippet.mode).toBe('expected-error');
  });

  it('ignores non-TypeScript fences', () => {
    const markdown = ['```sh', 'pnpm run check', '```', '', '```json', '{"ok":true}', '```'].join(
      '\n',
    );
    expect(extractCodeSnippets(markdown, 'page.md')).toHaveLength(0);
  });

  it('collects markdown files recursively in deterministic order', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-code-snippets-'));
    try {
      await writeFile(path.join(root, 'b.md'), ['```ts', 'const b = 1;', '```'].join('\n'), 'utf8');
      await writeFile(
        path.join(root, 'a.md'),
        ['```tsx', 'const a = <div />;', '```'].join('\n'),
        'utf8',
      );

      const snippets = await collectCodeSnippets(root);
      expect(snippets.map((snippet) => snippet.id)).toEqual(['a__L1', 'b__L1']);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('typechecks extracted snippets in a scratch project', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-code-snippets-'));
    await mkdir(path.join(process.cwd(), 'site/gen'), { recursive: true });
    const outDir = await mkdtemp(path.join(process.cwd(), 'site/gen/code-snippets-test-'));
    try {
      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'A cart page should show the useful path first.',
          '',
          '```tsx',
          "import { route } from '@kovojs/server';",
          '',
          "export const cartRoute = route('/cart', {",
          '  page: () => <main>Cart</main>,',
          '});',
          '```',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredCodeSnippets({ dir: root, outDir })).resolves.toMatchObject({
        ok: true,
        snippets: [{ id: 'page__L5', lang: 'tsx', sourcePath: 'page.md', startLine: 5 }],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('typechecks adapter snippets that import the separately defined request handler', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-code-snippets-'));
    await mkdir(path.join(process.cwd(), 'site/gen'), { recursive: true });
    const outDir = await mkdtemp(path.join(process.cwd(), 'site/gen/code-snippets-test-'));
    try {
      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'Keep raw host authority in the adapter entry.',
          '',
          '```ts',
          "import '@kovojs/server/runtime-bootstrap';",
          '',
          "import { createServer } from 'node:http';",
          "import { toNodeHandler } from '@kovojs/server/node';",
          "import { handler } from './handler.js';",
          '',
          'createServer(toNodeHandler(handler)).listen(3000);',
          '```',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredCodeSnippets({ dir: root, outDir })).resolves.toMatchObject({
        ok: true,
        snippets: [{ id: 'page__L5', lang: 'ts', sourcePath: 'page.md', startLine: 5 }],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects a large first TypeScript block', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-doc-style-'));
    try {
      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'A cart page should show the useful path first.',
          '',
          '## Run it',
          '',
          '```ts',
          'const a = 1;',
          'const b = 2;',
          'const c = 3;',
          'const d = 4;',
          'const e = 5;',
          'const f = 6;',
          'const g = 7;',
          'const h = 8;',
          'const i = 9;',
          'const j = 10;',
          'const k = 11;',
          'const l = 12;',
          'const m = 13;',
          '```',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredDocStyle({ dir: root })).rejects.toThrow('doc-style');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('allows SPEC citations inside collapsed details only', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-doc-style-'));
    try {
      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'A cart page should show the useful path first.',
          '',
          '```ts',
          'const count = 1;',
          '```',
          '',
          '<details>',
          '<summary>Spec & diagnostics</summary>',
          '',
          'SPEC §9.1 and KV310 live here.',
          '',
          '</details>',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredDocStyle({ dir: root })).resolves.toBeUndefined();

      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'A cart page should show the useful path first. SPEC §9.1 explains why.',
          '',
          '```ts',
          'const count = 1;',
          '```',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredDocStyle({ dir: root })).rejects.toThrow('doc-style');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('requires the canonical collapsed Spec & diagnostics disclosure', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-doc-style-'));
    try {
      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'A cart page should show the useful path first.',
          '',
          '## Run it',
          '',
          '```ts',
          'const count = 1;',
          '```',
          '',
          '<details>',
          '<summary>Implementation notes</summary>',
          '',
          'SPEC §9.1 lives here.',
          '',
          '</details>',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredDocStyle({ dir: root })).rejects.toThrow('doc-style');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('requires a proof step for task-guide code', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-doc-style-'));
    try {
      await mkdir(path.join(root, 'guides'));
      await writeFile(
        path.join(root, 'guides/page.md'),
        [
          '# Add a cart',
          '',
          'A cart page can show the current item count.',
          '',
          '## Add the count',
          '',
          '```ts',
          'const count = 1;',
          '```',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredDocStyle({ dir: root })).rejects.toThrow('doc-style');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects framework-noun openers without an app noun', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-doc-style-'));
    try {
      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'The invalidation graph derives from framework internals.',
          '',
          '```ts',
          'const count = 1;',
          '```',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredDocStyle({ dir: root })).rejects.toThrow('doc-style');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('accepts provenance-marked non-runnable snippets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-code-snippets-'));
    await mkdir(path.join(process.cwd(), 'site/gen'), { recursive: true });
    const outDir = await mkdtemp(path.join(process.cwd(), 'site/gen/code-snippets-test-'));
    try {
      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'A cart page should show the useful path first.',
          '',
          '```tsx',
          '// Source: examples/crm/src/testing.ts',
          'export const harness = await createKovoTestHarness(crmApp, {',
          "  artifact: new URL('../dist/.kovo/graph.json', import.meta.url),",
          "  projectRoot: new URL('../', import.meta.url),",
          '});',
          '```',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredCodeSnippets({ dir: root, outDir })).resolves.toMatchObject({
        ok: true,
        snippets: [{ id: 'page__L5', mode: 'provenance', sourcePath: 'page.md', startLine: 5 }],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects explicit any in authored runnable snippets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-code-snippets-'));
    await mkdir(path.join(process.cwd(), 'site/gen'), { recursive: true });
    await mkdir(path.join(root, 'guides'), { recursive: true });
    const outDir = await mkdtemp(path.join(process.cwd(), 'site/gen/code-snippets-test-'));
    try {
      await writeFile(
        path.join(root, 'guides/queries.md'),
        [
          '# Page',
          '',
          'A cart page should show the useful path first.',
          '',
          '## Run it',
          '',
          '```ts',
          'const load = (value: any) => value;',
          '```',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredCodeSnippets({ dir: root, outDir })).rejects.toThrow(
        'policy issue',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outDir, { force: true, recursive: true });
    }
  });
});

describe('built authored-snippet declaration graph', () => {
  it('materializes full finite exports and rejects a transitive workspace-source escape', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'kovo-doc-dist-workspace-'));
    const outDir = path.join(workspaceRoot, 'scratch');
    try {
      await writeFixtureKovoPackage(workspaceRoot, {
        distFiles: {
          'index.d.mts': 'export interface Component<Props> { readonly props: Props };\n',
          'storage.d.mts': 'export interface StorageKey { readonly key: string };\n',
        },
        name: '@kovojs/core',
        publishExports: {
          '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
          './storage': { types: './dist/storage.d.mts', default: './dist/storage.mjs' },
        },
        sourceExports: {
          '.': './src/index.ts',
          './storage': './src/storage.ts',
        },
        sourceFiles: {
          'index.ts': 'export interface Component<Props> { readonly props: Props };\n',
          'storage.ts': 'export interface StorageKey { readonly key: string };\n',
        },
      });
      await writeFixtureKovoPackage(workspaceRoot, {
        dependencies: { '@kovojs/core': 'workspace:*' },
        distFiles: {
          'arrow-right.d.mts':
            "import type { Component } from '@kovojs/core';\nexport declare const ArrowRight: Component<never>;\n",
          'index.d.mts': 'export {};\n',
        },
        name: '@kovojs/icons',
        publishExports: {
          '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
          './index': null,
          './*': { types: './dist/*.d.mts', default: './dist/*.mjs' },
        },
        sourceExports: {
          '.': './src/index.ts',
          './index': null,
          './*': './src/*.ts',
        },
        sourceFiles: {
          'arrow-right.ts':
            "import type { Component } from '@kovojs/core';\nexport declare const ArrowRight: Component<never>;\n",
          'index.ts': 'export {};\n',
        },
      });

      const result = await writeBuiltKovoDeclarationGraph(outDir, ['@kovojs/icons'], {
        workspaceRoot,
      });
      expect(result.packages).toEqual(['@kovojs/core', '@kovojs/icons']);

      const iconsManifest = JSON.parse(
        await readFile(path.join(outDir, 'node_modules/@kovojs/icons/package.json'), 'utf8'),
      );
      expect(iconsManifest.exports).toMatchObject({
        '.': { types: './dist/index.d.mts' },
        './arrow-right': { types: './dist/arrow-right.d.mts' },
        './index': null,
      });
      expect(iconsManifest.exports).not.toHaveProperty('./*');

      await writeFile(
        path.join(outDir, 'sample.ts'),
        "import { ArrowRight } from '@kovojs/icons/arrow-right';\nvoid ArrowRight;\n",
        'utf8',
      );
      const tsconfigPath = path.join(outDir, 'tsconfig.json');
      await writeFile(
        tsconfigPath,
        `${JSON.stringify(
          {
            compilerOptions: {
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              noEmit: true,
              skipLibCheck: true,
              strict: true,
              target: 'ES2024',
            },
            include: ['sample.ts'],
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      expect(() =>
        assertBuiltKovoDeclarationsStayInScratch(outDir, tsconfigPath, { workspaceRoot }),
      ).not.toThrow();

      await rm(path.join(outDir, 'node_modules/@kovojs/core'), {
        force: true,
        recursive: true,
      });
      await mkdir(path.join(workspaceRoot, 'node_modules/@kovojs'), { recursive: true });
      await symlink(
        path.join(workspaceRoot, 'packages/core'),
        path.join(workspaceRoot, 'node_modules/@kovojs/core'),
        'dir',
      );
      expect(() =>
        assertBuiltKovoDeclarationsStayInScratch(outDir, tsconfigPath, { workspaceRoot }),
      ).toThrow('escaped the materialized dist graph');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it('rejects a missing transitive package dist instead of falling back to source', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'kovo-doc-dist-workspace-'));
    const outDir = path.join(workspaceRoot, 'scratch');
    try {
      await writeFixtureKovoPackage(workspaceRoot, {
        createDist: false,
        name: '@kovojs/core',
        publishExports: {
          '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
        },
        sourceExports: { '.': './src/index.ts' },
        sourceFiles: { 'index.ts': 'export interface SourceOnlyCore {};\n' },
      });
      await writeFixtureKovoPackage(workspaceRoot, {
        dependencies: { '@kovojs/core': 'workspace:*' },
        distFiles: { 'index.d.mts': 'export {};\n' },
        name: '@kovojs/ui',
        publishExports: {
          '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
        },
      });

      await expect(
        writeBuiltKovoDeclarationGraph(outDir, ['@kovojs/ui'], { workspaceRoot }),
      ).rejects.toThrow('@kovojs/core is required by the built declaration graph');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it('rejects a stale transitive dist missing a manifest-declared public subpath', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'kovo-doc-dist-workspace-'));
    const outDir = path.join(workspaceRoot, 'scratch');
    try {
      await writeFixtureKovoPackage(workspaceRoot, {
        distFiles: { 'index.d.mts': 'export {};\n' },
        name: '@kovojs/core',
        publishExports: {
          '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
          './storage': { types: './dist/storage.d.mts', default: './dist/storage.mjs' },
        },
      });
      await writeFixtureKovoPackage(workspaceRoot, {
        dependencies: { '@kovojs/core': 'workspace:*' },
        distFiles: {
          'index.d.mts': "export type { StorageKey } from '@kovojs/core/storage';\n",
        },
        name: '@kovojs/ui',
        publishExports: {
          '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
        },
      });

      await expect(
        writeBuiltKovoDeclarationGraph(outDir, ['@kovojs/ui'], { workspaceRoot }),
      ).rejects.toThrow(
        '@kovojs/core export "./storage" declaration ./dist/storage.d.mts is missing',
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

async function writeFixtureKovoPackage(
  workspaceRoot,
  {
    createDist = true,
    dependencies = {},
    distFiles = {},
    name,
    publishExports,
    sourceExports = { '.': './src/index.ts' },
    sourceFiles = { 'index.ts': 'export {};\n' },
  },
) {
  const packageDir = path.join(workspaceRoot, 'packages', name.slice('@kovojs/'.length));
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify(
      {
        name,
        version: '0.0.0-test',
        type: 'module',
        exports: sourceExports,
        dependencies,
        publishConfig: { exports: publishExports },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  for (const [relative, source] of Object.entries(sourceFiles)) {
    const file = path.join(packageDir, 'src', relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source, 'utf8');
  }
  if (!createDist) return;
  await mkdir(path.join(packageDir, 'dist'), { recursive: true });
  for (const [relative, source] of Object.entries(distFiles)) {
    const file = path.join(packageDir, 'dist', relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source, 'utf8');
  }
}
