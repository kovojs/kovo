import { describe, expect, it } from 'vitest';

import {
  assertLiteralFirstServerBootstrap,
  assertPackedServerDeclarations,
  assertPackedServerManifest,
  packedDeclarationExports,
  packedServerConsumerManifest,
} from './check-packed-server-consumer.mjs';

const taskExports = [
  'AppTaskDeclaration',
  'DurableTaskObservedStatus',
  'DurableTaskStatusFilters',
  'DurableTaskStatusJob',
  'DurableTaskStatusRecord',
  'DurableTaskStatusSnapshotSource',
  'DurableTaskStatusSqlExecutor',
  'DurableTaskStatusSqlResult',
  'DurableTaskStatusSqlStatement',
  'DurableTaskStatusSurface',
  'TaskCronCatchUp',
  'TaskDefinition',
  'TaskFactory',
  'TaskHandle',
  'TaskInput',
  'TaskPrincipalReadScope',
  'TaskPrincipalScope',
  'TaskPrincipalWriteScope',
  'TaskRunContext',
  'TaskRunnableMutation',
  'TaskRunnableMutationInput',
  'TaskRunnableQuery',
  'TaskRunnableQueryInput',
  'TaskScheduleOptions',
  'TaskSchedulingRequest',
  'createDurableTaskStatus',
  'task',
];

function exportDeclaration(values, types = []) {
  const typeNames = new Set(types);
  return `export { ${values
    .map((name) => `${typeNames.has(name) ? 'type ' : ''}${name}`)
    .join(', ')} };`;
}

function serverManifest() {
  return {
    dependencies: { '@kovojs/core': '0.2.0' },
    exports: {
      '.': { default: './dist/index.mjs', types: './dist/index.d.mts' },
      './custom-adapters': {
        default: './dist/public-custom-adapters.mjs',
        types: './dist/public-custom-adapters.d.mts',
      },
      './node': {
        default: './dist/public-node.mjs',
        types: './dist/public-node.d.mts',
      },
      './runtime-bootstrap': {
        default: './dist/runtime-bootstrap.mjs',
        types: './dist/runtime-bootstrap.d.mts',
      },
      './tasks': {
        default: './dist/public-tasks.mjs',
        types: './dist/public-tasks.d.mts',
      },
    },
    name: '@kovojs/server',
    version: '0.2.0',
  };
}

describe('packed server consumer proof', () => {
  it('requires installable packed targets for root, task, Node, bootstrap, and custom adapters', () => {
    expect(() => assertPackedServerManifest(serverManifest())).not.toThrow();
    expect(() =>
      assertPackedServerManifest({
        ...serverManifest(),
        dependencies: { '@kovojs/core': 'workspace:*' },
      }),
    ).toThrow('not an installable version');
    expect(() =>
      assertPackedServerManifest({
        ...serverManifest(),
        exports: {
          ...serverManifest().exports,
          './tasks': './src/public-tasks.ts',
        },
      }),
    ).toThrow('reviewed runtime and declarations');
  });

  it('keeps the root bounded and the three semantic declaration families exact', () => {
    const requiredRoot = [
      'defineKovo',
      'mutation',
      'publicAccess',
      'query',
      'route',
      's',
      'safeRichHtml',
      'tag',
    ];
    const rootExports = [
      ...requiredRoot,
      ...Array.from({ length: 120 - requiredRoot.length }, (_, index) => `RootFixture${index}`),
    ];
    const declarations = {
      customAdapters: exportDeclaration(
        ['AppMutationAdapter', 'KovoApp', 'RequestHandler', 'createRequestHandler'],
        ['AppMutationAdapter', 'KovoApp', 'RequestHandler'],
      ),
      node: exportDeclaration(
        ['NodeHandlerOptions', 'NodeRequestHandler', 'toNodeHandler'],
        ['NodeHandlerOptions', 'NodeRequestHandler'],
      ),
      root: exportDeclaration(rootExports),
      tasks: exportDeclaration(
        taskExports,
        taskExports.filter((name) => name !== 'createDurableTaskStatus' && name !== 'task'),
      ),
    };

    expect(packedDeclarationExports(declarations.node)).toEqual([
      'NodeHandlerOptions',
      'NodeRequestHandler',
      'toNodeHandler',
    ]);
    expect(() => assertPackedServerDeclarations(declarations)).not.toThrow();
    expect(() =>
      assertPackedServerDeclarations({
        ...declarations,
        root: exportDeclaration([...rootExports.slice(0, -1), 'task']),
      }),
    ).toThrow('retains moved declarations');
    expect(() =>
      assertPackedServerDeclarations({
        ...declarations,
        customAdapters: exportDeclaration(['KovoApp', 'createRequestHandler']),
      }),
    ).toThrow('custom adapters declarations drifted');
  });

  it('requires the bootstrap as the exact first side-effect import', () => {
    expect(() =>
      assertLiteralFirstServerBootstrap(
        "import '@kovojs/server/runtime-bootstrap';\nimport '@kovojs/server/custom-adapters';\n",
      ),
    ).not.toThrow();
    expect(() =>
      assertLiteralFirstServerBootstrap(
        "import '@kovojs/server/custom-adapters';\nimport '@kovojs/server/runtime-bootstrap';\n",
      ),
    ).toThrow('must begin');
    expect(() =>
      assertLiteralFirstServerBootstrap(
        "import * as bootstrap from '@kovojs/server/runtime-bootstrap';\n",
      ),
    ).toThrow('must begin');
  });

  it('installs the server tarball and overrides first-party dependencies with packed tarballs', () => {
    const manifest = packedServerConsumerManifest(
      [
        { name: '@kovojs/core', tarball: '.release/tarballs/core.tgz' },
        {
          manifest: {
            peerDependencies: {
              '@kovojs/style': '0.2.0',
              better: '1.0.0',
              'drizzle-orm': '1.0.0-rc.4',
            },
            peerDependenciesMeta: { better: { optional: true } },
          },
          name: '@kovojs/server',
          tarball: '.release/tarballs/server.tgz',
        },
      ],
      'pnpm@10.12.1',
      '25.9.2',
    );
    expect(manifest).toMatchObject({
      dependencies: {
        '@kovojs/server': expect.stringMatching(/server\.tgz$/u),
        '@kovojs/style': '0.2.0',
        '@types/node': '25.9.2',
        'drizzle-orm': '1.0.0-rc.4',
      },
      packageManager: 'pnpm@10.12.1',
      pnpm: {
        overrides: {
          '@kovojs/core': expect.stringMatching(/core\.tgz$/u),
          '@kovojs/server': expect.stringMatching(/server\.tgz$/u),
        },
      },
      type: 'module',
    });
  });
});
