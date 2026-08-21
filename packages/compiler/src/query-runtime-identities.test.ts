import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { deriveRegistryIdentity } from './registry-identities.js';
import {
  completeQueryIdentityProgramConstructionsForTesting,
  resolveComponentQueryRuntimeNames,
} from './scan/query-runtime-identities.js';

const roots: string[] = [];
const frameworkServerPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../server');

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('compiler-owned query runtime identity project', () => {
  it('resolves shorthand bindings and extensionless free/namespace query declarations', () => {
    const root = projectRoot();
    const directSourceFile = join(root, 'src/components/direct-status-card.tsx');
    const directSource = [
      "import { component } from '@kovojs/core';",
      "import { status } from '../status';",
      'export const DirectStatusCard = component({',
      '  queries: { status },',
      '  render: ({ status }) => <article>{status.summary}</article>,',
      '});',
      '',
    ].join('\n');
    writeFile(
      root,
      'src/status.ts',
      [
        "import { query } from '@kovojs/server';",
        'export const status = query({',
        '  load: () => ({ summary: "ready" }),',
        '  output: {},',
        '  reads: [],',
        '});',
        '',
      ].join('\n'),
    );
    writeFile(root, 'src/components/direct-status-card.tsx', directSource);

    expect(
      resolveComponentQueryRuntimeNames({
        fileName: directSourceFile,
        rootDirectory: root,
        source: directSource,
      }),
    ).toEqual({ status: 'status/status' });

    const namespaceSourceFile = join(root, 'src/components/namespace-status-card.tsx');
    const namespaceSource = [
      "import { component } from '@kovojs/core';",
      "import { namespaceStatus } from '../namespace-status';",
      'export const NamespaceStatusCard = component({',
      '  queries: { status: namespaceStatus },',
      '  render: ({ status }) => <article>{status.summary}</article>,',
      '});',
      '',
    ].join('\n');
    writeFile(
      root,
      'src/namespace-status.jsx',
      [
        "import * as data from '@kovojs/server';",
        'export const namespaceStatus = data.query({',
        '  load: () => ({ summary: "ready" }),',
        '  output: {},',
        '  reads: [],',
        '});',
        '',
      ].join('\n'),
    );
    writeFile(root, 'src/components/namespace-status-card.tsx', namespaceSource);

    expect(
      resolveComponentQueryRuntimeNames({
        fileName: namespaceSourceFile,
        rootDirectory: root,
        source: namespaceSource,
      }),
    ).toEqual({ status: 'namespace-status/namespace-status' });
  });

  it('does not grant query identity to an imported structural lookalike through shorthand', () => {
    const root = projectRoot();
    const sourceFile = join(root, 'src/components/forged-card.tsx');
    const source = [
      "import { component } from '@kovojs/core';",
      "import { forged } from '../forged';",
      'export const ForgedCard = component({',
      '  queries: { forged },',
      '  render: ({ forged }) => <article>{forged.summary}</article>,',
      '});',
      '',
    ].join('\n');
    writeFile(
      root,
      'src/forged.ts',
      [
        'const app = { query(value: unknown) { return value; } };',
        'export const forged = app.query({ summary: "not a Kovo query" });',
        '',
      ].join('\n'),
    );
    writeFile(root, 'src/components/forged-card.tsx', source);

    expect(() =>
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toThrow(/could not prove the exact runtime query identity.*alias "forged"/u);
  });

  it('resolves local declarations, namespace barrels, and tsconfig path aliases exactly', () => {
    const root = projectRoot();
    const sourceFile = join(root, 'src/components/deal-card.tsx');
    writeFile(
      root,
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          paths: { '@data/*': ['src/data/*'] },
        },
      }),
    );
    writeFile(
      root,
      'src/data/deal-query.ts',
      [
        "import { query } from '@kovojs/server';",
        'export const dealByIdQuery = query({',
        '  input: {},',
        '  handler: async () => ({ stage: "open" }),',
        '});',
        '',
      ].join('\n'),
    );
    writeFile(
      root,
      'src/data/index.ts',
      "export { dealByIdQuery as selectedDealQuery } from './deal-query.js';\n",
    );
    const source = [
      "import { component } from '@kovojs/core';",
      "import { query } from '@kovojs/server';",
      "import * as dealQueries from '@data/index';",
      'export const localPipelineQuery = query({',
      '  input: {},',
      '  handler: async () => ({ count: 1 }),',
      '});',
      'export const DealCard = component({',
      '  queries: {',
      '    deal: dealQueries.selectedDealQuery,',
      '    pipeline: localPipelineQuery,',
      '  },',
      '  render: ({ deal, pipeline }) => <article>{deal.stage}{pipeline.count}</article>,',
      '});',
      '',
    ].join('\n');
    writeFile(root, 'src/components/deal-card.tsx', source);

    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({
      deal: 'data/deal-query/deal-by-id-query',
      pipeline: 'components/deal-card/local-pipeline-query',
    });
  });

  it('fails closed instead of treating an unproved local alias as a runtime family', () => {
    const root = projectRoot();
    const sourceFile = join(root, 'src/deal-card.tsx');
    const source = [
      "import { component } from '@kovojs/core';",
      'const makeQuery = () => ({ key: "runtime-only" });',
      'const localAlias = makeQuery();',
      'export const DealCard = component({',
      '  queries: { deal: localAlias },',
      '  render: ({ deal }) => <article>{deal.stage}</article>,',
      '});',
      '',
    ].join('\n');
    writeFile(root, 'src/deal-card.tsx', source);

    expect(() =>
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toThrow(/could not prove the exact runtime query identity.*alias "deal"/u);
  });

  it('re-reads cached dependency bytes and refuses a same-mtime structural forgery', () => {
    const root = projectRoot();
    const sourceFile = join(root, 'src/components/status-card.tsx');
    const dependencyFile = join(root, 'src/status.ts');
    const source = [
      "import { component } from '@kovojs/core';",
      "import { status } from '../status';",
      'export const StatusCard = component({',
      '  queries: { status },',
      '  render: ({ status }) => <article>{status.summary}</article>,',
      '});',
      '',
    ].join('\n');
    const genuine = [
      "import { query } from '@kovojs/server';",
      'export const status = query({ load: () => ({ summary: "ready" }) });',
      '',
    ].join('\n');
    const forged = [
      'const app = { query<T>(value: T): T { return value; } };',
      'export const status = app.query({ summary: "forged" });',
      '',
    ].join('\n');
    writeFile(root, 'src/status.ts', genuine);
    writeFile(root, 'src/components/status-card.tsx', source);

    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'status/status' });

    const originalTimes = statSync(dependencyFile);
    writeFile(root, 'src/status.ts', forged);
    utimesSync(dependencyFile, originalTimes.atime, originalTimes.mtime);
    expect(() =>
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toThrow(/could not prove the exact runtime query identity.*alias "status"/u);

    writeFile(root, 'src/status.ts', genuine);
    utimesSync(dependencyFile, originalTimes.atime, originalTimes.mtime);
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'status/status' });
  });

  it('re-resolves changed barrels and tsconfig paths instead of trusting cached syntax', () => {
    const root = projectRoot();
    const sourceFile = join(root, 'src/components/status-card.tsx');
    const source = [
      "import { component } from '@kovojs/core';",
      "import { selectedStatus } from '@data/index';",
      'export const StatusCard = component({',
      '  queries: { status: selectedStatus },',
      '  render: ({ status }) => <article>{status.summary}</article>,',
      '});',
      '',
    ].join('\n');
    const querySource = [
      "import { query } from '@kovojs/server';",
      'export const status = query({ load: () => ({ summary: "ready" }) });',
      '',
    ].join('\n');
    const config = (path: string) =>
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          paths: { '@data/*': [path] },
        },
      });
    writeFile(root, 'src/a/status.ts', querySource);
    writeFile(root, 'src/a/index.ts', "export { status as selectedStatus } from './status.js';\n");
    writeFile(root, 'src/b/status.ts', querySource);
    writeFile(root, 'src/b/index.ts', "export { status as selectedStatus } from './status.js';\n");
    writeFile(root, 'src/components/status-card.tsx', source);
    writeFile(root, 'tsconfig.json', config('src/a/*'));

    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'a/status/status' });

    writeFile(
      root,
      'src/a/index.ts',
      "export { status as selectedStatus } from '../b/status.js';\n",
    );
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'b/status/status' });

    writeFile(root, 'src/a/index.ts', "export { status as selectedStatus } from './status.js';\n");
    writeFile(root, 'tsconfig.json', config('src/b/*'));
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'b/status/status' });
  });

  it('revalidates direct app-query providers and the current tsconfig target', () => {
    const root = projectRoot();
    installFrameworkServer(root);
    const sourceFile = join(root, 'src/components/status-card.tsx');
    const source = [
      "import { component } from '@kovojs/core';",
      "import { status } from '@provider';",
      'export const StatusCard = component({',
      '  queries: { status },',
      '  render: ({ status }) => <article>{status.summary}</article>,',
      '});',
      '',
    ].join('\n');
    const providerSource = [
      "import { defineKovo } from '@kovojs/server';",
      "export const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000001' });",
      'export const status = app.query({ load: () => ({ summary: "ready" }) });',
      '',
    ].join('\n');
    const forgedProviderSource = [
      'const app = { query<T>(value: T): T { return value; } };',
      'export const status = app.query({ summary: "forged" });',
      '',
    ].join('\n');
    const config = (provider: string) =>
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          paths: { '@provider': [provider] },
        },
      });
    const providerA = join(root, 'src/providers/a.ts');
    writeFile(root, 'src/providers/a.ts', providerSource);
    writeFile(root, 'src/providers/b.ts', providerSource);
    writeFile(root, 'src/components/status-card.tsx', source);
    writeFile(root, 'tsconfig.json', config('src/providers/a.ts'));

    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'providers/a/status' });

    const originalTimes = statSync(providerA);
    writeFile(root, 'src/providers/a.ts', forgedProviderSource);
    utimesSync(providerA, originalTimes.atime, originalTimes.mtime);
    expect(() =>
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toThrow(/could not prove the exact runtime query identity.*alias "status"/u);

    writeFile(root, 'src/providers/a.ts', providerSource);
    utimesSync(providerA, originalTimes.atime, originalTimes.mtime);
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'providers/a/status' });

    writeFile(root, 'tsconfig.json', config('src/providers/b.ts'));
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'providers/b/status' });
  });

  it('falls back to the Program for divergent NodeNext import and require exports', () => {
    const root = projectRoot();
    installFrameworkServer(root);
    const providers = installConditionalQueryPackage(root);
    writeFile(root, 'tsconfig.json', nodeNextConfig());

    const importFile = join(root, 'src/components/import-card.mts');
    const importSource = componentQuerySource('@fixture/conditional-query');
    writeFile(root, 'src/components/import-card.mts', importSource);
    const beforeImport = completeQueryIdentityProgramConstructionsForTesting();
    expect(
      resolveComponentQueryRuntimeNames({
        fileName: importFile,
        rootDirectory: root,
        source: importSource,
      }),
    ).toEqual({ status: queryIdentityForFile(providers.importFile) });
    expect(completeQueryIdentityProgramConstructionsForTesting()).toBeGreaterThan(beforeImport);

    const requireFile = join(root, 'src/components/require-card.cts');
    const requireSource = componentQuerySource('@fixture/conditional-query');
    writeFile(root, 'src/components/require-card.cts', requireSource);
    const beforeRequire = completeQueryIdentityProgramConstructionsForTesting();
    expect(
      resolveComponentQueryRuntimeNames({
        fileName: requireFile,
        rootDirectory: root,
        source: requireSource,
      }),
    ).toEqual({ status: queryIdentityForFile(providers.requireFile) });
    expect(completeQueryIdentityProgramConstructionsForTesting()).toBeGreaterThan(beforeRequire);
  });

  it('freshly observes same-mtime nearest-package type flips for NodeNext TSX', () => {
    const root = projectRoot();
    installFrameworkServer(root);
    const providers = installConditionalQueryPackage(root);
    const packageFile = join(root, 'package.json');
    const sourceFile = join(root, 'src/components/status-card.tsx');
    const source = componentQuerySource('@fixture/conditional-query');
    writeFile(root, 'tsconfig.json', nodeNextConfig());
    writeFile(root, 'package.json', JSON.stringify({ type: 'module' }));
    writeFile(root, 'src/components/status-card.tsx', source);

    const beforeImport = completeQueryIdentityProgramConstructionsForTesting();
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: queryIdentityForFile(providers.importFile) });
    expect(completeQueryIdentityProgramConstructionsForTesting()).toBeGreaterThan(beforeImport);

    const originalTimes = statSync(packageFile);
    writeFile(root, 'package.json', JSON.stringify({ type: 'commonjs' }));
    utimesSync(packageFile, originalTimes.atime, originalTimes.mtime);
    const beforeRequire = completeQueryIdentityProgramConstructionsForTesting();
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: queryIdentityForFile(providers.requireFile) });
    expect(completeQueryIdentityProgramConstructionsForTesting()).toBeGreaterThan(beforeRequire);

    writeFile(root, 'package.json', JSON.stringify({ type: 'module' }));
    utimesSync(packageFile, originalTimes.atime, originalTimes.mtime);
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: queryIdentityForFile(providers.importFile) });
  });

  it('uses the Program for a mode-sensitive extensionless relative import', () => {
    const root = projectRoot();
    installFrameworkServer(root);
    writeFile(root, 'tsconfig.json', nodeNextConfig());
    const sourceFile = join(root, 'src/components/status-card.cts');
    const source = componentQuerySource('../providers/status');
    writeFile(root, 'src/providers/status.ts', appQueryProviderSource());
    writeFile(root, 'src/components/status-card.cts', source);

    const before = completeQueryIdentityProgramConstructionsForTesting();
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'providers/status/status' });
    expect(completeQueryIdentityProgramConstructionsForTesting()).toBeGreaterThan(before);
  });

  it('keeps a corpus-style explicit relative import on the mode-invariant path', () => {
    const root = projectRoot();
    installFrameworkServer(root);
    writeFile(
      root,
      'package.json',
      JSON.stringify({ name: 'kovo-query-corpus-test', private: true, type: 'module' }),
    );
    writeFile(
      root,
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' } }),
    );
    const sourceFile = join(root, 'src/components/component-000.tsx');
    const source = [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { benchmarkRefreshQuery } from '../kovo.js';",
      'export const CorpusComponent000 = component({',
      '  queries: { refresh: benchmarkRefreshQuery },',
      '  render: ({ refresh }: { refresh: { label: string } }) => refresh.label,',
      '});',
      '',
    ].join('\n');
    writeFile(
      root,
      'src/kovo.ts',
      [
        "import { defineKovo, s } from '@kovojs/server';",
        'export const app = defineKovo({',
        "  appId: '00000000-0000-4000-8000-000000000001',",
        "  document: { lang: 'en-US' },",
        "  renderRoute(value) { return typeof value === 'string' ? value : String(value ?? ''); },",
        '});',
        'export const benchmarkRefreshQuery = app.query({',
        "  access: app.publicAccess('generated equal-shape refresh-surface query'),",
        "  load: () => ({ label: 'ready' }),",
        '  output: s.object({ label: s.string() }),',
        '});',
        '',
      ].join('\n'),
    );
    writeFile(root, 'src/components/component-000.tsx', source);

    const before = completeQueryIdentityProgramConstructionsForTesting();
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ refresh: 'kovo/benchmark-refresh-query' });
    expect(completeQueryIdentityProgramConstructionsForTesting()).toBe(before);
  });

  it('falls back safely for an in-root provider final symlink', () => {
    const root = projectRoot();
    installFrameworkServer(root);
    writeFile(
      root,
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' } }),
    );
    const sourceFile = join(root, 'src/components/status-card.tsx');
    const source = componentQuerySource('../providers/linked.js');
    const providerFile = join(root, 'src/providers/linked.ts');
    writeFile(root, 'src/providers/target.ts', appQueryProviderSource());
    mkdirSync(dirname(providerFile), { recursive: true });
    symlinkSync(join(root, 'src/providers/target.ts'), providerFile, 'file');
    writeFile(root, 'src/components/status-card.tsx', source);

    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'providers/linked/status' });
  });

  it('falls back safely for an out-of-root provider final symlink', () => {
    const root = projectRoot();
    const outside = projectRoot();
    installFrameworkServer(root);
    installFrameworkServer(outside);
    writeFile(
      root,
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' } }),
    );
    const sourceFile = join(root, 'src/components/status-card.tsx');
    const source = componentQuerySource('../providers/escaped.js');
    const providerFile = join(root, 'src/providers/escaped.ts');
    writeFile(outside, 'src/status.ts', appQueryProviderSource());
    mkdirSync(dirname(providerFile), { recursive: true });
    symlinkSync(join(outside, 'src/status.ts'), providerFile, 'file');
    writeFile(root, 'src/components/status-card.tsx', source);

    const before = completeQueryIdentityProgramConstructionsForTesting();
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'providers/escaped/status' });
    expect(completeQueryIdentityProgramConstructionsForTesting()).toBeGreaterThan(before);
  });

  it('falls back to the complete fresh Program across changed app-query barrels', () => {
    const root = projectRoot();
    installFrameworkServer(root);
    const sourceFile = join(root, 'src/components/status-card.tsx');
    const source = [
      "import { component } from '@kovojs/core';",
      "import { status } from '@provider';",
      'export const StatusCard = component({',
      '  queries: { status },',
      '  render: ({ status }) => <article>{status.summary}</article>,',
      '});',
      '',
    ].join('\n');
    const providerSource = [
      "import { defineKovo } from '@kovojs/server';",
      "export const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000001' });",
      'export const status = app.query({ load: () => ({ summary: "ready" }) });',
      '',
    ].join('\n');
    writeFile(root, 'src/providers/a.ts', providerSource);
    writeFile(root, 'src/providers/b.ts', providerSource);
    writeFile(root, 'src/provider.ts', "export { status } from './providers/a.js';\n");
    writeFile(root, 'src/components/status-card.tsx', source);
    writeFile(
      root,
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          paths: { '@provider': ['src/provider.ts'] },
        },
      }),
    );

    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'providers/a/status' });

    writeFile(root, 'src/provider.ts', "export { status } from './providers/b.js';\n");
    expect(
      resolveComponentQueryRuntimeNames({ fileName: sourceFile, rootDirectory: root, source }),
    ).toEqual({ status: 'providers/b/status' });
  });
});

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kovo-query-identity-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  return root;
}

function writeFile(root: string, fileName: string, source: string): void {
  const target = join(root, fileName);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function installFrameworkServer(root: string): void {
  const scope = join(root, 'node_modules/@kovojs');
  mkdirSync(scope, { recursive: true });
  symlinkSync(frameworkServerPackageRoot, join(scope, 'server'), 'dir');
}

function appQueryProviderSource(): string {
  return [
    "import { defineKovo } from '@kovojs/server';",
    "export const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000001' });",
    'export const status = app.query({ load: () => ({ summary: "ready" }) });',
    '',
  ].join('\n');
}

function componentQuerySource(moduleSpecifier: string): string {
  return [
    "import { component } from '@kovojs/core';",
    `import { status } from '${moduleSpecifier}';`,
    'export const StatusCard = component({',
    '  queries: { status },',
    '  render: ({ status }: { status: { summary: string } }) => status.summary,',
    '});',
    '',
  ].join('\n');
}

function installConditionalQueryPackage(root: string): {
  importFile: string;
  requireFile: string;
} {
  const packageRoot = join(root, 'node_modules/@fixture/conditional-query');
  const importFile = join(packageRoot, 'import-provider.mts');
  const requireFile = join(packageRoot, 'require-provider.cts');
  writeFile(
    root,
    'node_modules/@fixture/conditional-query/package.json',
    JSON.stringify({
      exports: { '.': { import: './import-provider.mts', require: './require-provider.cts' } },
      name: '@fixture/conditional-query',
      type: 'module',
      version: '1.0.0',
    }),
  );
  writeFile(
    root,
    'node_modules/@fixture/conditional-query/import-provider.mts',
    appQueryProviderSource(),
  );
  writeFile(
    root,
    'node_modules/@fixture/conditional-query/require-provider.cts',
    appQueryProviderSource(),
  );
  return { importFile, requireFile };
}

function nodeNextConfig(): string {
  return JSON.stringify({
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
  });
}

function queryIdentityForFile(fileName: string): string {
  return deriveRegistryIdentity(realpathSync(fileName), 'status').key;
}
