import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { registerHooks } from 'node:module';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

import type { DiagnosticCode } from '@kovojs/core';
import { diagnosticDefinitions, isDiagnosticCode } from '@kovojs/core/internal/diagnostics';
import {
  outputSchemaQueryShapeFactsFromProject,
  type QueryShape,
  type QueryShapeFact,
} from '@kovojs/core/internal/query-shape-source';
import type * as CoreGraph from '@kovojs/core/internal/graph';
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

interface RuntimeQueryShapeFactLike {
  query: string;
  shape: unknown;
  source?: string;
  site?: string;
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
  scopeAudits?: readonly CoreGraph.ScopeAuditFact[];
  sqlSafetyDiagnostics: readonly TouchGraphDiagnosticLike[];
  toctouFacts: readonly ToctouFactLike[];
  touchGraph: unknown;
}

const KOVO_BUILD_QUERY_SHAPE_FACTS_GLOBAL = Symbol.for('kovo.build.queryShapeFacts');
const DRIZZLE_STATIC_ANALYZER_MODULE = '@kovojs/drizzle/internal/static';
const STATIC_DATA_PLANE_FACTS_CACHE_VERSION = '2026-07-02.authz-census.v1';
const OUTPUT_SCHEMA_QUERY_SHAPE_WORKER_KIND = 'kovo.output-schema-query-shape';
const OUTPUT_SCHEMA_WORKER_MIN_FILES = 8;
const OUTPUT_SCHEMA_WORKER_MAX_COUNT = 4;

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
  return dataPlaneSourceFilePaths(sourceDir)
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => ({
      fileName: slashPath(relative(root, filePath)),
      source: readFileSync(filePath, 'utf8'),
    }));
}

/** @internal Whether a changed file is an app data-plane source file the Vite gate should re-run. */
export function isDataPlaneSourceFile(file: string, sourceDir: string): boolean {
  const normalized = slashPath(file.split(/[?#]/, 1)[0] ?? file);
  const normalizedSourceDir = slashPath(sourceDir);
  if (normalized !== normalizedSourceDir && !normalized.startsWith(`${normalizedSourceDir}/`)) {
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
  const key = dataPlaneAnalysisCacheKey(files);
  const cached = dataPlaneAnalysisCache.get(key);
  if (cached) return cached;
  const promise = createDataPlaneAnalysis(options.root, key, files);
  dataPlaneAnalysisCache.set(key, promise);
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
  const buildSeed = seededBuildCompilerQueryShapeFacts();
  if (buildSeed !== undefined) return buildSeed;
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
  const { runtimeRegistryMutationTouchesFromGraph, runtimeRegistryQueryReadsFromFacts } =
    await importRuntimeRegistryWireModule();

  return {
    mutationTouches: runtimeRegistryMutationTouchesFromGraph(
      analysis.staticFacts.touchGraph === undefined
        ? {}
        : { touchGraph: analysis.staticFacts.touchGraph as CoreGraph.TouchGraph },
    ),
    queryReads: runtimeRegistryQueryReadsFromFacts(
      analysis.staticFacts.queries as readonly { query?: unknown; reads?: readonly unknown[] }[],
    ),
  };
}

/** @internal Run CLI build/check static data-plane extraction with shared resolver/cache/facts. */
export async function staticDataPlaneBuildFacts(
  files: readonly DataPlaneSourceFile[],
  options: StaticDataPlaneBuildFactsOptions,
): Promise<StaticDataPlaneBuildFacts> {
  const analysisFiles = files.filter(isBuildStaticAnalysisSourceFile);
  if (analysisFiles.length === 0) return { ...emptyStaticDataPlaneBuildFacts(), touchGraph: {} };

  const rawFacts = await cachedStaticBuildAnalysisFacts(files, options);

  const queryReadFacts = rawFacts.queries as readonly QueryReadFactLike[];
  const result: StaticDataPlaneBuildFacts = {
    massAssignmentFacts: rawFacts.massAssignmentFacts ?? [],
    ownerDomains: rawFacts.ownerDomains ?? [],
    queries: queryReadFacts,
    queryShapeFacts: queryShapeFactsFromQueryReadFacts(queryReadFacts),
    queryWriteReachability: rawFacts.queryWriteReachability ?? [],
    scopeAudits: rawFacts.scopeAudits ?? [],
    sqlSafetyDiagnostics: rawFacts.sqlSafetyDiagnostics.flatMap(sqlSafetyDiagnosticFact),
    toctouFacts: rawFacts.toctouFacts as readonly CoreGraph.ToctouFact[],
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

/** @internal Explicit bridge for app-authored Vite configs loaded during CLI build/export. */
export async function withKovoBuildQueryShapeFacts<T>(
  facts: readonly QueryShapeFact[],
  fn: () => Promise<T>,
): Promise<T> {
  const globalFacts = globalThis as Record<symbol, unknown>;
  const previous = globalFacts[KOVO_BUILD_QUERY_SHAPE_FACTS_GLOBAL];
  globalFacts[KOVO_BUILD_QUERY_SHAPE_FACTS_GLOBAL] = facts;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete globalFacts[KOVO_BUILD_QUERY_SHAPE_FACTS_GLOBAL];
    else globalFacts[KOVO_BUILD_QUERY_SHAPE_FACTS_GLOBAL] = previous;
  }
}

function seededBuildCompilerQueryShapeFacts(): readonly QueryShapeFact[] | undefined {
  const value = (globalThis as Record<symbol, unknown>)[KOVO_BUILD_QUERY_SHAPE_FACTS_GLOBAL];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? compilerQueryShapeFacts(value) : [];
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
  const outputFactsByQuery = new Map(secondary.map((fact) => [fact.query, fact]));
  const drizzleQueries = new Set(primary.map((fact) => fact.query));
  const mergedDrizzleFacts = primary.map((fact) =>
    mergeCompilerQueryShapeFact(fact, outputFactsByQuery.get(fact.query)),
  );
  const outputOnlyFacts = secondary.filter((fact) => !drizzleQueries.has(fact.query));
  return [...mergedDrizzleFacts, ...outputOnlyFacts].sort(
    (left, right) =>
      left.query.localeCompare(right.query) || left.source.localeCompare(right.source),
  );
}

function dataPlaneErrorDiagnosticsFromStaticFacts(
  staticFacts: StaticBuildAnalysisFactsLike,
  files: readonly DataPlaneSourceFile[],
): DataPlaneDiagnostic[] {
  if (files.length === 0) return [];
  const raw: TouchGraphDiagnosticLike[] = [];
  raw.push(...staticFacts.sqlSafetyDiagnostics);
  for (const fact of staticFacts.toctouFacts) {
    raw.push({
      code: 'KV429',
      message: `${diagnosticDefinitions.KV429.message} ${fact.name ?? '<anonymous>'} writes ${fact.table}.${fact.column} without a compare-and-set/version guard.`,
      severity: 'error',
      site: fact.site,
    });
  }
  return raw
    .filter((diagnostic): diagnostic is TouchGraphDiagnosticLike & { code: DiagnosticCode } => {
      return isDiagnosticCode(diagnostic.code) && (diagnostic.severity ?? 'error') === 'error';
    })
    .map((diagnostic) => {
      const { fileName, line } = parseDiagnosticSite(diagnostic.site);
      return {
        code: diagnostic.code,
        fileName,
        line,
        message: diagnostic.message,
        site: diagnostic.site,
      };
    })
    .sort((left, right) => left.site.localeCompare(right.site));
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
  cacheKey: string,
  files: readonly DataPlaneSourceFile[],
): Promise<DataPlaneAnalysis> {
  if (files.length === 0) {
    return { files, outputQueryShapeFacts: [], staticFacts: emptyStaticBuildAnalysisFactsLike() };
  }
  const cached = readCachedDataPlaneStaticFacts(root, `vite-${cacheKey}`);
  if (cached) {
    return {
      files,
      outputQueryShapeFacts: await outputSchemaQueryShapeFactsAsync(files),
      staticFacts: cached,
    };
  }
  const analysisFiles = files.filter(isBuildStaticAnalysisSourceFile);
  const staticFacts =
    analysisFiles.length === 0
      ? emptyStaticBuildAnalysisFactsLike()
      : await runStaticBuildAnalysisFacts(files);
  writeCachedDataPlaneStaticFacts(root, `vite-${cacheKey}`, staticFacts);
  return {
    files,
    outputQueryShapeFacts: await outputSchemaQueryShapeFactsAsync(files),
    staticFacts,
  };
}

async function cachedStaticBuildAnalysisFacts(
  files: readonly DataPlaneSourceFile[],
  options: StaticDataPlaneBuildFactsOptions,
): Promise<StaticBuildAnalysisFactsLike> {
  const cacheRoot = options.cacheRoot ?? process.cwd();
  const cacheKey = dataPlaneAnalysisCacheKey(files);
  if (options.cache) {
    const cached = readCachedDataPlaneStaticFacts(cacheRoot, cacheKey);
    if (cached) return cached;
  }
  const facts = await runStaticBuildAnalysisFacts(files);
  if (options.cache) writeCachedDataPlaneStaticFacts(cacheRoot, cacheKey, facts);
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
    const facts = drizzle.extractStaticBuildAnalysisFactsFromProject({ files });
    if (!isStaticBuildAnalysisFactsLike(facts)) {
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
    const workspaceSource = new URL('../../../drizzle/src/static.ts', import.meta.url);
    if (existsSync(workspaceSource)) {
      return (await import(workspaceSource.href)) as unknown as KovoDrizzleStaticModule;
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
  const sample = files
    .map((file) => file.fileName)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 3)
    .join(', ');
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  return new DataPlaneStaticAnalysisError(
    [
      'KV245 Kovo data-plane static analysis failed closed (SPEC.md §10 / §11.4).',
      'The aggregate @kovojs/drizzle analyzer ABI is required; Kovo will not synthesize old analyzer entrypoints or return empty facts after import, parse, or ts-morph failures.',
      sample ? `Relevant source sample: ${sample}.` : 'Relevant source sample: <none>.',
      `Cause: ${causeMessage}`,
    ].join(' '),
    cause,
  );
}

function dataPlaneAnalysisCacheKey(files: readonly DataPlaneSourceFile[]): string {
  const hash = createHash('sha256');
  hash.update(`${STATIC_DATA_PLANE_FACTS_CACHE_VERSION}\0`);
  hash.update(staticDataPlaneAnalyzerFingerprint());
  const entries = files
    .map((file) => ({ path: portableCacheFilePath(file.fileName), source: file.source }))
    .sort((left, right) => left.path.localeCompare(right.path));
  for (const entry of entries) {
    hash.update('\0file\0');
    hash.update(entry.path);
    hash.update('\0');
    hash.update(createHash('sha256').update(entry.source).digest('hex'));
  }
  return hash.digest('hex');
}

function staticDataPlaneAnalyzerFingerprint(): string {
  const resolved = resolveDataPlaneStaticAnalyzerPath();
  const packageRoot = resolved ? nearestPackageRoot(dirname(resolved)) : undefined;
  const hash = createHash('sha256');
  hash.update(resolved ? 'resolved' : 'unresolved');
  if (packageRoot) {
    hash.update('\0pkg\0');
    hash.update(readFileIfExists(join(packageRoot, 'package.json')));
    const srcDir = join(packageRoot, 'src');
    if (existsSync(srcDir)) {
      for (const file of sourceFilePathsUnder(srcDir)) {
        hash.update('\0src\0');
        hash.update(relative(packageRoot, file).split(/[\\/]/).join('/'));
        hash.update('\0');
        hash.update(createHash('sha256').update(readFileIfExists(file)).digest('hex'));
      }
    }
  }
  return hash.digest('hex');
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
  key: string,
): StaticBuildAnalysisFactsLike | undefined {
  try {
    const parsed = JSON.parse(readFileSync(dataPlaneStaticFactsCachePath(root, key), 'utf8'));
    return isStaticBuildAnalysisFactsLike(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedDataPlaneStaticFacts(
  root: string,
  key: string,
  facts: StaticBuildAnalysisFactsLike,
): void {
  try {
    const cachePath = dataPlaneStaticFactsCachePath(root, key);
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify(facts)}\n`, 'utf8');
  } catch {
    // Cache writes are performance-only; the analyzer already ran for this source snapshot.
  }
}

function dataPlaneStaticFactsCachePath(root: string, key: string): string {
  return join(root, '.kovo/cache/static-build-analysis', `${key}.json`);
}

function isStaticBuildAnalysisFactsLike(value: unknown): value is StaticBuildAnalysisFactsLike {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.queries) &&
    Array.isArray(value.sqlSafetyDiagnostics) &&
    Array.isArray(value.toctouFacts) &&
    isRecord(value.touchGraph)
  );
}

function queryShapeFactsFromQueryReadFacts(facts: readonly QueryReadFactLike[]): QueryShapeFact[] {
  return facts.flatMap((fact) => {
    if (typeof fact.query !== 'string' || fact.shape === undefined) return [];
    return [{ query: fact.query, shape: fact.shape, source: fact.site ?? fact.query }];
  });
}

function compilerQueryShapeFacts(queryFacts: readonly unknown[]): readonly QueryShapeFact[] {
  return queryFacts
    .filter(
      (
        fact,
      ): fact is RuntimeQueryShapeFactLike & { shape: QueryShapeFact['shape'] } & (
          | { site: string }
          | { source: string }
        ) => {
        const candidate = fact as RuntimeQueryShapeFactLike;
        return (
          typeof candidate.query === 'string' &&
          (typeof candidate.site === 'string' || typeof candidate.source === 'string') &&
          isCompilerQueryShape(candidate.shape) &&
          isSubstantiveCompilerQueryShape(candidate.shape)
        );
      },
    )
    .map((fact) => ({
      query: fact.query,
      shape: fact.shape,
      source: fact.source ?? fact.site ?? '<unknown>',
    }))
    .sort(
      (left, right) =>
        left.query.localeCompare(right.query) || left.source.localeCompare(right.source),
    );
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
  if (Array.isArray(staticShape) && Array.isArray(outputShape)) {
    const staticItem = staticShape[0];
    const outputItem = outputShape[0];
    return staticItem && outputItem
      ? [mergeCompilerQueryShapes(staticItem, outputItem)]
      : staticShape;
  }
  if (isPlainCompilerShapeObject(staticShape) && isPlainCompilerShapeObject(outputShape)) {
    const merged: Record<string, QueryShapeFact['shape']> = { ...outputShape };
    for (const [key, value] of Object.entries(staticShape)) {
      const outputValue = outputShape[key];
      merged[key] = outputValue ? mergeCompilerQueryShapes(value, outputValue) : value;
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
  const workerCount = Math.min(
    files.length,
    OUTPUT_SCHEMA_WORKER_MAX_COUNT,
    Math.max(1, availableParallelism() - 1),
  );
  if (workerCount <= 1) return outputSchemaQueryShapeFactsSerial(files);
  const chunks = Array.from({ length: workerCount }, () => [] as DataPlaneSourceFile[]);
  for (const [index, file] of files.entries()) chunks[index % workerCount]!.push(file);
  const facts = await Promise.all(
    chunks
      .filter((chunk) => chunk.length > 0)
      .map(async (chunk) => {
        try {
          return await outputSchemaQueryShapeFactsInWorker(chunk, files);
        } catch (error) {
          if (process.env.KOVO_TEST_REQUIRE_OUTPUT_SCHEMA_WORKER === '1') throw error;
          return outputSchemaQueryShapeFactsSerial(chunk, files);
        }
      }),
  );
  return facts.flat();
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
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(new URL(import.meta.url), {
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
  if (Array.isArray(shape)) return shape.every(isCompilerQueryShape);
  if (!isRecord(shape)) return false;
  if ('kind' in shape) {
    const wrapper = shape as { kind?: unknown; shape?: unknown; table?: unknown };
    if (
      wrapper.kind === 'nullable' ||
      wrapper.kind === 'optional' ||
      wrapper.kind === 'secret' ||
      wrapper.kind === 'volatile-time'
    ) {
      return isCompilerQueryShape(wrapper.shape);
    }
    if (wrapper.kind === 'table-row')
      return typeof wrapper.table === 'string' && isCompilerQueryShape(wrapper.shape);
    if (wrapper.kind === 'revealed') return isCompilerQueryShape(wrapper.shape);
    return false;
  }
  return Object.values(shape).every(isCompilerQueryShape);
}

function isSubstantiveCompilerQueryShape(shape: QueryShapeFact['shape']): boolean {
  if (typeof shape === 'string') return shape !== 'object';
  if (Array.isArray(shape)) return shape.some(isSubstantiveCompilerQueryShape);
  if ('kind' in shape) return isSubstantiveCompilerQueryShape(shape.shape);
  return Object.keys(shape).length > 0;
}

function isPlainCompilerShapeObject(
  shape: QueryShapeFact['shape'],
): shape is Record<string, QueryShapeFact['shape']> {
  return isRecord(shape) && !('kind' in shape);
}

function isOutputSchemaQueryShapeWorkerData(
  value: unknown,
): value is OutputSchemaQueryShapeWorkerData {
  if (!isRecord(value)) return false;
  return (
    value.kind === OUTPUT_SCHEMA_QUERY_SHAPE_WORKER_KIND &&
    Array.isArray(value.files) &&
    value.files.every(isOutputSchemaWorkerSourceFile) &&
    (value.projectFiles === undefined ||
      (Array.isArray(value.projectFiles) &&
        value.projectFiles.every(isOutputSchemaWorkerSourceFile)))
  );
}

function isOutputSchemaWorkerSourceFile(value: unknown): value is DataPlaneSourceFile {
  return isRecord(value) && typeof value.fileName === 'string' && typeof value.source === 'string';
}

function isCompilerQueryShapeFactArray(value: unknown): value is readonly QueryShapeFact[] {
  return Array.isArray(value) && value.every(isCompilerQueryShapeFact);
}

function isCompilerQueryShapeFact(value: unknown): value is QueryShapeFact {
  return (
    isRecord(value) &&
    typeof value.query === 'string' &&
    typeof value.source === 'string' &&
    isCompilerQueryShape(value.shape)
  );
}

function isBuildStaticAnalysisSourceFile(file: DataPlaneSourceFile): boolean {
  return !file.source.startsWith('// @kovojs-ui-copy\n');
}

function sourceFilesUnder(dir: string, root: string): DataPlaneSourceFile[] {
  if (!existsSync(dir)) return [];
  return readdirSafe(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (isIgnoredDataPlaneDirectory(entry)) return [];
    const stat = statSafe(path);
    if (!stat) return [];
    if (stat.isDirectory()) return sourceFilesUnder(path, root);
    if (!isDataPlaneAppSourcePath(entry, { includeDeclarations: false })) return [];
    return [
      {
        fileName: relative(root, path).split(/[\\/]/).join('/'),
        source: readFileSync(path, 'utf8'),
      },
    ];
  });
}

function dataPlaneSourceFilePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (isIgnoredDataPlaneDirectory(entry.name)) return [];
      return dataPlaneSourceFilePaths(path);
    }
    if (!isDataPlaneAppSourcePath(entry.name, { includeDeclarations: true })) return [];
    return [path];
  });
}

function isDataPlaneAppSourcePath(
  filePath: string,
  options: { includeDeclarations: boolean },
): boolean {
  const normalized = slashPath(filePath.split(/[?#]/, 1)[0] ?? filePath).toLowerCase();
  const baseName = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (normalized.includes('/generated/')) return false;
  if (baseName === 'generated') return false;
  if (baseName.endsWith('.d.ts') && !options.includeDeclarations) return false;
  if (!/\.(?:[cm]?[jt]sx?)$/.test(baseName)) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(baseName)) return false;
  if (/(?:^|[.-])test-helpers\.[cm]?[jt]sx?$/.test(baseName)) return false;
  if (/\.test-support\.[cm]?[jt]sx?$/.test(baseName)) return false;
  if (/(?:^|[.-])setup\.[cm]?[jt]sx?$/.test(baseName)) return false;
  return true;
}

function isIgnoredDataPlaneDirectory(entry: string): boolean {
  return entry === 'node_modules' || entry === 'dist' || entry === '.kovo' || entry === 'generated';
}

function sqlSafetyDiagnosticFact(value: unknown): CoreGraph.SqlSafetyDiagnosticFact[] {
  if (!isRecord(value)) return [];
  if (
    isDiagnosticCode(value.code) &&
    typeof value.message === 'string' &&
    typeof value.site === 'string' &&
    (value.severity === undefined ||
      value.severity === 'error' ||
      value.severity === 'warning' ||
      value.severity === 'notice')
  ) {
    return [
      {
        code: value.code,
        message: value.message,
        severity: (value.severity ?? 'error') as CoreGraph.SqlSafetyDiagnosticFact['severity'],
        site: value.site,
      },
    ];
  }
  return [];
}

function parseDiagnosticSite(site: string): { fileName: string; line: number } {
  const index = site.lastIndexOf(':');
  if (index < 0) return { fileName: site, line: 1 };
  const line = Number.parseInt(site.slice(index + 1), 10);
  return { fileName: site.slice(0, index), line: Number.isFinite(line) ? line : 1 };
}

function portableCacheFilePath(fileName: string): string {
  const relativePath = relative(process.cwd(), fileName).split(/[\\/]/).join('/');
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
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFilePathsUnder(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
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
    const sourceUrl = new URL('./runtime-registry-wire.ts', import.meta.url);
    if (existsSync(sourceUrl)) return await import(sourceUrl.href);
    throw error;
  }
}

function registerCompilerSourceResolutionHooks(): void {
  if (compilerSourceResolutionHooksRegistered) return;
  compilerSourceResolutionHooksRegistered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
        const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
        if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
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
  return value.replaceAll('\\', '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
