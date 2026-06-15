import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  compileComponentV1,
  handleFwMcpRequest,
  runMcpFallbackStdio,
  runMcpSdkServer,
} from './index.js';

class MemoryMcpTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  readonly sent: JSONRPCMessage[] = [];
  started = false;

  async close(): Promise<void> {
    this.onclose?.();
  }

  receive(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.sent.push(message);
  }

  async start(): Promise<void> {
    this.started = true;
  }
}

async function waitForMcpMessage(
  transport: MemoryMcpTransport,
  predicate: (message: JSONRPCMessage) => boolean,
): Promise<JSONRPCMessage> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const message = transport.sent.find(predicate);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`MCP message was not sent. Sent: ${JSON.stringify(transport.sent)}`);
}

async function* mcpInputChunks(...chunks: string[]): AsyncIterable<string> {
  yield* chunks;
}

function writePackageManifest(
  root: string,
  packageName: string,
  manifest: Record<string, unknown>,
): void {
  const dir = join(root, 'node_modules', ...packageName.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
}

describe('compile/v1 and fw mcp', () => {
  it('returns a snapshot-stable compile/v1 contract for in-memory component source', async () => {
    await expect(
      compileComponentV1({
        fileName: 'cart-badge.tsx',
        source: '<button>x</button>',
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "componentGraphFacts": [
          {
            "name": "CartBadge",
          },
        ],
        "diagnostics": [],
        "emittedFiles": [
          {
            "byteLength": 78,
            "fileName": "cart-badge.server.js",
            "kind": "server",
          },
          {
            "byteLength": 42,
            "fileName": "cart-badge.client.js",
            "kind": "client",
          },
          {
            "byteLength": 652,
            "fileName": "generated/registries.d.ts",
            "kind": "registry",
          },
        ],
        "handlerExports": [],
        "ok": true,
        "platformSubstitutions": [],
        "queryUpdatePlans": [],
        "renderEquivalenceChecks": [],
        "updateCoverage": [],
        "version": "compile/v1",
        "viewTransitions": [],
      }
    `);
  });

  it('proves the in-memory repair loop with shared FW201 diagnostics', async () => {
    const adversarial = await compileComponentV1({
      fileName: 'cart-badge.tsx',
      source: '<button onClick={() => window.alert("x")}>x</button>',
    });

    expect(adversarial.ok).toBe(false);
    expect(adversarial.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'FW210',
      'FW201',
    ]);
    const fw201 = adversarial.diagnostics.find((diagnostic) => diagnostic.code === 'FW201');
    expect(fw201).toMatchObject({
      code: 'FW201',
      fileName: 'cart-badge.tsx',
      message: 'Closure captures unserializable value.',
      severity: 'error',
      start: { column: 9, line: 1 },
    });
    expect(fw201?.help).toContain(
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
    );

    const corrected = await compileComponentV1({
      fileName: 'cart-badge.tsx',
      source: '<button>x</button>',
    });

    expect(corrected.ok).toBe(true);
    expect(corrected.diagnostics).toEqual([]);
  });

  it('feeds discovered package prefix facts through compile/v1', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jiso-cli-prefix-'));

    try {
      writePackageManifest(root, '@acme/primitives', {
        jiso: { prefix: 'acme-' },
        name: '@acme/primitives',
      });
      writePackageManifest(root, '@other/widgets', {
        jiso: { prefix: 'acme-' },
        name: '@other/widgets',
      });

      await expect(
        compileComponentV1({
          fileName: 'src/shell.tsx',
          packagePrefixDiscoveryRoot: root,
          source: `
import { component } from '@jiso/core';
import '@acme/primitives';
import '@other/widgets';

export const Shell = component('shell', {
  render: () => <section></section>,
});
`,
        }),
      ).resolves.toMatchObject({
        diagnostics: [
          {
            code: 'FW234',
            fileName: 'src/shell.tsx',
            message:
              'Package component prefix registration conflict or reservation violation. Effective package prefix "acme-" is claimed by @acme/primitives and @other/widgets.',
            severity: 'error',
          },
        ],
        ok: false,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('exposes MCP-style tool listing and structured compile results over JSON-RPC objects', async () => {
    await expect(handleFwMcpRequest({ id: 1, jsonrpc: '2.0', method: 'tools/list' })).resolves
      .toMatchInlineSnapshot(`
      {
        "id": 1,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "fw-mcp/v1",
              "type": "text",
            },
          ],
          "structuredContent": {
            "tools": [
              {
                "description": "Compile an in-memory TSX/JSX component module and return the stable compile/v1 contract.",
                "inputSchema": {
                  "additionalProperties": true,
                  "properties": {
                    "fileName": {
                      "type": "string",
                    },
                    "packageComponentPrefixes": {
                      "type": "array",
                    },
                    "packagePrefixDiscoveryRoot": {
                      "type": "string",
                    },
                    "queryShapeFacts": {
                      "type": "array",
                    },
                    "queryShapes": {
                      "type": "object",
                    },
                    "registryFacts": {
                      "type": "object",
                    },
                    "source": {
                      "type": "string",
                    },
                    "sourceProvenance": {
                      "enum": [
                        "app",
                        "compiler-emitted",
                      ],
                    },
                  },
                  "required": [
                    "fileName",
                    "source",
                  ],
                  "type": "object",
                },
                "name": "compile_component",
              },
              {
                "description": "Run fwCheck against an inline graph or graphPath.",
                "inputSchema": {
                  "additionalProperties": false,
                  "properties": {
                    "family": {
                      "enum": [
                        "all",
                        "coverage",
                        "optimistic",
                      ],
                    },
                    "graph": {
                      "type": "object",
                    },
                    "graphPath": {
                      "type": "string",
                    },
                  },
                  "required": [],
                  "type": "object",
                },
                "name": "fw_check",
              },
              {
                "description": "Run fwExplain against an inline graph or graphPath.",
                "inputSchema": {
                  "additionalProperties": false,
                  "properties": {
                    "graph": {
                      "type": "object",
                    },
                    "graphPath": {
                      "type": "string",
                    },
                    "options": {
                      "type": "object",
                    },
                  },
                  "required": [
                    "options",
                  ],
                  "type": "object",
                },
                "name": "fw_explain",
              },
              {
                "description": "List shared diagnostic definitions from the @jiso/core registry.",
                "inputSchema": {
                  "additionalProperties": false,
                  "properties": {},
                  "type": "object",
                },
                "name": "list_diagnostics",
              },
            ],
            "version": "fw-mcp/v1",
          },
          "version": "fw-mcp/v1",
        },
      }
    `);

    const response = await handleFwMcpRequest({
      id: 'compile-1',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: {
          fileName: 'cart-badge.tsx',
          source: '<button onClick={() => window.alert("x")}>x</button>',
        },
        name: 'compile_component',
      },
    });

    expect(response).toMatchObject({
      id: 'compile-1',
      jsonrpc: '2.0',
      result: {
        structuredContent: {
          diagnostics: [
            { code: 'FW210', severity: 'lint' },
            { code: 'FW201', severity: 'error' },
          ],
          ok: false,
          version: 'compile/v1',
        },
        version: 'fw-mcp/v1',
      },
    });
  });

  it('wraps fw_check, fw_explain, and diagnostic definitions without a second policy', async () => {
    await expect(
      handleFwMcpRequest({
        id: 'check-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { graph: {} }, name: 'fw_check' },
      }),
    ).resolves.toMatchObject({
      result: {
        structuredContent: {
          exitCode: 0,
          output: 'fw-check/v1\nOK\n',
          version: 'fw-check/v1',
        },
      },
    });

    await expect(
      handleFwMcpRequest({
        id: 'explain-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            graph: { queries: [{ domains: ['cart'], query: 'cart' }] },
            options: { kind: 'query', target: 'cart' },
          },
          name: 'fw_explain',
        },
      }),
    ).resolves.toMatchObject({
      result: {
        structuredContent: {
          exitCode: 0,
          output:
            'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: -\ninvalidated-by: -\ndomain-writes: -\n',
          version: 'fw-explain/v1',
        },
      },
    });

    const diagnostics = await handleFwMcpRequest({
      id: 'definitions-1',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: {}, name: 'list_diagnostics' },
    });
    expect(diagnostics).toMatchObject({
      result: {
        structuredContent: {
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: 'FW201',
              message: 'Closure captures unserializable value.',
              severity: 'error',
            }),
          ]),
          version: 'diagnostics/v1',
        },
      },
    });
  });

  it('preserves the newline-delimited JSON-RPC fallback stdio seam', async () => {
    const chunks: string[] = [];
    await runMcpFallbackStdio(
      mcpInputChunks(
        `${JSON.stringify({
          id: 'list-fallback',
          jsonrpc: '2.0',
          method: 'tools/list',
        })}\n`,
      ),
      { write: (chunk) => chunks.push(chunk) },
    );

    expect(JSON.parse(chunks.join(''))).toMatchObject({
      id: 'list-fallback',
      jsonrpc: '2.0',
      result: {
        structuredContent: {
          tools: expect.arrayContaining([expect.objectContaining({ name: 'compile_component' })]),
          version: 'fw-mcp/v1',
        },
        version: 'fw-mcp/v1',
      },
    });
  });

  it('serves initialize, tool listing, and tool calls through the SDK MCP lifecycle', async () => {
    const transport = new MemoryMcpTransport();
    await runMcpSdkServer(transport);

    expect(transport.started).toBe(true);

    transport.receive({
      id: 'init-1',
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'fw-test-client', version: '0.0.0' },
        protocolVersion: '2025-06-18',
      },
    });

    const initialize = await waitForMcpMessage(
      transport,
      (message) => 'id' in message && message.id === 'init-1',
    );
    expect(initialize).toMatchObject({
      id: 'init-1',
      jsonrpc: '2.0',
      result: {
        capabilities: { tools: {} },
        serverInfo: { name: 'fw', version: 'fw-mcp/v1' },
      },
    });

    transport.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
    transport.receive({ id: 'list-1', jsonrpc: '2.0', method: 'tools/list', params: {} });

    const list = await waitForMcpMessage(
      transport,
      (message) => 'id' in message && message.id === 'list-1',
    );
    expect(list).toMatchObject({
      id: 'list-1',
      jsonrpc: '2.0',
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({
            inputSchema: expect.objectContaining({ type: 'object' }),
            name: 'compile_component',
          }),
        ]),
      },
    });

    transport.receive({
      id: 'compile-1',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: {
          fileName: 'cart-badge.tsx',
          source: '<button onClick={() => window.alert("x")}>x</button>',
        },
        name: 'compile_component',
      },
    });

    const compile = await waitForMcpMessage(
      transport,
      (message) => 'id' in message && message.id === 'compile-1',
    );
    expect(compile).toMatchObject({
      id: 'compile-1',
      jsonrpc: '2.0',
      result: {
        content: [{ type: 'text' }],
        structuredContent: {
          diagnostics: [
            { code: 'FW210', severity: 'lint' },
            { code: 'FW201', severity: 'error' },
          ],
          ok: false,
          version: 'compile/v1',
        },
      },
    });
  });
});
