import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { compileComponentV1, runMcpStdioServer } from './index.js';

const browserAlertKv449Message =
  'Security-critical operation is outside the compiler-owned finite IR. semantic root=serialized-browser-handler:onClick@8; transfers=<direct>; sink=browser capability call window.alert is outside the finite handler IR; verdict=closed:opaque-transfer.';

async function* mcpInputChunks(...chunks: string[]): AsyncIterable<string> {
  yield* chunks;
}

async function finiteMcpRequest(
  request: Record<string, unknown>,
  invocationCwd = process.cwd(),
): Promise<Record<string, unknown>> {
  const messages = [
    {
      id: 'test-initialize',
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1' },
        protocolVersion: '2025-06-18',
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    request,
  ];
  const chunks: string[] = [];
  await runMcpStdioServer(
    mcpInputChunks(`${messages.map((message) => JSON.stringify(message)).join('\n')}\n`),
    { write: (chunk) => chunks.push(chunk) },
    invocationCwd,
  );
  const responses = chunks
    .join('')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return responses.at(-1)!;
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

describe('compile/v1 and kovo mcp', () => {
  it('returns a snapshot-stable compile/v1 contract for in-memory component source', async () => {
    await expect(
      compileComponentV1(
        {
          fileName: 'cart-badge.tsx',
          source: '<button>x</button>',
        },
        process.cwd(),
      ),
    ).resolves.toMatchInlineSnapshot(`
      {
        "componentGraphFacts": [
          {
            "domName": "cart-badge",
            "name": "cart-badge/cart-badge",
          },
        ],
        "diagnostics": [],
        "emittedFiles": [
          {
            "byteLength": 80,
            "fileName": "cart-badge.server.js",
            "kind": "server",
          },
          {
            "byteLength": 44,
            "fileName": "cart-badge.client.js",
            "kind": "client",
          },
          {
            "byteLength": 1214,
            "fileName": "generated/registries.d.ts",
            "kind": "registry",
          },
        ],
        "handlerExports": [],
        "ok": true,
        "platformSubstitutions": [],
        "queryUpdatePlans": [],
        "renderEquivalenceChecks": [
          {
            "artifact": "cart-badge.server.js",
            "ok": true,
          },
        ],
        "updateCoverage": [],
        "version": "compile/v1",
        "viewTransitions": [],
      }
    `);
  });

  it('proves the in-memory repair loop with shared KV201 diagnostics', async () => {
    const adversarial = await compileComponentV1(
      {
        fileName: 'cart-badge.tsx',
        source: '<button onClick={() => window.alert("x")}>x</button>',
      },
      process.cwd(),
    );

    expect(adversarial.ok).toBe(false);
    expect(adversarial.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'KV210',
      'KV201',
      'KV449',
    ]);
    const kv210 = adversarial.diagnostics.find((diagnostic) => diagnostic.code === 'KV210');
    expect(kv210).toMatchObject({
      category: 'build',
      code: 'KV210',
      help: diagnosticDefinitions.KV210.help,
      message: diagnosticDefinitions.KV210.message,
      severity: 'lint',
      source: { end: 13, file: 'cart-badge.tsx', start: 8 },
      version: 'kovo-diagnostic/v1',
    });
    const kv201 = adversarial.diagnostics.find((diagnostic) => diagnostic.code === 'KV201');
    expect(kv201).toMatchObject({
      category: 'build',
      code: 'KV201',
      message: 'Closure captures unserializable value.',
      severity: 'error',
      source: { end: 16, file: 'cart-badge.tsx', start: 8 },
      version: 'kovo-diagnostic/v1',
    });
    expect(kv201?.help).toContain(
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
    );
    const kv449 = adversarial.diagnostics.find((diagnostic) => diagnostic.code === 'KV449');
    expect(kv449).toMatchObject({
      category: 'build',
      code: 'KV449',
      help: diagnosticDefinitions.KV449.help,
      message: browserAlertKv449Message,
      severity: 'error',
      source: { end: 40, file: 'cart-badge.tsx', start: 23 },
      version: 'kovo-diagnostic/v1',
    });

    const corrected = await compileComponentV1(
      {
        fileName: 'cart-badge.tsx',
        source: '<button>x</button>',
      },
      process.cwd(),
    );

    expect(corrected.ok).toBe(true);
    expect(corrected.diagnostics).toEqual([]);
  });

  it('feeds discovered package prefix facts through compile/v1', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-cli-prefix-'));

    try {
      writePackageManifest(root, '@acme/primitives', {
        kovo: { prefix: 'acme-' },
        name: '@acme/primitives',
      });
      writePackageManifest(root, '@other/widgets', {
        kovo: { prefix: 'acme-' },
        name: '@other/widgets',
      });

      await expect(
        compileComponentV1(
          {
            fileName: 'src/shell.tsx',
            source: `
import { component } from '@kovojs/core';
import '@acme/primitives';
import '@other/widgets';

export const Shell = component({
  render: () => <section></section>,
});
`,
          },
          root,
        ),
      ).resolves.toMatchObject({
        diagnostics: [
          {
            category: 'build',
            code: 'KV234',
            message:
              'Package component prefix registration conflict or reservation violation. Effective package prefix "acme-" is claimed by @acme/primitives and @other/widgets.',
            severity: 'error',
            version: 'kovo-diagnostic/v1',
          },
        ],
        ok: false,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('exposes MCP-style tool listing and structured compile results over JSON-RPC objects', async () => {
    await expect(finiteMcpRequest({ id: 1, jsonrpc: '2.0', method: 'tools/list' })).resolves
      .toMatchInlineSnapshot(`
      {
        "id": 1,
        "jsonrpc": "2.0",
        "result": {
          "tools": [
            {
              "description": "Compile an in-memory TSX/JSX component module and return the stable compile/v1 contract.",
              "inputSchema": {
                "additionalProperties": false,
                "properties": {
                  "fileName": {
                    "maxLength": 4096,
                    "type": "string",
                  },
                  "source": {
                    "maxLength": 262144,
                    "type": "string",
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
              "description": "Run kovoCheck against a bounded inline graph.",
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
                },
                "required": [],
                "type": "object",
              },
              "name": "kovo_check",
            },
            {
              "description": "Search the exact version-matched local Kovo docs snapshot.",
              "inputSchema": {
                "additionalProperties": false,
                "properties": {
                  "limit": {
                    "maximum": 8,
                    "minimum": 1,
                    "type": "integer",
                  },
                  "task": {
                    "maxLength": 256,
                    "minLength": 1,
                    "type": "string",
                  },
                },
                "required": [
                  "task",
                ],
                "type": "object",
              },
              "name": "kovo_docs",
            },
            {
              "description": "Run kovoExplain against a bounded inline graph.",
              "inputSchema": {
                "additionalProperties": false,
                "properties": {
                  "graph": {
                    "type": "object",
                  },
                  "options": {
                    "oneOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "agent": {
                            "const": true,
                          },
                        },
                        "required": [
                          "agent",
                        ],
                        "type": "object",
                      },
                      {
                        "additionalProperties": false,
                        "properties": {
                          "access": {
                            "const": true,
                          },
                          "failOnFindings": {
                            "type": "boolean",
                          },
                        },
                        "required": [
                          "access",
                        ],
                        "type": "object",
                      },
                      {
                        "additionalProperties": false,
                        "properties": {
                          "endpoints": {
                            "const": true,
                          },
                        },
                        "required": [
                          "endpoints",
                        ],
                        "type": "object",
                      },
                      {
                        "additionalProperties": false,
                        "properties": {
                          "failOnFindings": {
                            "type": "boolean",
                          },
                          "unguarded": {
                            "const": true,
                          },
                        },
                        "required": [
                          "unguarded",
                        ],
                        "type": "object",
                      },
                      {
                        "additionalProperties": false,
                        "properties": {
                          "failOnFindings": {
                            "type": "boolean",
                          },
                          "unscoped": {
                            "const": true,
                          },
                        },
                        "required": [
                          "unscoped",
                        ],
                        "type": "object",
                      },
                      {
                        "additionalProperties": false,
                        "properties": {
                          "kind": {
                            "enum": [
                              "component",
                              "context",
                              "mutation",
                              "page",
                              "query",
                              "task",
                            ],
                          },
                          "optimistic": {
                            "type": "boolean",
                          },
                          "target": {
                            "minLength": 1,
                            "type": "string",
                          },
                        },
                        "required": [
                          "kind",
                          "target",
                        ],
                        "type": "object",
                      },
                    ],
                    "type": "object",
                  },
                },
                "required": [
                  "options",
                ],
                "type": "object",
              },
              "name": "kovo_explain",
            },
            {
              "description": "List shared diagnostic definitions from the @kovojs/core registry.",
              "inputSchema": {
                "additionalProperties": false,
                "properties": {},
                "type": "object",
              },
              "name": "list_diagnostics",
            },
          ],
        },
      }
    `);

    const response = await finiteMcpRequest({
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
            {
              category: 'build',
              code: 'KV210',
              help: diagnosticDefinitions.KV210.help,
              severity: 'lint',
              source: { end: 13, file: 'cart-badge.tsx', start: 8 },
              version: 'kovo-diagnostic/v1',
            },
            {
              category: 'build',
              code: 'KV201',
              help: expect.stringContaining(
                'SPEC §4.3 and §5.2 require handler lowering to cross only explicit serializable capture channels.',
              ),
              severity: 'error',
              source: { end: 16, file: 'cart-badge.tsx', start: 8 },
              version: 'kovo-diagnostic/v1',
            },
            {
              category: 'build',
              code: 'KV449',
              help: diagnosticDefinitions.KV449.help,
              message: browserAlertKv449Message,
              severity: 'error',
              source: { end: 40, file: 'cart-badge.tsx', start: 23 },
              version: 'kovo-diagnostic/v1',
            },
          ],
          ok: false,
          version: 'compile/v1',
        },
      },
    });
  });

  it('does not let MCP callers spoof compiler-emitted source provenance', async () => {
    const response = await finiteMcpRequest({
      id: 'compile-spoof',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: {
          fileName: 'cart-badge.client.js',
          source: [
            "import { handler } from '@kovojs/browser/generated';",
            'export const CartBadge$button_click = handler(() => null);',
            '',
          ].join('\n'),
          sourceProvenance: 'compiler-emitted',
        },
        name: 'compile_component',
      },
    });

    expect(response).toMatchObject({
      result: {
        content: [
          {
            text: 'compile_component arguments contain unsupported field sourceProvenance',
            type: 'text',
          },
        ],
        isError: true,
      },
    });
  });

  it('wraps kovo_check, kovo_explain, and diagnostic definitions without a second policy', async () => {
    await expect(
      finiteMcpRequest({
        id: 'check-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { graph: {} }, name: 'kovo_check' },
      }),
    ).resolves.toMatchObject({
      result: {
        structuredContent: {
          diagnostics: [],
          exitCode: 0,
          output: 'kovo-check/v1\nOK\n',
          version: 'kovo-check/v1',
        },
      },
    });

    const missingAccess = await finiteMcpRequest({
      id: 'check-diagnostic-1',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: {
          graph: {
            access: [
              {
                decision: 'missing',
                detail: 'missing access fact',
                kind: 'query',
                name: 'contacts',
                source: 'access',
                sourceAnchor: { end: 999, file: '../../forged.ts', start: 0 },
              },
            ],
          },
        },
        name: 'kovo_check',
      },
    });
    expect(missingAccess).toMatchObject({
      result: {
        structuredContent: {
          diagnostics: [
            {
              category: 'proof',
              code: 'KV436',
              help: expect.any(String),
              message: 'Missing explicit access decision. QUERY contacts missing access fact',
              severity: 'error',
              version: 'kovo-diagnostic/v1',
            },
          ],
          exitCode: 1,
          version: 'kovo-check/v1',
        },
      },
    });
    expect(
      (
        missingAccess.result as {
          structuredContent: { diagnostics: readonly Record<string, unknown>[] };
        }
      ).structuredContent.diagnostics[0],
    ).not.toHaveProperty('source');

    await expect(
      finiteMcpRequest({
        id: 'explain-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            graph: { queries: [{ domains: ['cart'], query: 'cart' }] },
            options: { kind: 'query', target: 'cart' },
          },
          name: 'kovo_explain',
        },
      }),
    ).resolves.toMatchObject({
      result: {
        structuredContent: {
          exitCode: 0,
          output:
            'kovo-explain/v1\nQUERY cart\nreads: cart\nconsumers: -\ninvalidated-by: -\ndomain-writes: -\n',
          version: 'kovo-explain/v1',
        },
      },
    });

    const diagnostics = await finiteMcpRequest({
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
              code: 'KV201',
              message: 'Closure captures unserializable value.',
              severity: 'error',
            }),
          ]),
          version: 'diagnostics/v1',
        },
      },
    });
  });

  it('serves the finite newline-delimited JSON-RPC lifecycle', async () => {
    const chunks: string[] = [];
    await runMcpStdioServer(
      mcpInputChunks(
        `${JSON.stringify({
          id: 'init',
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
            protocolVersion: '2025-06-18',
          },
        })}\n`,
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
        `${JSON.stringify({
          id: 'list',
          jsonrpc: '2.0',
          method: 'tools/list',
        })}\n`,
      ),
      { write: (chunk) => chunks.push(chunk) },
      process.cwd(),
    );

    const responses = chunks
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({
      id: 'init',
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'kovo', version: 'kovo-mcp/v1' },
      },
    });
    expect(responses[1]).toMatchObject({
      id: 'list',
      result: {
        tools: expect.arrayContaining([expect.objectContaining({ name: 'compile_component' })]),
      },
    });
  });

  it('bounds request lines and resumes with a fresh finite lifecycle', async () => {
    const chunks: string[] = [];
    await runMcpStdioServer(
      mcpInputChunks(
        'x'.repeat(4 * 1024 * 1024 + 1),
        `\n${JSON.stringify({
          id: 'init-after-limit',
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
            protocolVersion: '2025-06-18',
          },
        })}\n`,
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
        `${JSON.stringify({ id: 'after-limit', jsonrpc: '2.0', method: 'tools/list' })}\n`,
      ),
      { write: (chunk) => chunks.push(chunk) },
      process.cwd(),
    );

    const responses = chunks
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(responses).toHaveLength(3);
    expect(responses[0]).toMatchObject({
      error: { code: -32001, message: 'request exceeds 4194304 bytes' },
      id: null,
      jsonrpc: '2.0',
    });
    expect(responses[1]).toMatchObject({ id: 'init-after-limit' });
    expect(responses[2]).toMatchObject({
      id: 'after-limit',
      result: { tools: expect.arrayContaining([expect.objectContaining({ name: 'kovo_check' })]) },
    });
  });

  it('rejects oversized compile sources before invoking the compiler', async () => {
    await expect(
      finiteMcpRequest({
        id: 'compile-limit',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            fileName: 'oversized.tsx',
            source: 'x'.repeat(256 * 1024 + 1),
          },
          name: 'compile_component',
        },
      }),
    ).resolves.toMatchObject({
      id: 'compile-limit',
      jsonrpc: '2.0',
      result: {
        content: [{ text: 'compile_component source exceeds 262144 bytes', type: 'text' }],
        isError: true,
      },
    });
  });

  it('serves initialize, tool listing, and tool calls through the finite MCP lifecycle', async () => {
    const messages = [
      {
        id: 'init-1',
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          capabilities: {},
          clientInfo: { name: 'kovo-test-client', version: '0.0.0' },
          protocolVersion: '2025-06-18',
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { id: 'list-1', jsonrpc: '2.0', method: 'tools/list', params: {} },
      {
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
      },
    ];
    const chunks: string[] = [];
    await runMcpStdioServer(
      mcpInputChunks(`${messages.map((message) => JSON.stringify(message)).join('\n')}\n`),
      { write: (chunk) => chunks.push(chunk) },
      process.cwd(),
    );
    const [initialize, list, compile] = chunks
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(initialize).toMatchObject({
      id: 'init-1',
      jsonrpc: '2.0',
      result: {
        capabilities: { tools: {} },
        serverInfo: { name: 'kovo', version: 'kovo-mcp/v1' },
      },
    });

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

    expect(compile).toMatchObject({
      id: 'compile-1',
      jsonrpc: '2.0',
      result: {
        content: [{ type: 'text' }],
        structuredContent: {
          diagnostics: [
            {
              category: 'build',
              code: 'KV210',
              help: diagnosticDefinitions.KV210.help,
              severity: 'lint',
              source: { end: 13, file: 'cart-badge.tsx', start: 8 },
              version: 'kovo-diagnostic/v1',
            },
            {
              category: 'build',
              code: 'KV201',
              help: expect.stringContaining(
                'SPEC §4.3 and §5.2 require handler lowering to cross only explicit serializable capture channels.',
              ),
              severity: 'error',
              source: { end: 16, file: 'cart-badge.tsx', start: 8 },
              version: 'kovo-diagnostic/v1',
            },
            {
              category: 'build',
              code: 'KV449',
              help: diagnosticDefinitions.KV449.help,
              message: browserAlertKv449Message,
              severity: 'error',
              source: { end: 40, file: 'cart-badge.tsx', start: 23 },
              version: 'kovo-diagnostic/v1',
            },
          ],
          ok: false,
          version: 'compile/v1',
        },
      },
    });
  });

  it('serves and exits cleanly through the spawned kovo mcp command', () => {
    const input = [
      {
        id: 'init',
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          capabilities: {},
          clientInfo: { name: 'spawned-test', version: '1' },
          protocolVersion: '2025-06-18',
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { id: 'ping', jsonrpc: '2.0', method: 'ping' },
    ]
      .map((message) => JSON.stringify(message))
      .join('\n');
    const result = spawnSync(fileURLToPath(new URL('./bin.ts', import.meta.url)), ['mcp'], {
      encoding: 'utf8',
      input: `${input}\n`,
      timeout: 15_000,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(
      result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([
      expect.objectContaining({
        id: 'init',
        result: expect.objectContaining({ protocolVersion: '2025-06-18' }),
      }),
      { id: 'ping', jsonrpc: '2.0', result: {} },
    ]);
  });
});
