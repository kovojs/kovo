import { describe, expect, it } from 'vitest';

import {
  assertPackedCliDependencyClosure,
  assertPackedMcpLifecycle,
  productionDependencyNamesFromLockfile,
} from './check-packed-cli-consumer.mjs';

function lockfile(...packages) {
  return `lockfileVersion: '9.0'

snapshots:
${packages.map((name) => `  '${name}@1.0.0': {}`).join('\n')}
`;
}

describe('packed CLI consumer proof', () => {
  it('reads the finite production graph and rejects every removed SDK subtree family', () => {
    expect(productionDependencyNamesFromLockfile(lockfile('@kovojs/cli', 'esbuild'))).toEqual([
      '@kovojs/cli',
      'esbuild',
    ]);
    expect(() =>
      assertPackedCliDependencyClosure(
        lockfile(
          '@modelcontextprotocol/sdk',
          '@hono/node-server',
          'hono',
          'express',
          'body-parser',
          'ajv',
          'fast-uri',
        ),
      ),
    ).toThrow(
      '@hono/node-server, @modelcontextprotocol/sdk, ajv, body-parser, express, fast-uri, hono',
    );
  });

  it('accepts only the exact finite packed MCP lifecycle and tool vocabulary', () => {
    const initialize = {
      id: 1,
      jsonrpc: '2.0',
      result: { protocolVersion: '2025-11-25' },
    };
    const list = {
      id: 2,
      jsonrpc: '2.0',
      result: {
        tools: [
          { name: 'list_diagnostics' },
          { name: 'kovo_explain' },
          { name: 'compile_component' },
          { name: 'kovo_check' },
        ],
      },
    };
    expect(() =>
      assertPackedMcpLifecycle(`${JSON.stringify(initialize)}\n${JSON.stringify(list)}\n`),
    ).not.toThrow();
    expect(() =>
      assertPackedMcpLifecycle(
        `${JSON.stringify(initialize)}\n${JSON.stringify({ ...list, result: { tools: [] } })}\n`,
      ),
    ).toThrow('tool vocabulary drifted');
  });
});
