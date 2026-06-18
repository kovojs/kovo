#!/usr/bin/env node
export type { DiagnosticCode } from '@kovojs/core';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  CompileComponentOptions,
  CompileRouteModuleOptions,
  RouteComponentImportRewrite,
} from '@kovojs/compiler';
import type * as CompilerInternal from '@kovojs/compiler/internal';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  diagnosticDefinitionText,
  diagnosticDefinitions,
  isDiagnosticCode,
  type DiagnosticCode,
  type DiagnosticSeverity,
} from '@kovojs/core/internal/diagnostics';
import { puntReasonLabel } from '@kovojs/core/internal/derivation';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import { validateKovoExplainInput } from '@kovojs/core/internal/graph';
import type { KovoApp, StaticExportCompileDiagnostic } from '@kovojs/server';

import {
  availableAddComponents,
  isAddComponentName,
  vendoredUiComponents,
  type AddComponentName,
} from './add-catalog.js';
// Shared command manifest is the single source of truth for the bin's usage
// strings; the docs generator imports the same manifest so the CLI page cannot
// drift from the binary (see ./commands-manifest.ts).
import {
  ADD_USAGE,
  AUDIT_USAGE,
  BUILD_USAGE,
  CHECK_USAGE,
  COMPILE_USAGE,
  COMPILE_USAGE_LINE,
  EXPLAIN_USAGE_LINE,
  EXPORT_USAGE,
  MCP_USAGE,
} from './commands-manifest.js';

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
const compileCommandOutputVersion = 'kovo-compile/v1';
const addOutputVersion = 'kovo-add/v1';
const mcpOutputVersion = 'kovo-mcp/v1';
const buildOutputVersion = 'kovo-build/v1';

/** @internal Synchronous argv dispatcher for the `kovo` bin; not a public API. */
export function main(args: readonly string[] = process.argv.slice(2)): number {
  if (args.length === 0) {
    process.stdout.write('kovo: add, audit, build, check, compile, explain, export, mcp\n');
    return 0;
  }

  if (args[0] === 'compile' && args.length === 1) return writeUsageError(compileUsage());
  if (args[0] === 'build' || args[0] === 'compile' || args[0] === 'export' || args[0] === 'mcp') {
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
    `kovo: unknown command ${stableValue(args[0])}. expected add, build, compile, explain, check, audit, export, or mcp.\n`,
  );
  return 1;
}

/** @internal Async argv dispatcher (export/mcp) for the `kovo` bin; not a public API. */
export async function mainAsync(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (args[0] === 'mcp') return runMcpCommand(args.slice(1));
  if (args[0] === 'build') {
    const parsed = parseBuildArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(await runBuildCommand(parsed.options));
  }
  if (args[0] === 'compile') {
    const parsed = parseCompileArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(await runCompileCommand(parsed.options));
  }
  if (args[0] !== 'export') return main(args);

  const parsed = parseExportArgs(args.slice(1));
  if (!parsed.ok) return writeUsageError(parsed.message);
  return writeCommandResult(await runExportCommand(parsed.options));
}

/**
 * Run the same command dispatcher as the `kovo` executable and return its exit
 * code. Generated app maintenance scripts use this when they need the command
 * facade in-process, for example to run `kovo export --vite` after loading the
 * CLI through Vite SSR.
 */
export async function runKovoCommand(args: readonly string[]): Promise<number> {
  return await mainAsync(args);
}

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
  run: (input: CoreGraph.KovoExplainInput) => KovoCheckResult,
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
  assetBase?: string;
  distDir?: string;
  manifestFile?: string;
  onNonExportable?: 'error' | 'skip';
  origin?: string;
  outDir: string;
  root?: string;
  stylesheetEnv?: string;
  vite?: boolean;
}

type ExportArgParseResult =
  | { ok: true; options: KovoExportOptions }
  | { message: string; ok: false };

type KovoBuildPresetName = 'cloudflare' | 'node' | 'vercel';

interface KovoBuildOptions {
  appModulePath: string;
  outDir: string;
  preset?: KovoBuildPresetName;
}

type BuildArgParseResult =
  | { ok: true; options: KovoBuildOptions }
  | { message: string; ok: false };

interface AddComponentOptions {
  components: readonly AddComponentName[];
  outDir: string;
}

type AddArgParseResult =
  | { ok: true; options: AddComponentOptions }
  | { message: string; ok: false };

type CompileTarget =
  | 'component'
  | 'drizzle-static'
  | 'drizzle-optimistic'
  | 'graph'
  | 'mutation-inputs'
  | 'package-css'
  | 'route';

interface CompileBaseOptions {
  check: boolean;
  outPath: string;
  target: CompileTarget;
}

interface CompileComponentCommandOptions extends CompileBaseOptions {
  allowedDiagnosticCodes: readonly DiagnosticCode[];
  emitClientFiles: boolean;
  factsOutPath?: string;
  fixpoint: boolean;
  fileName?: string;
  queryShapeFactsPath?: string;
  registryFactsPath?: string;
  renderEquivalence: boolean;
  sourcePath: string;
  target: 'component';
}

interface CompileRouteCommandOptions extends CompileBaseOptions {
  artifactFileName?: string;
  componentImportRewrites: CompileRouteModuleOptions['componentImportRewrites'];
  factsOutPath?: string;
  fileName?: string;
  sourcePath: string;
  target: 'route';
}

interface CompileGraphCommandOptions extends CompileBaseOptions {
  inputPath: string;
  target: 'graph';
}

interface CompileMutationInputsCommandOptions extends CompileBaseOptions {
  fileName?: string;
  sourcePath: string;
  target: 'mutation-inputs';
}

interface CompileDrizzleOptimisticCommandOptions extends CompileBaseOptions {
  factsOutPath?: string;
  inputPath: string;
  target: 'drizzle-optimistic';
}

interface CompileDrizzleStaticCommandOptions extends CompileBaseOptions {
  inputPath: string;
  target: 'drizzle-static';
}

interface CompilePackageCssCommandOptions extends CompileBaseOptions {
  entryPath?: string;
  packageName: string;
  target: 'package-css';
}

type CompileCommandOptions =
  | CompileComponentCommandOptions
  | CompileDrizzleStaticCommandOptions
  | CompileDrizzleOptimisticCommandOptions
  | CompileGraphCommandOptions
  | CompileMutationInputsCommandOptions
  | CompilePackageCssCommandOptions
  | CompileRouteCommandOptions;

type CompileArgParseResult =
  | { ok: true; options: CompileCommandOptions }
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
  return [ADD_USAGE, `available: ${availableAddComponents()}`, ''].join('\n');
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

function parseCompileArgs(args: readonly string[]): CompileArgParseResult {
  const target = args[0];
  if (!target || target === '--help' || target === '-h') {
    return { message: compileUsage(), ok: false };
  }

  if (!isCompileTarget(target)) {
    return {
      message: `kovo: unknown compile target ${stableValue(target)}.\n${compileUsage()}`,
      ok: false,
    };
  }

  if (target === 'component') return parseCompileComponentArgs(args.slice(1));
  if (target === 'route') return parseCompileRouteArgs(args.slice(1));
  if (target === 'graph') return parseCompileGraphArgs(args.slice(1));
  if (target === 'mutation-inputs') return parseCompileMutationInputsArgs(args.slice(1));
  if (target === 'drizzle-static') return parseCompileDrizzleStaticArgs(args.slice(1));
  if (target === 'drizzle-optimistic') return parseCompileDrizzleOptimisticArgs(args.slice(1));
  return parseCompilePackageCssArgs(args.slice(1));
}

function parseCompileComponentArgs(args: readonly string[]): CompileArgParseResult {
  let sourcePath: string | undefined;
  let outPath: string | undefined;
  let fileName: string | undefined;
  let factsOutPath: string | undefined;
  let queryShapeFactsPath: string | undefined;
  let registryFactsPath: string | undefined;
  let check = false;
  let emitClientFiles = false;
  let fixpoint = false;
  let renderEquivalence = false;
  const allowedDiagnosticCodes: DiagnosticCode[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--fixpoint') {
      fixpoint = true;
      continue;
    }
    if (arg === '--render-equivalence') {
      renderEquivalence = true;
      continue;
    }
    if (arg === '--emit-client-files') {
      emitClientFiles = true;
      continue;
    }
    if (arg === '--allow-diagnostic') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile component --allow-diagnostic requires a code.\n', ok: false };
      if (!isDiagnosticCode(value)) {
        return {
          message: `kovo: compile component --allow-diagnostic received unknown code ${stableValue(value)}.\n`,
          ok: false,
        };
      }
      allowedDiagnosticCodes.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--allow-diagnostic=')) {
      const value = arg.slice('--allow-diagnostic='.length);
      if (!value)
        return { message: 'kovo: compile component --allow-diagnostic requires a code.\n', ok: false };
      if (!isDiagnosticCode(value)) {
        return {
          message: `kovo: compile component --allow-diagnostic received unknown code ${stableValue(value)}.\n`,
          ok: false,
        };
      }
      allowedDiagnosticCodes.push(value);
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: compile component --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath) return { message: 'kovo: compile component --out requires a path.\n', ok: false };
      continue;
    }
    if (arg === '--file-name') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile component --file-name requires a name.\n', ok: false };
      fileName = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--file-name=')) {
      fileName = arg.slice('--file-name='.length);
      if (!fileName)
        return { message: 'kovo: compile component --file-name requires a name.\n', ok: false };
      continue;
    }
    if (arg === '--facts-out') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile component --facts-out requires a JSON path.\n', ok: false };
      factsOutPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--facts-out=')) {
      factsOutPath = arg.slice('--facts-out='.length);
      if (!factsOutPath)
        return { message: 'kovo: compile component --facts-out requires a JSON path.\n', ok: false };
      continue;
    }
    if (arg === '--registry-facts') {
      const value = args[index + 1];
      if (!value)
        return {
          message: 'kovo: compile component --registry-facts requires a JSON path.\n',
          ok: false,
        };
      registryFactsPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--registry-facts=')) {
      registryFactsPath = arg.slice('--registry-facts='.length);
      if (!registryFactsPath)
        return {
          message: 'kovo: compile component --registry-facts requires a JSON path.\n',
          ok: false,
        };
      continue;
    }
    if (arg === '--query-shape-facts') {
      const value = args[index + 1];
      if (!value)
        return {
          message: 'kovo: compile component --query-shape-facts requires a JSON path.\n',
          ok: false,
        };
      queryShapeFactsPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--query-shape-facts=')) {
      queryShapeFactsPath = arg.slice('--query-shape-facts='.length);
      if (!queryShapeFactsPath)
        return {
          message: 'kovo: compile component --query-shape-facts requires a JSON path.\n',
          ok: false,
        };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile component option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (sourcePath) {
      return {
        message: `kovo: compile component accepts one source path.\n${compileUsage()}`,
        ok: false,
      };
    }
    sourcePath = arg;
  }

  if (!sourcePath)
    return { message: `kovo: compile component requires a source path.\n${compileUsage()}`, ok: false };
  if (!outPath)
    return { message: `kovo: compile component requires --out.\n${compileUsage()}`, ok: false };

  return {
    ok: true,
    options: {
      allowedDiagnosticCodes,
      check,
      emitClientFiles,
      ...(factsOutPath === undefined ? {} : { factsOutPath }),
      fixpoint,
      ...(fileName === undefined ? {} : { fileName }),
      outPath,
      ...(queryShapeFactsPath === undefined ? {} : { queryShapeFactsPath }),
      ...(registryFactsPath === undefined ? {} : { registryFactsPath }),
      renderEquivalence,
      sourcePath,
      target: 'component',
    },
  };
}

function parseCompileRouteArgs(args: readonly string[]): CompileArgParseResult {
  let sourcePath: string | undefined;
  let outPath: string | undefined;
  let fileName: string | undefined;
  let artifactFileName: string | undefined;
  let factsOutPath: string | undefined;
  let check = false;
  const componentImportRewrites: RouteComponentImportRewrite[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: compile route --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath) return { message: 'kovo: compile route --out requires a path.\n', ok: false };
      continue;
    }
    if (arg === '--file-name') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: compile route --file-name requires a name.\n', ok: false };
      fileName = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--file-name=')) {
      fileName = arg.slice('--file-name='.length);
      if (!fileName) return { message: 'kovo: compile route --file-name requires a name.\n', ok: false };
      continue;
    }
    if (arg === '--artifact-file-name') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile route --artifact-file-name requires a name.\n', ok: false };
      artifactFileName = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--artifact-file-name=')) {
      artifactFileName = arg.slice('--artifact-file-name='.length);
      if (!artifactFileName)
        return { message: 'kovo: compile route --artifact-file-name requires a name.\n', ok: false };
      continue;
    }
    if (arg === '--facts-out') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: compile route --facts-out requires a JSON path.\n', ok: false };
      factsOutPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--facts-out=')) {
      factsOutPath = arg.slice('--facts-out='.length);
      if (!factsOutPath)
        return { message: 'kovo: compile route --facts-out requires a JSON path.\n', ok: false };
      continue;
    }
    if (arg === '--rewrite') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: compile route --rewrite requires Local=specifier.\n', ok: false };
      const rewrite = parseRouteRewrite(value);
      if (!rewrite.ok) return rewrite;
      componentImportRewrites.push(rewrite.value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--rewrite=')) {
      const rewrite = parseRouteRewrite(arg.slice('--rewrite='.length));
      if (!rewrite.ok) return rewrite;
      componentImportRewrites.push(rewrite.value);
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile route option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (sourcePath) {
      return { message: `kovo: compile route accepts one source path.\n${compileUsage()}`, ok: false };
    }
    sourcePath = arg;
  }

  if (!sourcePath)
    return { message: `kovo: compile route requires a source path.\n${compileUsage()}`, ok: false };
  if (!outPath) return { message: `kovo: compile route requires --out.\n${compileUsage()}`, ok: false };

  return {
    ok: true,
    options: {
      ...(artifactFileName === undefined ? {} : { artifactFileName }),
      check,
      componentImportRewrites,
      ...(factsOutPath === undefined ? {} : { factsOutPath }),
      ...(fileName === undefined ? {} : { fileName }),
      outPath,
      sourcePath,
      target: 'route',
    },
  };
}

function parseCompileGraphArgs(args: readonly string[]): CompileArgParseResult {
  let inputPath: string | undefined;
  let outPath: string | undefined;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: compile graph --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath) return { message: 'kovo: compile graph --out requires a path.\n', ok: false };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile graph option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (inputPath) {
      return { message: `kovo: compile graph accepts one input path.\n${compileUsage()}`, ok: false };
    }
    inputPath = arg;
  }

  if (!inputPath)
    return { message: `kovo: compile graph requires an input path.\n${compileUsage()}`, ok: false };
  if (!outPath) return { message: `kovo: compile graph requires --out.\n${compileUsage()}`, ok: false };

  return { ok: true, options: { check, inputPath, outPath, target: 'graph' } };
}

function parseCompileMutationInputsArgs(args: readonly string[]): CompileArgParseResult {
  let sourcePath: string | undefined;
  let outPath: string | undefined;
  let fileName: string | undefined;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile mutation-inputs --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath)
        return { message: 'kovo: compile mutation-inputs --out requires a path.\n', ok: false };
      continue;
    }
    if (arg === '--file-name') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile mutation-inputs --file-name requires a name.\n', ok: false };
      fileName = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--file-name=')) {
      fileName = arg.slice('--file-name='.length);
      if (!fileName)
        return { message: 'kovo: compile mutation-inputs --file-name requires a name.\n', ok: false };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile mutation-inputs option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (sourcePath) {
      return {
        message: `kovo: compile mutation-inputs accepts one source path.\n${compileUsage()}`,
        ok: false,
      };
    }
    sourcePath = arg;
  }

  if (!sourcePath)
    return {
      message: `kovo: compile mutation-inputs requires a source path.\n${compileUsage()}`,
      ok: false,
    };
  if (!outPath)
    return { message: `kovo: compile mutation-inputs requires --out.\n${compileUsage()}`, ok: false };

  return {
    ok: true,
    options: {
      check,
      ...(fileName === undefined ? {} : { fileName }),
      outPath,
      sourcePath,
      target: 'mutation-inputs',
    },
  };
}

function parseCompileDrizzleOptimisticArgs(args: readonly string[]): CompileArgParseResult {
  let inputPath: string | undefined;
  let outPath: string | undefined;
  let factsOutPath: string | undefined;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile drizzle-optimistic --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath)
        return { message: 'kovo: compile drizzle-optimistic --out requires a path.\n', ok: false };
      continue;
    }
    if (arg === '--facts-out') {
      const value = args[index + 1];
      if (!value)
        return {
          message: 'kovo: compile drizzle-optimistic --facts-out requires a JSON path.\n',
          ok: false,
        };
      factsOutPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--facts-out=')) {
      factsOutPath = arg.slice('--facts-out='.length);
      if (!factsOutPath)
        return {
          message: 'kovo: compile drizzle-optimistic --facts-out requires a JSON path.\n',
          ok: false,
        };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile drizzle-optimistic option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (inputPath) {
      return {
        message: `kovo: compile drizzle-optimistic accepts one input path.\n${compileUsage()}`,
        ok: false,
      };
    }
    inputPath = arg;
  }

  if (!inputPath)
    return {
      message: `kovo: compile drizzle-optimistic requires an input path.\n${compileUsage()}`,
      ok: false,
    };
  if (!outPath)
    return {
      message: `kovo: compile drizzle-optimistic requires --out.\n${compileUsage()}`,
      ok: false,
    };

  return {
    ok: true,
    options: {
      check,
      ...(factsOutPath === undefined ? {} : { factsOutPath }),
      inputPath,
      outPath,
      target: 'drizzle-optimistic',
    },
  };
}

function parseCompileDrizzleStaticArgs(args: readonly string[]): CompileArgParseResult {
  let inputPath: string | undefined;
  let outPath: string | undefined;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile drizzle-static --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath)
        return { message: 'kovo: compile drizzle-static --out requires a path.\n', ok: false };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile drizzle-static option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (inputPath) {
      return {
        message: `kovo: compile drizzle-static accepts one input path.\n${compileUsage()}`,
        ok: false,
      };
    }
    inputPath = arg;
  }

  if (!inputPath)
    return {
      message: `kovo: compile drizzle-static requires an input path.\n${compileUsage()}`,
      ok: false,
    };
  if (!outPath)
    return {
      message: `kovo: compile drizzle-static requires --out.\n${compileUsage()}`,
      ok: false,
    };

  return { ok: true, options: { check, inputPath, outPath, target: 'drizzle-static' } };
}

function parseCompilePackageCssArgs(args: readonly string[]): CompileArgParseResult {
  let packageName: string | undefined;
  let outPath: string | undefined;
  let entryPath: string | undefined;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile package-css --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath)
        return { message: 'kovo: compile package-css --out requires a path.\n', ok: false };
      continue;
    }
    if (arg === '--entry') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile package-css --entry requires a source path.\n', ok: false };
      entryPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--entry=')) {
      entryPath = arg.slice('--entry='.length);
      if (!entryPath)
        return { message: 'kovo: compile package-css --entry requires a source path.\n', ok: false };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile package-css option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (packageName) {
      return {
        message: `kovo: compile package-css accepts one package name.\n${compileUsage()}`,
        ok: false,
      };
    }
    packageName = arg;
  }

  if (!packageName)
    return {
      message: `kovo: compile package-css requires a package name.\n${compileUsage()}`,
      ok: false,
    };
  if (!outPath)
    return { message: `kovo: compile package-css requires --out.\n${compileUsage()}`, ok: false };

  return {
    ok: true,
    options: {
      check,
      ...(entryPath === undefined ? {} : { entryPath }),
      outPath,
      packageName,
      target: 'package-css',
    },
  };
}

function parseRouteRewrite(
  value: string,
):
  | { ok: true; value: NonNullable<CompileRouteModuleOptions['componentImportRewrites']>[number] }
  | { message: string; ok: false } {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    return { message: 'kovo: compile route --rewrite requires Local=specifier.\n', ok: false };
  }

  return {
    ok: true,
    value: { localName: value.slice(0, separator), specifier: value.slice(separator + 1) },
  };
}

function isCompileTarget(value: string): value is CompileTarget {
  return (
    value === 'component' ||
    value === 'drizzle-static' ||
    value === 'drizzle-optimistic' ||
    value === 'route' ||
    value === 'graph' ||
    value === 'mutation-inputs' ||
    value === 'package-css'
  );
}

function compileUsage(): string {
  return [COMPILE_USAGE_LINE, ...COMPILE_USAGE, ''].join('\n');
}

async function runCompileCommand(options: CompileCommandOptions): Promise<CliCommandResult> {
  try {
    if (options.target === 'component') return await runCompileComponentCommand(options);
    if (options.target === 'route') return await runCompileRouteCommand(options);
    if (options.target === 'graph') return await runCompileGraphCommand(options);
    if (options.target === 'mutation-inputs') return await runCompileMutationInputsCommand(options);
    if (options.target === 'drizzle-static') return await runCompileDrizzleStaticCommand(options);
    if (options.target === 'drizzle-optimistic')
      return await runCompileDrizzleOptimisticCommand(options);
    return await runCompilePackageCssCommand(options);
  } catch (error) {
    return {
      error: `kovo: compile failed: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    };
  }
}

async function runCompileComponentCommand(
  options: CompileComponentCommandOptions,
): Promise<CliCommandResult> {
  const { assertFixpoint, assertRenderEquivalence, compileComponentModule } = await import(
    '@kovojs/compiler'
  );
  const compileOptions: CompileComponentOptions = {
    fileName: options.fileName ?? options.sourcePath,
    source: readFileSync(options.sourcePath, 'utf8'),
  };
  if (options.registryFactsPath !== undefined) {
    compileOptions.registryFacts = readJsonFile(
      options.registryFactsPath,
    ) as NonNullable<CompileComponentOptions['registryFacts']>;
  }
  if (options.queryShapeFactsPath !== undefined) {
    compileOptions.queryShapeFacts = readJsonFile(
      options.queryShapeFactsPath,
    ) as NonNullable<CompileComponentOptions['queryShapeFacts']>;
  }
  const result = compileComponentModule(compileOptions);
  const allowedDiagnosticCodes = new Set(options.allowedDiagnosticCodes);
  const warnings = result.diagnostics.filter((diagnostic) => allowedDiagnosticCodes.has(diagnostic.code));
  const blockingDiagnostics = result.diagnostics.filter(
    (diagnostic) => !allowedDiagnosticCodes.has(diagnostic.code),
  );
  if (blockingDiagnostics.length > 0) return compileDiagnosticResult(blockingDiagnostics);
  if (options.fixpoint) assertFixpoint(result);
  if (options.renderEquivalence) assertRenderEquivalence(result);
  if (!result.loweredSource) throw new Error(`${options.sourcePath} produced no lowered source`);

  const artifacts: CompileArtifact[] = [
    { kind: 'component', path: options.outPath, source: result.loweredSource },
  ];
  if (options.factsOutPath !== undefined) {
    artifacts.push({
      kind: 'component-facts',
      path: options.factsOutPath,
      source: `${JSON.stringify({ componentGraphFacts: result.componentGraphFacts }, null, 2)}\n`,
    });
  }
  if (options.emitClientFiles) {
    for (const file of result.files) {
      if (file.kind === 'client') {
        artifacts.push({ kind: 'client', path: file.fileName, source: file.source });
      }
    }
  }

  return compileArtifactsResult(options.check, artifacts, warningLines(warnings));
}

async function runCompileRouteCommand(
  options: CompileRouteCommandOptions,
): Promise<CliCommandResult> {
  const { compileRouteModule } = await import('@kovojs/compiler');
  const result = compileRouteModule({
    ...(options.artifactFileName === undefined ? {} : { artifactFileName: options.artifactFileName }),
    ...(options.componentImportRewrites === undefined ||
    options.componentImportRewrites.length === 0
      ? {}
      : { componentImportRewrites: options.componentImportRewrites }),
    fileName: options.fileName ?? options.sourcePath,
    source: readFileSync(options.sourcePath, 'utf8'),
  });
  if (result.diagnostics.length > 0) return compileDiagnosticResult(result.diagnostics);
  const source = result.files[0]?.source;
  if (!source) throw new Error(`${options.sourcePath} produced no route artifact`);

  const artifacts: CompileArtifact[] = [{ kind: 'route', path: options.outPath, source }];
  if (options.factsOutPath !== undefined) {
    artifacts.push({
      kind: 'route-facts',
      path: options.factsOutPath,
      source: `${JSON.stringify({ routePageFacts: result.routePageFacts }, null, 2)}\n`,
    });
  }
  return compileArtifactsResult(options.check, artifacts);
}

async function runCompileGraphCommand(options: CompileGraphCommandOptions): Promise<CliCommandResult> {
  const { deriveAppGraph } = await import('@kovojs/compiler/graph');
  const result = deriveAppGraph(readJsonFile(options.inputPath) as Parameters<typeof deriveAppGraph>[0]);
  if (result.diagnostics.length > 0) return compileDiagnosticResult(result.diagnostics);
  return compileArtifactResult(options, `${JSON.stringify(result.graph, null, 2)}\n`, 'graph');
}

async function runCompileMutationInputsCommand(
  options: CompileMutationInputsCommandOptions,
): Promise<CliCommandResult> {
  const { mutationInputFactsFromSource } = await import('@kovojs/compiler/internal');
  const facts = Object.fromEntries(
    [...mutationInputFactsFromSource(options.fileName ?? options.sourcePath, readFileSync(options.sourcePath, 'utf8')).values()].map(
      (fact) => [
        fact.key,
        fact.fields.map((field) => ({
          ...field,
          provenance: 'registry' as const,
        })),
      ],
    ),
  );
  return compileArtifactResult(options, `${JSON.stringify(facts, null, 2)}\n`, 'mutation-inputs');
}

type DrizzleOptimisticEntryStatus = 'await-fragment' | 'derived' | 'hand-written';

interface DrizzleStaticCommandInput {
  extract?: readonly ('algebraicShapes' | 'queryFacts' | 'symbolicEffects' | 'touchGraph')[];
  files?: readonly unknown[];
  invalidation?: {
    constName?: string;
    mutations: readonly unknown[];
    queries?: readonly unknown[];
    touchGraph?: unknown;
    typeName?: string;
  };
  serializeTouchGraph?: {
    exportName?: string;
    touchGraph?: unknown;
  };
}

async function runCompileDrizzleStaticCommand(
  options: CompileDrizzleStaticCommandOptions,
): Promise<CliCommandResult> {
  const {
    deriveInvalidationRegistry,
    extractAlgebraicShapesFromProject,
    extractQueryFactsFromProject,
    extractSymbolicEffectsFromProject,
    extractTouchGraphFromProject,
    serializeInvalidationRegistry,
    serializeTouchGraph,
  } = await import('@kovojs/drizzle/internal/static');
  const input = readJsonFile(options.inputPath) as DrizzleStaticCommandInput;
  const files = input.files as Parameters<typeof extractTouchGraphFromProject>[0]['files'] | undefined;
  const output: Record<string, unknown> = { version: 'drizzle-static/v1' };

  if (files !== undefined) {
    const extract = new Set(
      input.extract ?? ['algebraicShapes', 'queryFacts', 'symbolicEffects', 'touchGraph'],
    );
    if (extract.has('touchGraph')) output.touchGraph = extractTouchGraphFromProject({ files });
    if (extract.has('queryFacts')) {
      const queryFacts = extractQueryFactsFromProject({ files });
      output.queryFacts = queryFacts;
      output.queryDomains = queryDomainsFromStaticFacts(queryFacts);
    }
    if (extract.has('symbolicEffects'))
      output.symbolicEffects = extractSymbolicEffectsFromProject({ files });
    if (extract.has('algebraicShapes'))
      output.algebraicShapes = extractAlgebraicShapesFromProject({ files });
  }

  if (input.invalidation !== undefined) {
    const touchGraph = (input.invalidation.touchGraph ?? output.touchGraph) as Parameters<
      typeof deriveInvalidationRegistry
    >[0]['touchGraph'];
    const queries = (input.invalidation.queries ?? output.queryDomains) as Parameters<
      typeof deriveInvalidationRegistry
    >[0]['queries'];
    if (touchGraph === undefined) throw new Error('drizzle-static invalidation requires touchGraph');
    if (queries === undefined) throw new Error('drizzle-static invalidation requires queries');
    const invalidationRegistry = deriveInvalidationRegistry({
      mutations: input.invalidation.mutations as Parameters<typeof deriveInvalidationRegistry>[0]['mutations'],
      queries,
      touchGraph,
    });
    output.invalidationRegistry = invalidationRegistry;
    output.invalidationRegistrySource = serializeInvalidationRegistry(invalidationRegistry, {
      constName: input.invalidation.constName ?? 'invalidationSets',
      typeName: input.invalidation.typeName ?? 'InvalidationSets',
    });
  }

  if (input.serializeTouchGraph !== undefined) {
    const touchGraph = (input.serializeTouchGraph.touchGraph ?? output.touchGraph) as Parameters<
      typeof serializeTouchGraph
    >[0];
    if (touchGraph === undefined) throw new Error('drizzle-static serializeTouchGraph requires touchGraph');
    const source = serializeTouchGraph(touchGraph);
    output.touchGraphSource =
      input.serializeTouchGraph.exportName === undefined
        ? source
        : source.replace('export const touchGraph =', `export const ${input.serializeTouchGraph.exportName} =`);
  }

  return compileArtifactResult(
    options,
    `${JSON.stringify(output, null, 2)}\n`,
    'drizzle-static',
  );
}

interface DrizzleOptimisticCommandInput {
  complete?: boolean;
  constName: string;
  effects: readonly unknown[];
  entries: readonly {
    query: string;
    shape: unknown;
    status?: DrizzleOptimisticEntryStatus;
  }[];
  formImport: { name: string; path: string };
  overrides?: readonly string[];
  queue?: string;
}

async function runCompileDrizzleOptimisticCommand(
  options: CompileDrizzleOptimisticCommandOptions,
): Promise<CliCommandResult> {
  const { deriveOptimistic } = await import('@kovojs/drizzle/derive');
  const { serializeDerivedOptimistic } = await import('@kovojs/drizzle/internal/derive-codegen');
  const input = readJsonFile(options.inputPath) as DrizzleOptimisticCommandInput;
  const derivedEntries: Parameters<typeof serializeDerivedOptimistic>[0]['entries'][number][] = [];
  const facts: {
    derivation?: { reason?: unknown; status: 'PUNTED' | 'derived' };
    query: string;
    status: DrizzleOptimisticEntryStatus;
  }[] = [];

  for (const entry of input.entries) {
    const status = entry.status ?? 'derived';
    const result = deriveOptimistic(
      input.effects as Parameters<typeof deriveOptimistic>[0],
      entry.shape as Parameters<typeof deriveOptimistic>[1],
    );

    if (status === 'derived') {
      if (result.kind !== 'derived') {
        throw new Error(
          `${entry.query} expected derived optimistic transform, got ${JSON.stringify(result)}`,
        );
      }
      derivedEntries.push({ program: result.program, query: entry.query });
      facts.push({ derivation: { status: 'derived' }, query: entry.query, status });
      continue;
    }

    facts.push({
      ...(result.kind === 'punt'
        ? { derivation: { status: 'PUNTED' as const, reason: result.reason } }
        : {}),
      query: entry.query,
      status,
    });
  }

  const overrideQueries =
    input.overrides ??
    input.entries
      .filter((entry) => (entry.status ?? 'derived') !== 'derived')
      .map((entry) => entry.query);
  const source = serializeDerivedOptimistic({
    complete: input.complete ?? overrideQueries.length === 0,
    constName: input.constName,
    entries: derivedEntries,
    formImport: input.formImport,
    ...(input.queue === undefined ? {} : { queue: input.queue }),
    ...(overrideQueries.length === 0 ? {} : { overrides: overrideQueries }),
  });
  const artifacts: CompileArtifact[] = [
    { kind: 'drizzle-optimistic', path: options.outPath, source },
  ];
  if (options.factsOutPath !== undefined) {
    artifacts.push({
      kind: 'drizzle-optimistic-facts',
      path: options.factsOutPath,
      source: `${JSON.stringify(facts, null, 2)}\n`,
    });
  }
  return compileArtifactsResult(options.check, artifacts);
}

async function runCompilePackageCssCommand(
  options: CompilePackageCssCommandOptions,
): Promise<CliCommandResult> {
  const { extractPackageComponentCss } = await import('@kovojs/compiler/package-styles');
  const entryPath = options.entryPath ?? 'src/app.ts';
  const result = extractPackageComponentCss(options.packageName, {
    fileName: entryPath,
    packagePrefixDiscoveryRoot: dirname(resolve(entryPath)),
    source: existsSync(entryPath) ? readFileSync(entryPath, 'utf8') : '',
  });
  if (!result.css) throw new Error(`no CSS extracted for ${options.packageName}`);

  const lines = compileArtifactLines(options, result.css, 'package-css');
  for (const diagnostic of result.diagnostics) {
    lines.splice(
      -1,
      0,
      `WARN package-css file=${JSON.stringify(diagnostic.fileName)} ${stableText(diagnostic.message)}`,
    );
  }
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

function compileArtifactResult(
  options: CompileBaseOptions,
  source: string,
  kind: CompileTarget,
): CliCommandResult {
  return { exitCode: 0, output: `${compileArtifactLines(options, source, kind).join('\n')}\n` };
}

interface CompileArtifact {
  kind: string;
  path: string;
  source: string;
}

function compileArtifactsResult(
  check: boolean,
  artifacts: readonly CompileArtifact[],
  warnings: readonly string[] = [],
): CliCommandResult {
  const lines = [compileCommandOutputVersion];
  for (const artifact of artifacts) {
    lines.push(...compileArtifactActionLines(check, artifact));
  }
  lines.push(...warnings, `SUMMARY artifacts=${artifacts.length} diagnostics=${warnings.length}`);
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

function compileArtifactLines(
  options: CompileBaseOptions,
  source: string,
  kind: CompileTarget,
): string[] {
  return [
    compileCommandOutputVersion,
    ...compileArtifactActionLines(options.check, { kind, path: options.outPath, source }),
    `SUMMARY artifacts=1 diagnostics=0`,
  ];
}

function compileArtifactActionLines(check: boolean, artifact: CompileArtifact): string[] {
  const target = resolve(artifact.path);
  if (check) {
    const current = readFileSync(target, 'utf8');
    if (current !== artifact.source) {
      throw new Error(`${artifact.kind} artifact ${target} is stale; rerun without --check`);
    }
    return [
      `CHECK ${artifact.kind} path=${JSON.stringify(target)} status=current bytes=${byteLength(artifact.source)}`,
    ];
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, artifact.source, 'utf8');
  return [`WRITE ${artifact.kind} path=${JSON.stringify(target)} bytes=${byteLength(artifact.source)}`];
}

function warningLines(
  diagnostics: readonly { code: DiagnosticCode; fileName: string; message: string }[],
): string[] {
  return diagnostics.map(
    (diagnostic) =>
      `WARN ${diagnostic.code} file=${JSON.stringify(diagnostic.fileName)} ${stableText(diagnostic.message)}`,
  );
}

function compileDiagnosticResult(
  diagnostics: readonly { code: DiagnosticCode; fileName: string; message: string }[],
): CliCommandResult {
  return {
    error: [
      compileCommandOutputVersion,
      ...diagnostics.map(
        (diagnostic) =>
          `ERROR ${diagnostic.code} file=${JSON.stringify(diagnostic.fileName)} ${stableText(diagnostic.message)}`,
      ),
      `SUMMARY artifacts=0 diagnostics=${diagnostics.length}`,
    ].join('\n'),
    exitCode: 1,
  };
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function queryDomainsFromStaticFacts(
  facts: readonly { query: string; reads: readonly string[]; site: string }[],
): { domains: readonly string[]; query: string }[] {
  return [...facts]
    .sort((left, right) => siteLineNumber(left.site) - siteLineNumber(right.site))
    .map((fact) => ({ domains: [...fact.reads], query: fact.query }));
}

function siteLineNumber(site: string): number {
  return Number(String(site).split(':').pop() ?? 0);
}

function parseBuildArgs(args: readonly string[]): BuildArgParseResult {
  let appModulePath: string | undefined;
  let outDir = 'dist';
  let preset: KovoBuildPresetName | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      return { message: buildUsage(), ok: false };
    }

    if (arg === '--out') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: build --out requires a directory.\n', ok: false };
      outDir = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
      if (!outDir) return { message: 'kovo: build --out requires a directory.\n', ok: false };
      continue;
    }

    if (arg === '--preset') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: build --preset requires a preset name.\n', ok: false };
      const parsedPreset = parseKovoBuildPresetName(value);
      if (!parsedPreset) {
        return { message: `kovo: unsupported build preset ${stableValue(value)}.\n`, ok: false };
      }
      preset = parsedPreset;
      index += 1;
      continue;
    }

    if (arg.startsWith('--preset=')) {
      const value = arg.slice('--preset='.length);
      if (!value) return { message: 'kovo: build --preset requires a preset name.\n', ok: false };
      const parsedPreset = parseKovoBuildPresetName(value);
      if (!parsedPreset) {
        return { message: `kovo: unsupported build preset ${stableValue(value)}.\n`, ok: false };
      }
      preset = parsedPreset;
      continue;
    }

    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown build option ${stableValue(arg)}.\n${buildUsage()}`,
        ok: false,
      };
    }

    if (appModulePath) {
      return { message: `kovo: build accepts one app module path.\n${buildUsage()}`, ok: false };
    }

    appModulePath = arg;
  }

  if (!appModulePath)
    return { message: `kovo: build requires an app module path.\n${buildUsage()}`, ok: false };

  return {
    ok: true,
    options: {
      appModulePath,
      outDir,
      ...(preset === undefined ? {} : { preset }),
    },
  };
}

function parseKovoBuildPresetName(value: string): KovoBuildPresetName | undefined {
  return value === 'node' || value === 'vercel' || value === 'cloudflare' ? value : undefined;
}

function buildUsage(): string {
  return [BUILD_USAGE, ''].join('\n');
}

function parseExportArgs(args: readonly string[]): ExportArgParseResult {
  let appModulePath: string | undefined;
  let assetBase: string | undefined;
  let distDir: string | undefined;
  let manifestFile: string | undefined;
  let origin: string | undefined;
  let outDir = 'dist';
  let onNonExportable: 'error' | 'skip' | undefined;
  let root: string | undefined;
  let stylesheetEnv: string | undefined;
  let vite = false;

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

    if (arg === '--dist') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: export --dist requires a directory.\n', ok: false };
      distDir = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--dist=')) {
      distDir = arg.slice('--dist='.length);
      if (!distDir) return { message: 'kovo: export --dist requires a directory.\n', ok: false };
      continue;
    }

    if (arg === '--manifest') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: export --manifest requires a file.\n', ok: false };
      manifestFile = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--manifest=')) {
      manifestFile = arg.slice('--manifest='.length);
      if (!manifestFile) return { message: 'kovo: export --manifest requires a file.\n', ok: false };
      continue;
    }

    if (arg === '--asset-base') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: export --asset-base requires a URL path.\n', ok: false };
      assetBase = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--asset-base=')) {
      assetBase = arg.slice('--asset-base='.length);
      if (!assetBase)
        return { message: 'kovo: export --asset-base requires a URL path.\n', ok: false };
      continue;
    }

    if (arg === '--stylesheet-env') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: export --stylesheet-env requires a name.\n', ok: false };
      stylesheetEnv = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--stylesheet-env=')) {
      stylesheetEnv = arg.slice('--stylesheet-env='.length);
      if (!stylesheetEnv)
        return { message: 'kovo: export --stylesheet-env requires a name.\n', ok: false };
      continue;
    }

    if (arg === '--origin') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: export --origin requires a URL.\n', ok: false };
      origin = value;
      index += 1;
      continue;
    }

    if (arg === '--root') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: export --root requires a directory.\n', ok: false };
      root = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--root=')) {
      root = arg.slice('--root='.length);
      if (!root) return { message: 'kovo: export --root requires a directory.\n', ok: false };
      continue;
    }

    if (arg === '--vite') {
      vite = true;
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
      ...(assetBase === undefined ? {} : { assetBase }),
      ...(distDir === undefined ? {} : { distDir }),
      ...(manifestFile === undefined ? {} : { manifestFile }),
      ...(onNonExportable === undefined ? {} : { onNonExportable }),
      ...(origin === undefined ? {} : { origin }),
      outDir,
      ...(root === undefined ? {} : { root }),
      ...(stylesheetEnv === undefined ? {} : { stylesheetEnv }),
      ...(vite ? { vite } : {}),
    },
  };
}

function exportUsage(): string {
  return [EXPORT_USAGE, ''].join('\n');
}

async function runBuildCommand(options: KovoBuildOptions): Promise<CliCommandResult> {
  try {
    const presetName = selectedKovoBuildPreset(options);
    if (presetName !== 'node') {
      throw new Error(
        `kovo build preset ${presetName} is not implemented yet; use --preset node for the current Node/VPS output.`,
      );
    }
    const resolvedAppModulePath = resolve(options.appModulePath);
    const [{ node, writeKovoNeutralBuild }, appModule] = await Promise.all([
      import('@kovojs/server/build'),
      import(pathToFileURL(resolvedAppModulePath).href),
    ]);
    const app = appFromModule(appModule, options.appModulePath);
    const serverHandlerSource = await bundleKovoServerHandler(resolvedAppModulePath);
    const outDir = resolve(options.outDir);
    const neutralBuild = await writeKovoNeutralBuild({
      app,
      outDir: join(outDir, '.kovo'),
      serverHandlerSource,
    });
    const preset = node();
    const presetLogs: string[] = [];

    await preset.emit(neutralBuild, {
      declaredEnv: [],
      log(message) {
        presetLogs.push(message);
      },
      outDir: join(outDir, 'server'),
      readNeutral() {
        return neutralBuild;
      },
    });

    return kovoBuildResult({
      appModulePath: resolvedAppModulePath,
      neutralOutDir: neutralBuild.outDir,
      outDir,
      preset: presetName,
      presetLogs,
      serverOutDir: join(outDir, 'server'),
    });
  } catch (error) {
    return buildErrorResult(error);
  }
}

function selectedKovoBuildPreset(options: KovoBuildOptions): KovoBuildPresetName {
  if (options.preset !== undefined) return options.preset;

  const envPreset = process.env.KOVO_PRESET;
  if (envPreset) {
    const parsedPreset = parseKovoBuildPresetName(envPreset);
    if (!parsedPreset) throw new Error(`unsupported KOVO_PRESET ${stableValue(envPreset)}`);
    return parsedPreset;
  }

  if (process.env.VERCEL) return 'vercel';
  if (process.env.CF_PAGES || process.env.CLOUDFLARE) return 'cloudflare';
  return 'node';
}

async function bundleKovoServerHandler(appModulePath: string): Promise<string> {
  const { build } = await import('vite-plus');
  const tempDir = mkdtempSync(join(tmpdir(), 'kovo-build-'));
  const entryPath = join(tempDir, 'entry.mjs');
  const outDir = join(tempDir, 'out');

  try {
    writeFileSync(entryPath, kovoServerHandlerEntrySource(appModulePath), 'utf8');
    await build({
      appType: 'custom',
      build: {
        emptyOutDir: true,
        minify: false,
        outDir,
        rollupOptions: {
          external: [/^@kovojs\//],
          input: entryPath,
          output: {
            entryFileNames: 'handler.mjs',
            format: 'es',
          },
        },
        ssr: true,
        target: 'node22',
      },
      configFile: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'kovo-server-build-externals',
          resolveId(id) {
            if (id.startsWith('@kovojs/')) return { external: true, id };
            return null;
          },
        },
      ],
      root: process.cwd(),
    });

    return await readFile(join(outDir, 'handler.mjs'), 'utf8');
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function kovoServerHandlerEntrySource(appModulePath: string): string {
  return [
    "import { createRequestHandler } from '@kovojs/server';",
    `import * as appModule from ${JSON.stringify(pathToFileURL(appModulePath).href)};`,
    'const app = appModule.default ?? appModule.app;',
    'export default createRequestHandler(app);',
    '',
  ].join('\n');
}

async function runExportCommand(options: KovoExportOptions): Promise<CliCommandResult> {
  try {
    const manifestPlan = await staticExportManifestPlan(options);
    const { exportStaticApp } = await import('@kovojs/server');
    const appModule = await loadExportAppModule(options);
    const app = appFromModule(appModule, options.appModulePath);
    const result = await exportStaticApp(app, {
      ...(manifestPlan.assets.length === 0 ? {} : { assets: manifestPlan.assets }),
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

async function loadExportAppModule(options: KovoExportOptions): Promise<unknown> {
  if (!options.vite) return await import(pathToFileURL(resolve(options.appModulePath)).href);

  const { createServer } = await import('vite-plus');
  const server = await createServer({
    appType: 'custom',
    logLevel: 'error',
    root: resolve(options.root ?? process.cwd()),
    server: { middlewareMode: true },
  });
  try {
    return await server.ssrLoadModule(options.appModulePath);
  } finally {
    await server.close();
  }
}

interface ExportManifestPlan {
  assets: readonly {
    path: string;
    source: string;
  }[];
  stylesheetHref?: string;
}

async function staticExportManifestPlan(options: KovoExportOptions): Promise<ExportManifestPlan> {
  if (options.manifestFile === undefined) return { assets: [] };

  const manifestFile = resolve(options.manifestFile);
  const distDir = resolve(options.distDir ?? dirname(manifestFile));
  const manifest = exportManifestFromUnknown(JSON.parse(await readFile(manifestFile, 'utf8')));
  const assets = new Map<string, { path: string; source: string }>();
  let stylesheetHref: string | undefined;
  let stylesheetCount = 0;

  for (const chunk of Object.values(manifest)) {
    const fileAsset = addExportManifestAsset(assets, chunk.file, distDir, options.assetBase);
    if (fileAsset && chunk.file?.replace(/[?#].*$/, '').endsWith('.css')) {
      stylesheetHref = fileAsset.path;
      stylesheetCount += 1;
    }
    for (const stylesheet of chunk.css ?? []) {
      const asset = addExportManifestAsset(assets, stylesheet, distDir, options.assetBase);
      if (asset) {
        stylesheetHref = asset.path;
        stylesheetCount += 1;
      }
    }
  }

  if (options.stylesheetEnv !== undefined) {
    if (stylesheetCount !== 1 || stylesheetHref === undefined) {
      throw new Error(
        `kovo export --stylesheet-env requires exactly one stylesheet asset in --manifest; found ${stylesheetCount}.`,
      );
    }
    process.env[options.stylesheetEnv] = stylesheetHref;
  }

  return { assets: [...assets.values()], ...(stylesheetHref === undefined ? {} : { stylesheetHref }) };
}

interface ExportManifestChunk {
  css?: readonly string[];
  file?: string;
}

function exportManifestFromUnknown(value: unknown): Record<string, ExportManifestChunk> {
  if (!isRecord(value)) throw new Error('kovo export --manifest must be a JSON object.');
  const manifest: Record<string, ExportManifestChunk> = {};
  for (const [key, rawChunk] of Object.entries(value)) {
    if (!isRecord(rawChunk)) continue;
    const chunk: ExportManifestChunk = {};
    if (typeof rawChunk.file === 'string') chunk.file = rawChunk.file;
    if (Array.isArray(rawChunk.css)) {
      chunk.css = rawChunk.css.filter((entry): entry is string => typeof entry === 'string');
    }
    manifest[key] = chunk;
  }
  return manifest;
}

function addExportManifestAsset(
  assets: Map<string, { path: string; source: string }>,
  file: string | undefined,
  distDir: string,
  base: string | undefined,
): { path: string; source: string } | undefined {
  if (!file || /^[a-z][a-z0-9+.-]*:/i.test(file) || file.startsWith('//')) return undefined;
  const normalizedFile = normalizedExportManifestFile(file);
  if (assets.has(normalizedFile)) return assets.get(normalizedFile);
  const href = exportManifestAssetHref(normalizedFile, base);
  const asset = {
    path: new URL(href, 'https://kovo.local').pathname,
    source: resolve(distDir, normalizedFile),
  };
  assets.set(normalizedFile, asset);
  return asset;
}

function normalizedExportManifestFile(file: string): string {
  const pathname = file.replace(/[?#].*$/, '').replace(/^\/+/, '');
  const segments = pathname.split('/');
  if (segments.length === 0 || segments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error(`kovo export --manifest asset must stay within --dist: ${file}`);
  }
  return segments.join('/');
}

function exportManifestAssetHref(file: string, base: string | undefined): string {
  const normalizedBase = base === undefined ? '/' : `/${base.replace(/^\/+|\/+$/g, '')}/`;
  return `${normalizedBase}${file}`;
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

  for (const artifact of result.assets) {
    lines.push(
      `ASSET ${artifact.path} status=${artifact.status} bytes=${readFileSync(artifact.source).byteLength}`,
    );
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(
      `WARN ${diagnostic.code} route=${diagnostic.routePath} ${stableText(diagnostic.message)}`,
    );
  }

  lines.push(
    `SUMMARY html=${result.artifacts.length} clientModules=${result.clientModules.length} assets=${result.assets.length} diagnostics=${result.diagnostics.length} outDir=${JSON.stringify(options.outDir)}`,
  );

  return { exitCode: result.diagnostics.length > 0 ? 1 : 0, output: `${lines.join('\n')}\n` };
}

function kovoBuildResult(options: {
  appModulePath: string;
  neutralOutDir: string;
  outDir: string;
  preset: 'node';
  presetLogs: readonly string[];
  serverOutDir: string;
}): KovoCheckResult {
  const lines = [
    buildOutputVersion,
    `APP module=${JSON.stringify(options.appModulePath)}`,
    `NEUTRAL outDir=${JSON.stringify(options.neutralOutDir)}`,
    ...options.presetLogs.map((message) => `PRESET ${stableText(message)}`),
    `SUMMARY preset=${options.preset} outDir=${JSON.stringify(options.outDir)} serverOutDir=${JSON.stringify(options.serverOutDir)}`,
  ];

  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function buildErrorResult(error: unknown): CliCommandResult {
  return {
    error: `${buildOutputVersion}\nERROR ${error instanceof Error ? error.message : String(error)}`,
    exitCode: 1,
  };
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

type InputReadResult =
  | { ok: true; value: CoreGraph.KovoExplainInput }
  | { error: InputReadError; ok: false };

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

  return { ok: true, value: parsed as CoreGraph.KovoExplainInput };
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
  error: CoreGraph.GraphInputValidationError,
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
 * request context, mutation, query, or page (SPEC.md §5.3).
 */
export type ExplainKind = 'component' | 'context' | 'mutation' | 'page' | 'query';

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
export function kovoExplain(
  input: CoreGraph.KovoExplainInput,
  options: KovoExplainOptions,
): KovoCheckResult {
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

  if (options.kind === 'context') {
    const provider = input.requestProviders?.find((item) => item.kind === options.target);
    if (!provider) return notFound(options);

    lines.push(`CONTEXT ${provider.kind}`);
    lines.push(`fields: ${list(provider.fields)}`);
    lines.push(`consumers: ${list(provider.consumers)}`);
    lines.push(`source: ${provider.source ?? '-'}`);
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

    for (const form of component.mutationForms ?? []) {
      lines.push(
        [
          `FORM ${form.slot}`,
          `mutation=${form.mutation}`,
          `fields=${list(form.fields)}`,
          `field-errors=${list(form.fieldErrors?.map((field) => `${field.name}:${field.id ?? '-'}`))}`,
          `form-errors=${list(form.formErrors?.map((error) => error.code ?? '-'))}`,
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
    lines.push(
      `navigation-segments: ${list(page.navigationSegments?.map((segment) => segment.id))}`,
    );
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
  input: CoreGraph.KovoExplainInput,
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
  input: CoreGraph.KovoCheckInput,
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
  errors: readonly CoreGraph.GraphInputValidationError[],
): KovoCheckResult {
  const lines = [version, ...errors.map((error) => `ERROR INPUT ${error.path} ${error.message}`)];
  return {
    exitCode: 1,
    output: `${lines.join('\n')}\n`,
  };
}

function diagnosticSeverity(
  diagnostic: Pick<CoreGraph.StaticDiagnosticFact, 'code' | 'severity'>,
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
      : `kovo: ${CHECK_USAGE}\n`;
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
    return { message: `kovo: ${AUDIT_USAGE}`, ok: false };
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
  if (flags.has('--optimistic') && kind !== 'mutation') return explainUsage();

  return {
    inputPath,
    ok: true,
    options: {
      kind,
      layouts: flags.has('--layouts'),
      optimistic: flags.has('--optimistic'),
      target,
    },
  };
}

function explainUsage(): ExplainArgParseResult {
  return {
    message: `kovo: usage: ${EXPLAIN_USAGE_LINE}`,
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

function diagnosticsForTouchGraph(graph: CoreGraph.TouchGraph): TouchGraphDiagnosticFact[] {
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

function verificationDiagnosticLine(diagnostic: CoreGraph.VerificationDiagnosticFact): string {
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

function staticDiagnosticLine(diagnostic: CoreGraph.StaticDiagnosticFact): string {
  const definition = diagnosticDefinitions[diagnostic.code];
  const severity = diagnostic.severity ?? definition.severity;
  return `${severity.toUpperCase()} ${diagnostic.code} ${diagnosticSite(diagnostic)} ${diagnostic.message ?? definition.message}`;
}

function diagnosticSite(diagnostic: CoreGraph.StaticDiagnosticFact): string {
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
  components: readonly CoreGraph.ComponentExplain[] | undefined,
  target: string,
): CoreGraph.ComponentExplain | undefined {
  return components?.find(
    (component) =>
      component.name === target ||
      component.domName === target ||
      component.disambiguatedDomName === target ||
      componentWireName(component.name) === target,
  );
}

function componentPrefixProvenance(
  component: CoreGraph.ComponentExplain,
  target: string,
  input: CoreGraph.KovoExplainInput,
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
  facts: readonly CoreGraph.PackageComponentPrefixExplain[] | undefined,
  wireName: string,
): CoreGraph.PackageComponentPrefixExplain | null {
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
  return (
    value === 'component' ||
    value === 'context' ||
    value === 'mutation' ||
    value === 'page' ||
    value === 'query'
  );
}

function invalidatedBy(query: CoreGraph.QueryReadSet, input: CoreGraph.KovoExplainInput): string[] {
  const invalidators = new Set<string>();

  for (const mutation of input.mutations ?? []) {
    const domains = mutationAffectedDomains(mutation);

    if (query.domains.some((domain) => domains.has(domain))) {
      invalidators.add(mutation.key);
    }
  }

  return [...invalidators].sort();
}

function domainWritesFor(
  query: CoreGraph.QueryReadSet,
  input: CoreGraph.KovoExplainInput,
): string[] {
  const writes = new Set<string>();

  for (const [writeName, entry] of Object.entries(input.touchGraph ?? {})) {
    if (entry.touches.some((touch) => query.domains.some((domain) => domain === touch.domain))) {
      writes.add(writeName);
    }
  }

  return [...writes].sort();
}

function queryConsumers(queryName: string, input: CoreGraph.KovoExplainInput): string[] {
  const components =
    input.components
      ?.filter((component) => component.queries?.includes(queryName))
      .map((component) => `component:${component.exportName ?? component.name}`) ?? [];
  const pages =
    input.pages
      ?.filter((page) => page.queries?.includes(queryName))
      .map((page) => `page:${page.route}`) ?? [];

  return [...components, ...pages].sort();
}

function mutationUpdates(
  mutation: CoreGraph.MutationExplain,
  input: CoreGraph.KovoExplainInput,
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

function unguardedAccesses(input: CoreGraph.KovoExplainInput): UnguardedAccessFact[] {
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

function endpointExplainLine(endpoint: CoreGraph.EndpointExplain): string {
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

function hasMutationAuth(mutation: CoreGraph.MutationExplain): boolean {
  if (hasAuthGuard(mutation.guards ?? [])) return true;
  return mutationAuth(mutation) !== 'none';
}

function mutationAuth(mutation: CoreGraph.MutationExplain): string {
  return mutation.auth ?? 'none';
}

function hasEndpointAuth(endpoint: CoreGraph.EndpointExplain): boolean {
  if (hasAuthGuard(endpoint.guards ?? [])) return true;
  if (!endpoint.auth) return false;

  return (
    endpoint.auth === 'authed' ||
    endpoint.auth.startsWith('role:') ||
    endpoint.auth.startsWith('custom:') ||
    endpoint.auth.startsWith('verifier:')
  );
}

function endpointName(endpoint: CoreGraph.EndpointExplain): string {
  return endpoint.name ?? endpoint.path;
}

function compareEndpointExplain(
  left: CoreGraph.EndpointExplain,
  right: CoreGraph.EndpointExplain,
): number {
  return endpointName(left).localeCompare(endpointName(right));
}

function endpointAuth(endpoint: CoreGraph.EndpointExplain): string {
  return endpoint.auth ?? list(endpoint.guards);
}

function endpointCsrf(endpoint: CoreGraph.EndpointExplain): string {
  if (endpoint.csrf !== 'exempt') return endpoint.csrf ?? 'checked';
  return `exempt:${endpoint.csrfJustification ?? '-'}`;
}

function optimisticSummary(coverages: readonly CoreGraph.OptimisticCoverage[]): string {
  // SPEC.md §10.6: v2 adds `derived` to the status partition. PUNTED is a separate
  // dimension (derivation metadata that never counts as coverage), reported
  // alongside the status counts.
  const counts: Record<CoreGraph.OptimisticCoverage['status'], number> = {
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
  mutations: readonly CoreGraph.MutationExplain[],
  queries: readonly CoreGraph.QueryReadSet[],
  coverages: readonly CoreGraph.OptimisticCoverage[],
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

function sortedUpdateCoverage(
  coverage: readonly CoreGraph.UpdateCoverageFact[],
): CoreGraph.UpdateCoverageFact[] {
  return [...coverage].sort(compareUpdateCoverage);
}

function updateCoverageLine(fact: CoreGraph.UpdateCoverageFact): string {
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

function unscopedAccesses(input: CoreGraph.KovoCheckInput): CoreGraph.ScopeAuditFact[] {
  const ownerDomains = new Set((input.ownerDomains ?? []).map((owner) => owner.domain));

  return (input.scopeAudits ?? [])
    .filter((fact) => ownerDomains.has(fact.domain))
    .filter((fact) => fact.scope !== 'session')
    .sort(compareScopeAudit);
}

function unscopedLine(fact: CoreGraph.ScopeAuditFact): string {
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

function compareScopeAudit(
  left: CoreGraph.ScopeAuditFact,
  right: CoreGraph.ScopeAuditFact,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.domain.localeCompare(right.domain) ||
    left.site.localeCompare(right.site) ||
    left.scope.localeCompare(right.scope)
  );
}

function compareUpdateCoverage(
  left: CoreGraph.UpdateCoverageFact,
  right: CoreGraph.UpdateCoverageFact,
): number {
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
  mutation: CoreGraph.MutationExplain,
  input: CoreGraph.KovoExplainInput,
): CoreGraph.OptimisticCoverage[] {
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
  mutation: CoreGraph.MutationExplain,
  input: CoreGraph.KovoExplainInput,
): readonly CoreGraph.QueryReadSet[] {
  const domains = mutationAffectedDomains(mutation);
  if (domains.size === 0) return [];

  return (input.queries ?? []).filter((query) =>
    query.domains.some((domain) => domains.has(domain)),
  );
}

function mutationAffectedDomains(mutation: CoreGraph.MutationExplain): Set<string> {
  return new Set([
    ...(mutation.writes ?? []),
    ...(mutation.invalidates ?? []),
    ...(mutation.manualInvalidates ?? []),
  ]);
}

function fixpointFailures(checks: readonly CoreGraph.FixpointCheck[]): CoreGraph.FixpointCheck[] {
  return checks
    .filter((check) => !check.ok)
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
}

function fixpointFailureLine(check: CoreGraph.FixpointCheck): string {
  const detail = stableText(check.detail ?? 'Generated output must compile to itself.');
  const diff =
    check.expected === undefined && check.actual === undefined
      ? ''
      : ` expected=${stableValue(check.expected)} actual=${stableValue(check.actual)}`;

  return `ERROR FIXPOINT ${check.artifact} ${detail}${diff}`;
}

function renderEquivalenceFailures(
  checks: readonly CoreGraph.RenderEquivalenceCheck[],
): CoreGraph.RenderEquivalenceCheck[] {
  return checks
    .filter((check) => !check.ok)
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
}

function renderEquivalenceFailureLine(check: CoreGraph.RenderEquivalenceCheck): string {
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

function lintMessage(lint: CoreGraph.SemanticLint): string {
  const base = diagnosticDefinitions[lint.code].message;

  return lint.detail ? `${base} ${lint.detail}` : base;
}

function missedQueryInvalidations(
  queries: readonly CoreGraph.QueryReadSet[],
  touchGraph: CoreGraph.TouchGraph,
  mutations: readonly CoreGraph.MutationExplain[],
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
  events: readonly CoreGraph.EventPayloadFact[],
  queries: readonly CoreGraph.QueryDataFact[],
): CoreGraph.SemanticLint[] {
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
      ] satisfies CoreGraph.SemanticLint[];
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
