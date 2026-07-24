import { Buffer, isUtf8 } from 'node:buffer';

const JSON_RPC_VERSION = '2.0';
const LATEST_PROTOCOL_VERSION = '2025-11-25';
const MAX_JSON_DEPTH = 128;
const MAX_JSON_NODES = 65_536;
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const MAX_TOOL_ERROR_MESSAGE_CODE_UNITS = 4096;
const MIN_LINE_BYTES = 256;
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
 * application-facing agent API. SPEC §11.5 owns its closed lifecycle and resource bounds.
 */
export function createFiniteMcpStdioServer(
  options: FiniteMcpStdioServerOptions,
): FiniteMcpStdioServer {
  if (
    !Number.isSafeInteger(options.maxLineBytes) ||
    options.maxLineBytes < MIN_LINE_BYTES ||
    options.maxLineBytes > MAX_LINE_BYTES
  ) {
    throw new TypeError(
      `maxLineBytes must be a safe integer from ${MIN_LINE_BYTES} through ${MAX_LINE_BYTES}`,
    );
  }
  const maxLineBytes = options.maxLineBytes;
  const serverInfoInput = cloneJsonRecord(options.serverInfo, 'serverInfo', maxLineBytes);
  if (!hasExactKeys(serverInfoInput, ['name', 'version'])) {
    throw new TypeError('serverInfo must be an exact own-data object');
  }
  const serverInfo = Object.freeze({
    name: requiredString(serverInfoInput.name, 'serverInfo.name'),
    version: requiredString(serverInfoInput.version, 'serverInfo.version'),
  });
  const instructions =
    options.instructions === undefined
      ? undefined
      : requiredString(options.instructions, 'instructions');
  if (instructions !== undefined && jsonStringEncodedByteLength(instructions) > maxLineBytes) {
    throw new TypeError('instructions exceeds maxLineBytes');
  }
  const callTool = options.callTool;
  if (typeof callTool !== 'function') throw new TypeError('callTool must be a function');

  const toolInputs = cloneJsonArray(options.tools, 'tools', maxLineBytes);
  const tools = Object.freeze(
    toolInputs.map((value) => snapshotTool(value as FiniteMcpTool, maxLineBytes)),
  );
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

  async function handleMessage(input: unknown): Promise<Record<string, unknown> | undefined> {
    const message = tryCloneJsonRecord(input, maxLineBytes);
    if (message === undefined) return jsonRpcError(null, -32600, 'Invalid Request');
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
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(params.protocolVersion)
        ? params.protocolVersion
        : LATEST_PROTOCOL_VERSION;
      const response = jsonRpcResult(id, {
        capabilities: { tools: {} },
        ...(instructions === undefined ? {} : { instructions }),
        protocolVersion,
        serverInfo,
      });
      if (!responseFits(response, maxLineBytes)) {
        return jsonRpcError(id, -32603, `response exceeds ${maxLineBytes} bytes`);
      }
      phase = 'awaiting-initialized-notification';
      return response;
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
      return boundedToolErrorResponse(
        id,
        `unknown tool ${JSON.stringify(params.name.slice(0, 256))}`,
        maxLineBytes,
      );
    }

    let result: FiniteMcpToolResult;
    try {
      result = await callTool(
        params.name,
        cloneJsonRecord(params.arguments ?? {}, 'tools/call arguments', maxLineBytes),
      );
    } catch (error) {
      return boundedToolErrorResponse(id, safeToolErrorMessage(error), maxLineBytes);
    }
    try {
      return jsonRpcResult(id, snapshotToolResult(result, maxLineBytes));
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
    let pendingHighSurrogate = '';

    async function writeResponse(response: Record<string, unknown>): Promise<void> {
      await writeWithBackpressure(output, serializeFiniteMcpJsonLine(response, maxLineBytes));
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
      // One framing CR may follow an exact-max payload and is stripped before payload admission.
      if (bufferedBytes + segment.length > maxLineBytes + 1) {
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
      if (bytes.length > maxLineBytes) {
        await writeResponse(jsonRpcError(null, -32001, `request exceeds ${maxLineBytes} bytes`));
        return;
      }
      const parsed = parseFiniteMcpJsonLine(bytes);
      if (!parsed.ok) {
        await writeResponse(jsonRpcError(null, -32700, 'parse error'));
        return;
      }
      const response = await handleMessage(parsed.message);
      if (response !== undefined) await writeResponse(response);
    }

    async function consumeBytes(bytes: Buffer): Promise<void> {
      let start = 0;
      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] !== 0x0a) continue;
        await append(bytes.subarray(start, index));
        await finishLine();
        start = index + 1;
      }
      await append(bytes.subarray(start));
    }

    for await (const chunk of input) {
      if (typeof chunk !== 'string') {
        if (pendingHighSurrogate !== '') {
          await consumeBytes(Buffer.from(pendingHighSurrogate, 'utf8'));
          pendingHighSurrogate = '';
        }
        await consumeBytes(chunk);
        continue;
      }
      let source = `${pendingHighSurrogate}${chunk}`;
      pendingHighSurrogate = '';
      const finalCodeUnit = source.charCodeAt(source.length - 1);
      if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
        pendingHighSurrogate = source.at(-1) ?? '';
        source = source.slice(0, -1);
      }
      if (source !== '') await consumeBytes(Buffer.from(source, 'utf8'));
    }
    if (pendingHighSurrogate !== '') {
      await consumeBytes(Buffer.from(pendingHighSurrogate, 'utf8'));
    }
    if (!discarding && bufferedBytes > 0) await finishLine();
  }

  return { handleMessage, serveStdio };
}

function parseFiniteMcpJsonLine(bytes: Buffer): { message: unknown; ok: true } | { ok: false } {
  if (!isUtf8(bytes)) return { ok: false };
  try {
    const source = bytes.toString('utf8');
    if (finiteMcpJsonSourceIsAmbiguousOrOverBudget(source)) return { ok: false };
    return { message: JSON.parse(source), ok: true };
  } catch {
    return { ok: false };
  }
}

function finiteMcpJsonSourceIsAmbiguousOrOverBudget(source: string): boolean {
  type Frame =
    | { expecting: 'comma-or-end' | 'key-or-end' | 'value'; keys: Set<string>; kind: 'object' }
    | { expecting: 'comma-or-end' | 'value'; kind: 'array' };
  const stack: Frame[] = [];
  let nodeCount = 0;

  function startValue(): boolean {
    nodeCount += 1;
    if (nodeCount > MAX_JSON_NODES) return false;
    const parent = stack.at(-1);
    if (parent !== undefined) parent.expecting = 'comma-or-end';
    return true;
  }

  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === '{' || char === '[') {
      if (!startValue() || stack.length >= MAX_JSON_DEPTH) return true;
      stack.push(
        char === '{'
          ? { expecting: 'key-or-end', keys: new Set(), kind: 'object' }
          : { expecting: 'value', kind: 'array' },
      );
      index += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      stack.pop();
      index += 1;
      continue;
    }
    if (char === ':') {
      const frame = stack.at(-1);
      if (frame?.kind === 'object') frame.expecting = 'value';
      index += 1;
      continue;
    }
    if (char === ',') {
      const frame = stack.at(-1);
      if (frame !== undefined) {
        frame.expecting = frame.kind === 'object' ? 'key-or-end' : 'value';
      }
      index += 1;
      continue;
    }
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      const frame = stack.at(-1);
      if (frame?.kind === 'object' && frame.expecting === 'key-or-end') {
        const key = JSON.parse(source.slice(start, index));
        if (typeof key !== 'string' || frame.keys.has(key)) return true;
        frame.keys.add(key);
        nodeCount += 1;
        if (nodeCount > MAX_JSON_NODES) return true;
        frame.expecting = 'value';
      } else if (!startValue()) {
        return true;
      }
      continue;
    }
    if (!startValue()) return true;
    while (index < source.length && !/[\s,\]}]/u.test(source[index]!)) index += 1;
  }
  return false;
}

function serializeFiniteMcpJsonLine(
  response: Record<string, unknown>,
  maxLineBytes: number,
): string {
  const responseId = isJsonRpcId(response.id) ? response.id : null;
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(response);
  } catch {
    // The exact JSON-domain validator should make this unreachable; retain a bounded sink fallback.
  }
  if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > maxLineBytes) {
    encoded = JSON.stringify(
      jsonRpcError(responseId, -32603, `response exceeds ${maxLineBytes} bytes`),
    );
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxLineBytes) {
    throw new TypeError('bounded MCP error response exceeds maxLineBytes');
  }
  return `${encoded}\n`;
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

function snapshotTool(value: FiniteMcpTool, maxLineBytes: number): FiniteMcpTool {
  if (!isOwnDataRecord(value) || !hasExactKeys(value, ['description', 'inputSchema', 'name'])) {
    throw new TypeError('MCP tool must be an exact own-data object');
  }
  const name = requiredString(value.name, 'tool.name');
  const description = requiredString(value.description, `tool ${name} description`);
  if (!isJsonRecord(value.inputSchema, maxLineBytes)) {
    throw new TypeError(`tool ${name} inputSchema must be an own-JSON object`);
  }
  const inputSchema = cloneJsonRecord(value.inputSchema, `tool ${name} inputSchema`, maxLineBytes);
  return Object.freeze({ description, inputSchema, name });
}

function snapshotToolResult(value: FiniteMcpToolResult, maxLineBytes: number): FiniteMcpToolResult {
  const snapshot = cloneJsonRecord(value, 'tool result', maxLineBytes);
  if (!Array.isArray(snapshot.content)) {
    throw new TypeError('tool result must contain content');
  }
  const keys = Object.keys(snapshot);
  if (keys.some((key) => key !== 'content' && key !== 'isError' && key !== 'structuredContent')) {
    throw new TypeError('tool result contains unsupported fields');
  }
  for (const item of snapshot.content) {
    if (
      !isOwnDataRecord(item) ||
      !hasExactKeys(item, ['text', 'type']) ||
      item.type !== 'text' ||
      typeof item.text !== 'string'
    ) {
      throw new TypeError('tool result content must contain text items');
    }
  }
  if (Object.hasOwn(snapshot, 'isError') && typeof snapshot.isError !== 'boolean') {
    throw new TypeError('tool result isError must be boolean');
  }
  if (Object.hasOwn(snapshot, 'structuredContent') && !isJsonRecord(snapshot.structuredContent)) {
    throw new TypeError('tool result structuredContent must be an own-JSON object');
  }
  return snapshot as unknown as FiniteMcpToolResult;
}

function toolErrorResult(message: string): FiniteMcpToolResult {
  return Object.freeze({
    content: Object.freeze([Object.freeze({ text: message, type: 'text' as const })]),
    isError: true,
  });
}

function safeToolErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error.slice(0, MAX_TOOL_ERROR_MESSAGE_CODE_UNITS);
  try {
    if (error instanceof Error) {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
      if (typeof descriptor?.value === 'string') {
        return descriptor.value.slice(0, MAX_TOOL_ERROR_MESSAGE_CODE_UNITS);
      }
    }
  } catch {
    // Tool-thrown proxies and coercion hooks are outside the protocol trust boundary.
  }
  return 'tool failed';
}

function boundedToolErrorResponse(
  id: JsonRpcId,
  message: string,
  maxLineBytes: number,
): Record<string, unknown> {
  let low = 0;
  let high = Math.min(message.length, MAX_TOOL_ERROR_MESSAGE_CODE_UNITS);
  let response = jsonRpcResult(id, toolErrorResult(''));
  if (!responseFits(response, maxLineBytes)) {
    return jsonRpcError(id, -32603, `response exceeds ${maxLineBytes} bytes`);
  }
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = jsonRpcResult(id, toolErrorResult(message.slice(0, middle)));
    if (responseFits(candidate, maxLineBytes)) {
      response = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return response;
}

function cloneJsonRecord(
  value: unknown,
  label: string,
  maxAggregateBytes = MAX_LINE_BYTES,
): Readonly<Record<string, unknown>> {
  const snapshot = tryCloneJsonRecord(value, maxAggregateBytes);
  if (snapshot === undefined) throw new TypeError(`${label} must be an own-JSON object`);
  return snapshot;
}

function cloneJsonArray(
  value: unknown,
  label: string,
  maxAggregateBytes = MAX_LINE_BYTES,
): readonly unknown[] {
  try {
    const snapshot = cloneFiniteJsonValue(value, maxAggregateBytes);
    if (!Array.isArray(snapshot)) throw new TypeError();
    return snapshot;
  } catch {
    throw new TypeError(`${label} must be an own-JSON array`);
  }
}

function tryCloneJsonRecord(
  value: unknown,
  maxAggregateBytes = MAX_LINE_BYTES,
): Readonly<Record<string, unknown>> | undefined {
  try {
    const snapshot = cloneFiniteJsonValue(value, maxAggregateBytes);
    return isOwnDataRecord(snapshot) ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

function cloneFiniteJsonValue<T>(value: T, maxSerializedBytes: number): T {
  let nodeCount = 0;
  let serializedBytes = 0;
  const seen = new WeakSet<object>();

  function addNode(count = 1): void {
    nodeCount += count;
    if (nodeCount > MAX_JSON_NODES) throw new TypeError('JSON node budget exceeded');
  }

  function addBytes(count: number): void {
    serializedBytes += count;
    if (serializedBytes > maxSerializedBytes) {
      throw new TypeError('JSON serialized-size budget exceeded');
    }
  }

  function clonePrimitive(input: unknown): unknown {
    addNode();
    if (typeof input === 'string') addBytes(jsonStringEncodedByteLength(input));
    else if (input === null) addBytes(4);
    else if (typeof input === 'boolean') addBytes(input ? 4 : 5);
    else if (typeof input === 'number' && Number.isFinite(input)) addBytes(String(input).length);
    else throw new TypeError('value is outside the JSON domain');
    return input;
  }

  if (value === null || typeof value !== 'object') return clonePrimitive(value) as T;
  const rootIsArray = Array.isArray(value);
  const target: unknown[] | Record<string, unknown> = rootIsArray ? [] : {};
  const pending: Array<{
    depth: number;
    source: readonly unknown[] | Readonly<Record<string, unknown>>;
    target: unknown[] | Record<string, unknown>;
  }> = [
    {
      depth: 1,
      source: value as readonly unknown[] | Readonly<Record<string, unknown>>,
      target,
    },
  ];
  const containers: Array<unknown[] | Record<string, unknown>> = [target];
  addNode();
  seen.add(value as object);

  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined) break;
    if (frame.depth > MAX_JSON_DEPTH) throw new TypeError('JSON depth budget exceeded');
    const { entries, isArray } = ownJsonContainerEntries(frame.source);
    addBytes(2 + Math.max(0, entries.length - 1) + (isArray ? 0 : entries.length));
    if (!isArray) {
      addNode(entries.length);
      for (const [key] of entries) addBytes(jsonStringEncodedByteLength(key));
    }
    for (const [key, item] of entries) {
      let cloned: unknown;
      if (item === null || typeof item !== 'object') {
        cloned = clonePrimitive(item);
      } else {
        addNode();
        if (seen.has(item)) throw new TypeError('cyclic JSON value');
        seen.add(item);
        const itemIsArray = Array.isArray(item);
        const clonedContainer: unknown[] | Record<string, unknown> = itemIsArray ? [] : {};
        cloned = clonedContainer;
        containers.push(clonedContainer);
        pending.push({
          depth: frame.depth + 1,
          source: item as readonly unknown[] | Readonly<Record<string, unknown>>,
          target: clonedContainer,
        });
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
  return target as T;
}

function ownJsonContainerEntries(value: readonly unknown[] | Readonly<Record<string, unknown>>): {
  entries: Array<readonly [string, unknown]>;
  isArray: boolean;
} {
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    throw new TypeError('JSON container has an unsupported prototype');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) {
    throw new TypeError('JSON container has a symbol key');
  }
  let dataKeys = keys as string[];
  if (isArray) {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      keys.length !== length + 1 ||
      keys.at(-1) !== 'length'
    ) {
      throw new TypeError('JSON array is sparse or malformed');
    }
    dataKeys = keys.slice(0, -1) as string[];
    if (dataKeys.some((key, index) => key !== String(index))) {
      throw new TypeError('JSON array has non-index properties');
    }
  }
  const entries = dataKeys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('JSON container has an accessor or hidden field');
    }
    return [key, descriptor.value] as const;
  });
  return { entries, isArray };
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

function isJsonRecord(
  value: unknown,
  maxAggregateBytes = MAX_LINE_BYTES,
): value is Readonly<Record<string, unknown>> {
  return isOwnDataRecord(value) && isJsonValue(value, maxAggregateBytes);
}

function isJsonValue(value: unknown, maxSerializedBytes = MAX_LINE_BYTES): boolean {
  const pending: Array<{ depth: number; value: unknown }> = [
    { depth: value !== null && typeof value === 'object' ? 1 : 0, value },
  ];
  const seen = new WeakSet<object>();
  let nodeCount = 0;
  let serializedBytes = 0;

  function addBytes(count: number): boolean {
    serializedBytes += count;
    return serializedBytes <= maxSerializedBytes;
  }

  try {
    while (pending.length > 0) {
      const frame = pending.pop();
      if (frame === undefined) break;
      const current = frame.value;
      nodeCount += 1;
      if (nodeCount > MAX_JSON_NODES) return false;
      if (typeof current === 'string') {
        if (!addBytes(jsonStringEncodedByteLength(current))) return false;
        continue;
      }
      if (current === null) {
        if (!addBytes(4)) return false;
        continue;
      }
      if (typeof current === 'boolean') {
        if (!addBytes(current ? 4 : 5)) return false;
        continue;
      }
      if (typeof current === 'number' && Number.isFinite(current)) {
        if (!addBytes(String(current).length)) return false;
        continue;
      }
      if (typeof current !== 'object') return false;
      if (frame.depth > MAX_JSON_DEPTH) return false;
      if (seen.has(current)) return false;
      seen.add(current);
      const { entries, isArray } = ownJsonContainerEntries(
        current as readonly unknown[] | Readonly<Record<string, unknown>>,
      );
      if (!addBytes(2 + Math.max(0, entries.length - 1) + (isArray ? 0 : entries.length))) {
        return false;
      }
      if (!isArray) {
        nodeCount += entries.length;
        if (nodeCount > MAX_JSON_NODES) return false;
        for (const [key] of entries) {
          if (!addBytes(jsonStringEncodedByteLength(key))) return false;
        }
      }
      for (const [, item] of entries) {
        pending.push({ depth: frame.depth + 1, value: item });
      }
    }
  } catch {
    return false;
  }
  return true;
}

function jsonStringEncodedByteLength(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22 || codeUnit === 0x5c || codeUnit === 0x08 || codeUnit === 0x09) {
      bytes += 2;
    } else if (codeUnit === 0x0a || codeUnit === 0x0c || codeUnit === 0x0d) {
      bytes += 2;
    } else if (codeUnit <= 0x1f) {
      bytes += 6;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      bytes += 6;
    } else if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes;
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
  try {
    return Buffer.byteLength(JSON.stringify(response), 'utf8') <= maxLineBytes;
  } catch {
    return false;
  }
}

async function writeWithBackpressure(output: FiniteMcpOutput, chunk: string): Promise<void> {
  if (output.write(chunk) !== false) return;
  if (typeof output.once !== 'function') {
    throw new TypeError('finite MCP output returned false without a drain listener');
  }
  await new Promise<void>((resolve) => output.once?.('drain', resolve));
}
