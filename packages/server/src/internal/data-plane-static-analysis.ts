import {
  existsSync as builtinExistsSync,
  mkdirSync as builtinMkdirSync,
  readFileSync as builtinReadFileSync,
  readdirSync as builtinReaddirSync,
  statSync as builtinStatSync,
  writeFileSync as builtinWriteFileSync,
} from 'node:fs';
import {
  createRequire as builtinCreateRequire,
  registerHooks as builtinRegisterHooks,
} from 'node:module';
import { availableParallelism as builtinAvailableParallelism } from 'node:os';
import {
  dirname as builtinDirname,
  join as builtinJoin,
  relative as builtinRelative,
  resolve as builtinResolve,
} from 'node:path';
import {
  isMainThread as builtinIsMainThread,
  parentPort as builtinParentPort,
  Worker as BuiltinWorker,
  workerData as builtinWorkerData,
} from 'node:worker_threads';
import { fileURLToPath as builtinFileURLToPath } from 'node:url';

import type { DiagnosticCode } from '@kovojs/core';
import { diagnosticDefinitions, isDiagnosticCode } from '@kovojs/core/internal/diagnostics';
import {
  outputSchemaQueryShapeFactsFromProject,
  type QueryShape,
  type QueryShapeFact,
} from '@kovojs/core/internal/query-shape-source';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import {
  staticAnalysisArrayAppend,
  staticAnalysisArrayIsArray,
  staticAnalysisArrayLength,
  staticAnalysisArraySet,
  staticAnalysisCanonicalJson,
  staticAnalysisCreateUrl,
  staticAnalysisCreatePromise,
  staticAnalysisDefineDataProperty,
  staticAnalysisHmacSha256,
  staticAnalysisJsonParse,
  staticAnalysisMapGet,
  staticAnalysisMapSet,
  staticAnalysisMathMax,
  staticAnalysisMathMin,
  staticAnalysisNumberIsFinite,
  staticAnalysisNumberParseInt,
  staticAnalysisNullRecord,
  staticAnalysisObjectKeys,
  staticAnalysisOwnDataValue,
  staticAnalysisPromiseAll,
  staticAnalysisRegExpTest,
  staticAnalysisRandomUuid,
  staticAnalysisSecureStringEqual,
  staticAnalysisSha256,
  staticAnalysisStringEndsWith,
  staticAnalysisStringIncludes,
  staticAnalysisStringIndexOf,
  staticAnalysisStringLastIndexOf,
  staticAnalysisStringSlice,
  staticAnalysisStringStartsWith,
  staticAnalysisStringToLowerCase,
  staticAnalysisStatsIsDirectory,
  staticAnalysisUrlHref,
} from './data-plane-static-analysis-intrinsics.ts';
import type { RuntimeRegistryWireFacts } from './runtime-registry-wire.js';

export type { QueryShape, QueryShapeFact };

/** @internal SPEC.md §10.2/§10.3/§11.4 shared data-plane static-analysis source input. */
export interface DataPlaneSourceFile {
  fileName: string;
  source: string;
}

/** @internal Normalized error-severity finding from the data-plane analyzers. */
export interface DataPlaneDiagnostic {
  code: DiagnosticCode;
  fileName: string;
  line: number;
  message: string;
  site: string;
}

/** @internal Static facts consumed by build/check graph derivation. */
export interface StaticDataPlaneBuildFacts {
  massAssignmentFacts: readonly CoreGraph.MassAssignmentFact[];
  ownerDomains: readonly CoreGraph.OwnerDomainFact[];
  queries: readonly QueryReadFactLike[];
  queryShapeFacts: readonly QueryShapeFact[];
  queryWriteReachability: readonly CoreGraph.QueryWriteReachabilityFact[];
  scopeAudits: readonly CoreGraph.ScopeAuditFact[];
  sqlSafetyDiagnostics: readonly CoreGraph.SqlSafetyDiagnosticFact[];
  toctouFacts: readonly CoreGraph.ToctouFact[];
  touchGraph?: CoreGraph.TouchGraph;
}

/** @internal Runtime registry facts derived from the same static query/write facts. */
export type DataPlaneRuntimeRegistryFacts = RuntimeRegistryWireFacts;

/** @internal Options for CLI build/check static data-plane fact extraction. */
export interface StaticDataPlaneBuildFactsOptions {
  cache: boolean;
  cacheRoot?: string;
}

/** @internal Complete Vite/server-side app source analysis. */
export interface DataPlaneAnalysis {
  files: readonly DataPlaneSourceFile[];
  outputQueryShapeFacts: readonly QueryShapeFact[];
  staticFacts: StaticBuildAnalysisFactsLike;
}

/** @internal Structural view of Drizzle query-read facts used by CLI graph derivation. */
export interface QueryReadFactLike {
  readOnlyDomains?: readonly string[];
  readProvenance?: readonly CoreGraph.QueryReadProvenance[];
  reads?: readonly string[];
  shape?: QueryShapeFact['shape'];
  site?: string;
  query?: string;
}

/** @internal Structural runtime mutation touch site. */
export interface RuntimeMutationTouchSiteLike {
  crossTable?: true;
  domain: string;
  keys: null | string;
}

interface TouchGraphDiagnosticLike {
  code: string;
  message: string;
  severity?: string;
  site: string;
}

interface ToctouFactLike {
  column: string;
  name?: string;
  site: string;
  table: string;
}

interface KovoDrizzleStaticModule {
  deriveMutationTouchRegistry(options: {
    mutations: readonly { mutation: string; touchGraphKey: string }[];
    touchGraph: unknown;
  }): Readonly<Record<string, readonly RuntimeMutationTouchSiteLike[]>>;
  extractStaticBuildAnalysisFactsFromProject(options: {
    files: readonly DataPlaneSourceFile[];
  }): StaticBuildAnalysisFactsLike;
}

interface StaticBuildAnalysisFactsLike {
  massAssignmentFacts?: readonly CoreGraph.MassAssignmentFact[];
  ownerDomains?: readonly CoreGraph.OwnerDomainFact[];
  queries: readonly unknown[];
  queryWriteReachability?: readonly CoreGraph.QueryWriteReachabilityFact[];
  runtimeTableSecurityManifest?: RuntimeRegistryWireFacts['tableSecurity'];
  scopeAudits?: readonly CoreGraph.ScopeAuditFact[];
  sqlSafetyDiagnostics: readonly TouchGraphDiagnosticLike[];
  toctouFacts: readonly ToctouFactLike[];
  touchGraph: unknown;
}

const DRIZZLE_STATIC_ANALYZER_MODULE = '@kovojs/drizzle/internal/static';
const STATIC_DATA_PLANE_FACTS_CACHE_VERSION = '2026-07-02.authz-census.v1';
const STATIC_DATA_PLANE_CACHE_ENVELOPE_VERSION = 'kovo-static-data-plane-cache/v3';
const OUTPUT_SCHEMA_QUERY_SHAPE_WORKER_KIND = 'kovo.output-schema-query-shape';
const OUTPUT_SCHEMA_WORKER_MIN_FILES = 8;
const OUTPUT_SCHEMA_WORKER_MAX_COUNT = 4;
const existsSync = builtinExistsSync;
const mkdirSync = builtinMkdirSync;
const readFileSync = builtinReadFileSync;
const readdirSync = builtinReaddirSync;
const statSync = builtinStatSync;
const writeFileSync = builtinWriteFileSync;
const createRequire = builtinCreateRequire;
const registerHooks = builtinRegisterHooks;
const availableParallelism = builtinAvailableParallelism;
const dirname = builtinDirname;
const join = builtinJoin;
const relative = builtinRelative;
const resolve = builtinResolve;
const isMainThread = builtinIsMainThread;
const parentPort = builtinParentPort;
const Worker = BuiltinWorker;
const workerData = builtinWorkerData;
const fileURLToPath = builtinFileURLToPath;
const processOnlyAnalyzerIdentity = staticAnalysisRandomUuid();
// Cache storage is app-writable and therefore cannot authorize security facts. A key that exists
// only in this bootstrapped process turns coordinated envelope edits into misses. Consequently,
// cross-process entries are deliberately performance hints only and are re-analyzed (SPEC §11.4).
const staticDataPlaneCacheMacKey = staticAnalysisRandomUuid();

interface OutputSchemaQueryShapeWorkerData {
  files: readonly DataPlaneSourceFile[];
  kind: typeof OUTPUT_SCHEMA_QUERY_SHAPE_WORKER_KIND;
  projectFiles?: readonly DataPlaneSourceFile[];
}

type TypeScriptModule = typeof import('typescript');

let compilerSourceResolutionHooksRegistered = false;
let loadedTypeScript: TypeScriptModule | undefined;
const dataPlaneAnalysisCache = new Map<string, Promise<DataPlaneAnalysis>>();

class DataPlaneStaticAnalysisError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'DataPlaneStaticAnalysisError';
    this.cause = cause;
  }
}

if (!isMainThread && isOutputSchemaQueryShapeWorkerData(workerData)) {
  parentPort?.postMessage(
    outputSchemaQueryShapeFactsSerial(
      workerData.files,
      workerData.projectFiles ?? workerData.files,
    ),
  );
}

/** @internal Build the analyzer SourceFileInput[] for a Vite app source tree. */
export function dataPlaneSourceFiles(sourceDir: string, root: string): DataPlaneSourceFile[] {
  if (!existsSync(sourceDir)) return [];
  const paths = dataPlaneSourceFilePaths(sourceDir);
  sortStrings(paths);
  const files: DataPlaneSourceFile[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const filePath = paths[index]!;
    staticAnalysisArrayAppend(
      files,
      {
        fileName: slashPath(relative(root, filePath)),
        source: readFileSync(filePath, 'utf8'),
      },
      'Static-analysis discovered files',
    );
  }
  return files;
}

/** @internal Whether a changed file is an app data-plane source file the Vite gate should re-run. */
export function isDataPlaneSourceFile(file: string, sourceDir: string): boolean {
  const normalized = slashPath(stripPathSuffix(file));
  const normalizedSourceDir = slashPath(sourceDir);
  if (
    normalized !== normalizedSourceDir &&
    !staticAnalysisStringStartsWith(normalized, `${normalizedSourceDir}/`)
  ) {
    return false;
  }
  return isDataPlaneAppSourcePath(normalized, { includeDeclarations: true });
}

/** @internal Build the analyzer SourceFileInput[] for CLI build/check. */
export function buildCheckSourceFiles(appModulePath: string): DataPlaneSourceFile[] {
  const sourceDir = dirname(appModulePath);
  return sourceFilesUnder(sourceDir, sourceDir);
}

/** @internal Run Vite/server app source static analysis and cache by source snapshot. */
export async function collectDataPlaneAnalysis(options: {
  appSourceDir: string;
  root: string;
  skipStaticFacts?: boolean;
}): Promise<DataPlaneAnalysis> {
  const files = dataPlaneSourceFiles(options.appSourceDir, options.root);
  if (options.skipStaticFacts) {
    return {
      files,
      outputQueryShapeFacts: await outputSchemaQueryShapeFactsAsync(files),
      staticFacts: emptyStaticBuildAnalysisFactsLike(),
    };
  }
  const identity = dataPlaneAnalysisCacheIdentity(files);
  const cached = staticAnalysisMapGet(dataPlaneAnalysisCache, identity);
  if (cached) return cached;
  const promise = createDataPlaneAnalysis(options.root, identity, files);
  staticAnalysisMapSet(dataPlaneAnalysisCache, identity, promise);
  return promise;
}

/** @internal Return Vite build/dev error diagnostics from shared data-plane facts. */
export async function collectDataPlaneErrorDiagnostics(options: {
  appSourceDir: string;
  root: string;
}): Promise<DataPlaneDiagnostic[]> {
  const analysis = await collectDataPlaneAnalysis(options);
  return dataPlaneErrorDiagnosticsFromStaticFacts(analysis.staticFacts, analysis.files);
}

/** @internal Derive compiler query-shape facts for Vite/compiler invocations. */
export async function collectCompilerQueryShapeFacts(options: {
  appSourceDir: string;
  root: string;
}): Promise<readonly QueryShapeFact[]> {
  // SPEC.md §2 / §11.4: authored config shares this process and therefore cannot provide
  // verification facts through ambient globals. Derive them here; trusted CLI builds pass their
  // already-derived snapshot directly to the compiler plugin instead.
  const { currentKovoBuildContext } = await import('./build-context.js');

  const analysis = await collectDataPlaneAnalysis({
    ...options,
    skipStaticFacts: currentKovoBuildContext()?.graphDerivation === true,
  });
  if (analysis.files.length === 0) return [];
  return mergeStaticAndOutputQueryShapeFacts(
    analysis.staticFacts.queries,
    analysis.outputQueryShapeFacts,
  );
}

/** @internal Derive runtime query-read and mutation-touch registries from shared facts. */
export async function collectRuntimeRegistryFacts(options: {
  appSourceDir: string;
  root: string;
}): Promise<DataPlaneRuntimeRegistryFacts> {
  const analysis = await collectDataPlaneAnalysis(options);
  if (analysis.files.length === 0) return { mutationTouches: {}, queryReads: [] };
  const {
    runtimeRegistryMutationTouchesFromGraph,
    runtimeRegistryQueryReadsFromFacts,
    runtimeRegistryTableSecurityFromFacts,
  } = await importRuntimeRegistryWireModule();

  return {
    mutationTouches: runtimeRegistryMutationTouchesFromGraph(
      analysis.staticFacts.touchGraph === undefined
        ? {}
        : { touchGraph: analysis.staticFacts.touchGraph as CoreGraph.TouchGraph },
    ),
    queryReads: runtimeRegistryQueryReadsFromFacts(
      analysis.staticFacts.queries as readonly { query?: unknown; reads?: readonly unknown[] }[],
    ),
    ...(analysis.staticFacts.runtimeTableSecurityManifest === undefined
      ? {}
      : {
          tableSecurity: runtimeRegistryTableSecurityFromFacts(
            analysis.staticFacts.runtimeTableSecurityManifest,
          ),
        }),
  };
}

/** @internal Run CLI build/check static data-plane extraction with shared resolver/cache/facts. */
export async function staticDataPlaneBuildFacts(
  files: readonly DataPlaneSourceFile[],
  options: StaticDataPlaneBuildFactsOptions,
): Promise<StaticDataPlaneBuildFacts> {
  const sourceFiles = snapshotDataPlaneSourceFiles(files, 'Build static-analysis sources');
  const analysisFiles = buildStaticAnalysisSourceFiles(sourceFiles);
  if (analysisFiles.length === 0) return { ...emptyStaticDataPlaneBuildFacts(), touchGraph: {} };

  const rawFacts = await cachedStaticBuildAnalysisFacts(sourceFiles, options);

  const queryReadFacts = snapshotDenseArray(
    rawFacts.queries as readonly QueryReadFactLike[],
    'Static query-read facts',
  );
  const sqlSafetyDiagnostics: CoreGraph.SqlSafetyDiagnosticFact[] = [];
  const rawSqlDiagnostics = snapshotDenseArray(
    rawFacts.sqlSafetyDiagnostics,
    'Static SQL-safety diagnostics',
  );
  for (let index = 0; index < rawSqlDiagnostics.length; index += 1) {
    const facts = sqlSafetyDiagnosticFact(rawSqlDiagnostics[index]);
    for (let factIndex = 0; factIndex < facts.length; factIndex += 1) {
      staticAnalysisArrayAppend(
        sqlSafetyDiagnostics,
        facts[factIndex]!,
        'Static-analysis SQL diagnostics',
      );
    }
  }
  const result: StaticDataPlaneBuildFacts = {
    massAssignmentFacts: snapshotDenseArray(
      rawFacts.massAssignmentFacts ?? [],
      'Static mass-assignment facts',
    ),
    ownerDomains: snapshotDenseArray(rawFacts.ownerDomains ?? [], 'Static owner-domain facts'),
    queries: queryReadFacts,
    queryShapeFacts: queryShapeFactsFromQueryReadFacts(queryReadFacts),
    queryWriteReachability: snapshotDenseArray(
      rawFacts.queryWriteReachability ?? [],
      'Static query-write facts',
    ),
    scopeAudits: snapshotDenseArray(rawFacts.scopeAudits ?? [], 'Static scope-audit facts'),
    sqlSafetyDiagnostics,
    toctouFacts: projectToctouFacts(rawFacts.toctouFacts),
    touchGraph: rawFacts.touchGraph as CoreGraph.TouchGraph,
  };
  return result;
}

/** @internal Derive the compiler query-shape facts that combine Drizzle and declared output schemas. */
export function buildCompilerQueryShapeFacts(
  files: readonly DataPlaneSourceFile[],
  facts: StaticDataPlaneBuildFacts,
): readonly QueryShapeFact[] {
  return mergeQueryShapeFactSets(
    facts.queryShapeFacts,
    outputSchemaQueryShapeFacts(files, { worker: false }),
  );
}

function mergeStaticAndOutputQueryShapeFacts(
  queryFacts: readonly unknown[],
  outputQueryShapeFacts: readonly QueryShapeFact[],
): readonly QueryShapeFact[] {
  const drizzleFacts = compilerQueryShapeFacts(queryFacts);
  return mergeQueryShapeFactSets(drizzleFacts, outputQueryShapeFacts);
}

function mergeQueryShapeFactSets(
  primary: readonly QueryShapeFact[],
  secondary: readonly QueryShapeFact[],
): QueryShapeFact[] {
  const result: QueryShapeFact[] = [];
  for (let primaryIndex = 0; primaryIndex < primary.length; primaryIndex += 1) {
    const fact = primary[primaryIndex]!;
    let outputFact: QueryShapeFact | undefined;
    for (let secondaryIndex = 0; secondaryIndex < secondary.length; secondaryIndex += 1) {
      if (secondary[secondaryIndex]!.query === fact.query) {
        outputFact = secondary[secondaryIndex]!;
        break;
      }
    }
    insertQueryShapeFact(result, mergeCompilerQueryShapeFact(fact, outputFact));
  }
  for (let secondaryIndex = 0; secondaryIndex < secondary.length; secondaryIndex += 1) {
    const fact = secondary[secondaryIndex]!;
    let duplicate = false;
    for (let primaryIndex = 0; primaryIndex < primary.length; primaryIndex += 1) {
      if (primary[primaryIndex]!.query === fact.query) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) insertQueryShapeFact(result, fact);
  }
  return result;
}

function dataPlaneErrorDiagnosticsFromStaticFacts(
  staticFacts: StaticBuildAnalysisFactsLike,
  files: readonly DataPlaneSourceFile[],
): DataPlaneDiagnostic[] {
  if (files.length === 0) return [];
  const raw: TouchGraphDiagnosticLike[] = [];
  const sqlDiagnostics = snapshotDenseArray(
    staticFacts.sqlSafetyDiagnostics,
    'Vite SQL-safety diagnostics',
  );
  for (let index = 0; index < sqlDiagnostics.length; index += 1) {
    const projected = sqlSafetyDiagnosticFact(sqlDiagnostics[index]);
    for (let projectedIndex = 0; projectedIndex < projected.length; projectedIndex += 1) {
      staticAnalysisArrayAppend(raw, projected[projectedIndex]!, 'Vite SQL diagnostics');
    }
  }
  const toctouFacts = projectToctouFacts(staticFacts.toctouFacts);
  for (let index = 0; index < toctouFacts.length; index += 1) {
    const fact = toctouFacts[index]!;
    staticAnalysisArrayAppend(
      raw,
      {
        code: 'KV429',
        message: `${diagnosticDefinitions.KV429.message} ${fact.name ?? '<anonymous>'} writes ${fact.table}.${fact.column} without a compare-and-set/version guard.`,
        severity: 'error',
        site: fact.site,
      },
      'Vite data-plane diagnostics',
    );
  }
  const diagnostics: DataPlaneDiagnostic[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const diagnostic = raw[index]!;
    if (!isDiagnosticCode(diagnostic.code) || (diagnostic.severity ?? 'error') !== 'error') {
      continue;
    }
    const { fileName, line } = parseDiagnosticSite(diagnostic.site);
    const projected: DataPlaneDiagnostic = {
      code: diagnostic.code,
      fileName,
      line,
      message: diagnostic.message,
      site: diagnostic.site,
    };
    let insertAt = diagnostics.length;
    while (insertAt > 0 && projected.site < diagnostics[insertAt - 1]!.site) {
      staticAnalysisArraySet(
        diagnostics,
        insertAt,
        diagnostics[insertAt - 1]!,
        'Vite data-plane diagnostics',
      );
      insertAt -= 1;
    }
    staticAnalysisArraySet(diagnostics, insertAt, projected, 'Vite data-plane diagnostics');
  }
  return diagnostics;
}

function emptyStaticBuildAnalysisFactsLike(): StaticBuildAnalysisFactsLike {
  return { queries: [], sqlSafetyDiagnostics: [], toctouFacts: [], touchGraph: {} };
}

function emptyStaticDataPlaneBuildFacts(): StaticDataPlaneBuildFacts {
  return {
    massAssignmentFacts: [],
    ownerDomains: [],
    queries: [],
    queryShapeFacts: [],
    queryWriteReachability: [],
    scopeAudits: [],
    sqlSafetyDiagnostics: [],
    toctouFacts: [],
  };
}

async function createDataPlaneAnalysis(
  root: string,
  cacheIdentity: string,
  files: readonly DataPlaneSourceFile[],
): Promise<DataPlaneAnalysis> {
  const sourceFiles = snapshotDataPlaneSourceFiles(files, 'Vite static-analysis sources');
  if (sourceFiles.length === 0) {
    return {
      files: sourceFiles,
      outputQueryShapeFacts: [],
      staticFacts: emptyStaticBuildAnalysisFactsLike(),
    };
  }
  const viteCacheIdentity = namespacedDataPlaneCacheIdentity('vite', cacheIdentity);
  const cached = readCachedDataPlaneStaticFacts(root, viteCacheIdentity);
  if (cached) {
    return {
      files: sourceFiles,
      outputQueryShapeFacts: await outputSchemaQueryShapeFactsAsync(sourceFiles),
      staticFacts: cached,
    };
  }
  const analysisFiles = buildStaticAnalysisSourceFiles(sourceFiles);
  const staticFacts =
    analysisFiles.length === 0
      ? emptyStaticBuildAnalysisFactsLike()
      : await runStaticBuildAnalysisFacts(sourceFiles);
  writeCachedDataPlaneStaticFacts(root, viteCacheIdentity, staticFacts);
  return {
    files: sourceFiles,
    outputQueryShapeFacts: await outputSchemaQueryShapeFactsAsync(sourceFiles),
    staticFacts,
  };
}

async function cachedStaticBuildAnalysisFacts(
  files: readonly DataPlaneSourceFile[],
  options: StaticDataPlaneBuildFactsOptions,
): Promise<StaticBuildAnalysisFactsLike> {
  const sourceFiles = snapshotDataPlaneSourceFiles(files, 'Cached static-analysis sources');
  const cacheRoot = options.cacheRoot ?? process.cwd();
  const cacheIdentity = namespacedDataPlaneCacheIdentity(
    'build',
    dataPlaneAnalysisCacheIdentity(sourceFiles),
  );
  if (options.cache) {
    const cached = readCachedDataPlaneStaticFacts(cacheRoot, cacheIdentity);
    if (cached) return cached;
  }
  const facts = await runStaticBuildAnalysisFacts(sourceFiles);
  if (options.cache) writeCachedDataPlaneStaticFacts(cacheRoot, cacheIdentity, facts);
  return facts;
}

async function runStaticBuildAnalysisFacts(
  files: readonly DataPlaneSourceFile[],
): Promise<StaticBuildAnalysisFactsLike> {
  try {
    const drizzle = await importKovoDrizzleStaticModule();
    if (typeof drizzle.extractStaticBuildAnalysisFactsFromProject !== 'function') {
      throw new TypeError(
        '@kovojs/drizzle/internal/static must export extractStaticBuildAnalysisFactsFromProject.',
      );
    }
    const facts = snapshotStaticBuildAnalysisFacts(
      drizzle.extractStaticBuildAnalysisFactsFromProject({ files }),
    );
    if (facts === undefined) {
      throw new TypeError(
        '@kovojs/drizzle/internal/static extractStaticBuildAnalysisFactsFromProject returned an invalid static-analysis aggregate.',
      );
    }
    return facts;
  } catch (error) {
    throw dataPlaneStaticAnalysisError(error, files);
  }
}

async function importKovoDrizzleStaticModule(): Promise<KovoDrizzleStaticModule> {
  registerCompilerSourceResolutionHooks();
  try {
    return (await import(DRIZZLE_STATIC_ANALYZER_MODULE)) as unknown as KovoDrizzleStaticModule;
  } catch (error) {
    const workspaceSource = staticAnalysisCreateUrl(
      '../../../drizzle/src/static.ts',
      import.meta.url,
    );
    const workspaceSourceHref = staticAnalysisUrlHref(workspaceSource);
    if (existsSync(fileURLToPath(workspaceSourceHref))) {
      return (await import(workspaceSourceHref)) as unknown as KovoDrizzleStaticModule;
    }
    throw missingDrizzleError(error);
  }
}

function missingDrizzleError(cause: unknown): Error {
  return new Error(
    'Kovo requires @kovojs/drizzle to be installed so the data-plane static-analysis gates can run (KV422/KV410/KV411/KV429).',
    { cause },
  );
}

function dataPlaneStaticAnalysisError(
  cause: unknown,
  files: readonly DataPlaneSourceFile[],
): DataPlaneStaticAnalysisError {
  if (cause instanceof DataPlaneStaticAnalysisError) return cause;
  const sampleNames: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const name = files[index]!.fileName;
    let insertAt = sampleNames.length;
    while (insertAt > 0 && name < sampleNames[insertAt - 1]!) {
      staticAnalysisArraySet(
        sampleNames,
        insertAt,
        sampleNames[insertAt - 1]!,
        'Static-analysis sample names',
      );
      insertAt -= 1;
    }
    staticAnalysisArraySet(sampleNames, insertAt, name, 'Static-analysis sample names');
  }
  let sample = '';
  const sampleLength = staticAnalysisMathMin(3, sampleNames.length);
  for (let index = 0; index < sampleLength; index += 1) {
    if (index > 0) sample += ', ';
    sample += sampleNames[index]!;
  }
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  return new DataPlaneStaticAnalysisError(
    `KV245 Kovo data-plane static analysis failed closed (SPEC.md §10 / §11.4). The aggregate @kovojs/drizzle analyzer ABI is required; Kovo will not synthesize old analyzer entrypoints or return empty facts after import, parse, or ts-morph failures. ${sample ? `Relevant source sample: ${sample}.` : 'Relevant source sample: <none>.'} Cause: ${causeMessage}`,
    cause,
  );
}

function dataPlaneAnalysisCacheIdentity(files: readonly DataPlaneSourceFile[]): string {
  const sourceFiles = snapshotDataPlaneSourceFiles(files, 'Static-analysis cache-key sources');
  const entries: { path: string; source: string }[] = [];
  for (let index = 0; index < sourceFiles.length; index += 1) {
    const file = sourceFiles[index]!;
    const entry = { path: portableCacheFilePath(file.fileName), source: file.source };
    let insertAt = entries.length;
    while (insertAt > 0 && entry.path < entries[insertAt - 1]!.path) {
      staticAnalysisArraySet(
        entries,
        insertAt,
        entries[insertAt - 1]!,
        'Static-analysis cache entries',
      );
      insertAt -= 1;
    }
    staticAnalysisArraySet(entries, insertAt, entry, 'Static-analysis cache entries');
  }
  return staticAnalysisCanonicalJson({
    analyzerIdentity: staticDataPlaneAnalyzerIdentity(),
    files: entries,
    version: STATIC_DATA_PLANE_FACTS_CACHE_VERSION,
  });
}

function staticDataPlaneAnalyzerIdentity(): string {
  const resolved = resolveDataPlaneStaticAnalyzerPath();
  const packageRoot = resolved ? nearestPackageRoot(dirname(resolved)) : undefined;
  const sources: Array<{ path: string; source: string }> = [];
  let packageManifestSource: string | undefined;
  if (packageRoot) {
    packageManifestSource = readFileIfExists(join(packageRoot, 'package.json'));
    const srcDir = join(packageRoot, 'src');
    if (existsSync(srcDir)) {
      const analyzerSources = sourceFilePathsUnder(srcDir);
      for (let index = 0; index < analyzerSources.length; index += 1) {
        const file = analyzerSources[index]!;
        staticAnalysisArrayAppend(
          sources,
          {
            path: slashPath(relative(packageRoot, file)),
            source: readFileIfExists(file),
          },
          'Static-analysis analyzer sources',
        );
      }
    }
  }
  return staticAnalysisCanonicalJson(
    resolved && packageRoot && packageManifestSource !== undefined && sources.length > 0
      ? {
          packageManifestSource,
          resolvedPath: slashPath(relative(packageRoot, resolved)),
          sources,
          version: 'kovo-static-data-plane-analyzer-identity/v2',
        }
      : {
          processIdentity: processOnlyAnalyzerIdentity,
          version: 'kovo-static-data-plane-analyzer-identity/v2/process-only',
        },
  );
}

function namespacedDataPlaneCacheIdentity(kind: 'build' | 'vite', identity: string): string {
  return staticAnalysisCanonicalJson({ identity, kind });
}

function resolveDataPlaneStaticAnalyzerPath(): string | undefined {
  try {
    return createRequire(import.meta.url).resolve(DRIZZLE_STATIC_ANALYZER_MODULE);
  } catch {
    return undefined;
  }
}

function readCachedDataPlaneStaticFacts(
  root: string,
  cacheIdentity: string,
): StaticBuildAnalysisFactsLike | undefined {
  try {
    const parsed = staticAnalysisJsonParse(
      readFileSync(dataPlaneStaticFactsCachePath(root, cacheIdentity), 'utf8'),
    );
    if (!parsed || typeof parsed !== 'object' || staticAnalysisArrayIsArray(parsed)) {
      return undefined;
    }
    const version = staticAnalysisOwnDataValue(parsed, 'version', 'Static-analysis cache envelope');
    const storedIdentity = staticAnalysisOwnDataValue(
      parsed,
      'cacheIdentity',
      'Static-analysis cache envelope',
    );
    if (version !== STATIC_DATA_PLANE_CACHE_ENVELOPE_VERSION || storedIdentity !== cacheIdentity) {
      return undefined;
    }
    const resultPreimage = staticAnalysisOwnDataValue(
      parsed,
      'resultPreimage',
      'Static-analysis cache envelope',
    );
    const integrity = staticAnalysisOwnDataValue(
      parsed,
      'integrity',
      'Static-analysis cache envelope',
    );
    if (typeof resultPreimage !== 'string' || typeof integrity !== 'string') return undefined;
    const expectedIntegrity = staticAnalysisHmacSha256(
      staticDataPlaneCacheMacKey,
      staticAnalysisCanonicalJson({
        cacheIdentity: storedIdentity,
        resultPreimage,
        version,
      }),
    );
    if (!staticAnalysisSecureStringEqual(integrity, expectedIntegrity)) return undefined;
    return snapshotStaticBuildAnalysisFacts(staticAnalysisJsonParse(resultPreimage));
  } catch {
    return undefined;
  }
}

function writeCachedDataPlaneStaticFacts(
  root: string,
  cacheIdentity: string,
  facts: StaticBuildAnalysisFactsLike,
): void {
  try {
    const cachePath = dataPlaneStaticFactsCachePath(root, cacheIdentity);
    mkdirSync(dirname(cachePath), { recursive: true });
    const resultPreimage = staticAnalysisCanonicalJson(facts);
    const unsignedEnvelope = {
      cacheIdentity,
      resultPreimage,
      version: STATIC_DATA_PLANE_CACHE_ENVELOPE_VERSION,
    };
    const envelope = staticAnalysisCanonicalJson({
      ...unsignedEnvelope,
      integrity: staticAnalysisHmacSha256(
        staticDataPlaneCacheMacKey,
        staticAnalysisCanonicalJson(unsignedEnvelope),
      ),
    });
    writeFileSync(cachePath, `${envelope}\n`, 'utf8');
  } catch {
    // Cache writes are performance-only; the analyzer already ran for this source snapshot.
  }
}

function dataPlaneStaticFactsCachePath(root: string, cacheIdentity: string): string {
  return join(
    root,
    '.kovo/cache/static-build-analysis',
    `${staticAnalysisSha256(cacheIdentity)}.json`,
  );
}

function snapshotStaticBuildAnalysisFacts(
  value: unknown,
): StaticBuildAnalysisFactsLike | undefined {
  if (!value || typeof value !== 'object' || staticAnalysisArrayIsArray(value)) return undefined;
  const queries = staticAnalysisOwnDataValue(value, 'queries', 'Static-analysis facts');
  const sqlSafetyDiagnostics = staticAnalysisOwnDataValue(
    value,
    'sqlSafetyDiagnostics',
    'Static-analysis facts',
  );
  const toctouFacts = staticAnalysisOwnDataValue(value, 'toctouFacts', 'Static-analysis facts');
  const touchGraph = staticAnalysisOwnDataValue(value, 'touchGraph', 'Static-analysis facts');
  const runtimeTableSecurityManifest = staticAnalysisOwnDataValue(
    value,
    'runtimeTableSecurityManifest',
    'Static-analysis facts',
  );
  if (
    !staticAnalysisArrayIsArray(queries) ||
    !staticAnalysisArrayIsArray(sqlSafetyDiagnostics) ||
    !staticAnalysisArrayIsArray(toctouFacts) ||
    !touchGraph ||
    typeof touchGraph !== 'object' ||
    staticAnalysisArrayIsArray(touchGraph) ||
    (runtimeTableSecurityManifest !== undefined &&
      (runtimeTableSecurityManifest === null ||
        typeof runtimeTableSecurityManifest !== 'object' ||
        staticAnalysisArrayIsArray(runtimeTableSecurityManifest)))
  ) {
    return undefined;
  }
  let invalidOptionalArray = false;
  const optionalArray = (property: string): readonly unknown[] | undefined => {
    const candidate = staticAnalysisOwnDataValue(value, property, 'Static-analysis facts');
    if (candidate === undefined) return undefined;
    if (!staticAnalysisArrayIsArray(candidate)) {
      invalidOptionalArray = true;
      return undefined;
    }
    return snapshotDenseArray(candidate, property);
  };
  const massAssignmentFacts = optionalArray('massAssignmentFacts');
  const ownerDomains = optionalArray('ownerDomains');
  const queryWriteReachability = optionalArray('queryWriteReachability');
  const scopeAudits = optionalArray('scopeAudits');
  if (invalidOptionalArray) return undefined;
  const sqlSafetySnapshot = snapshotDenseArray(
    sqlSafetyDiagnostics,
    'Static SQL-safety diagnostics',
  ) as readonly TouchGraphDiagnosticLike[];
  for (let index = 0; index < sqlSafetySnapshot.length; index += 1) {
    sqlSafetyDiagnosticFact(sqlSafetySnapshot[index]);
  }
  const toctouSnapshot = snapshotDenseArray(
    toctouFacts,
    'Static TOCTOU facts',
  ) as readonly ToctouFactLike[];
  projectToctouFacts(toctouSnapshot);
  return {
    ...(massAssignmentFacts === undefined
      ? {}
      : { massAssignmentFacts: massAssignmentFacts as readonly CoreGraph.MassAssignmentFact[] }),
    ...(ownerDomains === undefined
      ? {}
      : { ownerDomains: ownerDomains as readonly CoreGraph.OwnerDomainFact[] }),
    queries: snapshotDenseArray(queries, 'Static query facts'),
    ...(queryWriteReachability === undefined
      ? {}
      : {
          queryWriteReachability:
            queryWriteReachability as readonly CoreGraph.QueryWriteReachabilityFact[],
        }),
    ...(scopeAudits === undefined
      ? {}
      : { scopeAudits: scopeAudits as readonly CoreGraph.ScopeAuditFact[] }),
    ...(runtimeTableSecurityManifest === undefined
      ? {}
      : {
          runtimeTableSecurityManifest: runtimeTableSecurityManifest as NonNullable<
            RuntimeRegistryWireFacts['tableSecurity']
          >,
        }),
    sqlSafetyDiagnostics: sqlSafetySnapshot,
    toctouFacts: toctouSnapshot,
    touchGraph,
  };
}

function queryShapeFactsFromQueryReadFacts(facts: readonly QueryReadFactLike[]): QueryShapeFact[] {
  const result: QueryShapeFact[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]!;
    const query = staticAnalysisOwnDataValue(fact, 'query', 'Static query-read fact');
    const shape = staticAnalysisOwnDataValue(fact, 'shape', 'Static query-read fact');
    const site = staticAnalysisOwnDataValue(fact, 'site', 'Static query-read fact');
    if (typeof query !== 'string' || shape === undefined || !isCompilerQueryShape(shape)) continue;
    staticAnalysisArrayAppend(
      result,
      {
        query,
        shape,
        source: typeof site === 'string' ? site : query,
      },
      'Static-analysis query-shape facts',
    );
  }
  return result;
}

function compilerQueryShapeFacts(queryFacts: readonly unknown[]): readonly QueryShapeFact[] {
  const sourceFacts = snapshotDenseArray(queryFacts, 'Compiler query-shape facts');
  const result: QueryShapeFact[] = [];
  for (let index = 0; index < sourceFacts.length; index += 1) {
    const fact = sourceFacts[index];
    if (!fact || typeof fact !== 'object') continue;
    const query = staticAnalysisOwnDataValue(fact, 'query', 'Compiler query-shape fact');
    const shape = staticAnalysisOwnDataValue(fact, 'shape', 'Compiler query-shape fact');
    const source = staticAnalysisOwnDataValue(fact, 'source', 'Compiler query-shape fact');
    const site = staticAnalysisOwnDataValue(fact, 'site', 'Compiler query-shape fact');
    if (
      typeof query !== 'string' ||
      (typeof site !== 'string' && typeof source !== 'string') ||
      !isCompilerQueryShape(shape) ||
      !isSubstantiveCompilerQueryShape(shape)
    ) {
      continue;
    }
    insertQueryShapeFact(result, {
      query,
      shape,
      source: typeof source === 'string' ? source : (site as string),
    });
  }
  return result;
}

function insertQueryShapeFact(result: QueryShapeFact[], fact: QueryShapeFact): void {
  let insertAt = result.length;
  while (insertAt > 0) {
    const previous = result[insertAt - 1]!;
    if (
      fact.query > previous.query ||
      (fact.query === previous.query && fact.source >= previous.source)
    ) {
      break;
    }
    staticAnalysisArraySet(result, insertAt, previous, 'Static-analysis query-shape facts');
    insertAt -= 1;
  }
  staticAnalysisArraySet(result, insertAt, fact, 'Static-analysis query-shape facts');
}

function mergeCompilerQueryShapeFact(
  staticFact: QueryShapeFact,
  outputFact: QueryShapeFact | undefined,
): QueryShapeFact {
  if (!outputFact) return staticFact;
  const shape = mergeCompilerQueryShapes(staticFact.shape, outputFact.shape);
  return { ...staticFact, shape, source: `${staticFact.source}; output ${outputFact.source}` };
}

function mergeCompilerQueryShapes(
  staticShape: QueryShapeFact['shape'],
  outputShape: QueryShapeFact['shape'],
): QueryShapeFact['shape'] {
  if (staticAnalysisArrayIsArray(staticShape) && staticAnalysisArrayIsArray(outputShape)) {
    const staticItem = staticAnalysisOwnDataValue(staticShape, 0, 'Static query shape array') as
      | QueryShapeFact['shape']
      | undefined;
    const outputItem = staticAnalysisOwnDataValue(outputShape, 0, 'Output query shape array') as
      | QueryShapeFact['shape']
      | undefined;
    return staticItem && outputItem
      ? [mergeCompilerQueryShapes(staticItem, outputItem)]
      : staticShape;
  }
  if (isPlainCompilerShapeObject(staticShape) && isPlainCompilerShapeObject(outputShape)) {
    const merged = staticAnalysisNullRecord<QueryShapeFact['shape']>();
    const outputKeys = staticAnalysisObjectKeys(outputShape);
    for (let index = 0; index < outputKeys.length; index += 1) {
      const key = outputKeys[index]!;
      const value = staticAnalysisOwnDataValue(outputShape, key, 'Output query shape');
      if (value !== undefined) {
        staticAnalysisDefineDataProperty(
          merged,
          key,
          value as QueryShapeFact['shape'],
          'Output query shape',
        );
      }
    }
    const staticKeys = staticAnalysisObjectKeys(staticShape);
    for (let index = 0; index < staticKeys.length; index += 1) {
      const key = staticKeys[index]!;
      const value = staticAnalysisOwnDataValue(staticShape, key, 'Static query shape');
      if (value === undefined) continue;
      const outputValue = staticAnalysisOwnDataValue(outputShape, key, 'Output query shape') as
        | QueryShapeFact['shape']
        | undefined;
      staticAnalysisDefineDataProperty(
        merged,
        key,
        outputValue
          ? mergeCompilerQueryShapes(value as QueryShapeFact['shape'], outputValue)
          : (value as QueryShapeFact['shape']),
        'Merged query shape',
      );
    }
    return merged;
  }
  return staticShape;
}

function outputSchemaQueryShapeFacts(
  files: readonly DataPlaneSourceFile[],
  options: { worker?: boolean } = {},
): readonly QueryShapeFact[] {
  if (options.worker !== false) {
    throw new Error('Internal error: async output-schema query-shape extraction is required.');
  }
  return outputSchemaQueryShapeFactsSerial(files);
}

async function outputSchemaQueryShapeFactsAsync(
  files: readonly DataPlaneSourceFile[],
): Promise<readonly QueryShapeFact[]> {
  if (!isMainThread || files.length < OUTPUT_SCHEMA_WORKER_MIN_FILES)
    return outputSchemaQueryShapeFactsSerial(files);
  const workerCount = staticAnalysisMathMin(
    files.length,
    OUTPUT_SCHEMA_WORKER_MAX_COUNT,
    staticAnalysisMathMax(1, availableParallelism() - 1),
  );
  if (workerCount <= 1) return outputSchemaQueryShapeFactsSerial(files);
  const chunks: DataPlaneSourceFile[][] = [];
  for (let index = 0; index < workerCount; index += 1) {
    staticAnalysisArrayAppend(chunks, [], 'Static-analysis worker chunks');
  }
  for (let index = 0; index < files.length; index += 1) {
    const chunk = chunks[index % workerCount]!;
    staticAnalysisArrayAppend(chunk, files[index]!, 'Static-analysis worker chunk');
  }
  const tasks: Promise<readonly QueryShapeFact[]>[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    if (chunk.length === 0) continue;
    staticAnalysisArrayAppend(
      tasks,
      outputSchemaQueryShapeFactsWithWorkerFallback(chunk, files),
      'Static-analysis worker tasks',
    );
  }
  const facts = await staticAnalysisPromiseAll(tasks);
  const result: QueryShapeFact[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const chunkFacts = facts[index]!;
    for (let factIndex = 0; factIndex < chunkFacts.length; factIndex += 1) {
      staticAnalysisArrayAppend(result, chunkFacts[factIndex]!, 'Static-analysis worker facts');
    }
  }
  return result;
}

async function outputSchemaQueryShapeFactsWithWorkerFallback(
  chunk: readonly DataPlaneSourceFile[],
  files: readonly DataPlaneSourceFile[],
): Promise<readonly QueryShapeFact[]> {
  try {
    return await outputSchemaQueryShapeFactsInWorker(chunk, files);
  } catch (error) {
    if (process.env.KOVO_TEST_REQUIRE_OUTPUT_SCHEMA_WORKER === '1') throw error;
    return outputSchemaQueryShapeFactsSerial(chunk, files);
  }
}

function outputSchemaQueryShapeFactsSerial(
  files: readonly DataPlaneSourceFile[],
  projectFiles: readonly DataPlaneSourceFile[] = files,
): readonly QueryShapeFact[] {
  return outputSchemaQueryShapeFactsFromProject(typeScript(), projectFiles, files);
}

function outputSchemaQueryShapeFactsInWorker(
  files: readonly DataPlaneSourceFile[],
  projectFiles: readonly DataPlaneSourceFile[],
): Promise<readonly QueryShapeFact[]> {
  return staticAnalysisCreatePromise((resolve, reject) => {
    let settled = false;
    const workerModule = staticAnalysisCreateUrl(import.meta.url);
    const worker = new Worker(fileURLToPath(staticAnalysisUrlHref(workerModule)), {
      workerData: {
        files,
        kind: OUTPUT_SCHEMA_QUERY_SHAPE_WORKER_KIND,
        projectFiles,
      } satisfies OutputSchemaQueryShapeWorkerData,
    });
    worker.once('message', (message: unknown) => {
      settled = true;
      if (isCompilerQueryShapeFactArray(message)) resolve(message);
      else reject(new Error('Kovo output-schema worker returned malformed query-shape facts.'));
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled)
        reject(new Error(`Kovo output-schema worker exited before returning facts, code ${code}.`));
    });
  });
}

function isCompilerQueryShape(shape: unknown): shape is QueryShapeFact['shape'] {
  if (
    shape === 'array' ||
    shape === 'boolean' ||
    shape === 'number' ||
    shape === 'object' ||
    shape === 'string'
  )
    return true;
  if (staticAnalysisArrayIsArray(shape)) {
    const length = staticAnalysisArrayLength(shape, 'Compiler query array shape');
    for (let index = 0; index < length; index += 1) {
      if (
        !isCompilerQueryShape(
          staticAnalysisOwnDataValue(shape, index, 'Compiler query array shape'),
        )
      ) {
        return false;
      }
    }
    return true;
  }
  if (!isRecord(shape)) return false;
  const kind = staticAnalysisOwnDataValue(shape, 'kind', 'Compiler query shape');
  if (kind !== undefined) {
    const wrappedShape = staticAnalysisOwnDataValue(shape, 'shape', 'Compiler query shape');
    if (
      kind === 'nullable' ||
      kind === 'optional' ||
      kind === 'secret' ||
      kind === 'volatile-time'
    ) {
      return isCompilerQueryShape(wrappedShape);
    }
    if (kind === 'table-row') {
      return (
        typeof staticAnalysisOwnDataValue(shape, 'table', 'Compiler query shape') === 'string' &&
        isCompilerQueryShape(wrappedShape)
      );
    }
    if (kind === 'revealed') return isCompilerQueryShape(wrappedShape);
    return false;
  }
  const keys = staticAnalysisObjectKeys(shape);
  for (let index = 0; index < keys.length; index += 1) {
    if (
      !isCompilerQueryShape(staticAnalysisOwnDataValue(shape, keys[index]!, 'Compiler query shape'))
    ) {
      return false;
    }
  }
  return true;
}

function isSubstantiveCompilerQueryShape(shape: QueryShapeFact['shape']): boolean {
  if (typeof shape === 'string') return shape !== 'object';
  if (staticAnalysisArrayIsArray(shape)) {
    const length = staticAnalysisArrayLength(shape, 'Compiler query array shape');
    for (let index = 0; index < length; index += 1) {
      const entry = staticAnalysisOwnDataValue(shape, index, 'Compiler query array shape');
      if (isCompilerQueryShape(entry) && isSubstantiveCompilerQueryShape(entry)) return true;
    }
    return false;
  }
  const kind = staticAnalysisOwnDataValue(shape, 'kind', 'Compiler query shape');
  if (kind !== undefined) {
    const nested = staticAnalysisOwnDataValue(shape, 'shape', 'Compiler query shape');
    return isCompilerQueryShape(nested) && isSubstantiveCompilerQueryShape(nested);
  }
  return staticAnalysisObjectKeys(shape).length > 0;
}

function isPlainCompilerShapeObject(
  shape: QueryShapeFact['shape'],
): shape is Record<string, QueryShapeFact['shape']> {
  return (
    isRecord(shape) &&
    staticAnalysisOwnDataValue(shape, 'kind', 'Compiler query shape') === undefined
  );
}

function isOutputSchemaQueryShapeWorkerData(
  value: unknown,
): value is OutputSchemaQueryShapeWorkerData {
  if (!isRecord(value)) return false;
  const kind = staticAnalysisOwnDataValue(value, 'kind', 'Output-schema worker data');
  const files = staticAnalysisOwnDataValue(value, 'files', 'Output-schema worker data');
  const projectFiles = staticAnalysisOwnDataValue(
    value,
    'projectFiles',
    'Output-schema worker data',
  );
  if (kind !== OUTPUT_SCHEMA_QUERY_SHAPE_WORKER_KIND || !staticAnalysisArrayIsArray(files)) {
    return false;
  }
  if (!sourceFileArrayIsValid(files)) return false;
  return (
    projectFiles === undefined ||
    (staticAnalysisArrayIsArray(projectFiles) && sourceFileArrayIsValid(projectFiles))
  );
}

function sourceFileArrayIsValid(value: unknown[]): boolean {
  const length = staticAnalysisArrayLength(value, 'Output-schema worker files');
  for (let index = 0; index < length; index += 1) {
    if (!isOutputSchemaWorkerSourceFile(staticAnalysisOwnDataValue(value, index, 'Worker files'))) {
      return false;
    }
  }
  return true;
}

function isOutputSchemaWorkerSourceFile(value: unknown): value is DataPlaneSourceFile {
  return (
    isRecord(value) &&
    typeof staticAnalysisOwnDataValue(value, 'fileName', 'Worker source file') === 'string' &&
    typeof staticAnalysisOwnDataValue(value, 'source', 'Worker source file') === 'string'
  );
}

function isCompilerQueryShapeFactArray(value: unknown): value is readonly QueryShapeFact[] {
  if (!staticAnalysisArrayIsArray(value)) return false;
  const length = staticAnalysisArrayLength(value, 'Worker query-shape facts');
  for (let index = 0; index < length; index += 1) {
    if (!isCompilerQueryShapeFact(staticAnalysisOwnDataValue(value, index, 'Worker query facts'))) {
      return false;
    }
  }
  return true;
}

function isCompilerQueryShapeFact(value: unknown): value is QueryShapeFact {
  return (
    isRecord(value) &&
    typeof staticAnalysisOwnDataValue(value, 'query', 'Worker query-shape fact') === 'string' &&
    typeof staticAnalysisOwnDataValue(value, 'source', 'Worker query-shape fact') === 'string' &&
    isCompilerQueryShape(staticAnalysisOwnDataValue(value, 'shape', 'Worker query-shape fact'))
  );
}

function isBuildStaticAnalysisSourceFile(file: DataPlaneSourceFile): boolean {
  const prefix = '// @kovojs-ui-copy\n';
  if (file.source.length < prefix.length) return true;
  for (let index = 0; index < prefix.length; index += 1) {
    if (file.source[index] !== prefix[index]) return true;
  }
  return false;
}

function buildStaticAnalysisSourceFiles(
  files: readonly DataPlaneSourceFile[],
): DataPlaneSourceFile[] {
  const result: DataPlaneSourceFile[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (isBuildStaticAnalysisSourceFile(file)) {
      staticAnalysisArrayAppend(result, file, 'Static-analysis build source files');
    }
  }
  return result;
}

function snapshotDataPlaneSourceFiles(
  files: readonly DataPlaneSourceFile[],
  label: string,
): DataPlaneSourceFile[] {
  if (!staticAnalysisArrayIsArray(files)) throw new TypeError(`${label} must be an array.`);
  const length = staticAnalysisArrayLength(files, label);
  const snapshot: DataPlaneSourceFile[] = [];
  for (let index = 0; index < length; index += 1) {
    const file = staticAnalysisOwnDataValue(files, index, label);
    if (!file || typeof file !== 'object') {
      throw new TypeError(`${label}[${index}] must be an own source-file record.`);
    }
    const fileName = staticAnalysisOwnDataValue(file, 'fileName', `${label}[${index}]`);
    const source = staticAnalysisOwnDataValue(file, 'source', `${label}[${index}]`);
    if (typeof fileName !== 'string' || typeof source !== 'string') {
      throw new TypeError(`${label}[${index}] must contain own string fileName/source values.`);
    }
    staticAnalysisArrayAppend(snapshot, { fileName, source }, 'Static-analysis source snapshot');
  }
  return snapshot;
}

function snapshotDenseArray<Value>(values: readonly Value[], label: string): Value[] {
  if (!staticAnalysisArrayIsArray(values)) throw new TypeError(`${label} must be an array.`);
  const length = staticAnalysisArrayLength(values, label);
  const snapshot: Value[] = [];
  for (let index = 0; index < length; index += 1) {
    const value = staticAnalysisOwnDataValue(values, index, label);
    if (value === undefined) throw new TypeError(`${label}[${index}] must be a dense own value.`);
    staticAnalysisArrayAppend(snapshot, value as Value, label);
  }
  return snapshot;
}

function sourceFilesUnder(dir: string, root: string): DataPlaneSourceFile[] {
  if (!existsSync(dir)) return [];
  const files: DataPlaneSourceFile[] = [];
  const entries = readdirSafe(dir);
  sortStrings(entries);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const path = join(dir, entry);
    if (isIgnoredDataPlaneDirectory(entry)) continue;
    const stat = statSafe(path);
    if (!stat) continue;
    if (staticAnalysisStatsIsDirectory(stat)) {
      const nested = sourceFilesUnder(path, root);
      for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex += 1) {
        staticAnalysisArrayAppend(files, nested[nestedIndex]!, 'Static-analysis directory files');
      }
      continue;
    }
    if (!isDataPlaneAppSourcePath(entry, { includeDeclarations: false })) continue;
    staticAnalysisArrayAppend(
      files,
      {
        fileName: slashPath(relative(root, path)),
        source: readFileSync(path, 'utf8'),
      },
      'Static-analysis directory files',
    );
  }
  return files;
}

function dataPlaneSourceFilePaths(directory: string): string[] {
  const paths: string[] = [];
  const entries = readdirSafe(directory);
  sortStrings(entries);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const path = resolve(directory, entry);
    const stat = statSafe(path);
    if (!stat) continue;
    if (staticAnalysisStatsIsDirectory(stat)) {
      if (isIgnoredDataPlaneDirectory(entry)) continue;
      const nested = dataPlaneSourceFilePaths(path);
      for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex += 1) {
        staticAnalysisArrayAppend(paths, nested[nestedIndex]!, 'Static-analysis source paths');
      }
      continue;
    }
    if (isDataPlaneAppSourcePath(entry, { includeDeclarations: true })) {
      staticAnalysisArrayAppend(paths, path, 'Static-analysis source paths');
    }
  }
  return paths;
}

function isDataPlaneAppSourcePath(
  filePath: string,
  options: { includeDeclarations: boolean },
): boolean {
  const normalized = staticAnalysisStringToLowerCase(slashPath(stripPathSuffix(filePath)));
  const baseName = staticAnalysisStringSlice(
    normalized,
    staticAnalysisStringLastIndexOf(normalized, '/') + 1,
  );
  if (staticAnalysisStringIncludes(normalized, '/generated/')) return false;
  if (baseName === 'generated') return false;
  if (staticAnalysisStringEndsWith(baseName, '.d.ts') && !options.includeDeclarations) return false;
  if (!staticAnalysisRegExpTest(/\.(?:[cm]?[jt]sx?)$/u, baseName)) return false;
  if (staticAnalysisRegExpTest(/\.(?:test|spec)\.[cm]?[jt]sx?$/u, baseName)) return false;
  if (staticAnalysisRegExpTest(/(?:^|[.-])test-helpers\.[cm]?[jt]sx?$/u, baseName)) return false;
  if (staticAnalysisRegExpTest(/\.test-support\.[cm]?[jt]sx?$/u, baseName)) return false;
  if (staticAnalysisRegExpTest(/(?:^|[.-])setup\.[cm]?[jt]sx?$/u, baseName)) return false;
  return true;
}

function isIgnoredDataPlaneDirectory(entry: string): boolean {
  return entry === 'node_modules' || entry === 'dist' || entry === '.kovo' || entry === 'generated';
}

function sqlSafetyDiagnosticFact(value: unknown): CoreGraph.SqlSafetyDiagnosticFact[] {
  if (!isRecord(value)) {
    throw new TypeError('Static SQL-safety diagnostic must be an own-data record.');
  }
  const code = staticAnalysisOwnDataValue(value, 'code', 'SQL-safety diagnostic');
  const message = staticAnalysisOwnDataValue(value, 'message', 'SQL-safety diagnostic');
  const severity = staticAnalysisOwnDataValue(value, 'severity', 'SQL-safety diagnostic');
  const site = staticAnalysisOwnDataValue(value, 'site', 'SQL-safety diagnostic');
  const normalizedSeverity = severity ?? 'error';
  if (
    isDiagnosticCode(code) &&
    typeof message === 'string' &&
    typeof site === 'string' &&
    (normalizedSeverity === 'error' ||
      normalizedSeverity === 'warn' ||
      normalizedSeverity === 'lint' ||
      normalizedSeverity === 'notice')
  ) {
    return [
      {
        code,
        message,
        severity: normalizedSeverity,
        site,
      },
    ];
  }
  throw new TypeError('Static SQL-safety diagnostic has malformed authority fields.');
}

function projectToctouFacts(values: readonly ToctouFactLike[]): CoreGraph.ToctouFact[] {
  const source = snapshotDenseArray(values, 'Static TOCTOU facts');
  const facts: CoreGraph.ToctouFact[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const fact = source[index]!;
    const column = staticAnalysisOwnDataValue(fact, 'column', 'TOCTOU fact');
    const name = staticAnalysisOwnDataValue(fact, 'name', 'TOCTOU fact');
    const site = staticAnalysisOwnDataValue(fact, 'site', 'TOCTOU fact');
    const table = staticAnalysisOwnDataValue(fact, 'table', 'TOCTOU fact');
    if (
      typeof column !== 'string' ||
      (name !== undefined && typeof name !== 'string') ||
      typeof site !== 'string' ||
      typeof table !== 'string'
    ) {
      throw new TypeError('Static TOCTOU fact must use own string authority fields.');
    }
    staticAnalysisArrayAppend(
      facts,
      {
        column,
        ...(name === undefined ? {} : { name }),
        site,
        table,
      },
      'Static-analysis TOCTOU facts',
    );
  }
  return facts;
}

function parseDiagnosticSite(site: string): { fileName: string; line: number } {
  const index = staticAnalysisStringLastIndexOf(site, ':');
  if (index < 0) return { fileName: site, line: 1 };
  const line = staticAnalysisNumberParseInt(staticAnalysisStringSlice(site, index + 1));
  return {
    fileName: staticAnalysisStringSlice(site, 0, index),
    line: staticAnalysisNumberIsFinite(line) ? line : 1,
  };
}

function portableCacheFilePath(fileName: string): string {
  const relativePath = slashPath(relative(process.cwd(), fileName));
  return relativePath === '' ? fileName : relativePath;
}

function nearestPackageRoot(startDir: string): string | undefined {
  for (let current = startDir; ; current = dirname(current)) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
  }
}

function sourceFilePathsUnder(directory: string): string[] {
  const paths: string[] = [];
  const entries = readdirSafe(directory);
  sortStrings(entries);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const path = resolve(directory, entry);
    const stat = statSafe(path);
    if (!stat) continue;
    if (staticAnalysisStatsIsDirectory(stat)) {
      const nested = sourceFilePathsUnder(path);
      for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex += 1) {
        staticAnalysisArrayAppend(paths, nested[nestedIndex]!, 'Static-analysis project paths');
      }
    } else if (staticAnalysisRegExpTest(/\.[cm]?[jt]sx?$/u, entry)) {
      staticAnalysisArrayAppend(paths, path, 'Static-analysis project paths');
    }
  }
  return paths;
}

function sortStrings(values: string[]): void {
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]!;
    let insertAt = index;
    while (insertAt > 0 && value < values[insertAt - 1]!) {
      staticAnalysisArraySet(
        values,
        insertAt,
        values[insertAt - 1]!,
        'Static-analysis sorted strings',
      );
      insertAt -= 1;
    }
    staticAnalysisArraySet(values, insertAt, value, 'Static-analysis sorted strings');
  }
}

function readFileIfExists(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function statSafe(path: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

async function importRuntimeRegistryWireModule(): Promise<
  typeof import('./runtime-registry-wire.js')
> {
  try {
    return await import('./runtime-registry-wire.js');
  } catch (error) {
    const sourceUrl = staticAnalysisCreateUrl('./runtime-registry-wire.ts', import.meta.url);
    const sourceHref = staticAnalysisUrlHref(sourceUrl);
    if (existsSync(fileURLToPath(sourceHref))) return await import(sourceHref);
    throw error;
  }
}

function registerCompilerSourceResolutionHooks(): void {
  if (compilerSourceResolutionHooksRegistered) return;
  compilerSourceResolutionHooksRegistered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        staticAnalysisStringStartsWith(specifier, '.') &&
        staticAnalysisStringEndsWith(specifier, '.js') &&
        context.parentURL
      ) {
        const tsUrl = staticAnalysisCreateUrl(
          `${staticAnalysisStringSlice(specifier, 0, specifier.length - 3)}.ts`,
          context.parentURL,
        );
        const tsHref = staticAnalysisUrlHref(tsUrl);
        if (existsSync(fileURLToPath(tsHref))) return nextResolve(tsHref, context);
      }
      return nextResolve(specifier, context);
    },
  });
}

function typeScript(): TypeScriptModule {
  loadedTypeScript ??= createRequire(import.meta.url)('typescript') as TypeScriptModule;
  return loadedTypeScript;
}

function slashPath(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    result += value[index] === '\\' ? '/' : value[index];
  }
  return result;
}

function stripPathSuffix(value: string): string {
  const query = staticAnalysisStringIndexOf(value, '?');
  const fragment = staticAnalysisStringIndexOf(value, '#');
  const end = query < 0 ? fragment : fragment < 0 ? query : staticAnalysisMathMin(query, fragment);
  return end < 0 ? value : staticAnalysisStringSlice(value, 0, end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !staticAnalysisArrayIsArray(value);
}
