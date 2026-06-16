import { describe, expect, it } from 'vitest';

import { mcpCompileResponseFacts, mcpJsonRpcResponseFacts } from './mcp-fixtures.js';

describe('@kovojs/test MCP fixture seam', () => {
  it('turns MCP stdio JSONL chunks into structured compile response facts', () => {
    const chunks = [
      JSON.stringify({
        id: 'red',
        jsonrpc: '2.0',
        result: {
          structuredContent: {
            diagnostics: [
              { code: 'KV210', message: 'lint', severity: 'lint' },
              { code: 'KV201', message: 'error', severity: 'error' },
            ],
            ok: false,
            version: 'compile/v1',
          },
          version: 'kovo-mcp/v1',
        },
      }),
      '\n',
      JSON.stringify({
        id: 'green',
        jsonrpc: '2.0',
        result: {
          structuredContent: {
            diagnostics: [],
            ok: true,
            version: 'compile/v1',
          },
          version: 'kovo-mcp/v1',
        },
      }),
      '\n',
    ];

    expect(mcpCompileResponseFacts(chunks)).toEqual([
      {
        contentVersion: 'compile/v1',
        diagnostics: [
          { code: 'KV210', severity: 'lint' },
          { code: 'KV201', severity: 'error' },
        ],
        id: 'red',
        ok: false,
        version: 'kovo-mcp/v1',
      },
      {
        contentVersion: 'compile/v1',
        diagnostics: [],
        id: 'green',
        ok: true,
        version: 'kovo-mcp/v1',
      },
    ]);
  });

  it('exposes the generic JSON-RPC response boundary for non-compile MCP tests', () => {
    expect(
      mcpJsonRpcResponseFacts(
        JSON.stringify({ id: 1, jsonrpc: '2.0', result: { version: 'kovo-mcp/v1' } }),
      ),
    ).toEqual([{ id: 1, result: { version: 'kovo-mcp/v1' } }]);
  });

  it('rejects malformed MCP stdio output at the fixture seam', () => {
    expect(() => mcpJsonRpcResponseFacts(JSON.stringify({ id: true, result: {} }))).toThrow(
      'MCP stdio response id is string, number, or null',
    );
    expect(() =>
      mcpCompileResponseFacts(
        JSON.stringify({
          id: 'bad',
          result: { structuredContent: { diagnostics: [], ok: true, version: 'compile/v2' } },
        }),
      ),
    ).toThrow('MCP compile response uses kovo-mcp/v1 for id bad');
    expect(() =>
      mcpCompileResponseFacts(
        JSON.stringify({
          id: 'bad-diagnostic',
          result: {
            structuredContent: {
              diagnostics: [{ code: 'KV201' }],
              ok: false,
              version: 'compile/v1',
            },
            version: 'kovo-mcp/v1',
          },
        }),
      ),
    ).toThrow('MCP compile diagnostic exposes code and severity for id bad-diagnostic');
  });
});
