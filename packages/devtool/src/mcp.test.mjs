import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createMcpServer } from './mcp.mjs';
import { createRuntimeFrameStore } from './runtime-frames.mjs';

function bundle() {
  return {
    app: 'demo',
    blurb: 'MCP fixture',
    counts: { query: 1 },
    edges: [],
    label: 'Demo',
    nodes: [
      {
        data: { domains: [], guards: [] },
        id: 'query:orders',
        kind: 'query',
        label: 'Orders',
        name: 'orders',
        source: null,
      },
    ],
  };
}

async function* chunks(...values) {
  yield* values;
}

function lifecycle(...requests) {
  return [
    {
      id: 'init',
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'devtool-test', version: '1' },
        protocolVersion: '2025-06-18',
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...requests,
  ];
}

describe('devtool finite MCP transport', () => {
  it('serves list/call and returns invalid tool arguments as isError', async () => {
    const runtimeFrames = createRuntimeFrameStore();
    const runtimeFrame = runtimeFrames.recordRoundTrip({
      app: 'demo',
      phase: 'settled',
      queries: [
        {
          bytes: 25,
          delta: false,
          keyed: false,
          name: 'orders',
          raw: '{"secret":"never-in-mcp"}',
          settlesPendingWork: false,
          value: 'redacted',
        },
      ],
      status: 200,
      url: '/_m/orders%2Frefresh',
    });
    const messages = lifecycle(
      { id: 'list', jsonrpc: '2.0', method: 'tools/list' },
      {
        id: 'call',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { app: 'demo', limit: 1, query: 'orders' }, name: 'kovo_explain' },
      },
      {
        id: 'invalid',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { limit: 21, query: 'orders' }, name: 'kovo_explain' },
      },
      {
        id: 'frames',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: { app: 'demo', limit: 1 },
          name: 'kovo_graph_recent_frames',
        },
      },
    );
    let stdout = '';
    let stderr = '';
    await createMcpServer({ bundles: [bundle()], runtimeFrames }).serveStdio(
      chunks(`${messages.map((message) => JSON.stringify(message)).join('\n')}\n`),
      { write: (chunk) => (stdout += chunk) },
      { write: (chunk) => (stderr += chunk) },
    );
    const responses = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(stderr).toBe('kovo-dataflow MCP server ready (apps: demo)\n');
    expect(responses).toHaveLength(5);
    expect(responses[1]).toMatchObject({
      id: 'list',
      result: {
        tools: [
          expect.objectContaining({ name: 'kovo_explain' }),
          expect.objectContaining({ name: 'kovo_graph_recent_frames' }),
        ],
      },
    });
    expect(responses[2]).toMatchObject({
      id: 'call',
      result: {
        structuredContent: {
          app: 'demo',
          count: 1,
          results: [expect.objectContaining({ id: 'query:orders' })],
        },
      },
    });
    expect(responses[3]).toMatchObject({
      id: 'invalid',
      result: {
        content: [{ text: 'kovo_explain limit must be an integer from 1 to 20', type: 'text' }],
        isError: true,
      },
    });
    expect(responses[4]).toMatchObject({
      id: 'frames',
      result: {
        structuredContent: {
          app: 'demo',
          count: 1,
          frames: [runtimeFrame],
          schema: 'kovo-devtool-runtime-frames/v1',
        },
      },
    });
    expect(JSON.stringify(responses[4])).not.toContain('never-in-mcp');
  });

  it('serves and exits cleanly through the spawned devtool binary', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-devtool-mcp-'));
    try {
      const graphPath = join(root, 'graph.json');
      writeFileSync(graphPath, '{}\n');
      const input = lifecycle({ id: 'ping', jsonrpc: '2.0', method: 'ping' })
        .map((message) => JSON.stringify(message))
        .join('\n');
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('../bin/kovo-devtool.mjs', import.meta.url)),
          'mcp',
          '--graph',
          graphPath,
          '--src',
          root,
        ],
        { encoding: 'utf8', input: `${input}\n`, timeout: 15_000 },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain('kovo-dataflow MCP server ready');
      expect(
        result.stdout
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      ).toEqual([
        expect.objectContaining({ id: 'init' }),
        { id: 'ping', jsonrpc: '2.0', result: {} },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('clamps the default recent-frame request to a smaller shared store', () => {
    const runtimeFrames = createRuntimeFrameStore({ limit: 2 });
    const mcp = createMcpServer({ bundles: [bundle()], runtimeFrames });

    expect(mcp.recentFrames({})).toEqual({
      app: 'demo',
      count: 0,
      frames: [],
      schema: 'kovo-devtool-runtime-frames/v1',
    });
  });
});
