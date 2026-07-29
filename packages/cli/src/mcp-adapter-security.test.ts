import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import * as cliInternal from './index.js';
import { createKovoMcpServer } from './index.js';

async function readyMcpServer(invocationCwd = process.cwd()) {
  const server = createKovoMcpServer(invocationCwd);
  await server.handleMessage({
    id: 'initialize',
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      capabilities: {},
      clientInfo: { name: 'adapter-security-test', version: '1' },
      protocolVersion: '2025-06-18',
    },
  });
  await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return server;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  invocationCwd = process.cwd(),
) {
  const server = await readyMcpServer(invocationCwd);
  return await server.handleMessage({
    id: 'call',
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { arguments: args, name },
  });
}

function expectToolError(response: unknown, message: string): void {
  expect(response).toMatchObject({
    id: 'call',
    jsonrpc: '2.0',
    result: {
      content: [{ text: message, type: 'text' }],
      isError: true,
    },
  });
}

describe('finite MCP adapter security boundary', () => {
  it('has one finite transport instead of exporting the legacy duplicate dispatcher', () => {
    expect(Object.hasOwn(cliInternal, 'handleKovoMcpRequest')).toBe(false);
  });

  it('advertises only inline graphs and workspace-confined compile inputs', async () => {
    const server = await readyMcpServer();
    const response = await server.handleMessage({
      id: 'list',
      jsonrpc: '2.0',
      method: 'tools/list',
    });
    const tools = (response as { result: { tools: Array<Record<string, unknown>> } }).result.tools;
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const compileSchema = byName.get('compile_component')?.inputSchema as {
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };
    const checkSchema = byName.get('kovo_check')?.inputSchema as {
      properties: Record<string, unknown>;
    };
    const explainSchema = byName.get('kovo_explain')?.inputSchema as {
      properties: Record<string, unknown>;
    };

    expect(compileSchema.additionalProperties).toBe(false);
    expect(Object.keys(compileSchema.properties).sort()).toEqual(['fileName', 'source']);
    expect(Object.hasOwn(compileSchema.properties, 'packagePrefixDiscoveryRoot')).toBe(false);
    expect(Object.hasOwn(checkSchema.properties, 'graphPath')).toBe(false);
    expect(Object.hasOwn(explainSchema.properties, 'graphPath')).toBe(false);
  });

  it('rejects every protocol-controlled graph path before filesystem access', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-mcp-graph-path-'));
    try {
      const graphPath = join(root, 'outside-graph.json');
      const hugePath = join(root, 'huge-graph.json');
      const fifoPath = join(root, 'graph.fifo');
      const symlinkPath = join(root, 'outside-graph-link.json');
      writeFileSync(graphPath, '{}\n', 'utf8');
      writeFileSync(hugePath, 'x'.repeat(5 * 1024 * 1024), 'utf8');
      execFileSync('mkfifo', [fifoPath]);
      symlinkSync(graphPath, symlinkPath);

      for (const forbiddenPath of [
        graphPath,
        symlinkPath,
        fifoPath,
        hugePath,
        join(root, 'missing.json'),
      ]) {
        expectToolError(
          await callTool('kovo_check', { graphPath: forbiddenPath }),
          'kovo_check arguments contain unsupported field graphPath',
        );
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects caller-selected discovery roots and compile fileName workspace escapes', async () => {
    expectToolError(
      await callTool('compile_component', {
        fileName: 'src/shell.tsx',
        packagePrefixDiscoveryRoot: '/tmp/outside',
        source: '<section />',
      }),
      'compile_component arguments contain unsupported field packagePrefixDiscoveryRoot',
    );

    for (const fileName of ['/tmp/outside.tsx', '../outside.tsx']) {
      expectToolError(
        await callTool('compile_component', { fileName, source: '<section />' }),
        'compile_component fileName must be a relative path confined to the MCP launch workspace',
      );
    }
  });

  it('pins manifest discovery to the canonical launch workspace across symlinks and cwd changes', async () => {
    const launchRoot = mkdtempSync(join(tmpdir(), 'kovo-mcp-launch-root-'));
    const laterRoot = mkdtempSync(join(tmpdir(), 'kovo-mcp-later-root-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'kovo-mcp-outside-root-'));
    const originalCwd = process.cwd();
    const sourceFor = (left: string, right: string) => `
import { component } from '@kovojs/core';
import '${left}';
import '${right}';
export const Shell = component({ render: () => <section></section> });
`;
    const writeConflictingPackages = (root: string, packageNames: readonly string[]) => {
      for (const packageName of packageNames) {
        const packageRoot = join(root, 'node_modules', ...packageName.split('/'));
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          `${JSON.stringify({ kovo: { prefix: 'acme-' }, name: packageName })}\n`,
          'utf8',
        );
      }
    };

    try {
      const launchPackages = ['@launch/primitives', '@launch/widgets'] as const;
      const outsidePackages = ['@outside/primitives', '@outside/widgets'] as const;
      writeConflictingPackages(launchRoot, launchPackages);
      writeConflictingPackages(outsideRoot, outsidePackages);
      symlinkSync(outsideRoot, join(launchRoot, 'outside-link'));

      const pinnedServer = await readyMcpServer(launchRoot);
      process.chdir(laterRoot);
      const pinnedResponse = await pinnedServer.handleMessage({
        id: 'call',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: { fileName: 'src/shell.tsx', source: sourceFor(...launchPackages) },
          name: 'compile_component',
        },
      });
      expect(pinnedResponse).toMatchObject({
        result: {
          structuredContent: {
            diagnostics: [expect.objectContaining({ code: 'KV234' })],
            ok: false,
          },
        },
      });

      const symlinkResponse = await callTool(
        'compile_component',
        {
          fileName: 'outside-link/src/shell.tsx',
          source: sourceFor(...outsidePackages),
        },
        launchRoot,
      );
      expect(symlinkResponse).toMatchObject({
        result: { structuredContent: { diagnostics: [], ok: true } },
      });
    } finally {
      process.chdir(originalCwd);
      rmSync(launchRoot, { force: true, recursive: true });
      rmSync(laterRoot, { force: true, recursive: true });
      rmSync(outsideRoot, { force: true, recursive: true });
    }
  });

  it('rejects launch-workspace replacement instead of re-canonicalizing new authority', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'kovo-mcp-root-replacement-'));
    const launchRoot = join(parent, 'workspace');
    const movedRoot = join(parent, 'moved-workspace');
    const replacementRoot = join(parent, 'replacement');
    try {
      mkdirSync(launchRoot);
      const packageRoot = join(replacementRoot, 'node_modules', '@outside', 'widgets');
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        `${JSON.stringify({ kovo: { prefix: 'outside-' }, name: '@outside/widgets' })}\n`,
        'utf8',
      );

      const server = await readyMcpServer(launchRoot);
      renameSync(launchRoot, movedRoot);
      symlinkSync(replacementRoot, launchRoot);
      expectToolError(
        await server.handleMessage({
          id: 'call',
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            arguments: {
              fileName: 'src/shell.tsx',
              source: `import '@outside/widgets';\n<section />`,
            },
            name: 'compile_component',
          },
        }),
        'Compiler package discovery root identity changed.',
      );
    } finally {
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('rejects outside, oversized, and FIFO package-manifest candidates', async () => {
    const launchRoot = mkdtempSync(join(tmpdir(), 'kovo-mcp-package-boundary-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'kovo-mcp-package-outside-'));
    const packageNames = [
      '@dir-link/one',
      '@dir-link/two',
      '@manifest-link/one',
      '@manifest-link/two',
      '@huge/one',
      '@huge/two',
      '@fifo/one',
      '@fifo/two',
    ] as const;
    const manifest = (name: string, prefix: string, padding = '') =>
      `${JSON.stringify({ kovo: { prefix }, name, padding })}\n`;

    try {
      for (const packageName of packageNames) {
        mkdirSync(join(launchRoot, 'node_modules', ...packageName.split('/'), '..'), {
          recursive: true,
        });
      }

      for (const packageName of ['@dir-link/one', '@dir-link/two'] as const) {
        const outsidePackage = join(outsideRoot, ...packageName.split('/'));
        mkdirSync(outsidePackage, { recursive: true });
        writeFileSync(join(outsidePackage, 'package.json'), manifest(packageName, 'dir-link-'));
        symlinkSync(outsidePackage, join(launchRoot, 'node_modules', ...packageName.split('/')));
      }

      for (const packageName of ['@manifest-link/one', '@manifest-link/two'] as const) {
        const packageRoot = join(launchRoot, 'node_modules', ...packageName.split('/'));
        const outsideManifest = join(outsideRoot, `${packageName.replaceAll('/', '-')}.json`);
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(outsideManifest, manifest(packageName, 'manifest-link-'));
        symlinkSync(outsideManifest, join(packageRoot, 'package.json'));
      }

      for (const packageName of ['@huge/one', '@huge/two'] as const) {
        const packageRoot = join(launchRoot, 'node_modules', ...packageName.split('/'));
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          manifest(packageName, 'huge-', 'x'.repeat(256 * 1024)),
        );
      }

      for (const packageName of ['@fifo/one', '@fifo/two'] as const) {
        const packageRoot = join(launchRoot, 'node_modules', ...packageName.split('/'));
        mkdirSync(packageRoot, { recursive: true });
        execFileSync('mkfifo', [join(packageRoot, 'package.json')]);
      }

      const source = `
import { component } from '@kovojs/core';
${packageNames.map((packageName) => `import '${packageName}';`).join('\n')}
export const Shell = component({ render: () => <section></section> });
`;
      const started = performance.now();
      const response = await callTool(
        'compile_component',
        { fileName: 'src/shell.tsx', source },
        launchRoot,
      );
      expect(performance.now() - started).toBeLessThan(2_000);
      expect(response).toMatchObject({
        result: { structuredContent: { diagnostics: [], ok: true } },
      });
    } finally {
      rmSync(launchRoot, { force: true, recursive: true });
      rmSync(outsideRoot, { force: true, recursive: true });
    }
  });

  it('enforces exact tool arguments rather than silently applying an advertised schema subset', async () => {
    const cases = [
      {
        args: { fileName: 'component.tsx', source: '<section />', typo: true },
        message: 'compile_component arguments contain unsupported field typo',
        name: 'compile_component',
      },
      {
        args: { graph: {}, typo: true },
        message: 'kovo_check arguments contain unsupported field typo',
        name: 'kovo_check',
      },
      {
        args: { graph: {}, options: { kind: 'query', target: 'cart' }, typo: true },
        message: 'kovo_explain arguments contain unsupported field typo',
        name: 'kovo_explain',
      },
      {
        args: { typo: true },
        message: 'list_diagnostics arguments contain unsupported field typo',
        name: 'list_diagnostics',
      },
    ];

    for (const testCase of cases) {
      expectToolError(await callTool(testCase.name, testCase.args), testCase.message);
    }

    for (const field of [
      'packageComponentPrefixes',
      'queryShapeFacts',
      'queryShapes',
      'registryFacts',
      'sourceProvenance',
    ]) {
      expectToolError(
        await callTool('compile_component', {
          [field]: field === 'sourceProvenance' ? 'app' : {},
          fileName: 'component.tsx',
          source: '<section />',
        }),
        `compile_component arguments contain unsupported field ${field}`,
      );
    }
  });

  it('rejects unknown or ambiguous nested explain options', async () => {
    expectToolError(
      await callTool('kovo_explain', {
        graph: {},
        options: { target: 'cart', typo: true, view: 'query' },
      }),
      'kovo_explain options contain unsupported field typo',
    );
    expectToolError(
      await callTool('kovo_explain', {
        graph: {},
        options: { endpoints: true, view: 'agent' },
      }),
      'kovo_explain options contain unsupported field endpoints',
    );
    expectToolError(
      await callTool('kovo_explain', {
        graph: {},
        options: { failOnFindings: true, optimistic: true, view: 'access' },
      }),
      'kovo_explain options contain unsupported field optimistic',
    );
  });

  it('admits the graph-work boundary and rejects max plus one before verification', async () => {
    const graphAtBoundary = {
      capabilityClosure: Array.from({ length: 255 }, () => null),
    };
    const boundary = await callTool('kovo_check', { family: 'coverage', graph: graphAtBoundary });
    expect(boundary).toMatchObject({
      result: {
        structuredContent: { version: 'kovo-check/v1' },
      },
    });
    expect((boundary as { result: { isError?: boolean } }).result.isError).not.toBe(true);

    const graphOverBoundary = {
      ...graphAtBoundary,
      capabilityClosure: [...graphAtBoundary.capabilityClosure, null],
    };
    expectToolError(
      await callTool('kovo_check', { family: 'coverage', graph: graphOverBoundary }),
      'MCP graph work exceeds 65536 aggregate comparison units',
    );
    expectToolError(
      await callTool('kovo_explain', {
        graph: graphOverBoundary,
        options: { view: 'endpoints' },
      }),
      'MCP graph work exceeds 65536 aggregate comparison units',
    );
  });

  it('rejects mutation-consumer and endpoint-runMutation amplification graphs', async () => {
    const mutationConsumerGraph = {
      components: Array.from({ length: 130 }, (_, index) => ({
        name: `component-${index}`,
        queries: ['shared'],
      })),
      mutations: [{ key: 'save', writes: ['cart'] }],
      queries: Array.from({ length: 130 }, () => ({ domains: ['cart'], query: 'shared' })),
    };
    expectToolError(
      await callTool('kovo_explain', {
        graph: mutationConsumerGraph,
        options: { target: 'save', view: 'mutation' },
      }),
      'MCP graph work exceeds 65536 aggregate comparison units',
    );

    const endpointRunMutationGraph = {
      endpoints: Array.from({ length: 130 }, (_, index) => ({
        name: `endpoint-${index}`,
        path: `/endpoint-${index}`,
        runMutations: ['save'],
      })),
      mutations: Array.from({ length: 130 }, (_, index) => ({ key: `mutation-${index}` })),
    };
    expectToolError(
      await callTool('kovo_explain', {
        graph: endpointRunMutationGraph,
        options: { view: 'endpoints' },
      }),
      'MCP graph work exceeds 65536 aggregate comparison units',
    );
  });

  it('bounds graph output rows, string width, and amplified response bytes before verification', async () => {
    expectToolError(
      await callTool('kovo_check', {
        graph: { queries: [{ domains: [], query: 'x'.repeat(4_097) }] },
      }),
      'MCP graph string exceeds 4096 bytes',
    );

    expectToolError(
      await callTool('kovo_check', {
        graph: {
          mutations: Array.from({ length: 50 }, (_, index) => ({ key: `m${index}` })),
          queries: Array.from({ length: 40 }, (_, index) => ({ domains: [], query: `q${index}` })),
        },
      }),
      'MCP graph output exceeds 2048 estimated rows',
    );

    expectToolError(
      await callTool('kovo_check', {
        family: 'coverage',
        graph: {
          mutations: Array.from({ length: 100 }, (_, index) => ({
            key: `${index}-${'x'.repeat(4_090)}`,
          })),
        },
      }),
      'MCP graph output exceeds 2097152 estimated bytes',
    );
  });

  it('bounds aggregate tool calls for one stdio session', async () => {
    const server = await readyMcpServer();
    for (let index = 0; index < 256; index += 1) {
      const response = await server.handleMessage({
        id: `call-${index}`,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: {}, name: 'list_diagnostics' },
      });
      expect((response as { result: { isError?: boolean } }).result.isError).not.toBe(true);
    }
    const overBoundary = await server.handleMessage({
      id: 'call',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: {}, name: 'list_diagnostics' },
    });
    expectToolError(overBoundary, 'MCP session exceeds 256 tool calls');
  });
});
