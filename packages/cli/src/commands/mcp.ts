import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { CompileComponentOptions, CompileResult } from '@kovojs/compiler';
import {
  compileComponentModuleForFramework,
  snapshotCompileComponentOptions,
} from '@kovojs/compiler/internal';
import * as CompilerInternal from '@kovojs/compiler/internal';
import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import {
  assertRegisteredDiagnostic,
  diagnosticDefinitions,
} from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import { validateKovoExplainInput } from '@kovojs/core/internal/graph';
import { createFiniteMcpStdioServer } from '@kovojs/core/internal/mcp-stdio';
import type {
  FiniteMcpOutput,
  FiniteMcpStdioServer,
  FiniteMcpToolResult,
} from '@kovojs/core/internal/mcp-stdio';

import { DOCS_RESULT_PROTOCOL, parseKovoCommandInvocation } from '../commands-manifest.js';
import { kovoCommandExitCode } from '../command-schema.js';
import {
  checkFamilyArg,
  explainOutputVersion,
  isExplainKind,
  kovoCheck,
  kovoExplain,
  outputVersion,
  type KovoExplainOptions,
} from '../graph-output.js';
import { readInstalledAgentDocsSnapshot } from '../docs-snapshot.js';
import { searchInstalledAgentDocs } from '../docs-store.js';
import { readCliPackageVersion } from '../package-version.js';
import { projectKovoDiagnostic, type KovoDiagnosticRecord } from '../diagnostic.js';
import {
  byteLength,
  compileOutputVersion,
  type CliCommandResult,
  type KovoCheckResult,
  mcpOutputVersion,
  stableValue,
  writeUsageError,
} from '../shared.js';
import { buildByteLength } from './build-security-intrinsics.js';

const MCP_MAX_LINE_BYTES = 4 * 1024 * 1024;
const MCP_MAX_COMPILE_SOURCE_BYTES = 256 * 1024;
const MCP_MAX_COMPILE_PREPARSE_TOKENS = 32_768;
const MCP_MAX_COMPILE_STRUCTURAL_TOKENS = 512;
const MCP_MAX_COMPILE_SYNTAX_DEPTH = 256;
const MCP_MAX_COMPILE_SYNTAX_NODES = 20_000;
const MCP_MAX_COMPILE_PATH_SEGMENTS = 64;
const MCP_MAX_GRAPH_WORK_UNITS = 65_536;
const MCP_MAX_GRAPH_OUTPUT_ROWS = 2_048;
const MCP_MAX_GRAPH_AMPLIFIED_TEXT_BYTES = 2 * 1024 * 1024;
const MCP_MAX_GRAPH_STRING_BYTES = 4_096;
const MCP_MAX_TOOL_CALLS_PER_SESSION = 256;

type McpWorkspaceRoot = CompilerInternal.CompilerSourceRootWitness;

/** @internal Input shape for the internal `compile_component` MCP tool. */
export interface CompileComponentV1Input {
  fileName: string;
  source: string;
}

/** @internal Exact `kovo-diagnostic/v1` record returned by `compile_component`. */
export type CompileComponentV1Diagnostic = KovoDiagnosticRecord;

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
  | 'kovo_docs'
  | 'kovo_explain'
  | 'list_diagnostics';

/** @internal Backs the internal `compile_component` MCP tool; not a public API. */
export async function compileComponentV1(
  input: CompileComponentV1Input,
  workspaceRoot: string,
): Promise<CompileComponentV1Result> {
  const rootWitness = CompilerInternal.createCompilerSourceRootWitness(workspaceRoot);
  if (rootWitness === null) throw new TypeError('MCP launch workspace must be a directory');
  return compileComponentV1WithWorkspace(input, rootWitness);
}

async function compileComponentV1WithWorkspace(
  input: CompileComponentV1Input,
  rootWitness: McpWorkspaceRoot,
): Promise<CompileComponentV1Result> {
  const result = await compileFrameworkComponentModule(compileComponentOptions(input, rootWitness));
  for (let index = 0; index < result.diagnostics.length; index += 1) {
    assertRegisteredDiagnostic(result.diagnostics[index], `MCP compiler diagnostics[${index}]`);
  }

  return {
    componentGraphFacts: [...result.componentGraphFacts],
    // SPEC §11: MCP projects the exact compiler-owned diagnostic; it cannot mint a lookalike.
    diagnostics: result.diagnostics.map((diagnostic) => projectKovoDiagnostic(diagnostic, 'build')),
    emittedFiles: result.files.map((file) => ({
      byteLength: byteLength(file.source),
      fileName: file.fileName,
      kind: file.kind,
    })),
    handlerExports: [...result.handlerExports],
    ok: result.diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
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

export async function compileFrameworkComponentModule(
  options: CompileComponentOptions,
): Promise<CompileResult> {
  // Pin before the first await: callers can otherwise mutate source/path authority while
  // compilation yields, making emitted bytes observe a later carrier than the one supplied at
  // invocation (SPEC.md §5.2.1).
  options = snapshotCompileComponentOptions(options);
  return compileComponentModuleForFramework(options);
}

function compileComponentOptions(
  input: CompileComponentV1Input,
  workspaceRoot: McpWorkspaceRoot,
): CompileComponentOptions & {
  packagePrefixDiscoveryBoundary: string;
  packagePrefixDiscoveryRootWitness: McpWorkspaceRoot;
} {
  return {
    fileName: input.fileName,
    // The adapter, not protocol input, owns both the starting root and hard stop. The internal
    // boundary field survives the compiler snapshot without becoming a public compiler option.
    packagePrefixDiscoveryBoundary: workspaceRoot.canonicalRoot,
    packagePrefixDiscoveryRoot: workspaceRoot.canonicalRoot,
    packagePrefixDiscoveryRootWitness: workspaceRoot,
    source: input.source,
    sourceProvenance: 'app',
  };
}

export async function runMcpCommand(
  args: readonly string[],
  invocationCwd: string,
): Promise<0 | 2> {
  const parsed = parseKovoCommandInvocation('mcp', args);
  if (!parsed.ok) return writeUsageError(parsed.message, 'mcp');

  await runMcpStdioServer(process.stdin, process.stdout, invocationCwd);
  const exitCode = kovoCommandExitCode('mcp', 'success');
  if (exitCode !== 0) {
    throw new TypeError(`Kovo mcp success exit ${exitCode} contradicts the CLI contract.`);
  }
  return exitCode;
}

/** @internal Runs the finite SPEC §11.5 `kovo mcp` stdio server; not a public API. */
export async function runMcpStdioServer(
  input: AsyncIterable<Buffer | string>,
  output: FiniteMcpOutput,
  invocationCwd: string,
): Promise<void> {
  await createKovoMcpServer(invocationCwd).serveStdio(input, output);
}

/** @internal Creates Kovo's closed tool adapter over the shared finite stdio engine. */
export function createKovoMcpServer(invocationCwd: string): FiniteMcpStdioServer {
  const workspaceRoot = canonicalMcpWorkspaceRoot(invocationCwd);
  const listing = listMcpTools();
  let toolCallCount = 0;
  return createFiniteMcpStdioServer({
    callTool: async (name, args) => {
      toolCallCount += 1;
      if (toolCallCount > MCP_MAX_TOOL_CALLS_PER_SESSION) {
        throw new Error(`MCP session exceeds ${MCP_MAX_TOOL_CALLS_PER_SESSION} tool calls`);
      }
      return mcpToolResult(asMcpStructuredContent(await callMcpTool(name, args, workspaceRoot)));
    },
    instructions:
      'Kovo diagnostics and version-matched local-docs surface. Tools wrap existing compile/check/explain/docs APIs; SPEC §11.3 keeps severity policy in @kovojs/core.',
    maxLineBytes: MCP_MAX_LINE_BYTES,
    serverInfo: { name: 'kovo', version: mcpOutputVersion },
    tools: listing.tools,
  });
}

function mcpToolResult(structuredContent: Record<string, unknown>): FiniteMcpToolResult {
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

async function callMcpTool(
  name: string,
  args: unknown,
  workspaceRoot: McpWorkspaceRoot,
): Promise<unknown> {
  if (name === 'compile_component') {
    return compileComponentV1WithWorkspace(
      assertCompileComponentV1Input(args, workspaceRoot),
      workspaceRoot,
    );
  }
  if (name === 'kovo_check') return runKovoCheckTool(args);
  if (name === 'kovo_docs') return await runKovoDocsTool(args, workspaceRoot);
  if (name === 'kovo_explain') return runKovoExplainTool(args);
  if (name === 'list_diagnostics') {
    assertExactKeys(assertToolArgs(args, 'list_diagnostics'), [], 'list_diagnostics arguments');
    return listDiagnosticsV1();
  }

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
          additionalProperties: false,
          properties: {
            fileName: { maxLength: 4096, type: 'string' },
            source: { maxLength: MCP_MAX_COMPILE_SOURCE_BYTES, type: 'string' },
          },
          required: ['fileName', 'source'],
          type: 'object',
        },
        name: 'compile_component',
      },
      {
        description: 'Run kovoCheck against a bounded inline graph.',
        inputSchema: graphToolSchema({ family: { enum: ['all', 'coverage', 'optimistic'] } }),
        name: 'kovo_check',
      },
      {
        description: 'Search the exact version-matched local Kovo docs snapshot.',
        inputSchema: {
          additionalProperties: false,
          properties: {
            limit: { maximum: 8, minimum: 1, type: 'integer' },
            task: { maxLength: 256, minLength: 1, type: 'string' },
          },
          required: ['task'],
          type: 'object',
        },
        name: 'kovo_docs',
      },
      {
        description: 'Run kovoExplain against a bounded inline graph.',
        inputSchema: graphToolSchema({ options: explainOptionsSchema() }, ['options']),
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
      ...properties,
    },
    required,
    type: 'object',
  };
}

function explainOptionsSchema(): Record<string, unknown> {
  const exactMode = (
    properties: Record<string, unknown>,
    required: readonly string[],
  ): Record<string, unknown> => ({
    additionalProperties: false,
    properties,
    required,
    type: 'object',
  });
  const auditMode = (name: 'access' | 'unguarded' | 'unscoped') =>
    exactMode({ failOnFindings: { type: 'boolean' }, [name]: { const: true } }, [name]);
  return {
    oneOf: [
      exactMode({ agent: { const: true } }, ['agent']),
      auditMode('access'),
      exactMode({ endpoints: { const: true } }, ['endpoints']),
      auditMode('unguarded'),
      auditMode('unscoped'),
      exactMode(
        {
          kind: { enum: ['component', 'context', 'mutation', 'page', 'query', 'task'] },
          optimistic: { type: 'boolean' },
          target: { minLength: 1, type: 'string' },
        },
        ['kind', 'target'],
      ),
    ],
    type: 'object',
  };
}

function runKovoCheckTool(args: unknown): KovoCheckResult & { version: typeof outputVersion } {
  const options = assertToolArgs(args, 'kovo_check');
  assertExactKeys(options, ['family', 'graph'], 'kovo_check arguments');
  const graph = graphToolInput(options);
  const family = assertKovoCheckFamily(options.family);
  const result = kovoCheck(graph, { family });
  return {
    ...result,
    ...(result.diagnostics === undefined ? {} : { diagnostics: result.diagnostics }),
    version: outputVersion,
  };
}

async function runKovoDocsTool(
  args: unknown,
  workspaceRoot: McpWorkspaceRoot,
): Promise<{
  results: Awaited<ReturnType<typeof searchInstalledAgentDocs>>;
  version: typeof DOCS_RESULT_PROTOCOL;
}> {
  const options = assertToolArgs(args, 'kovo_docs');
  assertExactKeys(options, ['limit', 'task'], 'kovo_docs arguments');
  if (typeof options.task !== 'string') {
    throw new Error('kovo_docs task must be a string');
  }
  if (buildByteLength(options.task) < 1 || buildByteLength(options.task) > 256) {
    throw new Error('kovo_docs task must be 1..256 UTF-8 bytes');
  }
  if (
    options.limit !== undefined &&
    (!Number.isSafeInteger(options.limit) ||
      (options.limit as number) < 1 ||
      (options.limit as number) > 8)
  ) {
    throw new Error('kovo_docs limit must be an integer from 1 through 8');
  }
  const version = readCliPackageVersion();
  const expectedSnapshot = readInstalledAgentDocsSnapshot({ expectedVersion: version });
  return {
    results: await searchInstalledAgentDocs({
      cwd: workspaceRoot.canonicalRoot,
      expectedSnapshot,
      ...(options.limit === undefined ? {} : { limit: options.limit as number }),
      task: options.task,
    }),
    version: DOCS_RESULT_PROTOCOL,
  };
}

function runKovoExplainTool(
  args: unknown,
): KovoCheckResult & { version: typeof explainOutputVersion } {
  const options = assertToolArgs(args, 'kovo_explain');
  assertExactKeys(options, ['graph', 'options'], 'kovo_explain arguments');
  const explainOptions = assertKovoExplainOptions(options.options);
  const graph = graphToolInput(options);
  const result = kovoExplain(graph, explainOptions);
  return { ...result, version: explainOutputVersion };
}

function graphToolInput(args: Record<string, unknown>): CoreGraph.KovoExplainInput {
  if (Object.hasOwn(args, 'graph')) {
    if (!isRecord(args.graph)) throw new Error('graph must be an object');
    // The shape/work pass is linear over the finite transport snapshot and runs before graph
    // validation or any verifier helper can perform a join.
    assertMcpGraphWorkBudget(args.graph as CoreGraph.KovoExplainInput);
    const validationErrors = validateKovoExplainInput(args.graph);
    if (validationErrors.length > 0)
      throw new Error(validationErrors[0]?.message ?? 'invalid graph');
    return args.graph as CoreGraph.KovoExplainInput;
  }

  return {};
}

function assertKovoCheckFamily(value: unknown): ReturnType<typeof checkFamilyArg> {
  if (value === undefined) return 'all';
  if (value !== 'all' && value !== 'coverage' && value !== 'optimistic') {
    throw new Error('kovo_check family must be all, coverage, or optimistic');
  }
  return checkFamilyArg(value);
}

function assertMcpGraphWorkBudget(graph: CoreGraph.KovoExplainInput): void {
  const mutations = Array.isArray(graph.mutations) ? graph.mutations : [];
  const queries = Array.isArray(graph.queries) ? graph.queries : [];
  const updateCoverage = Array.isArray(graph.updateCoverage) ? graph.updateCoverage : [];
  const touchGraph = isRecord(graph.touchGraph) ? graph.touchGraph : {};
  const touchEntries = Object.values(touchGraph).filter(isRecord);

  let mutationDomainEntries = 0;
  for (const mutation of mutations) {
    if (!isRecord(mutation)) continue;
    const ownDomainCount =
      arrayLength(mutation.writes) +
      arrayLength(mutation.invalidates) +
      arrayLength(mutation.manualInvalidates);
    mutationDomainEntries += ownDomainCount;
  }

  let queryDomainEntries = 0;
  for (const query of queries) {
    if (isRecord(query)) queryDomainEntries += arrayLength(query.domains);
  }
  let touchDomainEntries = 0;
  for (const entry of touchEntries) touchDomainEntries += arrayLength(entry.touches);
  const renderOnceCount = updateCoverage.filter(
    (fact) => isRecord(fact) && fact.status === 'renderOnce' && fact.source !== 'state',
  ).length;

  // Every graph array entry and touch-map row participates in a single conservative pair envelope.
  // That bounds mutation x query, query x component/page consumer, endpoint runMutation x
  // mutation, scope x ownership, session-authority, event/query, and endpoint-posture joins even
  // when a newly added verifier path is not separately instrumented. The only known cubic path is
  // render-once invalidation, which is charged explicitly below including nested domain scans.
  const shape = graphShapeStats(graph as Record<string, unknown>);
  if (shape.maxStringBytes > MCP_MAX_GRAPH_STRING_BYTES) {
    throw new Error(`MCP graph string exceeds ${MCP_MAX_GRAPH_STRING_BYTES} bytes`);
  }
  const shapeEntries = saturatingAdd(
    MCP_MAX_GRAPH_WORK_UNITS,
    shape.arrayEntries,
    shape.objectProperties,
  );
  const pairWorkEnvelope = saturatingMultiply(MCP_MAX_GRAPH_WORK_UNITS, shapeEntries, shapeEntries);
  const invalidatorCount = saturatingAdd(
    MCP_MAX_GRAPH_WORK_UNITS,
    mutations.length,
    touchEntries.length,
  );
  const invalidatorDomainEntries = saturatingAdd(
    MCP_MAX_GRAPH_WORK_UNITS,
    mutationDomainEntries,
    touchDomainEntries,
  );
  const workForAllInvalidatorsPerQuery = saturatingAdd(
    MCP_MAX_GRAPH_WORK_UNITS,
    invalidatorCount,
    invalidatorDomainEntries,
  );
  const renderOnceWorkPerCoverage = saturatingAdd(
    MCP_MAX_GRAPH_WORK_UNITS,
    queries.length,
    saturatingMultiply(MCP_MAX_GRAPH_WORK_UNITS, queries.length, workForAllInvalidatorsPerQuery),
    saturatingMultiply(MCP_MAX_GRAPH_WORK_UNITS, invalidatorCount, queryDomainEntries),
  );
  const renderOnceWork = saturatingMultiply(
    MCP_MAX_GRAPH_WORK_UNITS,
    renderOnceCount,
    renderOnceWorkPerCoverage,
  );
  const aggregateWork = saturatingAdd(MCP_MAX_GRAPH_WORK_UNITS, pairWorkEnvelope, renderOnceWork);
  if (aggregateWork > MCP_MAX_GRAPH_WORK_UNITS) {
    throw new Error(
      `MCP graph work exceeds ${MCP_MAX_GRAPH_WORK_UNITS} aggregate comparison units`,
    );
  }

  // Bound materialized findings separately from CPU. The finite transport independently rejects
  // any response above 4 MiB; this pre-verifier estimate keeps us from first allocating an
  // attacker-amplified warning buffer only to have the transport discard it.
  const estimatedOutputRows = saturatingAdd(
    MCP_MAX_GRAPH_OUTPUT_ROWS,
    shapeEntries,
    saturatingMultiply(MCP_MAX_GRAPH_OUTPUT_ROWS, mutations.length, queries.length),
    updateCoverage.length,
  );
  if (estimatedOutputRows > MCP_MAX_GRAPH_OUTPUT_ROWS) {
    throw new Error(`MCP graph output exceeds ${MCP_MAX_GRAPH_OUTPUT_ROWS} estimated rows`);
  }
  const amplifiedTextBytes = saturatingMultiply(
    MCP_MAX_GRAPH_AMPLIFIED_TEXT_BYTES,
    shape.textBytes,
    Math.max(1, estimatedOutputRows),
  );
  if (amplifiedTextBytes > MCP_MAX_GRAPH_AMPLIFIED_TEXT_BYTES) {
    throw new Error(
      `MCP graph output exceeds ${MCP_MAX_GRAPH_AMPLIFIED_TEXT_BYTES} estimated bytes`,
    );
  }
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function graphShapeStats(root: Record<string, unknown>): {
  arrayEntries: number;
  maxStringBytes: number;
  objectProperties: number;
  textBytes: number;
} {
  const pending: unknown[] = [root];
  let arrayEntries = 0;
  let maxStringBytes = 0;
  let objectProperties = 0;
  let textBytes = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === 'string') {
      const bytes = buildByteLength(value);
      if (bytes > maxStringBytes) maxStringBytes = bytes;
      textBytes = saturatingAdd(MCP_MAX_GRAPH_AMPLIFIED_TEXT_BYTES, textBytes, bytes);
      continue;
    }
    if (Array.isArray(value)) {
      arrayEntries = saturatingAdd(MCP_MAX_GRAPH_WORK_UNITS, arrayEntries, value.length);
      for (let index = 0; index < value.length; index += 1) pending.push(value[index]);
      continue;
    }
    if (!isRecord(value)) continue;
    const children = Object.values(value);
    objectProperties = saturatingAdd(MCP_MAX_GRAPH_WORK_UNITS, objectProperties, children.length);
    for (const child of children) pending.push(child);
  }
  return { arrayEntries, maxStringBytes, objectProperties, textBytes };
}

function saturatingAdd(limit: number, ...values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || value > limit - total) return limit + 1;
    total += value;
  }
  return total;
}

function saturatingMultiply(limit: number, left: number, right: number): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0 ||
    (left !== 0 && right > Math.floor(limit / left))
  ) {
    return limit + 1;
  }
  return left * right;
}

function assertToolArgs(args: unknown, tool: KovoMcpToolName): Record<string, unknown> {
  if (!isRecord(args)) throw new Error(`${tool} arguments must be an object`);
  return args;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const unsupported = Object.keys(value)
    .filter((key) => !allowedKeys.has(key))
    .sort();
  if (unsupported.length > 0) {
    throw new Error(`${label} contain unsupported field ${unsupported[0]}`);
  }
}

function assertOptionalBoolean(
  value: Record<string, unknown>,
  key: string,
  label: string,
): { failOnFindings?: boolean } {
  if (!Object.hasOwn(value, key)) return {};
  if (typeof value[key] !== 'boolean') throw new Error(`${label} ${key} must be a boolean`);
  return { failOnFindings: value[key] };
}

function assertMcpCompileFileName(fileName: string, workspaceRoot: McpWorkspaceRoot): void {
  const segments = fileName.split('/');
  const resolved = resolve(workspaceRoot.canonicalRoot, fileName);
  const relativePath = relative(workspaceRoot.canonicalRoot, resolved);
  if (
    fileName.length === 0 ||
    fileName.includes('\\') ||
    fileName.includes('\0') ||
    isAbsolute(fileName) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      'compile_component fileName must be a relative path confined to the MCP launch workspace',
    );
  }
  if (segments.length > MCP_MAX_COMPILE_PATH_SEGMENTS) {
    throw new Error(
      `compile_component fileName exceeds ${MCP_MAX_COMPILE_PATH_SEGMENTS} path segments`,
    );
  }
}

function canonicalMcpWorkspaceRoot(invocationCwd: string): McpWorkspaceRoot {
  if (typeof invocationCwd !== 'string' || invocationCwd.length === 0) {
    throw new TypeError('MCP launch workspace must be a nonempty path');
  }
  const workspaceRoot = CompilerInternal.createCompilerSourceRootWitness(invocationCwd);
  if (workspaceRoot === null) throw new TypeError('MCP launch workspace must be a directory');
  return workspaceRoot;
}

function assertCompileComponentV1Input(
  args: unknown,
  workspaceRoot: McpWorkspaceRoot,
): CompileComponentV1Input {
  const inputArgs = assertToolArgs(args, 'compile_component');
  assertExactKeys(inputArgs, ['fileName', 'source'], 'compile_component arguments');
  if (typeof inputArgs.fileName !== 'string') {
    throw new Error('compile_component fileName must be a string');
  }
  if (typeof inputArgs.source !== 'string') {
    throw new Error('compile_component source must be a string');
  }
  if (buildByteLength(inputArgs.source) > MCP_MAX_COMPILE_SOURCE_BYTES) {
    throw new Error(`compile_component source exceeds ${MCP_MAX_COMPILE_SOURCE_BYTES} bytes`);
  }
  if (inputArgs.fileName.length > 4096) {
    throw new Error('compile_component fileName exceeds 4096 characters');
  }
  assertMcpCompileFileName(inputArgs.fileName, workspaceRoot);
  assertMcpCompilePreparseBudget(inputArgs.source);
  const syntaxBudget = CompilerInternal.compilerSourceSyntaxBudget(
    inputArgs.fileName,
    inputArgs.source,
    {
      maxDepth: MCP_MAX_COMPILE_SYNTAX_DEPTH,
      maxNodes: MCP_MAX_COMPILE_SYNTAX_NODES,
    },
  );
  if (!syntaxBudget.ok) {
    throw new Error(
      syntaxBudget.reason === 'depth'
        ? `compile_component source exceeds ${MCP_MAX_COMPILE_SYNTAX_DEPTH} syntax depth`
        : syntaxBudget.reason === 'parser'
          ? 'compile_component source exceeds the finite parser recursion budget'
          : `compile_component source exceeds ${MCP_MAX_COMPILE_SYNTAX_NODES} syntax nodes`,
    );
  }
  const input: CompileComponentV1Input = {
    fileName: inputArgs.fileName,
    source: inputArgs.source,
  };

  return input;
}

function assertMcpCompilePreparseBudget(source: string): void {
  let inToken = false;
  let structuralTokens = 0;
  let tokens = 0;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    const isWord =
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      code === 0x24 ||
      code === 0x5f;
    if (isWord) {
      if (!inToken) tokens += 1;
      inToken = true;
    } else {
      inToken = false;
      if (code > 0x20) tokens += 1;
    }
    // Raw source is deliberately conservative: every potential parsed opener is charged even
    // inside a literal/comment. Parsed nesting therefore cannot exceed this pre-parse ceiling.
    if (code === 0x28 || code === 0x3c || code === 0x5b || code === 0x7b) {
      structuralTokens += 1;
    }
    if (tokens > MCP_MAX_COMPILE_PREPARSE_TOKENS) {
      throw new Error(
        `compile_component source exceeds ${MCP_MAX_COMPILE_PREPARSE_TOKENS} pre-parse tokens`,
      );
    }
    if (structuralTokens > MCP_MAX_COMPILE_STRUCTURAL_TOKENS) {
      throw new Error(
        `compile_component source exceeds ${MCP_MAX_COMPILE_STRUCTURAL_TOKENS} structural tokens`,
      );
    }
  }
}

function assertKovoExplainOptions(value: unknown): KovoExplainOptions {
  if (!isRecord(value)) throw new Error('kovo_explain options must be an object');
  const modeFields = ['access', 'agent', 'endpoints', 'unguarded', 'unscoped'] as const;
  const selectedModes = modeFields.filter((field) => value[field] === true);
  const targeted = Object.hasOwn(value, 'kind') || Object.hasOwn(value, 'target');
  if (selectedModes.length + (targeted ? 1 : 0) > 1) {
    throw new Error('kovo_explain options select multiple modes');
  }

  if (value.agent === true) {
    assertExactKeys(value, ['agent'], 'kovo_explain options');
    return { agent: true };
  }
  if (value.access === true) {
    assertExactKeys(value, ['access', 'failOnFindings'], 'kovo_explain options');
    return {
      ...assertOptionalBoolean(value, 'failOnFindings', 'kovo_explain options'),
      access: true,
    };
  }
  if (value.endpoints === true) {
    assertExactKeys(value, ['endpoints'], 'kovo_explain options');
    return { endpoints: true };
  }
  if (value.unguarded === true) {
    assertExactKeys(value, ['failOnFindings', 'unguarded'], 'kovo_explain options');
    return {
      ...assertOptionalBoolean(value, 'failOnFindings', 'kovo_explain options'),
      unguarded: true,
    };
  }
  if (value.unscoped === true) {
    assertExactKeys(value, ['failOnFindings', 'unscoped'], 'kovo_explain options');
    return {
      ...assertOptionalBoolean(value, 'failOnFindings', 'kovo_explain options'),
      unscoped: true,
    };
  }

  const kind = typeof value.kind === 'string' ? value.kind : undefined;
  if (!isExplainKind(kind) || typeof value.target !== 'string') {
    throw new Error('kovo_explain options require kind and target, or a supported audit flag');
  }
  assertExactKeys(value, ['kind', 'optimistic', 'target'], 'kovo_explain options');
  if (value.target.length === 0) throw new Error('kovo_explain options target must be nonempty');
  if (Object.hasOwn(value, 'optimistic') && typeof value.optimistic !== 'boolean') {
    throw new Error('kovo_explain options optimistic must be a boolean');
  }

  return {
    kind,
    ...(typeof value.optimistic === 'boolean' ? { optimistic: value.optimistic } : {}),
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

function mcpContentText(structuredContent: unknown): string {
  if (isRecord(structuredContent) && typeof structuredContent.version === 'string') {
    return structuredContent.version;
  }

  return mcpOutputVersion;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
