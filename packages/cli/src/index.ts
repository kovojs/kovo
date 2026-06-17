#!/usr/bin/env node
export type { DiagnosticCode } from '@kovojs/core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CompileComponentOptions } from '@kovojs/compiler';
import type { QueryShape, QueryShapeFact } from '@kovojs/compiler/internal';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  diagnosticDefinitionText,
  diagnosticDefinitions,
  isDiagnosticCode,
  type DiagnosticCode,
  type DiagnosticSeverity,
} from '@kovojs/core';
import { puntReasonLabel } from '@kovojs/core/internal/derivation';
import {
  validateKovoExplainInput,
  type ComponentExplain,
  type EndpointExplain,
  type EventPayloadFact,
  type FixpointCheck,
  type KovoCheckInput,
  type KovoExplainInput,
  type GraphInputValidationError,
  type MutationExplain,
  type OptimisticCoverage,
  type PackageComponentPrefixExplain,
  type QueryReadSet,
  type QueryDataFact,
  type RenderEquivalenceCheck,
  type ScopeAuditFact,
  type SemanticLint,
  type StaticDiagnosticFact,
  type TouchGraph,
  type UpdateCoverageFact,
  type VerificationDiagnosticFact,
} from '@kovojs/core/internal/graph';
import type { KovoApp, StaticExportCompileDiagnostic } from '@kovojs/server';

import {
  availableAddComponents,
  isAddComponentName,
  vendoredUiComponents,
  type AddComponentName,
} from './add-catalog.js';

interface TouchGraphDiagnosticFact {
  code: DiagnosticCode;
  message: string;
  severity: DiagnosticSeverity;
  site: string;
}

interface UnguardedAccessFact {
  detail: string;
  kind: 'endpoint' | 'mutation' | 'page' | 'query';
  name: string;
}

/**
 * Result of a `kovoCheck`/`kovoExplain` run: the stable verifier output text and
 * a process exit code (0 success, 1 failure) matching what the `kovo` bin would
 * emit (SPEC.md §11.4 verification surface; §1.1 proof claims).
 */
export interface KovoCheckResult {
  exitCode: 0 | 1;
  output: string;
}

type KovoCheckFamily = 'all' | 'coverage' | 'optimistic';
type CliCommandResult = KovoCheckResult | { error: string; exitCode: 1 };

const outputVersion = 'kovo-check/v1';
const explainOutputVersion = 'kovo-explain/v1';
const auditOutputVersion = 'kovo-audit/v1';
const compileOutputVersion = 'compile/v1';
const addOutputVersion = 'kovo-add/v1';
const mcpOutputVersion = 'kovo-mcp/v1';

/** @internal Synchronous argv dispatcher for the `kovo` bin; not a public API. */
export function main(args: readonly string[] = process.argv.slice(2)): number {
  if (args.length === 0) {
    process.stdout.write('kovo: explain, check, audit, export, mcp\n');
    return 0;
  }

  if (args[0] === 'export' || args[0] === 'mcp') {
    throw new Error(`kovo ${args[0]} is asynchronous; call mainAsync() instead.`);
  }

  if (args[0] === 'check') {
    const parsed = parseCheckArgs(args.slice(1));
    if (!parsed.ok) return writeCheckUsageError(parsed);
    const { family, inputPath } = parsed;
    return writeCommandResult(runGraphCommand(inputPath, (input) => kovoCheck(input, { family })));
  }

  if (args[0] === 'add') {
    const parsed = parseAddArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(runAddCommand(parsed.options));
  }

  if (args[0] === 'audit') {
    const parsed = parseAuditArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(
      runGraphCommand(parsed.inputPath, (input) =>
        kovoAudit(input, { failOnFindings: parsed.failOnFindings }),
      ),
    );
  }

  if (args[0] === 'explain') {
    const parsed = parseExplainArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(
      runGraphCommand(parsed.inputPath, (input) => kovoExplain(input, parsed.options)),
    );
  }

  process.stderr.write(
    `kovo: unknown command ${stableValue(args[0])}. expected add, explain, check, audit, export, or mcp.\n`,
  );
  return 1;
}

/** @internal Async argv dispatcher (export/mcp) for the `kovo` bin; not a public API. */
export async function mainAsync(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (args[0] === 'mcp') return runMcpCommand(args.slice(1));
  if (args[0] !== 'export') return main(args);

  const parsed = parseExportArgs(args.slice(1));
  if (!parsed.ok) return writeUsageError(parsed.message);
  return writeCommandResult(await runExportCommand(parsed.options));
}

/** @internal Input shape for the internal `compile_component` MCP tool. */
export interface CompileComponentV1Input {
  fileName: string;
  packageComponentPrefixes?: CompileComponentOptions['packageComponentPrefixes'];
  packagePrefixDiscoveryRoot?: CompileComponentOptions['packagePrefixDiscoveryRoot'];
  queryShapeFacts?: readonly QueryShapeFact[];
  queryShapes?: Record<string, QueryShape>;
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
  const { compileComponentModule } = await import('@kovojs/compiler');
  const result = compileComponentModule(compileComponentOptions(input));

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
  run: (input: KovoExplainInput) => KovoCheckResult,
): CliCommandResult {
  const input = readGraphInput(inputPath);
  if (!input.ok) return { error: inputErrorMessage(input.error), exitCode: 1 };
  return run(input.value);
}

async function runMcpCommand(args: readonly string[]): Promise<0 | 1> {
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
    'usage: kovo mcp',
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
            sourceProvenance: { enum: ['app', 'compiler-emitted'] },
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

function graphToolInput(args: Record<string, unknown>): KovoExplainInput {
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
    return args.graph as KovoExplainInput;
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
    input.queryShapeFacts = args.queryShapeFacts as readonly QueryShapeFact[];
  }
  if (isRecord(args.queryShapes)) {
    input.queryShapes = args.queryShapes as Record<string, QueryShape>;
  }
  if (isRecord(args.registryFacts)) {
    input.registryFacts = args.registryFacts as CompileComponentV1Input['registryFacts'];
  }
  if (args.sourceProvenance === 'app' || args.sourceProvenance === 'compiler-emitted') {
    input.sourceProvenance = args.sourceProvenance;
  }

  return input;
}

function assertKovoExplainOptions(value: unknown): KovoExplainOptions {
  if (!isRecord(value)) throw new Error('kovo_explain options must be an object');

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

interface KovoExportOptions {
  appModulePath: string;
  onNonExportable?: 'error' | 'skip';
  origin?: string;
  outDir: string;
}

type ExportArgParseResult =
  | { ok: true; options: KovoExportOptions }
  | { message: string; ok: false };

interface AddComponentOptions {
  components: readonly AddComponentName[];
  outDir: string;
}

type AddArgParseResult =
  | { ok: true; options: AddComponentOptions }
  | { message: string; ok: false };

function parseAddArgs(args: readonly string[]): AddArgParseResult {
  let outDir = 'src/components/ui';
  const components: AddComponentName[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      return { message: addUsage(), ok: false };
    }

    if (arg === '--out') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: add --out requires a directory.\n', ok: false };
      outDir = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
      if (!outDir) return { message: 'kovo: add --out requires a directory.\n', ok: false };
      continue;
    }

    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown add option ${stableValue(arg)}.\n${addUsage()}`,
        ok: false,
      };
    }

    if (!isAddComponentName(arg)) {
      return {
        message: `kovo: unknown component ${stableValue(arg)}. available: ${availableAddComponents()}.`,
        ok: false,
      };
    }

    if (!components.includes(arg)) components.push(arg);
  }

  if (components.length === 0) {
    return { message: `kovo: add requires at least one component.\n${addUsage()}`, ok: false };
  }

  return { ok: true, options: { components, outDir } };
}

function addUsage(): string {
  return [
    `usage: kovo add <component...> [--out <dir>]`,
    `available: ${availableAddComponents()}`,
    '',
  ].join('\n');
}

function runAddCommand(options: AddComponentOptions): CliCommandResult {
  const lines = [addOutputVersion];
  mkdirSync(options.outDir, { recursive: true });

  for (const component of options.components) {
    const entry = vendoredUiComponents[component];
    if (!entry) {
      return {
        error: `${addOutputVersion}\nERROR ${component} reason=unknown-component`,
        exitCode: 1,
      };
    }
    const target = resolve(options.outDir, entry.fileName);

    // SPEC.md §5.2 requires vendored UI to land as TSX app source, not lowered IR.
    if (existsSync(target)) {
      const current = readFileSync(target, 'utf8');
      if (current === entry.source) {
        lines.push(`SKIP ${component} path=${JSON.stringify(target)} reason=already-current`);
        continue;
      }

      return {
        error: `${addOutputVersion}\nERROR ${component} path=${JSON.stringify(target)} reason=would-overwrite`,
        exitCode: 1,
      };
    }

    writeFileSync(target, entry.source, 'utf8');
    lines.push(`ADD ${component} path=${JSON.stringify(target)} source=tsx`);
  }

  lines.push(
    `SUMMARY total=${options.components.length} outDir=${JSON.stringify(resolve(options.outDir))}`,
  );
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

function parseExportArgs(args: readonly string[]): ExportArgParseResult {
  let appModulePath: string | undefined;
  let origin: string | undefined;
  let outDir = 'dist';
  let onNonExportable: 'error' | 'skip' | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      return { message: exportUsage(), ok: false };
    }

    if (arg === '--out') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: export --out requires a directory.\n', ok: false };
      outDir = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
      if (!outDir) return { message: 'kovo: export --out requires a directory.\n', ok: false };
      continue;
    }

    if (arg === '--origin') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: export --origin requires a URL.\n', ok: false };
      origin = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--origin=')) {
      origin = arg.slice('--origin='.length);
      if (!origin) return { message: 'kovo: export --origin requires a URL.\n', ok: false };
      continue;
    }

    if (arg === '--skip-non-exportable') {
      onNonExportable = 'skip';
      continue;
    }

    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown export option ${stableValue(arg)}.\n${exportUsage()}`,
        ok: false,
      };
    }

    if (appModulePath) {
      return { message: `kovo: export accepts one app module path.\n${exportUsage()}`, ok: false };
    }

    appModulePath = arg;
  }

  if (!appModulePath)
    return { message: `kovo: export requires an app module path.\n${exportUsage()}`, ok: false };

  return {
    ok: true,
    options: {
      appModulePath,
      ...(onNonExportable === undefined ? {} : { onNonExportable }),
      ...(origin === undefined ? {} : { origin }),
      outDir,
    },
  };
}

function exportUsage(): string {
  return [
    'usage: kovo export <app-module> [--out <dir>] [--origin <url>] [--skip-non-exportable]',
    '',
  ].join('\n');
}

async function runExportCommand(options: KovoExportOptions): Promise<CliCommandResult> {
  try {
    const [{ exportStaticApp }, appModule] = await Promise.all([
      import('@kovojs/server'),
      import(pathToFileURL(resolve(options.appModulePath)).href),
    ]);
    const app = appFromModule(appModule, options.appModulePath);
    const result = await exportStaticApp(app, {
      ...(options.onNonExportable === undefined
        ? {}
        : { onNonExportable: options.onNonExportable }),
      diagnostics: staticExportDiagnosticsFromModule(appModule),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      outDir: options.outDir,
    });

    return kovoExportResult(result, options);
  } catch (error) {
    return exportErrorResult(error);
  }
}

function appFromModule(module: unknown, source: string): KovoApp {
  if (typeof module === 'object' && module !== null) {
    const exports = module as { app?: unknown; default?: unknown };
    const app = exports.default ?? exports.app;
    if (isKovoApp(app)) return app;
  }

  throw new Error(`kovo export expected ${source} to export a Kovo app as default or named 'app'.`);
}

function isKovoApp(value: unknown): value is KovoApp {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { routes?: unknown }).routes) &&
    Array.isArray((value as { endpoints?: unknown }).endpoints) &&
    Array.isArray((value as { mutations?: unknown }).mutations) &&
    Array.isArray((value as { queries?: unknown }).queries) &&
    typeof (value as { clientModules?: { resolve?: unknown } }).clientModules?.resolve ===
      'function'
  );
}

function staticExportDiagnosticsFromModule(module: unknown): StaticExportCompileDiagnostic[] {
  if (typeof module !== 'object' || module === null) return [];
  const diagnostics = (module as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) return [];

  return diagnostics.filter(isStaticExportCompileDiagnostic);
}

function isStaticExportCompileDiagnostic(value: unknown): value is StaticExportCompileDiagnostic {
  if (typeof value !== 'object' || value === null) return false;
  const diagnostic = value as Partial<StaticExportCompileDiagnostic>;

  return (
    isDiagnosticCode(diagnostic.code) &&
    typeof diagnostic.fileName === 'string' &&
    typeof diagnostic.message === 'string'
  );
}

function kovoExportResult(
  result: Awaited<ReturnType<(typeof import('@kovojs/server'))['exportStaticApp']>>,
  options: KovoExportOptions,
): KovoCheckResult {
  const lines = ['kovo-export/v1'];

  for (const artifact of result.artifacts) {
    lines.push(
      `HTML ${artifact.path} status=${artifact.status} bytes=${byteLength(artifact.body)}`,
    );
  }

  for (const artifact of result.clientModules) {
    lines.push(
      `CLIENT-MODULE ${artifact.path} href=${JSON.stringify(artifact.href)} status=${artifact.status} bytes=${byteLength(artifact.body)}`,
    );
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(
      `WARN ${diagnostic.code} route=${diagnostic.routePath} ${stableText(diagnostic.message)}`,
    );
  }

  lines.push(
    `SUMMARY html=${result.artifacts.length} clientModules=${result.clientModules.length} diagnostics=${result.diagnostics.length} outDir=${JSON.stringify(options.outDir)}`,
  );

  return { exitCode: result.diagnostics.length > 0 ? 1 : 0, output: `${lines.join('\n')}\n` };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function exportErrorResult(error: unknown): CliCommandResult {
  if (isStaticExportDiagnosticError(error)) {
    return {
      error: [
        'kovo-export/v1',
        ...error.diagnostics.map(
          (diagnostic) =>
            `ERROR ${diagnostic.code} route=${diagnostic.routePath} ${stableText(diagnostic.message)}`,
        ),
      ].join('\n'),
      exitCode: 1,
    };
  }

  return {
    error: `kovo: export failed: ${error instanceof Error ? error.message : String(error)}`,
    exitCode: 1,
  };
}

function isStaticExportDiagnosticError(error: unknown): error is {
  diagnostics: readonly { code: DiagnosticCode; message: string; routePath: string }[];
} {
  return (
    typeof error === 'object' &&
    error !== null &&
    Array.isArray((error as { diagnostics?: unknown }).diagnostics)
  );
}

interface InputReadError {
  expected?: 'array' | 'object';
  field?: string;
  kind:
    | 'invalid-field-shape'
    | 'invalid-json'
    | 'invalid-shape'
    | 'invalid-value'
    | 'not-found'
    | 'read-error';
  message?: string;
  path: string;
}

type InputReadResult = { ok: true; value: KovoExplainInput } | { error: InputReadError; ok: false };

function readGraphInput(path: string | undefined): InputReadResult {
  if (!path) return { ok: true, value: {} };

  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    return {
      error: { kind: isNodeErrorCode(error, 'ENOENT') ? 'not-found' : 'read-error', path },
      ok: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { error: { kind: 'invalid-json', path }, ok: false };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: { kind: 'invalid-shape', path }, ok: false };
  }

  const validationErrors = validateKovoExplainInput(parsed);
  if (validationErrors.length > 0) {
    const validationError = validationErrors[0];
    if (validationError) {
      return { error: graphInputValidationReadError(validationError, path), ok: false };
    }
  }

  return { ok: true, value: parsed as KovoExplainInput };
}

function inputErrorMessage(error: InputReadError): string {
  const messages: Record<InputReadError['kind'], string> = {
    'invalid-field-shape': `kovo: input JSON field ${error.field ?? '-'} must be an ${error.expected ?? 'object'}: ${error.path}`,
    'invalid-json': `kovo: input file is not valid JSON: ${error.path}`,
    'invalid-shape': `kovo: input JSON must be an object: ${error.path}`,
    'invalid-value': `kovo: input JSON invalid: ${error.path}: ${error.field ?? '$'} ${error.message ?? 'is invalid'}`,
    'not-found': `kovo: input file not found: ${error.path}`,
    'read-error': `kovo: unable to read input file: ${error.path}`,
  };
  return messages[error.kind];
}

function writeUsageError(message: string): 1 {
  process.stderr.write(`${message}\n`);
  return 1;
}

function graphInputValidationReadError(
  error: GraphInputValidationError,
  path: string,
): InputReadError {
  const arrayShape = /^([A-Za-z]+) must be an array$/.exec(error.message);
  const arrayField = arrayShape?.[1];
  if (arrayField) {
    return { expected: 'array', field: arrayField, kind: 'invalid-field-shape', path };
  }
  if (error.message === 'touchGraph must be an object') {
    return { expected: 'object', field: 'touchGraph', kind: 'invalid-field-shape', path };
  }
  if (error.path === '$') return { kind: 'invalid-shape', path };

  return { field: error.path, kind: 'invalid-value', message: error.message, path };
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * The kind of graph subject a targeted `kovo explain` describes — a component,
 * mutation, query, or page (SPEC.md §5.3).
 */
export type ExplainKind = 'component' | 'mutation' | 'page' | 'query';

/**
 * Options selecting which `kovo explain` view `kovoExplain` produces: a targeted
 * component/mutation/query/page subject, the `--endpoints` machine-ingress audit,
 * or the `--unguarded`/`--unscoped` access audits (SPEC.md §5.3 and §11.4).
 */
export type KovoExplainOptions =
  | KovoEndpointExplainOptions
  | KovoTargetExplainOptions
  | KovoUnguardedExplainOptions
  | KovoUnscopedExplainOptions;

/**
 * `kovo explain --endpoints` options: emit the stable machine-ingress audit table
 * of every declared endpoint, webhook, and file/stream route (SPEC.md §11.4).
 */
export interface KovoEndpointExplainOptions {
  endpoints: true;
}

/**
 * Targeted `kovo explain` options: describe one graph subject of the given `kind`
 * and `target`, optionally including optimistic transform coverage for mutations
 * (SPEC.md §5.3).
 */
export interface KovoTargetExplainOptions {
  kind: ExplainKind;
  layouts?: boolean;
  optimistic?: boolean;
  target: string;
}

/**
 * `kovo explain --unguarded` options: audit every mutation, route, and query
 * reachable without an `authed` guard, optionally failing when findings exist
 * (SPEC.md §11.4).
 */
export interface KovoUnguardedExplainOptions {
  failOnFindings?: boolean;
  unguarded: true;
}

/**
 * `kovo explain --unscoped` options: audit every query or write touching an
 * owner-annotated domain without an owner scope, optionally failing when findings
 * exist (SPEC.md §11.4).
 */
export interface KovoUnscopedExplainOptions {
  failOnFindings?: boolean;
  unscoped: true;
}

/**
 * Run the `kovo explain` verifier in-process against an extracted graph.
 *
 * Prints the stable `kovo-explain/v1` graph view selected by `options`: a single
 * component, mutation, query, or page subject; the `--endpoints` machine-ingress
 * audit; or the `--unguarded`/`--unscoped` access audits (SPEC.md §5.3 and §11.4).
 * The printed format is stable so agents and graph queries can answer intent-level
 * questions over it (SPEC.md §1.1 proof claims). Returns the text plus an exit
 * code that is non-zero only when an audit ran with `failOnFindings` and findings
 * were present.
 */
export function kovoExplain(input: KovoExplainInput, options: KovoExplainOptions): KovoCheckResult {
  const validationErrors = validateKovoExplainInput(input);
  if (validationErrors.length > 0)
    return invalidGraphInputResult(explainOutputVersion, validationErrors);

  const lines = [explainOutputVersion];

  if ('unscoped' in options) {
    const findings = unscopedAccesses(input);
    lines.push('UNSCOPED');

    for (const finding of findings) {
      lines.push(unscopedLine(finding));
    }

    lines.push(`SUMMARY total=${findings.length}`);
    return explainAuditResult(lines, findings.length, options.failOnFindings);
  }

  if ('unguarded' in options) {
    const accesses = unguardedAccesses(input);
    lines.push('UNGUARDED');

    for (const access of accesses) {
      lines.push(unguardedLine(access));
    }

    lines.push(`SUMMARY total=${accesses.length}`);
    return explainAuditResult(lines, accesses.length, options.failOnFindings);
  }

  if ('endpoints' in options) {
    const endpoints = [...(input.endpoints ?? [])].sort(compareEndpointExplain);
    lines.push('ENDPOINTS');

    for (const endpoint of endpoints) {
      lines.push(endpointExplainLine(endpoint));
    }

    lines.push(`SUMMARY total=${endpoints.length}`);
    return ok(lines);
  }

  if (options.kind === 'component') {
    const component = findComponentExplain(input.components, options.target);
    if (!component) return notFound(options);
    const provenance = componentPrefixProvenance(component, options.target, input);

    lines.push(`COMPONENT ${component.name}`);
    if (provenance) lines.push(provenance);
    lines.push(`queries: ${list(component.queries)}`);
    lines.push(`fragments: ${list(component.fragments)}`);
    if (component.domName) lines.push(`dom-name: ${component.domName}`);
    if (component.disambiguatedDomName) {
      lines.push(`effective-dom-name: ${component.disambiguatedDomName}`);
    }

    for (const rule of component.styleRules ?? []) {
      lines.push(
        [
          'STYLE',
          `class=${rule.className}`,
          `source=${rule.source}`,
          `style-ref=${rule.styleRef}`,
        ].join(' '),
      );
    }

    for (const handler of component.handlers ?? []) {
      lines.push(
        [
          `HANDLER ${handler.event}`,
          `export=${handler.exportName}`,
          `ref=${handler.ref}`,
          `captures=${list(handler.captures)}`,
          `params=${list(handler.params)}`,
          `substitution=${handler.substitution ?? '-'}`,
        ].join(' '),
      );
    }

    for (const substitution of component.platformSubstitutions ?? []) {
      lines.push(
        [
          `SUBSTITUTION ${substitution.kind}`,
          `tag=${substitution.tag}`,
          `event=${substitution.event}`,
          `target=${substitution.target}`,
          `action=${substitution.action}`,
        ].join(' '),
      );
    }

    for (const derive of component.derives ?? []) {
      lines.push(
        [
          `DERIVE ${derive.name}`,
          `inputs=${list(derive.inputs)}`,
          `ref=${derive.ref}`,
          `target=${derive.target}`,
        ].join(' '),
      );
    }

    for (const trigger of component.triggers ?? []) {
      lines.push(
        [
          `TRIGGER ${trigger.trigger}`,
          `export=${trigger.exportName}`,
          `ref=${trigger.ref}`,
          `deps=${list(trigger.deps)}`,
          `justification=${trigger.justification ?? '-'}`,
        ].join(' '),
      );
    }

    for (const merge of component.attributeMerges ?? []) {
      lines.push(
        [
          `MERGE ${merge.element}`,
          `attr=${merge.attr}`,
          `rule=${merge.rule}`,
          `decision=${merge.decision}`,
          `diagnostics=${list(merge.diagnostics)}`,
        ].join(' '),
      );
    }

    return ok(lines);
  }

  if (options.kind === 'mutation') {
    const mutation = input.mutations?.find((item) => item.key === options.target);
    if (!mutation) return notFound(options);

    lines.push(`MUTATION ${mutation.key}`);
    lines.push(`guards: ${list(mutation.guards)}`);
    if (mutation.auth) lines.push(`auth: ${mutation.auth}`);
    if (mutation.session) lines.push(`session: ${mutation.session}`);
    if (mutation.enctype) lines.push(`enctype: ${mutation.enctype}`);
    if (mutation.inputFields) lines.push(`input-fields: ${list(mutation.inputFields)}`);
    if (mutation.fileFields) lines.push(`file-fields: ${list(mutation.fileFields)}`);
    lines.push(`writes: ${list(mutation.writes)}`);
    lines.push(`invalidates: ${list(mutation.invalidates)}`);
    lines.push(`manual-invalidates: ${list(mutation.manualInvalidates)}`);
    lines.push(`updates: ${listMutationUpdates(mutationUpdates(mutation, input))}`);

    if (options.optimistic) {
      const coverages = optimisticCoverageForMutation(mutation, input);

      for (const coverage of coverages) {
        // SPEC.md §10.5/§10.6: report transform coverage (status, incl. `derived`)
        // plus the derivation trace. A PUNTED derivation is metadata, not coverage,
        // so it renders as a separate OPTIMISTIC-PUNT line with its named reason and
        // the pair keeps its real status (UNHANDLED still shows the fix line).
        lines.push(`OPTIMISTIC ${coverage.query} ${coverage.status}`);
        if (coverage.derivation?.status === 'PUNTED') {
          // Field form (`<key>: <value>`) so the named reason's own colons stay in
          // the value; the key carries the query.
          lines.push(
            `OPTIMISTIC-PUNT ${coverage.query}: ${puntReasonLabel(coverage.derivation.reason)}`,
          );
        }
        if (coverage.status === 'UNHANDLED') {
          lines.push(optimisticUnhandledFixLine());
        }
      }

      lines.push(optimisticSummary(coverages));
    }

    return ok(lines);
  }

  if (options.kind === 'query') {
    const query = input.queries?.find((item) => item.query === options.target);
    if (!query) return notFound(options);

    lines.push(`QUERY ${query.query}`);
    lines.push(`reads: ${list(query.domains)}`);
    lines.push(`consumers: ${list(queryConsumers(query.query, input))}`);
    lines.push(`invalidated-by: ${list(invalidatedBy(query, input))}`);
    lines.push(`domain-writes: ${list(domainWritesFor(query, input))}`);
    return ok(lines);
  }

  const page = input.pages?.find((item) => item.route === options.target);
  if (!page) return notFound(options);

  lines.push(`PAGE ${page.route}`);
  lines.push(`prefetch: ${page.prefetch ?? false}`);
  if (page.meta) {
    lines.push(
      [
        'meta:',
        `title=${page.meta.title ?? '-'}`,
        `description=${page.meta.description ?? '-'}`,
        `image=${page.meta.image ?? '-'}`,
      ].join(' '),
    );
  }
  if (page.i18n) lines.push(`i18n: ${list(page.i18n)}`);
  lines.push(`modulepreloads: ${list(page.modulepreloads)}`);
  lines.push(`stylesheets: ${list(page.stylesheets)}`);
  lines.push(`queries: ${list(page.queries)}`);
  if (options.layouts) {
    lines.push(`layouts: ${list(page.layouts?.map((layout) => layout.name))}`);
    for (const layout of page.layouts ?? []) {
      lines.push(`layout: ${layout.name} queries=${list(layout.queries)}`);
    }
    lines.push(`navigation-segments: ${list(page.navigationSegments?.map((segment) => segment.id))}`);
    for (const segment of page.navigationSegments ?? []) {
      lines.push(
        [
          `segment: ${segment.kind}`,
          `id=${segment.id}`,
          `name=${segment.name}`,
          `queries=${list(segment.queries)}`,
          `components=${list(segment.components)}`,
        ].join(' '),
      );
    }
  }
  lines.push(`view-transitions: ${list(page.viewTransitions)}`);
  return ok(lines);
}

/** @internal Options for the internal `kovo audit` command; not a public API. */
export interface KovoAuditOptions {
  failOnFindings?: boolean;
}

/** @internal Backs the internal `kovo audit` command; not a public API. */
export function kovoAudit(
  input: KovoExplainInput,
  options: KovoAuditOptions = {},
): KovoCheckResult {
  const validationErrors = validateKovoExplainInput(input);
  if (validationErrors.length > 0)
    return invalidGraphInputResult(auditOutputVersion, validationErrors);

  const unguarded = unguardedAccesses(input);
  const manualInvalidates = (input.mutations ?? []).filter(
    (mutation) => (mutation.manualInvalidates?.length ?? 0) > 0,
  );
  const lines = [auditOutputVersion];

  if (unguarded.length > 0) {
    lines.push('UNGUARDED');

    for (const access of unguarded) {
      lines.push(unguardedLine(access));
    }
  }

  if (manualInvalidates.length > 0) {
    lines.push('MANUAL-INVALIDATES');

    for (const mutation of manualInvalidates) {
      lines.push(`MUTATION ${mutation.key} domains=${list(mutation.manualInvalidates)}`);
    }
  }

  if (lines.length === 1) {
    lines.push('OK');
  } else {
    lines.push(
      `SUMMARY unguarded=${unguarded.length} manual-invalidates=${manualInvalidates.length}`,
    );
  }

  const findingCount = unguarded.length + manualInvalidates.length;
  return {
    exitCode: options.failOnFindings && findingCount > 0 ? 1 : 0,
    output: `${lines.join('\n')}\n`,
  };
}

/**
 * Run the `kovo check` verifier in-process against an extracted graph.
 *
 * Reports the consistency and exhaustiveness findings of SPEC.md §11.4: touch-graph
 * diagnostics, optimistic exhaustiveness (KV310), update coverage (KV311), fixpoint
 * and render-equivalence invariants, and the unguarded/unscoped audits. The
 * optional `family` selects the `optimistic` or `coverage` slice (default `all`).
 * Returns the stable `kovo-check/v1` text plus an exit code that is non-zero when
 * any error-severity finding is present (SPEC.md §1.1 proof claims).
 */
export function kovoCheck(
  input: KovoCheckInput,
  options: { family?: KovoCheckFamily } = {},
): KovoCheckResult {
  const validationErrors = validateKovoExplainInput(input);
  if (validationErrors.length > 0) return invalidGraphInputResult(outputVersion, validationErrors);

  const lines = [outputVersion];
  const family = options.family ?? 'all';
  const includeAll = family === 'all';
  let failed = false;

  const pushFinding = (line: string, fail = false): void => {
    lines.push(line);
    failed ||= fail;
  };

  if (includeAll) {
    const diagnostics = diagnosticsForTouchGraph(input.touchGraph ?? {});

    for (const diagnostic of diagnostics) {
      pushFinding(
        `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.site} ${diagnostic.message}`,
        diagnostic.severity === 'error',
      );
    }

    for (const diagnostic of input.diagnostics ?? []) {
      pushFinding(staticDiagnosticLine(diagnostic), diagnosticSeverity(diagnostic) === 'error');
    }

    for (const diagnostic of input.verificationDiagnostics ?? []) {
      pushFinding(
        verificationDiagnosticLine(diagnostic),
        diagnosticSeverity(diagnostic) === 'error',
      );
    }
  }

  if (includeAll || family === 'optimistic') {
    for (const warning of optimisticCoverageWarnings(
      input.mutations ?? [],
      input.queries ?? [],
      input.optimistic ?? [],
    )) {
      pushFinding(warning, true);
    }
  }

  if (includeAll || family === 'coverage') {
    for (const fact of sortedUpdateCoverage(input.updateCoverage ?? [])) {
      pushFinding(updateCoverageLine(fact), fact.status === 'UNHANDLED');
    }
  }

  if (includeAll) {
    for (const finding of unscopedAccesses(input)) {
      pushFinding(`WARN ${unscopedLine(finding)}`);
    }

    for (const lint of input.lints ?? []) {
      pushFinding(`LINT ${lint.code} ${lint.site} ${lintMessage(lint)}`);
    }

    for (const lint of eventPayloadQueryLints(input.eventPayloads ?? [], input.queryData ?? [])) {
      pushFinding(`LINT ${lint.code} ${lint.site} ${lintMessage(lint)}`);
    }

    for (const failure of fixpointFailures(input.fixpointChecks ?? [])) {
      pushFinding(fixpointFailureLine(failure), true);
    }

    for (const failure of renderEquivalenceFailures(input.renderEquivalenceChecks ?? [])) {
      pushFinding(renderEquivalenceFailureLine(failure), true);
    }

    for (const missed of missedQueryInvalidations(
      input.queries ?? [],
      input.touchGraph ?? {},
      input.mutations ?? [],
    )) {
      const message = diagnosticDefinitionText('KV407', { includeHelp: true });
      pushFinding(`ERROR KV407 ${missed.query} reads ${missed.domain}. ${message}`, true);
    }

    for (const access of unguardedAccesses(input)) {
      pushFinding(unguardedWarningLine(access));
    }

    for (const endpoint of input.endpoints ?? []) {
      if (endpoint.csrf === 'exempt' && !endpoint.csrfJustification) {
        pushFinding(
          `WARN ENDPOINT ${endpointName(endpoint)} csrf exemption requires a named justification.`,
        );
      }
    }

    for (const mutation of input.mutations ?? []) {
      for (const domain of mutation.manualInvalidates ?? []) {
        pushFinding(
          `WARN INVALIDATE ${mutation.key} -> ${domain} Manual invalidate escape hatch requires review.`,
        );
      }
    }
  }

  if (lines.length === 1) {
    lines.push('OK');
  }

  return {
    exitCode: failed ? 1 : 0,
    output: `${lines.join('\n')}\n`,
  };
}

function invalidGraphInputResult(
  version: string,
  errors: readonly GraphInputValidationError[],
): KovoCheckResult {
  const lines = [version, ...errors.map((error) => `ERROR INPUT ${error.path} ${error.message}`)];
  return {
    exitCode: 1,
    output: `${lines.join('\n')}\n`,
  };
}

function diagnosticSeverity(
  diagnostic: Pick<StaticDiagnosticFact, 'code' | 'severity'>,
): DiagnosticSeverity {
  return diagnostic.severity ?? diagnosticDefinitions[diagnostic.code].severity;
}

function checkFamilyArg(value: string | undefined): KovoCheckFamily {
  return value === 'optimistic' || value === 'coverage' ? value : 'all';
}

type CheckArgParseResult =
  | { family: KovoCheckFamily; inputPath: string | undefined; ok: true }
  | { family: string | undefined; kind: 'too-many-args' | 'unsupported-family'; ok: false };

function parseCheckArgs(args: readonly string[]): CheckArgParseResult {
  const family = checkFamilyArg(args[0]);
  if (family !== 'all') {
    if (args.length > 2) return { family: args[0], kind: 'too-many-args', ok: false };
    return { family, inputPath: args[1], ok: true };
  }
  if (args.length > 1) return { family: args[0], kind: 'unsupported-family', ok: false };
  return { family, inputPath: args[0], ok: true };
}

function writeCheckUsageError(error: Extract<CheckArgParseResult, { ok: false }>): number {
  const message =
    error.kind === 'unsupported-family'
      ? `kovo: unsupported check family ${stableValue(error.family)}. expected optimistic or coverage.\n`
      : 'kovo: usage: kovo check [optimistic|coverage] [graph.json]\n';
  process.stderr.write(message);
  return 1;
}

type AuditArgParseResult =
  | { failOnFindings: boolean; inputPath: string | undefined; ok: true }
  | { message: string; ok: false };

function parseAuditArgs(args: readonly string[]): AuditArgParseResult {
  const parsed = parseFlaggedArgs(args, ['--fail-on-findings']);
  if (!parsed.ok) return parsed;
  if (parsed.positional.length > 1) {
    return { message: 'kovo: usage: kovo audit [--fail-on-findings] [graph.json]', ok: false };
  }

  return {
    failOnFindings: parsed.flags.has('--fail-on-findings'),
    inputPath: parsed.positional[0],
    ok: true,
  };
}

type ExplainArgParseResult =
  | { inputPath: string | undefined; ok: true; options: KovoExplainOptions }
  | { message: string; ok: false };

function parseExplainArgs(args: readonly string[]): ExplainArgParseResult {
  const parsed = parseFlaggedArgs(args, [
    '--endpoints',
    '--fail-on-findings',
    '--layouts',
    '--optimistic',
    '--unguarded',
    '--unscoped',
  ]);
  if (!parsed.ok) return parsed;

  const { flags, positional } = parsed;
  const modeFlags = ['--endpoints', '--unguarded', '--unscoped'].filter((flag) => flags.has(flag));
  if (modeFlags.length > 1) return explainUsage();

  if (flags.has('--endpoints')) {
    if (
      flags.has('--fail-on-findings') ||
      flags.has('--layouts') ||
      flags.has('--optimistic') ||
      positional.length > 1
    ) {
      return explainUsage();
    }
    return { inputPath: positional[0], ok: true, options: { endpoints: true } };
  }

  if (flags.has('--unguarded') || flags.has('--unscoped')) {
    if (flags.has('--layouts') || flags.has('--optimistic') || positional.length > 1) {
      return explainUsage();
    }
    const options = flags.has('--unguarded')
      ? ({ failOnFindings: flags.has('--fail-on-findings'), unguarded: true } as const)
      : ({ failOnFindings: flags.has('--fail-on-findings'), unscoped: true } as const);
    return { inputPath: positional[0], ok: true, options };
  }

  if (flags.has('--fail-on-findings')) return explainUsage();

  const [kind, target, inputPath, extra] = positional;
  if (!isExplainKind(kind) || !target || extra) return explainUsage();
  if (flags.has('--layouts') && kind !== 'page') return explainUsage();

  return {
    inputPath,
    ok: true,
    options: { kind, layouts: flags.has('--layouts'), optimistic: flags.has('--optimistic'), target },
  };
}

function explainUsage(): ExplainArgParseResult {
  return {
    message:
      'kovo: usage: kovo explain component|mutation|query|page <target> [--optimistic] [--layouts] [graph.json] | kovo explain --endpoints [graph.json] | kovo explain --unguarded [--fail-on-findings] [graph.json] | kovo explain --unscoped [--fail-on-findings] [graph.json]',
    ok: false,
  };
}

type FlagParseResult =
  | { flags: Set<string>; ok: true; positional: string[] }
  | { message: string; ok: false };

function parseFlaggedArgs(
  args: readonly string[],
  allowedFlags: readonly string[],
): FlagParseResult {
  const allowed = new Set(allowedFlags);
  const flags = new Set<string>();
  const positional: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('--')) {
      if (!allowed.has(arg))
        return { message: `kovo: unknown flag ${stableValue(arg)}`, ok: false };
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }

  return { flags, ok: true, positional };
}

function ok(lines: string[]): KovoCheckResult {
  return {
    exitCode: 0,
    output: `${lines.join('\n')}\n`,
  };
}

function explainAuditResult(
  lines: string[],
  findingCount: number,
  failOnFindings = false,
): KovoCheckResult {
  return {
    exitCode: failOnFindings && findingCount > 0 ? 1 : 0,
    output: `${lines.join('\n')}\n`,
  };
}

function diagnosticsForTouchGraph(graph: TouchGraph): TouchGraphDiagnosticFact[] {
  return Object.values(graph).flatMap((entry) => [
    ...entry.unresolved.map((unresolved) => ({
      code: unresolved.code,
      message: unresolved.message,
      severity: diagnosticDefinitions[unresolved.code].severity,
      site: unresolved.site,
    })),
    ...entry.touches
      .filter((touch) => touch.predicate === 'non-eq')
      .map((touch) => ({
        code: 'KV409' as const,
        message: diagnosticDefinitions.KV409.message,
        severity: diagnosticDefinitions.KV409.severity,
        site: touch.site,
      })),
    ...(entry.reads ?? [])
      .filter((read) => read.predicate === 'non-eq')
      .map((read) => ({
        code: 'KV409' as const,
        message: diagnosticDefinitions.KV409.message,
        severity: diagnosticDefinitions.KV409.severity,
        site: read.site,
      })),
  ]);
}

function verificationDiagnosticLine(diagnostic: VerificationDiagnosticFact): string {
  const definition = diagnosticDefinitions[diagnostic.code];
  const severity = diagnostic.severity ?? definition.severity;
  const site = diagnostic.site ?? (diagnostic.domain ? `domain:${diagnostic.domain}` : '-');
  const details = [
    diagnostic.domain ? `domain=${diagnostic.domain}` : '',
    diagnostic.branch ? `branch=${diagnostic.branch}` : '',
    diagnostic.detail ?? '',
  ].filter(Boolean);
  const suffix = details.length > 0 ? ` ${details.join(' ')}` : '';

  return `${severity.toUpperCase()} ${diagnostic.code} ${site} ${diagnostic.message ?? definition.message}${suffix}`;
}

function staticDiagnosticLine(diagnostic: StaticDiagnosticFact): string {
  const definition = diagnosticDefinitions[diagnostic.code];
  const severity = diagnostic.severity ?? definition.severity;
  return `${severity.toUpperCase()} ${diagnostic.code} ${diagnosticSite(diagnostic)} ${diagnostic.message ?? definition.message}`;
}

function diagnosticSite(diagnostic: StaticDiagnosticFact): string {
  return diagnostic.start
    ? `${diagnostic.site}:${diagnostic.start.line}:${diagnostic.start.column}`
    : diagnostic.site;
}

function notFound(options: KovoTargetExplainOptions): KovoCheckResult {
  return {
    exitCode: 1,
    output: `${explainOutputVersion}\nERROR NOT_FOUND ${options.kind} ${options.target}\n`,
  };
}

function list(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join(',') : '-';
}

function findComponentExplain(
  components: readonly ComponentExplain[] | undefined,
  target: string,
): ComponentExplain | undefined {
  return components?.find(
    (component) =>
      component.name === target ||
      component.domName === target ||
      component.disambiguatedDomName === target ||
      componentWireName(component.name) === target,
  );
}

function componentPrefixProvenance(
  component: ComponentExplain,
  target: string,
  input: KovoExplainInput,
): string | null {
  const wireName = target.includes('-') ? target : componentWireName(component.name);
  const owner = packagePrefixOwner(input.packageComponentPrefixes, wireName);
  if (!owner) return null;

  const effectivePrefix = owner.effectivePrefix ?? owner.prefix;
  if (!effectivePrefix) return null;

  return [
    'provenance:',
    `package=${owner.packageName}`,
    `prefix=${owner.prefix ?? '-'}`,
    `effective-prefix=${effectivePrefix}`,
    'source=package-prefix-fact',
  ].join(' ');
}

function packagePrefixOwner(
  facts: readonly PackageComponentPrefixExplain[] | undefined,
  wireName: string,
): PackageComponentPrefixExplain | null {
  const candidates = (facts ?? [])
    .filter((fact) => {
      const effectivePrefix = fact.effectivePrefix ?? fact.prefix;
      return Boolean(effectivePrefix && wireName.startsWith(effectivePrefix));
    })
    .sort((left, right) => {
      const leftPrefix = left.effectivePrefix ?? left.prefix ?? '';
      const rightPrefix = right.effectivePrefix ?? right.prefix ?? '';
      return (
        rightPrefix.length - leftPrefix.length || left.packageName.localeCompare(right.packageName)
      );
    });

  return candidates[0] ?? null;
}

function componentWireName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function isExplainKind(value: string | undefined): value is ExplainKind {
  return value === 'component' || value === 'mutation' || value === 'page' || value === 'query';
}

function invalidatedBy(query: QueryReadSet, input: KovoExplainInput): string[] {
  const invalidators = new Set<string>();

  for (const mutation of input.mutations ?? []) {
    const domains = mutationAffectedDomains(mutation);

    if (query.domains.some((domain) => domains.has(domain))) {
      invalidators.add(mutation.key);
    }
  }

  return [...invalidators].sort();
}

function domainWritesFor(query: QueryReadSet, input: KovoExplainInput): string[] {
  const writes = new Set<string>();

  for (const [writeName, entry] of Object.entries(input.touchGraph ?? {})) {
    if (entry.touches.some((touch) => query.domains.some((domain) => domain === touch.domain))) {
      writes.add(writeName);
    }
  }

  return [...writes].sort();
}

function queryConsumers(queryName: string, input: KovoExplainInput): string[] {
  const components =
    input.components
      ?.filter((component) => component.queries?.includes(queryName))
      .map((component) => `component:${component.name}`) ?? [];
  const pages =
    input.pages
      ?.filter((page) => page.queries?.includes(queryName))
      .map((page) => `page:${page.route}`) ?? [];

  return [...components, ...pages].sort();
}

function mutationUpdates(
  mutation: MutationExplain,
  input: KovoExplainInput,
): Array<{ consumers: string[]; query: string }> {
  const domains = mutationAffectedDomains(mutation);
  if (domains.size === 0) return [];

  return (input.queries ?? [])
    .filter((query) => query.domains.some((domain) => domains.has(domain)))
    .map((query) => ({
      consumers: queryConsumers(query.query, input),
      query: query.query,
    }))
    .filter((update) => update.consumers.length > 0)
    .sort((left, right) => left.query.localeCompare(right.query));
}

function listMutationUpdates(
  updates: readonly { consumers: readonly string[]; query: string }[],
): string {
  if (updates.length === 0) return '-';

  return updates.map((update) => `${update.query}->${list(update.consumers)}`).join('; ');
}

function unguardedAccesses(input: KovoExplainInput): UnguardedAccessFact[] {
  return [
    ...(input.endpoints ?? [])
      .filter((endpoint) => !hasEndpointAuth(endpoint))
      .map((endpoint) => ({
        detail: [
          `method=${endpoint.method ?? 'ANY'}`,
          `path=${endpoint.path}`,
          `mount=${endpoint.mount ?? 'exact'}`,
          `auth=${endpointAuth(endpoint)}`,
          `csrf=${endpointCsrf(endpoint)}`,
        ].join(' '),
        kind: 'endpoint' as const,
        name: endpointName(endpoint),
      })),
    ...(input.mutations ?? [])
      .filter((mutation) => !hasMutationAuth(mutation))
      .map((mutation) => ({
        detail: [
          `guards=${list(mutation.guards)}`,
          mutation.auth === undefined ? '' : `auth=${mutationAuth(mutation)}`,
          `writes=${list(mutation.writes)}`,
          `invalidates=${list(mutation.invalidates)}`,
          `manual-invalidates=${list(mutation.manualInvalidates)}`,
        ]
          .filter(Boolean)
          .join(' '),
        kind: 'mutation' as const,
        name: mutation.key,
      })),
    ...(input.queries ?? [])
      .filter((query) => query.guards !== undefined && !hasAuthGuard(query.guards))
      .map((query) => ({
        detail: [`guards=${list(query.guards)}`, `reads=${list(query.domains)}`].join(' '),
        kind: 'query' as const,
        name: query.query,
      })),
    ...(input.pages ?? [])
      .filter((page) => page.guards !== undefined && !hasAuthGuard(page.guards))
      .map((page) => ({
        detail: [`guards=${list(page.guards)}`, `queries=${list(page.queries)}`].join(' '),
        kind: 'page' as const,
        name: page.route,
      })),
  ].sort(compareUnguardedAccess);
}

function unguardedLine(access: UnguardedAccessFact): string {
  return `${access.kind.toUpperCase()} ${access.name} ${access.detail}`;
}

function endpointExplainLine(endpoint: EndpointExplain): string {
  return [
    `ENDPOINT ${endpointName(endpoint)}`,
    `method=${endpoint.method ?? 'ANY'}`,
    `path=${endpoint.path}`,
    `mount=${endpoint.mount ?? 'exact'}`,
    `auth=${endpointAuth(endpoint)}`,
    `csrf=${endpointCsrf(endpoint)}`,
    `writes=${list(endpoint.writes)}`,
  ].join(' ');
}

function unguardedWarningLine(access: UnguardedAccessFact): string {
  if (access.kind === 'endpoint') {
    return `WARN UNGUARDED ${access.name} endpoint is reachable without an auth declaration.`;
  }

  if (access.kind === 'mutation') {
    return `WARN UNGUARDED ${access.name} mutation is reachable without an auth guard.`;
  }

  return `WARN UNGUARDED ${access.kind} ${access.name} is reachable without an auth guard.`;
}

function compareUnguardedAccess(left: UnguardedAccessFact, right: UnguardedAccessFact): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
}

function hasAuthGuard(guards: readonly string[]): boolean {
  return guards.some((guard) => guard === 'authed' || guard.startsWith('role:'));
}

function hasMutationAuth(mutation: MutationExplain): boolean {
  if (hasAuthGuard(mutation.guards ?? [])) return true;
  return mutationAuth(mutation) !== 'none';
}

function mutationAuth(mutation: MutationExplain): string {
  return mutation.auth ?? 'none';
}

function hasEndpointAuth(endpoint: EndpointExplain): boolean {
  if (hasAuthGuard(endpoint.guards ?? [])) return true;
  if (!endpoint.auth) return false;

  return (
    endpoint.auth === 'authed' ||
    endpoint.auth.startsWith('role:') ||
    endpoint.auth.startsWith('custom:') ||
    endpoint.auth.startsWith('verifier:')
  );
}

function endpointName(endpoint: EndpointExplain): string {
  return endpoint.name ?? endpoint.path;
}

function compareEndpointExplain(left: EndpointExplain, right: EndpointExplain): number {
  return endpointName(left).localeCompare(endpointName(right));
}

function endpointAuth(endpoint: EndpointExplain): string {
  return endpoint.auth ?? list(endpoint.guards);
}

function endpointCsrf(endpoint: EndpointExplain): string {
  if (endpoint.csrf !== 'exempt') return endpoint.csrf ?? 'checked';
  return `exempt:${endpoint.csrfJustification ?? '-'}`;
}

function optimisticSummary(coverages: readonly OptimisticCoverage[]): string {
  // SPEC.md §10.6: v2 adds `derived` to the status partition. PUNTED is a separate
  // dimension (derivation metadata that never counts as coverage), reported
  // alongside the status counts.
  const counts: Record<OptimisticCoverage['status'], number> = {
    UNHANDLED: 0,
    'await-fragment': 0,
    derived: 0,
    'hand-written': 0,
  };
  let punted = 0;

  for (const coverage of coverages) {
    counts[coverage.status] += 1;
    if (coverage.derivation?.status === 'PUNTED') punted += 1;
  }

  return [
    'OPTIMISTIC-SUMMARY',
    `total=${coverages.length}`,
    `derived=${counts.derived}`,
    `hand-written=${counts['hand-written']}`,
    `await-fragment=${counts['await-fragment']}`,
    `UNHANDLED=${counts.UNHANDLED}`,
    `PUNTED=${punted}`,
  ].join(' ');
}

function optimisticCoverageWarnings(
  mutations: readonly MutationExplain[],
  queries: readonly QueryReadSet[],
  coverages: readonly OptimisticCoverage[],
): string[] {
  const covered = new Map(
    coverages.map((coverage) => [`${coverage.mutation}\0${coverage.query}`, coverage.status]),
  );
  const warnings: string[] = [];

  for (const coverage of coverages) {
    if (coverage.status !== 'UNHANDLED') continue;

    warnings.push(optimisticCoverageWarning(coverage.mutation, coverage.query));
  }

  for (const mutation of mutations) {
    const domains = mutationAffectedDomains(mutation);
    if (domains.size === 0) continue;

    for (const query of queries) {
      if (!query.domains.some((domain) => domains.has(domain))) continue;
      if (covered.has(`${mutation.key}\0${query.query}`)) continue;

      warnings.push(optimisticCoverageWarning(mutation.key, query.query));
    }
  }

  return warnings;
}

function optimisticCoverageWarning(mutation: string, query: string): string {
  return `WARN KV310 ${mutation} -> ${query} ${diagnosticDefinitions.KV310.message}`;
}

function sortedUpdateCoverage(coverage: readonly UpdateCoverageFact[]): UpdateCoverageFact[] {
  return [...coverage].sort(compareUpdateCoverage);
}

function updateCoverageLine(fact: UpdateCoverageFact): string {
  if (fact.status === 'UNHANDLED') {
    return [
      'WARN KV311',
      `component=${fact.component}`,
      `query=${fact.query}`,
      fact.source ? `source=${fact.source}` : '',
      `position=${JSON.stringify(fact.position)}`,
      diagnosticDefinitions.KV311.message,
      fact.detail ?? '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return [
    'COVERAGE',
    `component=${fact.component}`,
    `query=${fact.query}`,
    fact.source ? `source=${fact.source}` : '',
    `position=${JSON.stringify(fact.position)}`,
    `status=${fact.status}`,
    fact.detail ? `detail=${JSON.stringify(fact.detail)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function unscopedAccesses(input: KovoCheckInput): ScopeAuditFact[] {
  const ownerDomains = new Set((input.ownerDomains ?? []).map((owner) => owner.domain));

  return (input.scopeAudits ?? [])
    .filter((fact) => ownerDomains.has(fact.domain))
    .filter((fact) => fact.scope !== 'session')
    .sort(compareScopeAudit);
}

function unscopedLine(fact: ScopeAuditFact): string {
  return [
    'UNSCOPED',
    fact.kind.toUpperCase(),
    fact.name,
    `domain=${fact.domain}`,
    `scope=${fact.scope}`,
    `site=${fact.site}`,
    fact.detail ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

function compareScopeAudit(left: ScopeAuditFact, right: ScopeAuditFact): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.domain.localeCompare(right.domain) ||
    left.site.localeCompare(right.site) ||
    left.scope.localeCompare(right.scope)
  );
}

function compareUpdateCoverage(left: UpdateCoverageFact, right: UpdateCoverageFact): number {
  return (
    left.component.localeCompare(right.component) ||
    left.query.localeCompare(right.query) ||
    (left.source ?? '').localeCompare(right.source ?? '') ||
    left.position.localeCompare(right.position) ||
    left.status.localeCompare(right.status)
  );
}

function optimisticUnhandledFixLine(): string {
  return "  -> hand-write in the mutation module, or declare 'await-fragment'";
}

function optimisticCoverageForMutation(
  mutation: MutationExplain,
  input: KovoExplainInput,
): OptimisticCoverage[] {
  const affectedQueries = new Set(
    mutationAffectedQueries(mutation, input).map((query) => query.query),
  );
  const explicit =
    input.optimistic?.filter(
      (item) => item.mutation === mutation.key && affectedQueries.has(item.query),
    ) ?? [];
  const covered = new Set(explicit.map((coverage) => coverage.query));
  const derivedUnhandled = mutationAffectedQueries(mutation, input)
    .filter((query) => !covered.has(query.query))
    .map((query) => ({
      mutation: mutation.key,
      query: query.query,
      status: 'UNHANDLED' as const,
    }))
    .sort((left, right) => left.query.localeCompare(right.query));

  return [...explicit, ...derivedUnhandled];
}

function mutationAffectedQueries(
  mutation: MutationExplain,
  input: KovoExplainInput,
): readonly QueryReadSet[] {
  const domains = mutationAffectedDomains(mutation);
  if (domains.size === 0) return [];

  return (input.queries ?? []).filter((query) =>
    query.domains.some((domain) => domains.has(domain)),
  );
}

function mutationAffectedDomains(mutation: MutationExplain): Set<string> {
  return new Set([
    ...(mutation.writes ?? []),
    ...(mutation.invalidates ?? []),
    ...(mutation.manualInvalidates ?? []),
  ]);
}

function fixpointFailures(checks: readonly FixpointCheck[]): FixpointCheck[] {
  return checks
    .filter((check) => !check.ok)
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
}

function fixpointFailureLine(check: FixpointCheck): string {
  const detail = stableText(check.detail ?? 'Generated output must compile to itself.');
  const diff =
    check.expected === undefined && check.actual === undefined
      ? ''
      : ` expected=${stableValue(check.expected)} actual=${stableValue(check.actual)}`;

  return `ERROR FIXPOINT ${check.artifact} ${detail}${diff}`;
}

function renderEquivalenceFailures(
  checks: readonly RenderEquivalenceCheck[],
): RenderEquivalenceCheck[] {
  return checks
    .filter((check) => !check.ok)
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
}

function renderEquivalenceFailureLine(check: RenderEquivalenceCheck): string {
  const detail = stableText(
    check.detail ?? 'Authored and lowered render output must match byte-for-byte.',
  );
  const diff =
    check.expected === undefined && check.actual === undefined
      ? ''
      : ` expected=${stableValue(check.expected)} actual=${stableValue(check.actual)}`;

  return `ERROR RENDER_EQUIV ${check.artifact} ${detail}${diff}`;
}

function stableValue(value: string | undefined): string {
  return value === undefined ? '-' : JSON.stringify(value);
}

function stableText(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ');
}

function lintMessage(lint: SemanticLint): string {
  const base = diagnosticDefinitions[lint.code].message;

  return lint.detail ? `${base} ${lint.detail}` : base;
}

function missedQueryInvalidations(
  queries: readonly QueryReadSet[],
  touchGraph: TouchGraph,
  mutations: readonly MutationExplain[],
): { domain: string; query: string }[] {
  const touchedDomains = new Set(
    Object.values(touchGraph).flatMap((entry) => entry.touches.map((touch) => touch.domain)),
  );
  const mutationDomains = new Set(
    mutations.flatMap((mutation) => [...mutationAffectedDomains(mutation)]),
  );

  return queries.flatMap((query) =>
    query.domains
      .filter((domain) => !touchedDomains.has(domain) && !mutationDomains.has(domain))
      .map((domain) => ({ domain, query: query.query })),
  );
}

function eventPayloadQueryLints(
  events: readonly EventPayloadFact[],
  queries: readonly QueryDataFact[],
): SemanticLint[] {
  const queryFields = new Map<string, string[]>();

  for (const query of queries) {
    for (const field of query.fields) {
      const existing = queryFields.get(normalizePath(field)) ?? [];
      existing.push(query.query);
      queryFields.set(normalizePath(field), existing);
    }
  }

  return events.flatMap((event) =>
    event.fields.flatMap((field) => {
      const normalizedField = normalizePath(field);
      const queryNames = queryFields.get(normalizedField);
      if (!queryNames) return [];

      return [
        {
          code: 'KV320',
          detail: `event ${event.event} carries ${normalizedField} from query ${[
            ...new Set(queryNames),
          ]
            .sort()
            .join(',')}.`,
          site: event.site,
        },
      ] satisfies SemanticLint[];
    }),
  );
}

function normalizePath(path: string): string {
  return path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void mainAsync().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
