import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { createFiniteMcpStdioServer, type FiniteMcpTool } from './mcp-stdio.js';

const tool: FiniteMcpTool = {
  description: 'Echo one value.',
  inputSchema: {
    additionalProperties: false,
    properties: { value: { type: 'string' } },
    required: ['value'],
    type: 'object',
  },
  name: 'echo',
};

function server(maxLineBytes = 4 * 1024 * 1024) {
  return createFiniteMcpStdioServer({
    callTool: async (name, args) => {
      if (name !== 'echo') throw new Error(`unknown tool ${name}`);
      if (!isRecord(args) || typeof args.value !== 'string') {
        throw new Error('echo requires value');
      }
      return {
        content: [{ text: args.value, type: 'text' }],
        structuredContent: { echoed: args.value },
      };
    },
    instructions: 'Finite test server.',
    maxLineBytes,
    serverInfo: { name: 'finite-test', version: '1.0.0' },
    tools: [tool],
  });
}

async function* chunks(...values: Array<Buffer | string>): AsyncIterable<Buffer | string> {
  for (const value of values) yield value;
}

async function stdio(
  values: Array<Buffer | string>,
  maxLineBytes = 4 * 1024 * 1024,
): Promise<unknown[]> {
  let output = '';
  await server(maxLineBytes).serveStdio(chunks(...values), {
    write(value) {
      output += value;
      return true;
    },
  });
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function initialize(id: string | number, protocolVersion = '2025-06-18') {
  return {
    id,
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
      protocolVersion,
    },
  };
}

describe('finite MCP stdio protocol', () => {
  it('serves initialize, initialized, ping, tools/list, and tools/call without an SDK', async () => {
    const finite = server();

    await expect(finite.handleMessage(initialize('init'))).resolves.toEqual({
      id: 'init',
      jsonrpc: '2.0',
      result: {
        capabilities: { tools: {} },
        instructions: 'Finite test server.',
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'finite-test', version: '1.0.0' },
      },
    });
    await expect(
      finite.handleMessage({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      }),
    ).resolves.toBeUndefined();
    await expect(
      finite.handleMessage({ id: 1, jsonrpc: '2.0', method: 'ping', params: {} }),
    ).resolves.toEqual({ id: 1, jsonrpc: '2.0', result: {} });
    await expect(
      finite.handleMessage({ id: 2, jsonrpc: '2.0', method: 'tools/list', params: {} }),
    ).resolves.toEqual({ id: 2, jsonrpc: '2.0', result: { tools: [tool] } });
    await expect(
      finite.handleMessage({
        id: 3,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { value: 'hello' }, name: 'echo' },
      }),
    ).resolves.toEqual({
      id: 3,
      jsonrpc: '2.0',
      result: {
        content: [{ text: 'hello', type: 'text' }],
        structuredContent: { echoed: 'hello' },
      },
    });
  });

  it('negotiates the finite version set and rejects duplicate initialization', async () => {
    const finite = server();
    await expect(finite.handleMessage(initialize(1, '2099-01-01'))).resolves.toMatchObject({
      result: { protocolVersion: '2025-11-25' },
    });
    await expect(finite.handleMessage(initialize(2))).resolves.toEqual({
      error: { code: -32600, message: 'server is already initialized' },
      id: 2,
      jsonrpc: '2.0',
    });
  });

  it('requires the ordered initialized notification before ping or tool dispatch', async () => {
    const finite = server();
    await finite.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await finite.handleMessage(initialize(1));
    await expect(finite.handleMessage({ id: 2, jsonrpc: '2.0', method: 'ping' })).resolves.toEqual({
      error: { code: -32002, message: 'server is not initialized' },
      id: 2,
      jsonrpc: '2.0',
    });

    await finite.handleMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: { surplus: true },
    });
    await expect(
      finite.handleMessage({ id: 3, jsonrpc: '2.0', method: 'tools/list' }),
    ).resolves.toMatchObject({ error: { code: -32002 } });

    await finite.handleMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: { _meta: { trace: 'test' } },
    });
    await expect(finite.handleMessage({ id: 4, jsonrpc: '2.0', method: 'ping' })).resolves.toEqual({
      id: 4,
      jsonrpc: '2.0',
      result: {},
    });
  });

  it('fails closed before initialization and distinguishes protocol from tool errors', async () => {
    const finite = server();
    await expect(
      finite.handleMessage({ id: 1, jsonrpc: '2.0', method: 'tools/list', params: {} }),
    ).resolves.toEqual({
      error: { code: -32002, message: 'server is not initialized' },
      id: 1,
      jsonrpc: '2.0',
    });

    await finite.handleMessage(initialize(2));
    await finite.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await expect(
      finite.handleMessage({ id: 3, jsonrpc: '2.0', method: 'unknown', params: {} }),
    ).resolves.toEqual({
      error: { code: -32601, message: 'Method not found' },
      id: 3,
      jsonrpc: '2.0',
    });
    await expect(
      finite.handleMessage({
        id: 4,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: {}, name: 'echo' },
      }),
    ).resolves.toEqual({
      id: 4,
      jsonrpc: '2.0',
      result: {
        content: [{ text: 'echo requires value', type: 'text' }],
        isError: true,
      },
    });
  });

  it('rejects malformed request ids, versions, params, and surplus request fields', async () => {
    const finite = server();
    for (const message of [
      { id: 1.5, jsonrpc: '2.0', method: 'initialize', params: {} },
      { id: 1, jsonrpc: '1.0', method: 'initialize', params: {} },
      { extra: true, id: 1, jsonrpc: '2.0', method: 'initialize', params: {} },
    ]) {
      await expect(finite.handleMessage(message)).resolves.toEqual({
        error: { code: -32600, message: 'Invalid Request' },
        id: null,
        jsonrpc: '2.0',
      });
    }

    await expect(
      finite.handleMessage({ id: 1, jsonrpc: '2.0', method: 'initialize', params: {} }),
    ).resolves.toEqual({
      error: { code: -32602, message: 'initialize requires protocolVersion and clientInfo' },
      id: 1,
      jsonrpc: '2.0',
    });
  });

  it('enforces closed method params and never invokes accessor-bearing own data', async () => {
    const finite = server();
    let getterCalled = false;
    const accessorEnvelope = {};
    Object.defineProperty(accessorEnvelope, 'jsonrpc', {
      enumerable: true,
      get() {
        getterCalled = true;
        return '2.0';
      },
    });
    await expect(finite.handleMessage(accessorEnvelope)).resolves.toMatchObject({
      error: { code: -32600 },
    });
    expect(getterCalled).toBe(false);

    await expect(
      finite.handleMessage({
        ...initialize(1),
        params: {
          ...initialize(1).params,
          clientInfo: { name: 'test-client', surplus: true, version: '1.0.0' },
        },
      }),
    ).resolves.toMatchObject({ error: { code: -32602 } });

    await finite.handleMessage(initialize(2));
    await finite.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    for (const message of [
      { id: 3, jsonrpc: '2.0', method: 'ping', params: { surplus: true } },
      { id: 4, jsonrpc: '2.0', method: 'tools/list', params: { surplus: true } },
      {
        id: 5,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: {}, name: 'echo', surplus: true },
      },
    ]) {
      await expect(finite.handleMessage(message)).resolves.toMatchObject({
        error: { code: -32602 },
      });
    }

    const accessorMeta = {};
    Object.defineProperty(accessorMeta, 'secret', {
      enumerable: true,
      get() {
        getterCalled = true;
        return 'no';
      },
    });
    await expect(
      finite.handleMessage({
        id: 6,
        jsonrpc: '2.0',
        method: 'ping',
        params: { _meta: accessorMeta },
      }),
    ).resolves.toMatchObject({ error: { code: -32602 } });
    expect(getterCalled).toBe(false);
  });

  it('does not respond to notifications and ignores response-shaped client messages', async () => {
    const finite = server();
    await expect(
      finite.handleMessage({ jsonrpc: '2.0', method: 'notifications/unknown', params: {} }),
    ).resolves.toBeUndefined();
    await expect(
      finite.handleMessage({ id: 1, jsonrpc: '2.0', result: {} }),
    ).resolves.toBeUndefined();
  });

  it('preserves split UTF-8 and CRLF while emitting only response lines', async () => {
    const first = `${JSON.stringify(initialize(1))}\r\n`;
    const initialized = `${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })}\n`;
    const call = `${JSON.stringify({
      id: 2,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: { value: 'café' }, name: 'echo' },
    })}\n`;
    const bytes = Buffer.from(first + initialized + call);
    const split = bytes.indexOf(Buffer.from('é')) + 1;
    const responses = await stdio([bytes.subarray(0, split), bytes.subarray(split)]);

    expect(responses).toHaveLength(2);
    expect(responses[1]).toMatchObject({
      id: 2,
      result: { structuredContent: { echoed: 'café' } },
    });
  });

  it('rejects invalid UTF-8, parse errors, and oversized lines, then resumes', async () => {
    const init = `${JSON.stringify(initialize(1))}\n`;
    const initialized = `${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })}\n`;
    const ping = JSON.stringify({ id: 2, jsonrpc: '2.0', method: 'ping' });
    const responses = await stdio(
      [
        Buffer.from([0xff, 0x0a]),
        '{nope}\n',
        `${'x'.repeat(256)}\n`,
        `${'x'.repeat(257)}\n`,
        init,
        initialized,
        ping,
      ],
      256,
    );

    expect(responses.slice(0, 4)).toEqual([
      { error: { code: -32700, message: 'parse error' }, id: null, jsonrpc: '2.0' },
      { error: { code: -32700, message: 'parse error' }, id: null, jsonrpc: '2.0' },
      { error: { code: -32700, message: 'parse error' }, id: null, jsonrpc: '2.0' },
      {
        error: { code: -32001, message: 'request exceeds 256 bytes' },
        id: null,
        jsonrpc: '2.0',
      },
    ]);
    expect(responses.at(-1)).toEqual({ id: 2, jsonrpc: '2.0', result: {} });
  });

  it('allows an exact-boundary result, bounds one byte over, and keeps serving', async () => {
    const maxLineBytes = 320;
    const responseWithText = (text: string) => ({
      id: 2,
      jsonrpc: '2.0',
      result: { content: [{ text, type: 'text' }] },
    });
    const emptyBytes = Buffer.byteLength(JSON.stringify(responseWithText('')), 'utf8');
    const exactTextBytes = maxLineBytes - emptyBytes;
    const finite = createFiniteMcpStdioServer({
      callTool: async (_name, args) => ({
        content: [{ text: 'x'.repeat(Number(args.size)), type: 'text' }],
      }),
      maxLineBytes,
      serverInfo: { name: 'bounded', version: '1' },
      tools: [
        {
          description: 'Return bounded text.',
          inputSchema: { properties: { size: { type: 'integer' } }, type: 'object' },
          name: 'bounded',
        },
      ],
    });
    const messages = [
      initialize(1),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      {
        id: 2,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { size: exactTextBytes }, name: 'bounded' },
      },
      {
        id: 3,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { size: exactTextBytes + 1 }, name: 'bounded' },
      },
      { id: 4, jsonrpc: '2.0', method: 'ping' },
    ];
    let output = '';
    await finite.serveStdio(chunks(messages.map((message) => JSON.stringify(message)).join('\n')), {
      write(value) {
        output += value;
        return true;
      },
    });
    const lines = output.trimEnd().split('\n');
    const responses = lines.map((line) => JSON.parse(line));

    expect(Buffer.byteLength(lines[1], 'utf8')).toBe(maxLineBytes);
    expect(responses[1]).toEqual(responseWithText('x'.repeat(exactTextBytes)));
    expect(responses[2]).toEqual({
      error: { code: -32603, message: `response exceeds ${maxLineBytes} bytes` },
      id: 3,
      jsonrpc: '2.0',
    });
    expect(responses[3]).toEqual({ id: 4, jsonrpc: '2.0', result: {} });
  });

  it('rejects static tool descriptors that cannot fit the output ceiling', () => {
    expect(() =>
      createFiniteMcpStdioServer({
        callTool: async () => ({ content: [] }),
        maxLineBytes: 256,
        serverInfo: { name: 'bounded', version: '1' },
        tools: [
          {
            description: 'x'.repeat(256),
            inputSchema: { type: 'object' },
            name: 'oversized',
          },
        ],
      }),
    ).toThrow('tools/list response exceeds maxLineBytes');
  });

  it('rejects descriptor and result hooks without invoking them', async () => {
    let hookCalled = false;
    const inputSchema = {};
    Object.defineProperty(inputSchema, 'toJSON', {
      enumerable: true,
      value() {
        hookCalled = true;
        return { type: 'object' };
      },
    });
    expect(() =>
      createFiniteMcpStdioServer({
        callTool: async () => ({ content: [] }),
        maxLineBytes: 512,
        serverInfo: { name: 'hooks', version: '1' },
        tools: [{ description: 'Hooked schema.', inputSchema, name: 'hooked' }],
      }),
    ).toThrow('tools must be an own-JSON array');
    expect(hookCalled).toBe(false);

    const resultContent = {};
    Object.defineProperty(resultContent, 'text', {
      enumerable: true,
      get() {
        hookCalled = true;
        return 'unsafe';
      },
    });
    Object.defineProperty(resultContent, 'type', {
      enumerable: true,
      value: 'text',
    });
    const finite = createFiniteMcpStdioServer({
      callTool: async () => ({ content: [resultContent] }) as never,
      maxLineBytes: 512,
      serverInfo: { name: 'hooks', version: '1' },
      tools: [tool],
    });
    await finite.handleMessage(initialize(1));
    await finite.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await expect(
      finite.handleMessage({
        id: 2,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { value: 'unused' }, name: 'echo' },
      }),
    ).resolves.toEqual({
      error: { code: -32603, message: 'tool returned an invalid result' },
      id: 2,
      jsonrpc: '2.0',
    });
    expect(hookCalled).toBe(false);
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
