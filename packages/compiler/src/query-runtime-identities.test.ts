import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveComponentQueryRuntimeNames } from './scan/query-runtime-identities.js';

const roots: string[] = [];

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
