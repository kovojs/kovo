import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAgentDocsSnapshot } from '../../../scripts/agent-docs-snapshot.mjs';
import {
  decodeInstalledAgentDocsSnapshot,
  type InstalledAgentDocsSnapshot,
} from './docs-snapshot.js';
import { installAgentDocsSnapshot, searchInstalledAgentDocs } from './docs-store.js';
import { createKovoMcpServer } from './index.js';

const CLI_VERSION = '0.3.0';
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const roots: string[] = [];
const snapshotState = vi.hoisted(() => ({ snapshot: undefined as unknown }));

vi.mock('./docs-snapshot.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./docs-snapshot.js')>();
  return {
    ...actual,
    readInstalledAgentDocsSnapshot({ expectedVersion }: { expectedVersion: string }) {
      const snapshot = snapshotState.snapshot as InstalledAgentDocsSnapshot | undefined;
      if (snapshot === undefined) throw new Error('test snapshot was not configured');
      if (snapshot.version !== expectedVersion) throw new Error('test snapshot version mismatch');
      return snapshot;
    },
  };
});

afterEach(() => {
  snapshotState.snapshot = undefined;
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('kovo_docs finite MCP projection', () => {
  it('advertises one exact bounded argument grammar', async () => {
    const root = fixtureRoot();
    const server = await readyServer(root);

    const response = await server.handleMessage({
      id: 'list',
      jsonrpc: '2.0',
      method: 'tools/list',
    });
    const tools = (response as { result: { tools: Array<Record<string, unknown>> } }).result.tools;
    const docs = tools.find((tool) => tool.name === 'kovo_docs');

    expect(docs).toEqual({
      description: 'Search the exact version-matched local Kovo docs snapshot.',
      inputSchema: {
        additionalProperties: false,
        properties: {
          limit: { maximum: 8, minimum: 1, type: 'integer' },
          task: { maxLength: 256, minLength: 1, type: 'string' },
        },
        required: ['task'],
        type: 'object',
      },
      name: 'kovo_docs',
    });
  });

  it('returns the same authenticated bounded records as the shared local search', async () => {
    const root = fixtureRoot();
    const snapshot = useFixtureSnapshot(root);
    await installAgentDocsSnapshot({ cwd: root, snapshot });
    const expected = await searchInstalledAgentDocs({
      cwd: root,
      expectedSnapshot: snapshot,
      limit: 2,
      task: 'quickstart route',
    });

    const response = await callDocs(root, { limit: 2, task: 'quickstart route' });

    expect(response).toMatchObject({
      id: 'call',
      jsonrpc: '2.0',
      result: {
        content: [{ text: 'kovo-docs/v1', type: 'text' }],
        structuredContent: {
          results: expected,
          version: 'kovo-docs/v1',
        },
      },
    });
  });

  it('fails closed for missing local docs and non-extensible or oversized requests', async () => {
    const root = fixtureRoot();
    useFixtureSnapshot(root);

    expectToolError(
      await callDocs(root, { task: 'quickstart' }),
      'no installed Kovo docs snapshot; run `kovo update-docs`',
    );
    expectToolError(
      await callDocs(root, { task: 'quickstart', typo: true }),
      'kovo_docs arguments contain unsupported field typo',
    );
    expectToolError(
      await callDocs(root, { limit: 9, task: 'quickstart' }),
      'kovo_docs limit must be an integer from 1 through 8',
    );
    expectToolError(
      await callDocs(root, { task: 'x'.repeat(257) }),
      'kovo_docs task must be 1..256 UTF-8 bytes',
    );
  });
});

async function callDocs(
  root: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const server = await readyServer(root);
  return (await server.handleMessage({
    id: 'call',
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { arguments: args, name: 'kovo_docs' },
  })) as Record<string, unknown>;
}

async function readyServer(root: string) {
  const server = createKovoMcpServer(root);
  await server.handleMessage({
    id: 'initialize',
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      capabilities: {},
      clientInfo: { name: 'docs-test', version: '1' },
      protocolVersion: '2025-11-25',
    },
  });
  await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return server;
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

function useFixtureSnapshot(root: string): InstalledAgentDocsSnapshot {
  const snapshot = decodeInstalledAgentDocsSnapshot(
    buildAgentDocsSnapshot({
      root,
      sourceCommit: SOURCE_COMMIT,
      version: CLI_VERSION,
    }).compressed,
    { expectedVersion: CLI_VERSION },
  );
  snapshotState.snapshot = snapshot;
  return snapshot;
}

function fixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-mcp-docs-'));
  roots.push(root);
  write(root, 'SPEC.md', '# Kovo fixture spec\n');
  write(root, 'spec/01-overview.md', '# Overview\n');
  write(
    root,
    'site/content/guides/quickstart.md',
    '# Quickstart\n\nBuild the first page with a route.\n',
  );
  write(root, 'site/gen/api/core.md', '# Core API\n\nUse `route()`.\n');
  write(
    root,
    'public-packages.json',
    `${JSON.stringify({
      packages: [
        {
          apiBoundary: { generated: [], internal: [], public: ['.'] },
          dir: 'core',
          kind: 'library',
          name: '@kovojs/core',
          visibility: 'public',
        },
      ],
    })}\n`,
  );
  write(
    root,
    'packages/core/package.json',
    `${JSON.stringify({
      exports: { '.': './src/index.ts' },
      name: '@kovojs/core',
      version: CLI_VERSION,
    })}\n`,
  );
  write(
    root,
    'packages/cli/package.json',
    `${JSON.stringify({ name: '@kovojs/cli', version: CLI_VERSION })}\n`,
  );
  return root;
}

function write(root: string, relativePath: string, source: string): void {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}
