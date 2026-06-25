import type { CompileComponentOptions, CompileResult } from '@kovojs/compiler';
import {
  CompileCache,
  compileCacheKey,
  compileComponentCacheKeyInput,
  persistentCompileCacheDir,
  readPersistentCompileCacheEntry,
  writePersistentCompileCacheEntry,
} from '@kovojs/compiler/internal';
import type * as CompilerInternal from '@kovojs/compiler/internal';
import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import { validateKovoExplainInput } from '@kovojs/core/internal/graph';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

import { MCP_USAGE } from '../commands-manifest.js';
import {
  checkFamilyArg,
  explainOutputVersion,
  inputErrorMessage,
  isExplainKind,
  kovoCheck,
  kovoExplain,
  outputVersion,
  readGraphInput,
  type KovoExplainOptions,
} from '../graph-output.js';
import {
  byteLength,
  compileOutputVersion,
  type CliCommandResult,
  type KovoCheckResult,
  mcpOutputVersion,
  stableValue,
  writeUsageError,
} from '../shared.js';

const cliCompileComponentCache = new CompileCache<CompileResult>();

/** @internal Input shape for the internal `compile_component` MCP tool. */
export interface CompileComponentV1Input {
  fileName: string;
  packageComponentPrefixes?: CompileComponentOptions['packageComponentPrefixes'];
  packagePrefixDiscoveryRoot?: CompileComponentOptions['packagePrefixDiscoveryRoot'];
  queryShapeFacts?: readonly CompilerInternal.QueryShapeFact[];
  queryShapes?: Record<string, CompilerInternal.QueryShape>;
  registryFacts?: CompileComponentOptions['registryFacts'];
  source: string;
  sourceProvenance?: CompileComponentOptions['sourceProvenance'];
}

/** @internal Diagnostic shape returned by the internal `compile_component` MCP tool. */
export interface CompileComponentV1Diagnostic {
  code: DiagnosticCode;
  fileName: string;
  help?: string;
  length?: number;
  message: string;
  severity: DiagnosticSeverity;
  start?: { column: number; line: number };
}

/** @internal Result shape returned by the internal `compile_component` MCP tool. */
export interface CompileComponentV1Result {
  componentGraphFacts: readonly unknown[];
  diagnostics: readonly CompileComponentV1Diagnostic[];
  emittedFiles: readonly { byteLength: number; fileName: string; kind: string }[];
  handlerExports: readonly string[];
  ok: boolean;
  platformSubstitutions: readonly unknown[];
  queryUpdatePlans: readonly unknown[];
  renderEquivalenceChecks: readonly {
    actual?: string;
    artifact: string;
    detail?: string;
    expected?: string;
    ok: boolean;
  }[];
  updateCoverage: readonly unknown[];
  version: typeof compileOutputVersion;
  viewTransitions: readonly unknown[];
}

/** @internal Tool names exposed by the internal `kovo mcp` server. */
export type KovoMcpToolName =
  | 'compile_component'
  | 'kovo_check'
  | 'kovo_explain'
  | 'list_diagnostics';

/** @internal JSON-RPC request shape handled by the internal `kovo mcp` transport. */
export type KovoMcpRequest =
  | {
      id?: string | number | null;
      jsonrpc?: '2.0';
      method: 'tools/list';
    }
  | {
      id?: string | number | null;
      jsonrpc?: '2.0';
      method: 'tools/call';
      params: { arguments?: unknown; name: string };
    };

/** @internal JSON-RPC response shape emitted by the internal `kovo mcp` transport. */
export type KovoMcpResponse =
  | {
      id: string | number | null;
      jsonrpc: '2.0';
      result: {
        content: readonly { text: string; type: 'text' }[];
        structuredContent: unknown;
        version: typeof mcpOutputVersion;
      };
    }
  | {
      error: { code: number; message: string };
      id: string | number | null;
      jsonrpc: '2.0';
    };

/** @internal Backs the internal `compile_component` MCP tool; not a public API. */
export async function compileComponentV1(
  input: CompileComponentV1Input,
): Promise<CompileComponentV1Result> {
  const result = await compileCachedComponentModule(compileComponentOptions(input));

  return {
    componentGraphFacts: [...result.componentGraphFacts],
    // SPEC.md §11.3 owns code severity; this surface only copies the shared compiler facts.
    diagnostics: result.diagnostics.map((diagnostic) => {
      const value: CompileComponentV1Diagnostic = {
        code: diagnostic.code,
        fileName: diagnostic.fileName,
        message: diagnostic.message,
        severity: diagnostic.severity ?? diagnosticDefinitions[diagnostic.code].severity,
        ...(diagnostic.help === undefined ? {} : { help: diagnostic.help }),
        ...(diagnostic.length === undefined ? {} : { length: diagnostic.length }),
        ...(diagnostic.start === undefined
          ? {}
          : { start: { column: diagnostic.start.column, line: diagnostic.start.line } }),
      };
      return value;
    }),
    emittedFiles: result.files.map((file) => ({
      byteLength: byteLength(file.source),
      fileName: file.fileName,
      kind: file.kind,
    })),
    handlerExports: [...result.handlerExports],
    ok: result.diagnostics.every(
      (diagnostic) =>
        (diagnostic.severity ?? diagnosticDefinitions[diagnostic.code].severity) !== 'error',
    ),
    platformSubstitutions: [...result.platformSubstitutions],
    queryUpdatePlans: [...result.queryUpdatePlans],
    renderEquivalenceChecks: result.renderEquivalenceChecks.map((check) => ({
      ...(!check.ok && check.actual !== undefined ? { actual: check.actual } : {}),
      artifact: check.artifact,
      ...(!check.ok && check.detail !== undefined ? { detail: check.detail } : {}),
      ...(!check.ok && check.expected !== undefined ? { expected: check.expected } : {}),
      ok: check.ok,
    })),
    updateCoverage: [...result.updateCoverage],
    version: compileOutputVersion,
    viewTransitions: [...result.viewTransitions],
  };
}

export async function compileCachedComponentModule(
  options: CompileComponentOptions,
  cache = true,
): Promise<CompileResult> {
  const { compileComponentModule } = await import('@kovojs/compiler');
  if (!cache) return compileComponentModule(options);

  const cacheInput = compileComponentCacheKeyInput(options);
  const cacheKey = compileCacheKey(cacheInput);
  const cacheDir = persistentCompileCacheDir(options.packagePrefixDiscoveryRoot ?? process.cwd());
  const persistent = await readPersistentCompileCacheEntry<CompileResult>(cacheDir, cacheKey);
  if (persistent) return persistent;

  const result = await cliCompileComponentCache.getOrCreate(cacheInput, () =>
    compileComponentModule(options),
  );
  await writePersistentCompileCacheEntry(cacheDir, {
    cacheKey,
    footprint: result.dependencyFootprint,
    result,
  });
  return result;
}

function compileComponentOptions(input: CompileComponentV1Input): CompileComponentOptions {
  return {
    fileName: input.fileName,
    ...(input.packageComponentPrefixes === undefined
      ? {}
      : { packageComponentPrefixes: input.packageComponentPrefixes }),
    ...(input.packagePrefixDiscoveryRoot === undefined
      ? {}
      : { packagePrefixDiscoveryRoot: input.packagePrefixDiscoveryRoot }),
    ...(input.queryShapeFacts === undefined ? {} : { queryShapeFacts: input.queryShapeFacts }),
    ...(input.queryShapes === undefined ? {} : { queryShapes: input.queryShapes }),
    ...(input.registryFacts === undefined ? {} : { registryFacts: input.registryFacts }),
    source: input.source,
    ...(input.sourceProvenance === undefined ? {} : { sourceProvenance: input.sourceProvenance }),
  };
}

/** @internal Dispatches a single `kovo mcp` JSON-RPC request; not a public API. */
export async function handleKovoMcpRequest(request: unknown): Promise<KovoMcpResponse> {
  if (!isRecord(request)) return mcpError(null, -32600, 'request must be an object');
  const id = mcpRequestId(request.id);
  const method = request.method;

  if (method === 'tools/list') return mcpResult(id, listMcpTools());
  if (method !== 'tools/call') return mcpError(id, -32601, 'unknown method');

  const params = request.params;
  if (!isRecord(params) || typeof params.name !== 'string') {
    return mcpError(id, -32602, 'tools/call requires params.name');
  }

  try {
    const result = await callMcpTool(params.name, params.arguments);
    return mcpResult(id, result);
  } catch (error) {
    return mcpError(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function runGraphCommand(
  inputPath: string | undefined,
  run: (input: CoreGraph.KovoExplainInput) => KovoCheckResult,
): CliCommandResult {
  const input = readGraphInput(inputPath);
  if (!input.ok) return { error: inputErrorMessage(input.error), exitCode: 1 };
  return run(input.value);
}

export async function runMcpCommand(args: readonly string[]): Promise<0 | 1> {
  if (args.length > 0) {
    const [first] = args;
    const message =
      first === '--help' || first === '-h'
        ? mcpUsage()
        : `kovo: unknown mcp option ${stableValue(first)}.\n${mcpUsage()}`;
    return writeUsageError(message);
  }

  await runMcpSdkServer();
  return 0;
}

function mcpUsage(): string {
  return [
    MCP_USAGE,
    'Reads newline-delimited JSON-RPC requests from stdin and writes newline-delimited responses.',
    '',
  ].join('\n');
}

/** @internal Newline-delimited JSON-RPC stdio fallback for `kovo mcp`; not a public API. */
export async function runMcpFallbackStdio(
  input: AsyncIterable<Buffer | string>,
  output: { write(chunk: string): unknown },
): Promise<void> {
  let pending = '';

  for await (const chunk of input) {
    pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';

    for (const line of lines) {
      await writeMcpLine(line, output);
    }
  }

  if (pending.trim()) await writeMcpLine(pending, output);
}

async function writeMcpLine(
  line: string,
  output: { write(chunk: string): unknown },
): Promise<void> {
  if (!line.trim()) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    output.write(`${JSON.stringify(mcpError(null, -32700, 'parse error'))}\n`);
    return;
  }

  output.write(`${JSON.stringify(await handleKovoMcpRequest(parsed))}\n`);
}

/** @internal Connects the internal `kovo mcp` SDK server to a transport; not a public API. */
export async function runMcpSdkServer(transport?: Transport): Promise<void> {
  const [{ StdioServerTransport }, server] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    createMcpSdkServer(),
  ]);
  await server.connect(transport ?? new StdioServerTransport());
}

async function createMcpSdkServer(): Promise<
  InstanceType<typeof import('@modelcontextprotocol/sdk/server/index.js').Server>
> {
  const [{ Server: McpSdkServer }, { CallToolRequestSchema, ListToolsRequestSchema }] =
    await Promise.all([
      import('@modelcontextprotocol/sdk/server/index.js'),
      import('@modelcontextprotocol/sdk/types.js'),
    ]);
  const server = new McpSdkServer(
    { name: 'kovo', version: mcpOutputVersion },
    {
      capabilities: { tools: {} },
      instructions:
        'Kovo diagnostics surface. Tools wrap existing compile/check/explain APIs; SPEC §11.3 keeps severity policy in @kovojs/core.',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listMcpTools().tools.map((tool) => ({ ...tool })) as Tool[],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    try {
      const structuredContent = asMcpStructuredContent(
        await callMcpTool(request.params.name, request.params.arguments),
      );
      return mcpToolResult(structuredContent);
    } catch (error) {
      return {
        content: [
          {
            text: error instanceof Error ? error.message : String(error),
            type: 'text',
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

function mcpToolResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ text: mcpContentText(structuredContent), type: 'text' }],
    structuredContent,
  };
}

function asMcpStructuredContent(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error('MCP tool returned non-object structured content');
}

function writeCommandResult(result: CliCommandResult): 0 | 1 {
  if ('error' in result) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }

  const stream = result.exitCode === 0 ? process.stdout : process.stderr;
  stream.write(result.output);
  return result.exitCode;
}

async function callMcpTool(name: string, args: unknown): Promise<unknown> {
  if (name === 'compile_component') return compileComponentV1(assertCompileComponentV1Input(args));
  if (name === 'kovo_check') return runKovoCheckTool(args);
  if (name === 'kovo_explain') return runKovoExplainTool(args);
  if (name === 'list_diagnostics') return listDiagnosticsV1();

  throw new Error(`unknown tool ${stableValue(name)}`);
}

function listMcpTools(): {
  tools: readonly {
    description: string;
    inputSchema: Record<string, unknown>;
    name: KovoMcpToolName;
  }[];
  version: typeof mcpOutputVersion;
} {
  return {
    tools: [
      {
        description:
          'Compile an in-memory TSX/JSX component module and return the stable compile/v1 contract.',
        inputSchema: {
          additionalProperties: true,
          properties: {
            fileName: { type: 'string' },
            packageComponentPrefixes: { type: 'array' },
            packagePrefixDiscoveryRoot: { type: 'string' },
            queryShapeFacts: { type: 'array' },
            queryShapes: { type: 'object' },
            registryFacts: { type: 'object' },
            source: { type: 'string' },
            sourceProvenance: { enum: ['app'] },
          },
          required: ['fileName', 'source'],
          type: 'object',
        },
        name: 'compile_component',
      },
      {
        description: 'Run kovoCheck against an inline graph or graphPath.',
        inputSchema: graphToolSchema({ family: { enum: ['all', 'coverage', 'optimistic'] } }),
        name: 'kovo_check',
      },
      {
        description: 'Run kovoExplain against an inline graph or graphPath.',
        inputSchema: graphToolSchema({ options: { type: 'object' } }, ['options']),
        name: 'kovo_explain',
      },
      {
        description: 'List shared diagnostic definitions from the @kovojs/core registry.',
        inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
        name: 'list_diagnostics',
      },
    ],
    version: mcpOutputVersion,
  };
}

function graphToolSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    additionalProperties: false,
    properties: {
      graph: { type: 'object' },
      graphPath: { type: 'string' },
      ...properties,
    },
    required,
    type: 'object',
  };
}

function runKovoCheckTool(args: unknown): KovoCheckResult & { version: typeof outputVersion } {
  const options = assertGraphToolArgs(args);
  const graph = graphToolInput(options);
  const family = typeof options.family === 'string' ? checkFamilyArg(options.family) : 'all';
  const result = kovoCheck(graph, { family });
  return { ...result, version: outputVersion };
}

function runKovoExplainTool(
  args: unknown,
): KovoCheckResult & { version: typeof explainOutputVersion } {
  const options = assertGraphToolArgs(args);
  const explainOptions = assertKovoExplainOptions(options.options);
  const result = kovoExplain(graphToolInput(options), explainOptions);
  return { ...result, version: explainOutputVersion };
}

function graphToolInput(args: Record<string, unknown>): CoreGraph.KovoExplainInput {
  if ('graph' in args && 'graphPath' in args) {
    throw new Error('graph tools accept graph or graphPath, not both');
  }

  if ('graphPath' in args) {
    if (typeof args.graphPath !== 'string') throw new Error('graphPath must be a string');
    const read = readGraphInput(args.graphPath);
    if (!read.ok) throw new Error(inputErrorMessage(read.error));
    return read.value;
  }

  if ('graph' in args) {
    if (!isRecord(args.graph)) throw new Error('graph must be an object');
    const validationErrors = validateKovoExplainInput(args.graph);
    if (validationErrors.length > 0)
      throw new Error(validationErrors[0]?.message ?? 'invalid graph');
    return args.graph as CoreGraph.KovoExplainInput;
  }

  return {};
}

function assertGraphToolArgs(args: unknown): Record<string, unknown> {
  if (args === undefined) return {};
  if (!isRecord(args)) throw new Error('tool arguments must be an object');
  return args;
}

function assertCompileComponentV1Input(args: unknown): CompileComponentV1Input {
  if (!isRecord(args)) throw new Error('compile_component arguments must be an object');
  if (typeof args.fileName !== 'string') {
    throw new Error('compile_component fileName must be a string');
  }
  if (typeof args.source !== 'string') throw new Error('compile_component source must be a string');

  const input: CompileComponentV1Input = {
    fileName: args.fileName,
    source: args.source,
  };

  if (Array.isArray(args.packageComponentPrefixes)) {
    input.packageComponentPrefixes =
      args.packageComponentPrefixes as CompileComponentV1Input['packageComponentPrefixes'];
  }
  if (typeof args.packagePrefixDiscoveryRoot === 'string') {
    input.packagePrefixDiscoveryRoot = args.packagePrefixDiscoveryRoot;
  }
  if (Array.isArray(args.queryShapeFacts)) {
    input.queryShapeFacts = args.queryShapeFacts as readonly CompilerInternal.QueryShapeFact[];
  }
  if (isRecord(args.queryShapes)) {
    input.queryShapes = args.queryShapes as Record<string, CompilerInternal.QueryShape>;
  }
  if (isRecord(args.registryFacts)) {
    input.registryFacts = args.registryFacts as CompileComponentV1Input['registryFacts'];
  }
  if (args.sourceProvenance === 'app') {
    input.sourceProvenance = args.sourceProvenance;
  }

  return input;
}

function assertKovoExplainOptions(value: unknown): KovoExplainOptions {
  if (!isRecord(value)) throw new Error('kovo_explain options must be an object');

  if (value.access === true) {
    return {
      ...(value.failOnFindings === true ? { failOnFindings: true } : {}),
      access: true,
    };
  }
  if (value.endpoints === true) return { endpoints: true };
  if (value.unguarded === true) {
    return {
      ...(value.failOnFindings === true ? { failOnFindings: true } : {}),
      unguarded: true,
    };
  }
  if (value.unscoped === true) {
    return {
      ...(value.failOnFindings === true ? { failOnFindings: true } : {}),
      unscoped: true,
    };
  }

  const kind = typeof value.kind === 'string' ? value.kind : undefined;
  if (!isExplainKind(kind) || typeof value.target !== 'string') {
    throw new Error('kovo_explain options require kind and target, or a supported audit flag');
  }

  return {
    kind,
    ...(value.optimistic === true ? { optimistic: true } : {}),
    target: value.target,
  };
}

function listDiagnosticsV1(): {
  diagnostics: readonly {
    code: DiagnosticCode;
    detailLabels?: Readonly<Record<string, string>>;
    help?: string;
    message: string;
    severity: DiagnosticSeverity;
  }[];
  version: 'diagnostics/v1';
} {
  return {
    diagnostics: Object.values(diagnosticDefinitions)
      .map((definition) => {
        const detailLabels = 'detailLabels' in definition ? definition.detailLabels : undefined;
        const help = 'help' in definition ? definition.help : undefined;
        return {
          code: definition.code,
          ...(detailLabels === undefined ? {} : { detailLabels }),
          ...(help === undefined ? {} : { help }),
          message: definition.message,
          severity: definition.severity,
        };
      })
      .sort((left, right) => left.code.localeCompare(right.code)),
    version: 'diagnostics/v1',
  };
}

function mcpResult(
  id: string | number | null,
  structuredContent: unknown,
): Extract<KovoMcpResponse, { result: unknown }> {
  return {
    id,
    jsonrpc: '2.0',
    result: {
      content: [{ text: mcpContentText(structuredContent), type: 'text' }],
      structuredContent,
      version: mcpOutputVersion,
    },
  };
}

function mcpContentText(structuredContent: unknown): string {
  if (isRecord(structuredContent) && typeof structuredContent.version === 'string') {
    return structuredContent.version;
  }

  return mcpOutputVersion;
}

function mcpError(
  id: string | number | null,
  code: number,
  message: string,
): Extract<KovoMcpResponse, { error: unknown }> {
  return { error: { code, message }, id, jsonrpc: '2.0' };
}

function mcpRequestId(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
