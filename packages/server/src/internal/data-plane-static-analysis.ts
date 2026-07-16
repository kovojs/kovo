import { existsSync as builtinExistsSync } from 'node:fs';
import { extractStaticBuildAnalysisFactsFromProject } from '@kovojs/drizzle/internal/static';
import * as TypeScript from 'typescript';
import {
  dirname as builtinDirname,
  relative as builtinRelative,
  resolve as builtinResolve,
} from 'node:path';

import type { DiagnosticCode } from '@kovojs/core';
import {
  compilerSourceModuleSpecifiers,
  createCompilerSourceFileSystem,
  type CompilerSourceFileSystem,
} from '@kovojs/compiler/internal/source-filesystem';
import { diagnosticDefinitions, isDiagnosticCode } from '@kovojs/core/internal/diagnostics';
import {
  outputSchemaQueryShapeFactsFromProject,
  type QueryShape,
  type QueryShapeFact,
} from '@kovojs/core/internal/query-shape-source';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import { currentKovoBuildContext } from './build-context.ts';
import {
  runtimeRegistryMutationTouchesFromGraph,
  runtimeRegistryQueryReadsFromFacts,
  runtimeRegistryTableSecurityFromFacts,
} from './runtime-registry-wire.ts';
import {
  staticAnalysisArrayAppend,
  staticAnalysisArrayIsArray,
  staticAnalysisArrayLength,
  staticAnalysisArraySet,
  staticAnalysisCanonicalJson,
  staticAnalysisDefineDataProperty,
  staticAnalysisJsonParse,
  staticAnalysisMapGet,
  staticAnalysisMapSet,
  staticAnalysisMathMin,
  staticAnalysisNumberIsFinite,
  staticAnalysisNumberParseInt,
  staticAnalysisNullRecord,
  staticAnalysisObjectKeys,
  staticAnalysisOwnDataValue,
  staticAnalysisRegExpTest,
  staticAnalysisStringEndsWith,
  staticAnalysisStringIndexOf,
  staticAnalysisStringLastIndexOf,
  staticAnalysisStringSlice,
  staticAnalysisStringStartsWith,
  staticAnalysisStringToLowerCase,
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

const STATIC_DATA_PLANE_FACTS_CACHE_VERSION = '2026-07-02.authz-census.v1';
const existsSync = builtinExistsSync;
const dirname = builtinDirname;
const relative = builtinRelative;
const resolve = builtinResolve;
type TypeScriptModule = typeof import('typescript');

const loadedTypeScript: TypeScriptModule = TypeScript;
let dataPlaneAnalysisCacheEntry:
  | {
      identity: string;
      resultPreimage: Promise<string>;
    }
  | undefined;
let staticBuildAnalysisCacheEntry:
  | {
      identity: string;
      resultPreimage: Promise<string>;
    }
  | undefined;

class DataPlaneStaticAnalysisError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'DataPlaneStaticAnalysisError';
    this.cause = cause;
  }
}

/** @internal Build the analyzer SourceFileInput[] for a Vite app source tree. */
export function dataPlaneSourceFiles(sourceDir: string, root: string): DataPlaneSourceFile[] {
  if (!existsSync(sourceDir)) return [];
  return sourceFilesWithinBoundary(sourceDir, root, root, true);
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
export function buildCheckSourceFiles(
  appModulePath: string,
  sourceBoundaryRoot: string = dirname(appModulePath),
): DataPlaneSourceFile[] {
  const sourceDir = dirname(appModulePath);
  if (!existsSync(sourceBoundaryRoot)) return [];
  return sourceFilesWithinBoundary(sourceDir, sourceDir, sourceBoundaryRoot, false);
}

/** @internal Snapshot one authored entry and its exact relative-import closure. */
export function buildCheckSourceGraphFiles(
  entryModulePath: string,
  sourceBoundaryRoot: string = dirname(entryModulePath),
): DataPlaneSourceFile[] {
  const entryPath = resolve(entryModulePath);
  const boundaryRoot = resolve(sourceBoundaryRoot);
  if (!existsSync(boundaryRoot)) return [];
  if (!pathIsWithinDataPlaneBoundary(boundaryRoot, entryPath)) {
    throw new TypeError(`Kovo source entry escapes the project root: ${entryModulePath}`);
  }
  const fileSystem = createCompilerSourceFileSystem(boundaryRoot);
  if (fileSystem === null) {
    throw new TypeError(`Kovo source root is unavailable or unstable: ${boundaryRoot}`);
  }
  const kind = fileSystem.kind(entryPath);
  if (kind !== 'file') {
    throw new TypeError(
      kind === 'other'
        ? `Kovo source entry resolves through a symbolic link or special entry: ${entryPath}`
        : `Kovo source entry is unavailable: ${entryPath}`,
    );
  }
  if (!isDataPlaneAppSourcePath(entryPath, { includeDeclarations: false })) {
    throw new TypeError(`Kovo source entry is not a supported source module: ${entryPath}`);
  }
  const source = fileSystem.readFile(entryPath);
  if (source === null) {
    throw new TypeError(`Kovo source entry is unavailable or unstable: ${entryPath}`);
  }
  const fileNameRoot = dirname(entryPath);
  const files: DataPlaneSourceFile[] = [
    { fileName: slashPath(relative(fileNameRoot, entryPath)), source },
  ];
  collectImportedSourceFilesWithinBoundary(fileNameRoot, boundaryRoot, fileSystem, false, files);
  return files;
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
  let entry = dataPlaneAnalysisCacheEntry;
  if (entry?.identity !== identity) {
    entry = {
      identity,
      resultPreimage: createDataPlaneAnalysisPreimage(files),
    };
    dataPlaneAnalysisCacheEntry = entry;
  }
  try {
    return snapshotDataPlaneAnalysisPreimage(await entry.resultPreimage);
  } catch (error) {
    if (dataPlaneAnalysisCacheEntry === entry) dataPlaneAnalysisCacheEntry = undefined;
    throw error;
  }
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
  if (sourceFiles.length === 0) return { ...emptyStaticDataPlaneBuildFacts(), touchGraph: {} };

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
  const staticFacts = await runStaticBuildAnalysisFacts(sourceFiles);
  return {
    files: sourceFiles,
    outputQueryShapeFacts: await outputSchemaQueryShapeFactsAsync(sourceFiles),
    staticFacts,
  };
}

async function createDataPlaneAnalysisPreimage(
  files: readonly DataPlaneSourceFile[],
): Promise<string> {
  return staticAnalysisCanonicalJson(await createDataPlaneAnalysis(files));
}

async function cachedStaticBuildAnalysisFacts(
  files: readonly DataPlaneSourceFile[],
  options: StaticDataPlaneBuildFactsOptions,
): Promise<StaticBuildAnalysisFactsLike> {
  const sourceFiles = snapshotDataPlaneSourceFiles(files, 'Cached static-analysis sources');
  const cacheIdentity = namespacedDataPlaneCacheIdentity(
    'build',
    dataPlaneAnalysisCacheIdentity(sourceFiles),
  );
  if (!options.cache) return runStaticBuildAnalysisFacts(sourceFiles);

  let entry = staticBuildAnalysisCacheEntry;
  if (entry?.identity !== cacheIdentity) {
    entry = {
      identity: cacheIdentity,
      resultPreimage: createStaticBuildAnalysisPreimage(sourceFiles),
    };
    staticBuildAnalysisCacheEntry = entry;
  }
  try {
    const facts = snapshotStaticBuildAnalysisFacts(
      staticAnalysisJsonParse(await entry.resultPreimage),
    );
    if (facts === undefined) {
      throw new TypeError('Kovo process-local static-analysis cache returned invalid facts.');
    }
    return facts;
  } catch (error) {
    if (staticBuildAnalysisCacheEntry === entry) staticBuildAnalysisCacheEntry = undefined;
    throw error;
  }
}

async function createStaticBuildAnalysisPreimage(
  files: readonly DataPlaneSourceFile[],
): Promise<string> {
  return staticAnalysisCanonicalJson(await runStaticBuildAnalysisFacts(files));
}

async function runStaticBuildAnalysisFacts(
  files: readonly DataPlaneSourceFile[],
): Promise<StaticBuildAnalysisFactsLike> {
  try {
    if (typeof extractStaticBuildAnalysisFactsFromProject !== 'function') {
      throw new TypeError(
        '@kovojs/drizzle/internal/static must export extractStaticBuildAnalysisFactsFromProject.',
      );
    }
    const facts = snapshotStaticBuildAnalysisFacts(
      extractStaticBuildAnalysisFactsFromProject({ files }),
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
    files: entries,
    version: STATIC_DATA_PLANE_FACTS_CACHE_VERSION,
  });
}

function namespacedDataPlaneCacheIdentity(kind: 'build' | 'vite', identity: string): string {
  return staticAnalysisCanonicalJson({ identity, kind });
}

function snapshotDataPlaneAnalysisPreimage(preimage: string): DataPlaneAnalysis {
  const parsed = staticAnalysisJsonParse(preimage);
  if (!parsed || typeof parsed !== 'object' || staticAnalysisArrayIsArray(parsed)) {
    throw new TypeError('Kovo process-local data-plane cache returned an invalid record.');
  }
  const files = staticAnalysisOwnDataValue(parsed, 'files', 'Cached data-plane analysis');
  const outputQueryShapeFacts = staticAnalysisOwnDataValue(
    parsed,
    'outputQueryShapeFacts',
    'Cached data-plane analysis',
  );
  const staticFactsValue = staticAnalysisOwnDataValue(
    parsed,
    'staticFacts',
    'Cached data-plane analysis',
  );
  if (!staticAnalysisArrayIsArray(files) || !staticAnalysisArrayIsArray(outputQueryShapeFacts)) {
    throw new TypeError('Kovo process-local data-plane cache returned invalid arrays.');
  }
  const queryShapeFacts = snapshotDenseArray(
    outputQueryShapeFacts,
    'Cached data-plane query-shape facts',
  );
  for (let index = 0; index < queryShapeFacts.length; index += 1) {
    if (!isCompilerQueryShapeFact(queryShapeFacts[index])) {
      throw new TypeError('Kovo process-local data-plane cache returned an invalid query shape.');
    }
  }
  const staticFacts = snapshotStaticBuildAnalysisFacts(staticFactsValue);
  if (staticFacts === undefined) {
    throw new TypeError('Kovo process-local data-plane cache returned invalid static facts.');
  }
  return {
    files: snapshotDataPlaneSourceFiles(
      files as readonly DataPlaneSourceFile[],
      'Cached data-plane sources',
    ),
    outputQueryShapeFacts: queryShapeFacts as readonly QueryShapeFact[],
    staticFacts,
  };
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
  return outputSchemaQueryShapeFactsSerial(files);
}

function outputSchemaQueryShapeFactsSerial(
  files: readonly DataPlaneSourceFile[],
  projectFiles: readonly DataPlaneSourceFile[] = files,
): readonly QueryShapeFact[] {
  return outputSchemaQueryShapeFactsFromProject(typeScript(), projectFiles, files);
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

function isCompilerQueryShapeFact(value: unknown): value is QueryShapeFact {
  return (
    isRecord(value) &&
    typeof staticAnalysisOwnDataValue(value, 'query', 'Worker query-shape fact') === 'string' &&
    typeof staticAnalysisOwnDataValue(value, 'source', 'Worker query-shape fact') === 'string' &&
    isCompilerQueryShape(staticAnalysisOwnDataValue(value, 'shape', 'Worker query-shape fact'))
  );
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

function sourceFilesWithinBoundary(
  dir: string,
  fileNameRoot: string,
  boundaryRoot: string,
  includeDeclarations: boolean,
): DataPlaneSourceFile[] {
  // SPEC.md §5.2's source-derived security facts must come only from the selected app tree.
  // Use the compiler's descriptor-bound source capability so symlinks, special entries, and
  // realpath/descriptor races cannot redirect static analysis to host files.
  const fileSystem = createCompilerSourceFileSystem(boundaryRoot);
  if (fileSystem === null) {
    throw new TypeError(`Kovo data-plane source root is unavailable or unstable: ${boundaryRoot}`);
  }
  const files: DataPlaneSourceFile[] = [];
  collectSourceFilesWithinBoundary(dir, fileNameRoot, fileSystem, includeDeclarations, files);
  collectImportedSourceFilesWithinBoundary(
    fileNameRoot,
    boundaryRoot,
    fileSystem,
    includeDeclarations,
    files,
  );
  return files;
}

function collectImportedSourceFilesWithinBoundary(
  fileNameRoot: string,
  boundaryRoot: string,
  fileSystem: CompilerSourceFileSystem,
  includeDeclarations: boolean,
  files: DataPlaneSourceFile[],
): void {
  const knownPaths = new Map<string, true>();
  const initialLength = staticAnalysisArrayLength(files, 'Static-analysis initial source files');
  for (let index = 0; index < initialLength; index += 1) {
    const file = dataPlaneSourceFileAt(files, index, 'Static-analysis initial source files');
    staticAnalysisMapSet(knownPaths, resolve(fileNameRoot, file.fileName), true);
  }

  for (
    let fileIndex = 0;
    fileIndex < staticAnalysisArrayLength(files, 'Static-analysis source closure');
    fileIndex += 1
  ) {
    const file = dataPlaneSourceFileAt(files, fileIndex, 'Static-analysis source closure');
    const importerPath = resolve(fileNameRoot, file.fileName);
    const specifiers = snapshotDenseArray(
      compilerSourceModuleSpecifiers(file.source),
      `Static-analysis imports for ${file.fileName}`,
    );
    for (let specifierIndex = 0; specifierIndex < specifiers.length; specifierIndex += 1) {
      const specifier = specifiers[specifierIndex]!;
      if (
        !staticAnalysisStringStartsWith(specifier, './') &&
        !staticAnalysisStringStartsWith(specifier, '../')
      ) {
        continue;
      }
      const candidates = relativeSourceModuleCandidates(importerPath, specifier, boundaryRoot);
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        const candidate = candidates[candidateIndex]!;
        const kind = fileSystem.kind(candidate);
        if (kind === 'directory') continue;
        if (kind === 'other') {
          if (existsSync(candidate)) {
            throw new TypeError(
              `Kovo data-plane import resolves through a symbolic link or special entry: ${candidate}`,
            );
          }
          continue;
        }
        if (staticAnalysisMapGet(knownPaths, candidate) === true) break;
        if (!isDataPlaneAppSourcePath(candidate, { includeDeclarations })) break;
        const source = fileSystem.readFile(candidate);
        if (source === null) {
          throw new TypeError(`Kovo data-plane imported source is unavailable: ${candidate}`);
        }
        staticAnalysisMapSet(knownPaths, candidate, true);
        staticAnalysisArrayAppend(
          files,
          { fileName: slashPath(relative(fileNameRoot, candidate)), source },
          'Static-analysis imported source closure',
        );
        break;
      }
    }
  }
}

function dataPlaneSourceFileAt(
  files: readonly DataPlaneSourceFile[],
  index: number,
  label: string,
): DataPlaneSourceFile {
  const value = staticAnalysisOwnDataValue(files, index, label);
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${label}[${index}] must be a source-file record.`);
  }
  const fileName = staticAnalysisOwnDataValue(value, 'fileName', `${label}[${index}]`);
  const source = staticAnalysisOwnDataValue(value, 'source', `${label}[${index}]`);
  if (typeof fileName !== 'string' || typeof source !== 'string') {
    throw new TypeError(`${label}[${index}] must contain fileName/source strings.`);
  }
  return { fileName, source };
}

const DATA_PLANE_SOURCE_MODULE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
] as const;

function relativeSourceModuleCandidates(
  importerPath: string,
  specifier: string,
  boundaryRoot: string,
): string[] {
  const queryIndex = staticAnalysisStringIndexOf(specifier, '?');
  const fragmentIndex = staticAnalysisStringIndexOf(specifier, '#');
  let end = specifier.length;
  if (queryIndex >= 0) end = staticAnalysisMathMin(end, queryIndex);
  if (fragmentIndex >= 0) end = staticAnalysisMathMin(end, fragmentIndex);
  const pathSpecifier = staticAnalysisStringSlice(specifier, 0, end);
  if (staticAnalysisStringIndexOf(pathSpecifier, '%') >= 0) {
    throw new TypeError(`Kovo data-plane relative imports cannot use URL escapes: ${specifier}`);
  }
  const base = resolve(dirname(importerPath), pathSpecifier);
  if (!pathIsWithinDataPlaneBoundary(boundaryRoot, base)) {
    throw new TypeError(`Kovo data-plane relative import escapes the app root: ${specifier}`);
  }

  const candidates: string[] = [];
  const mappedTypeScriptPaths = mappedTypeScriptSourcePaths(base);
  if (mappedTypeScriptPaths.length > 0) {
    for (let index = 0; index < mappedTypeScriptPaths.length; index += 1) {
      staticAnalysisArrayAppend(
        candidates,
        mappedTypeScriptPaths[index]!,
        'Static-analysis import candidates',
      );
    }
    staticAnalysisArrayAppend(candidates, base, 'Static-analysis import candidates');
    return candidates;
  }
  for (let index = 0; index < DATA_PLANE_SOURCE_MODULE_EXTENSIONS.length; index += 1) {
    if (staticAnalysisStringEndsWith(base, DATA_PLANE_SOURCE_MODULE_EXTENSIONS[index]!)) {
      staticAnalysisArrayAppend(candidates, base, 'Static-analysis import candidates');
      return candidates;
    }
  }
  if (staticAnalysisRegExpTest(/\.[^/\\]+$/u, pathSpecifier)) return candidates;

  staticAnalysisArrayAppend(candidates, base, 'Static-analysis import candidates');
  for (let index = 0; index < DATA_PLANE_SOURCE_MODULE_EXTENSIONS.length; index += 1) {
    const extension = DATA_PLANE_SOURCE_MODULE_EXTENSIONS[index]!;
    staticAnalysisArrayAppend(
      candidates,
      `${base}${extension}`,
      'Static-analysis import candidates',
    );
  }
  for (let index = 0; index < DATA_PLANE_SOURCE_MODULE_EXTENSIONS.length; index += 1) {
    const extension = DATA_PLANE_SOURCE_MODULE_EXTENSIONS[index]!;
    staticAnalysisArrayAppend(
      candidates,
      resolve(base, `index${extension}`),
      'Static-analysis import candidates',
    );
  }
  return candidates;
}

function mappedTypeScriptSourcePaths(fileName: string): string[] {
  if (staticAnalysisStringEndsWith(fileName, '.mjs')) {
    return [`${staticAnalysisStringSlice(fileName, 0, -4)}.mts`];
  }
  if (staticAnalysisStringEndsWith(fileName, '.cjs')) {
    return [`${staticAnalysisStringSlice(fileName, 0, -4)}.cts`];
  }
  if (staticAnalysisStringEndsWith(fileName, '.jsx')) {
    return [`${staticAnalysisStringSlice(fileName, 0, -4)}.tsx`];
  }
  if (staticAnalysisStringEndsWith(fileName, '.js')) {
    const stem = staticAnalysisStringSlice(fileName, 0, -3);
    // Match TypeScript/Bundler resolution order. A JS-spelled authored import may resolve to a
    // TSX source module; omitting that candidate would leave executed code outside KV424's exact
    // immutable pre-evaluation snapshot.
    return [`${stem}.ts`, `${stem}.tsx`];
  }
  return [];
}

function pathIsWithinDataPlaneBoundary(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return (
    relativePath === '' ||
    !staticAnalysisRegExpTest(/^(?:\.\.(?:[/\\]|$)|[/\\]|[A-Za-z]:)/u, relativePath)
  );
}

function collectSourceFilesWithinBoundary(
  dir: string,
  fileNameRoot: string,
  fileSystem: CompilerSourceFileSystem,
  includeDeclarations: boolean,
  files: DataPlaneSourceFile[],
): void {
  const directoryEntries = fileSystem.readDirectory(dir);
  if (directoryEntries === null) {
    throw new TypeError(`Kovo data-plane source directory is unavailable or unstable: ${dir}`);
  }
  const entries = snapshotDenseArray(directoryEntries, 'Static-analysis source directory entries');
  sortStrings(entries);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const path = resolve(dir, entry);
    if (isIgnoredDataPlaneDirectory(entry)) continue;
    const kind = fileSystem.kind(path);
    if (kind === 'directory') {
      collectSourceFilesWithinBoundary(path, fileNameRoot, fileSystem, includeDeclarations, files);
      continue;
    }
    if (kind === 'other') {
      throw new TypeError(
        `Kovo data-plane source tree contains a symbolic link or special entry: ${path}`,
      );
    }
    if (!isInitialDataPlaneAppSourcePath(entry, { includeDeclarations })) continue;
    const source = fileSystem.readFile(path);
    if (source === null) {
      throw new TypeError(`Kovo data-plane source file is unavailable or unstable: ${path}`);
    }
    staticAnalysisArrayAppend(
      files,
      {
        fileName: slashPath(relative(fileNameRoot, path)),
        source,
      },
      'Static-analysis directory files',
    );
  }
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
  if (staticAnalysisStringEndsWith(baseName, '.d.ts') && !options.includeDeclarations) return false;
  if (!staticAnalysisRegExpTest(/\.(?:[cm]?[jt]sx?)$/u, baseName)) return false;
  return true;
}

function isInitialDataPlaneAppSourcePath(
  filePath: string,
  options: { includeDeclarations: boolean },
): boolean {
  if (!isDataPlaneAppSourcePath(filePath, options)) return false;
  const normalized = staticAnalysisStringToLowerCase(slashPath(stripPathSuffix(filePath)));
  const baseName = staticAnalysisStringSlice(
    normalized,
    staticAnalysisStringLastIndexOf(normalized, '/') + 1,
  );
  if (staticAnalysisRegExpTest(/\.(?:test|spec)\.[cm]?[jt]sx?$/u, baseName)) return false;
  if (staticAnalysisRegExpTest(/(?:^|[.-])test-helpers\.[cm]?[jt]sx?$/u, baseName)) return false;
  if (staticAnalysisRegExpTest(/\.test-support\.[cm]?[jt]sx?$/u, baseName)) return false;
  if (staticAnalysisRegExpTest(/(?:^|[.-])setup\.[cm]?[jt]sx?$/u, baseName)) return false;
  return true;
}

function isIgnoredDataPlaneDirectory(entry: string): boolean {
  return entry === 'node_modules' || entry === 'dist' || entry === '.kovo';
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

function typeScript(): TypeScriptModule {
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
