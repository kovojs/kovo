import { Buffer, isUtf8 } from 'node:buffer';

const JSON_RPC_VERSION = '2.0';
const LATEST_PROTOCOL_VERSION = '2025-11-25';
const MIN_LINE_BYTES = 128;
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  LATEST_PROTOCOL_VERSION,
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
]);

type JsonRpcId = number | string;

/** @internal One text content item in Kovo's finite MCP result language. */
export interface FiniteMcpTextContent {
  text: string;
  type: 'text';
}

/** @internal The closed tool result language supported by Kovo's stdio MCP servers. */
export interface FiniteMcpToolResult {
  content: readonly FiniteMcpTextContent[];
  isError?: boolean;
  structuredContent?: Readonly<Record<string, unknown>>;
}

/** @internal One immutable tool descriptor served by Kovo's finite MCP transport. */
export interface FiniteMcpTool {
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  name: string;
}

/** @internal Minimal backpressure-aware output accepted by the finite MCP stdio transport. */
export interface FiniteMcpOutput {
  once?(event: 'drain', listener: () => void): unknown;
  write(chunk: string): unknown;
}

/** @internal Options for one dependency-free, finite Kovo MCP stdio server. */
export interface FiniteMcpStdioServerOptions {
  callTool: (name: string, args: Readonly<Record<string, unknown>>) => Promise<FiniteMcpToolResult>;
  instructions?: string;
  maxLineBytes: number;
  serverInfo: Readonly<{ name: string; version: string }>;
  tools: readonly FiniteMcpTool[];
}

/** @internal A closed MCP server over caller-supplied NDJSON input and output. */
export interface FiniteMcpStdioServer {
  handleMessage(message: unknown): Promise<Record<string, unknown> | undefined>;
  serveStdio(input: AsyncIterable<Buffer | string>, output: FiniteMcpOutput): Promise<void>;
}

/**
 * @internal
 * Creates Kovo's finite MCP stdio protocol engine. This is an internal command transport, not an
 * application-facing agent API. SPEC §5.3 owns its closed lifecycle and resource bounds.
 */
export function createFiniteMcpStdioServer(
  options: FiniteMcpStdioServerOptions,
): FiniteMcpStdioServer {
  if (
    !isOwnDataRecord(options.serverInfo) ||
    !hasExactKeys(options.serverInfo, ['name', 'version'])
  ) {
    throw new TypeError('serverInfo must be an exact own-data object');
  }
  const serverInfo = {
    name: requiredString(options.serverInfo.name, 'serverInfo.name'),
    version: requiredString(options.serverInfo.version, 'serverInfo.version'),
  };
  const instructions =
    options.instructions === undefined
      ? undefined
      : requiredString(options.instructions, 'instructions');
  if (!Number.isSafeInteger(options.maxLineBytes) || options.maxLineBytes < MIN_LINE_BYTES) {
    throw new TypeError(`maxLineBytes must be a safe integer of at least ${MIN_LINE_BYTES}`);
  }
  const maxLineBytes = options.maxLineBytes;
  const callTool = options.callTool;
  if (typeof callTool !== 'function') throw new TypeError('callTool must be a function');

  if (!Array.isArray(options.tools) || !isJsonValue(options.tools)) {
    throw new TypeError('tools must be an own-JSON array');
  }
  const tools = options.tools.map(snapshotTool);
  const toolNames = new Set<string>();
  for (const tool of tools) {
    if (toolNames.has(tool.name))
      throw new TypeError(`duplicate MCP tool ${JSON.stringify(tool.name)}`);
    toolNames.add(tool.name);
  }

  assertResponseFits(
    jsonRpcResult(0, {
      capabilities: { tools: {} },
      ...(instructions === undefined ? {} : { instructions }),
      protocolVersion: LATEST_PROTOCOL_VERSION,
      serverInfo,
    }),
    maxLineBytes,
    'initialize response',
  );
  assertResponseFits(jsonRpcResult(0, { tools }), maxLineBytes, 'tools/list response');

  let phase: 'awaiting-initialize' | 'awaiting-initialized-notification' | 'ready' =
    'awaiting-initialize';

  async function handleMessage(message: unknown): Promise<Record<string, unknown> | undefined> {
    if (!isOwnDataRecord(message)) return jsonRpcError(null, -32600, 'Invalid Request');
    if (isResponseMessage(message)) return undefined;

    const hasId = Object.hasOwn(message, 'id');
    const allowedKeys = hasId
      ? ['id', 'jsonrpc', 'method', ...(Object.hasOwn(message, 'params') ? ['params'] : [])]
      : ['jsonrpc', 'method', ...(Object.hasOwn(message, 'params') ? ['params'] : [])];
    if (
      !hasExactKeys(message, allowedKeys) ||
      message.jsonrpc !== JSON_RPC_VERSION ||
      typeof message.method !== 'string'
    ) {
      return hasId ? jsonRpcError(null, -32600, 'Invalid Request') : undefined;
    }

    if (!hasId) {
      if (
        message.method === 'notifications/initialized' &&
        phase === 'awaiting-initialized-notification' &&
        validInitializedParams(message.params)
      ) {
        phase = 'ready';
      }
      return undefined;
    }
    if (!isJsonRpcId(message.id)) return jsonRpcError(null, -32600, 'Invalid Request');
    const id = message.id;
    if (
      !responseFits(
        jsonRpcError(id, -32603, `response exceeds ${maxLineBytes} bytes`),
        maxLineBytes,
      )
    ) {
      return jsonRpcError(null, -32600, 'request id exceeds response budget');
    }

    if (message.method === 'initialize') {
      if (phase !== 'awaiting-initialize') {
        return jsonRpcError(id, -32600, 'server is already initialized');
      }
      const params = message.params;
      if (!validInitializeParams(params)) {
        return jsonRpcError(id, -32602, 'initialize requires protocolVersion and clientInfo');
      }
      phase = 'awaiting-initialized-notification';
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(params.protocolVersion)
        ? params.protocolVersion
        : LATEST_PROTOCOL_VERSION;
      return jsonRpcResult(id, {
        capabilities: { tools: {} },
        ...(instructions === undefined ? {} : { instructions }),
        protocolVersion,
        serverInfo,
      });
    }

    if (
      message.method !== 'ping' &&
      message.method !== 'tools/list' &&
      message.method !== 'tools/call'
    ) {
      return jsonRpcError(id, -32601, 'Method not found');
    }
    if (phase !== 'ready') return jsonRpcError(id, -32002, 'server is not initialized');

    if (message.method === 'ping') {
      if (!validPingParams(message.params)) {
        return jsonRpcError(id, -32602, 'ping params are invalid');
      }
      return jsonRpcResult(id, {});
    }

    if (message.method === 'tools/list') {
      if (!validListToolsParams(message.params)) {
        return jsonRpcError(id, -32602, 'tools/list params are invalid');
      }
      return jsonRpcResult(id, { tools });
    }

    const params = message.params;
    if (!validCallToolParams(params)) {
      return jsonRpcError(id, -32602, 'tools/call requires params.name and object arguments');
    }
    if (!toolNames.has(params.name)) {
      return jsonRpcResult(id, toolErrorResult(`unknown tool ${JSON.stringify(params.name)}`));
    }

    let result: FiniteMcpToolResult;
    try {
      result = await callTool(
        params.name,
        cloneJsonRecord(params.arguments ?? {}, 'tools/call arguments'),
      );
    } catch (error) {
      return jsonRpcResult(
        id,
        toolErrorResult(error instanceof Error ? error.message : String(error)),
      );
    }
    try {
      return jsonRpcResult(id, snapshotToolResult(result));
    } catch {
      return jsonRpcError(id, -32603, 'tool returned an invalid result');
    }
  }

  async function serveStdio(
    input: AsyncIterable<Buffer | string>,
    output: FiniteMcpOutput,
  ): Promise<void> {
    let buffered: Buffer[] = [];
    let bufferedBytes = 0;
    let discarding = false;

    async function writeResponse(response: Record<string, unknown>): Promise<void> {
      let encoded = JSON.stringify(response);
      if (Buffer.byteLength(encoded, 'utf8') > maxLineBytes) {
        const responseId = isJsonRpcId(response.id) ? response.id : null;
        encoded = JSON.stringify(
          jsonRpcError(responseId, -32603, `response exceeds ${maxLineBytes} bytes`),
        );
      }
      await writeWithBackpressure(output, `${encoded}\n`);
    }

    async function rejectOversizedLine(): Promise<void> {
      if (discarding) return;
      discarding = true;
      buffered = [];
      bufferedBytes = 0;
      await writeResponse(jsonRpcError(null, -32001, `request exceeds ${maxLineBytes} bytes`));
    }

    async function append(segment: Buffer): Promise<void> {
      if (discarding || segment.length === 0) return;
      if (bufferedBytes + segment.length > maxLineBytes) {
        await rejectOversizedLine();
        return;
      }
      buffered.push(segment);
      bufferedBytes += segment.length;
    }

    async function finishLine(): Promise<void> {
      if (discarding) {
        discarding = false;
        buffered = [];
        bufferedBytes = 0;
        return;
      }
      if (bufferedBytes === 0) return;
      let bytes = Buffer.concat(buffered, bufferedBytes);
      buffered = [];
      bufferedBytes = 0;
      if (bytes.at(-1) === 0x0d) bytes = bytes.subarray(0, -1);
      if (bytes.length === 0) return;
      if (!isUtf8(bytes)) {
        await writeResponse(jsonRpcError(null, -32700, 'parse error'));
        return;
      }

      let message: unknown;
      try {
        message = JSON.parse(bytes.toString('utf8'));
      } catch {
        await writeResponse(jsonRpcError(null, -32700, 'parse error'));
        return;
      }
      const response = await handleMessage(message);
      if (response !== undefined) await writeResponse(response);
    }

    for await (const chunk of input) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      let start = 0;
      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] !== 0x0a) continue;
        await append(bytes.subarray(start, index));
        await finishLine();
        start = index + 1;
      }
      await append(bytes.subarray(start));
    }
    if (!discarding && bufferedBytes > 0) await finishLine();
  }

  return { handleMessage, serveStdio };
}

function validInitializeParams(value: unknown): value is {
  capabilities: Readonly<Record<string, unknown>>;
  clientInfo: Readonly<{ name: string; version: string }>;
  protocolVersion: string;
} {
  if (!isOwnDataRecord(value)) return false;
  if (!hasOnlyKeys(value, ['_meta', 'capabilities', 'clientInfo', 'protocolVersion'])) return false;
  if (
    typeof value.protocolVersion !== 'string' ||
    value.protocolVersion.length === 0 ||
    !isJsonRecord(value.capabilities) ||
    !isOwnDataRecord(value.clientInfo) ||
    !hasExactKeys(value.clientInfo, ['name', 'version']) ||
    typeof value.clientInfo.name !== 'string' ||
    value.clientInfo.name.length === 0 ||
    typeof value.clientInfo.version !== 'string' ||
    value.clientInfo.version.length === 0
  ) {
    return false;
  }
  return !Object.hasOwn(value, '_meta') || isJsonRecord(value._meta);
}

function validInitializedParams(value: unknown): boolean {
  return value === undefined || validMetaOnlyParams(value);
}

function validPingParams(value: unknown): boolean {
  return value === undefined || validMetaOnlyParams(value);
}

function validMetaOnlyParams(value: unknown): boolean {
  return (
    isOwnDataRecord(value) &&
    hasOnlyKeys(value, ['_meta']) &&
    (!Object.hasOwn(value, '_meta') || isJsonRecord(value._meta))
  );
}

function validListToolsParams(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isOwnDataRecord(value) || !hasOnlyKeys(value, ['_meta', 'cursor'])) return false;
  return (
    (!Object.hasOwn(value, 'cursor') || typeof value.cursor === 'string') &&
    (!Object.hasOwn(value, '_meta') || isJsonRecord(value._meta))
  );
}

function validCallToolParams(
  value: unknown,
): value is { arguments?: Readonly<Record<string, unknown>>; name: string } {
  if (
    !isOwnDataRecord(value) ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    !hasOnlyKeys(value, ['_meta', 'arguments', 'name'])
  ) {
    return false;
  }
  return (
    (!Object.hasOwn(value, 'arguments') || isJsonRecord(value.arguments)) &&
    (!Object.hasOwn(value, '_meta') || isJsonRecord(value._meta))
  );
}

function snapshotTool(value: FiniteMcpTool): FiniteMcpTool {
  if (!isOwnDataRecord(value) || !hasExactKeys(value, ['description', 'inputSchema', 'name'])) {
    throw new TypeError('MCP tool must be an exact own-data object');
  }
  const name = requiredString(value.name, 'tool.name');
  const description = requiredString(value.description, `tool ${name} description`);
  if (!isJsonRecord(value.inputSchema)) {
    throw new TypeError(`tool ${name} inputSchema must be an own-JSON object`);
  }
  const inputSchema = cloneJsonRecord(value.inputSchema, `tool ${name} inputSchema`);
  return Object.freeze({ description, inputSchema, name });
}

function snapshotToolResult(value: FiniteMcpToolResult): FiniteMcpToolResult {
  if (!isOwnDataRecord(value) || !Array.isArray(value.content) || !isJsonValue(value.content)) {
    throw new TypeError('tool result must contain content');
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'content' && key !== 'isError' && key !== 'structuredContent')) {
    throw new TypeError('tool result contains unsupported fields');
  }
  const content = value.content.map((item) => {
    if (
      !isOwnDataRecord(item) ||
      !hasExactKeys(item, ['text', 'type']) ||
      item.type !== 'text' ||
      typeof item.text !== 'string'
    ) {
      throw new TypeError('tool result content must contain text items');
    }
    return Object.freeze({ text: item.text, type: 'text' as const });
  });
  if (Object.hasOwn(value, 'isError') && typeof value.isError !== 'boolean') {
    throw new TypeError('tool result isError must be boolean');
  }
  if (Object.hasOwn(value, 'structuredContent') && !isJsonRecord(value.structuredContent)) {
    throw new TypeError('tool result structuredContent must be an own-JSON object');
  }
  return {
    content,
    ...(value.isError === undefined ? {} : { isError: value.isError }),
    ...(value.structuredContent === undefined
      ? {}
      : { structuredContent: cloneJsonRecord(value.structuredContent, 'structuredContent') }),
  };
}

function toolErrorResult(message: string): FiniteMcpToolResult {
  return { content: [{ text: message, type: 'text' }], isError: true };
}

function cloneJsonRecord(value: Readonly<Record<string, unknown>>, label: string) {
  try {
    if (!isJsonRecord(value)) throw new TypeError();
    return cloneValidatedJsonRecord(value);
  } catch {
    throw new TypeError(`${label} must be an own-JSON object`);
  }
}

function cloneValidatedJsonRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const target: Record<string, unknown> = {};
  const pending: Array<{
    source: readonly unknown[] | Readonly<Record<string, unknown>>;
    target: unknown[] | Record<string, unknown>;
  }> = [{ source: value, target }];
  const containers: Array<unknown[] | Record<string, unknown>> = [target];

  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined) break;
    const entries = Array.isArray(frame.source)
      ? frame.source.map((item, index) => [String(index), item] as const)
      : Object.keys(frame.source).map(
          (key) => [key, Object.getOwnPropertyDescriptor(frame.source, key)?.value] as const,
        );
    for (const [key, item] of entries) {
      let cloned = item;
      if (Array.isArray(item)) {
        cloned = [];
        containers.push(cloned);
        pending.push({ source: item, target: cloned });
      } else if (isOwnDataRecord(item)) {
        cloned = {};
        containers.push(cloned);
        pending.push({ source: item, target: cloned });
      }
      Object.defineProperty(frame.target, key, {
        configurable: true,
        enumerable: true,
        value: cloned,
        writable: true,
      });
    }
  }
  for (const container of containers.reverse()) Object.freeze(container);
  return target;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

function isResponseMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.jsonrpc === JSON_RPC_VERSION &&
    isJsonRpcId(value.id) &&
    !Object.hasOwn(value, 'method') &&
    (Object.hasOwn(value, 'result') || Object.hasOwn(value, 'error'))
  );
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOwnDataRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
      );
    });
  } catch {
    return false;
  }
}

function isJsonRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return isOwnDataRecord(value) && isJsonValue(value);
}

function isJsonValue(value: unknown): boolean {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  let nodeCount = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    nodeCount += 1;
    if (nodeCount > 4 * 1024 * 1024) return false;
    if (
      current === null ||
      typeof current === 'string' ||
      typeof current === 'boolean' ||
      (typeof current === 'number' && Number.isFinite(current))
    ) {
      continue;
    }
    if (typeof current !== 'object') return false;
    if (seen.has(current)) return false;
    seen.add(current);

    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) return false;
      const keys = Reflect.ownKeys(current);
      if (keys.length !== current.length + 1 || keys.at(-1) !== 'length') return false;
      for (let index = 0; index < current.length; index += 1) {
        if (keys[index] !== String(index)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !Object.hasOwn(descriptor, 'value')
        ) {
          return false;
        }
        pending.push(descriptor.value);
      }
      continue;
    }

    if (!isOwnDataRecord(current)) return false;
    for (const key of Object.keys(current)) {
      pending.push(Object.getOwnPropertyDescriptor(current, key)?.value);
    }
  }
  return true;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function jsonRpcResult(id: JsonRpcId, result: unknown): Record<string, unknown> {
  return { id, jsonrpc: JSON_RPC_VERSION, result };
}

function jsonRpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
): Record<string, unknown> {
  return { error: { code, message }, id, jsonrpc: JSON_RPC_VERSION };
}

function assertResponseFits(
  response: Record<string, unknown>,
  maxLineBytes: number,
  label: string,
): void {
  if (!responseFits(response, maxLineBytes)) {
    throw new TypeError(`${label} exceeds maxLineBytes`);
  }
}

function responseFits(response: Record<string, unknown>, maxLineBytes: number): boolean {
  return Buffer.byteLength(JSON.stringify(response), 'utf8') <= maxLineBytes;
}

async function writeWithBackpressure(output: FiniteMcpOutput, chunk: string): Promise<void> {
  if (output.write(chunk) !== false || typeof output.once !== 'function') return;
  await new Promise<void>((resolve) => output.once?.('drain', resolve));
}
