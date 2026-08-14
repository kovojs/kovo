import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  componentQueryRuntimeIdentityPreimage,
  resolveComponentQueryRuntimeNames,
} from './scan/query-runtime-identities.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('compiler-owned query runtime identity project', () => {
  it('admits only exact direct-import query bindings and ignores only render implementation bytes', () => {
    const fileName = '/workspace/src/card.tsx';
    const source = (
      renderRevision: string,
      options: { importPath?: string; queryBinding?: string; queryDeclaration?: string } = {},
    ) =>
      [
        "import { component } from '@kovojs/core';",
        `import { statusQuery } from '${options.importPath ?? './status.js'}';`,
        options.queryDeclaration ?? "export const unrelatedLabel = 'revision-zero';",
        'export const Card = component({',
        `  queries: { status: ${options.queryBinding ?? 'statusQuery'} },`,
        `  render: ({ status }) => <article data-revision="${renderRevision}">{status.label}</article>,`,
        '});',
        '',
      ].join('\n');

    const baseline = componentQueryRuntimeIdentityPreimage({ fileName, source: source('zero') });
    expect(baseline).toBeDefined();
    expect(componentQueryRuntimeIdentityPreimage({ fileName, source: source('one') })).toBe(
      baseline,
    );
    expect(
      componentQueryRuntimeIdentityPreimage({
        fileName,
        source: source('zero', { importPath: './forged.js' }),
      }),
    ).not.toBe(baseline);
    expect(
      componentQueryRuntimeIdentityPreimage({
        fileName,
        source: source('zero', { queryDeclaration: "export const unrelatedLabel = 'changed';" }),
      }),
    ).not.toBe(baseline);
    expect(
      componentQueryRuntimeIdentityPreimage({
        fileName,
        source: source('zero', { queryBinding: 'otherQuery' }),
      }),
    ).toBeUndefined();

    const namespaceSource = source('zero')
      .replace(
        "import { statusQuery } from './status.js';",
        "import * as queries from './status.js';",
      )
      .replace('status: statusQuery', 'status: queries.statusQuery');
    expect(
      componentQueryRuntimeIdentityPreimage({ fileName, source: namespaceSource }),
    ).toBeUndefined();

    const dynamicBaseline = source('zero').replace(
      '<article data-revision="zero">',
      "<article data-revision={void import('./render-a.js')}>",
    );
    expect(
      componentQueryRuntimeIdentityPreimage({ fileName, source: dynamicBaseline }),
    ).toBeUndefined();

    const importTypeInRender = source('zero').replace(
      'render: ({ status }) => <article data-revision="zero">{status.label}</article>',
      [
        'render: ({ status }) => {',
        "    type RenderAugmentation = import('./render-augmentation.js').Value;",
        '    return <article data-revision={null as unknown as RenderAugmentation}>{status.label}</article>;',
        '  }',
      ].join('\n'),
    );
    expect(
      componentQueryRuntimeIdentityPreimage({ fileName, source: importTypeInRender }),
    ).toBeUndefined();

    const jsDocImportInRender = source('zero').replace(
      'render: ({ status }) => <article data-revision="zero">{status.label}</article>',
      [
        'render: ({ status }) => {',
        "    /** @type {import('./render-augmentation.js').Value} */",
        '    const revision = null;',
        '    return <article data-revision={revision}>{status.label}</article>;',
        '  }',
      ].join('\n'),
    );
    expect(
      componentQueryRuntimeIdentityPreimage({ fileName, source: jsDocImportInRender }),
    ).toBeUndefined();

    const nestedQuery = source('zero').replace(
      'render: ({ status }) => <article data-revision="zero">{status.label}</article>',
      [
        'render: ({ status }) => {',
        '    const Nested = component({',
        '      queries: { status: statusQuery },',
        '      render: () => <span>{status.label}</span>,',
        '    });',
        '    return <Nested />;',
        '  }',
      ].join('\n'),
    );
    expect(
      componentQueryRuntimeIdentityPreimage({ fileName, source: nestedQuery }),
    ).toBeUndefined();
    expect(
      componentQueryRuntimeIdentityPreimage({
        fileName,
        source: source('zero').replace('</article>', '</article'),
      }),
    ).toBeUndefined();
  });

  it('derives reuse preimages through boot-captured compiler intrinsics after prototype poisoning', () => {
    const fileName = '/workspace/src/status-card.tsx';
    const source = [
      "import { component } from '@kovojs/core';",
      "import { statusQuery } from './status.js';",
      'export const StatusCard = component({',
      '  queries: { status: statusQuery },',
      '  render: ({ status }) => <p>{status.label}</p>,',
      '});',
      '',
    ].join('\n');
    const expected = componentQueryRuntimeIdentityPreimage({ fileName, source });
    const descriptors = {
      arraySort: Object.getOwnPropertyDescriptor(Array.prototype, 'sort'),
      getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor(Object, 'getOwnPropertyDescriptor'),
      setAdd: Object.getOwnPropertyDescriptor(Set.prototype, 'add'),
      setHas: Object.getOwnPropertyDescriptor(Set.prototype, 'has'),
    };
    const defineProperty = Object.defineProperty;
    const deleteProperty = Reflect.deleteProperty;
    const poison = () => {
      throw new Error('late prototype poison ran');
    };
    let actual: string | undefined;
    try {
      defineProperty(Array.prototype, 'sort', { configurable: true, value: poison });
      defineProperty(Object, 'getOwnPropertyDescriptor', {
        configurable: true,
        value: poison,
      });
      defineProperty(Set.prototype, 'add', { configurable: true, value: poison });
      defineProperty(Set.prototype, 'has', { configurable: true, value: poison });

      actual = componentQueryRuntimeIdentityPreimage({ fileName, source });
    } finally {
      if (descriptors.arraySort === undefined) deleteProperty(Array.prototype, 'sort');
      else defineProperty(Array.prototype, 'sort', descriptors.arraySort);
      if (descriptors.getOwnPropertyDescriptor === undefined) {
        deleteProperty(Object, 'getOwnPropertyDescriptor');
      } else {
        defineProperty(Object, 'getOwnPropertyDescriptor', descriptors.getOwnPropertyDescriptor);
      }
      if (descriptors.setAdd === undefined) deleteProperty(Set.prototype, 'add');
      else defineProperty(Set.prototype, 'add', descriptors.setAdd);
      if (descriptors.setHas === undefined) deleteProperty(Set.prototype, 'has');
      else defineProperty(Set.prototype, 'has', descriptors.setHas);
    }
    expect(actual).toBe(expected);
  });

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
