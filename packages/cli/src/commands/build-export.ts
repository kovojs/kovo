/* oxlint-disable typescript/unbound-method -- Buffer.from is a static intrinsic and does not use this. */
import {
  execFile as builtinExecFile,
  spawn as builtinSpawn,
  type ChildProcess,
} from 'node:child_process';
import { Buffer as builtinBuffer } from 'node:buffer';
import {
  createHmac as builtinCreateHmac,
  hash as builtinHash,
  randomBytes as builtinRandomBytes,
  timingSafeEqual as builtinTimingSafeEqual,
} from 'node:crypto';
import {
  accessSync as builtinAccessSync,
  constants as builtinFsConstants,
  existsSync as builtinExistsSync,
  lstatSync as builtinLstatSync,
  mkdirSync as builtinMkdirSync,
  mkdtempSync as builtinMkdtempSync,
  readFileSync as builtinReadFileSync,
  readdirSync as builtinReaddirSync,
  realpathSync as builtinRealpathSync,
  renameSync as builtinRenameSync,
  rmSync as builtinRmSync,
  statSync as builtinStatSync,
  symlinkSync as builtinSymlinkSync,
  writeFileSync as builtinWriteFileSync,
} from 'node:fs';
import { readFile as builtinReadFile } from 'node:fs/promises';
import { createRequire as builtinCreateRequire } from 'node:module';
import { tmpdir as builtinTmpdir } from 'node:os';
import {
  basename as builtinBasename,
  dirname as builtinDirname,
  isAbsolute as builtinIsAbsolute,
  join as builtinJoin,
  relative as builtinRelative,
  resolve as builtinResolve,
  sep as builtinPathSeparator,
} from 'node:path';
import { performance as builtinPerformance } from 'node:perf_hooks';
import {
  fileURLToPath as builtinFileURLToPath,
  pathToFileURL as builtinPathToFileURL,
} from 'node:url';
import { promisify as builtinPromisify } from 'node:util';

import type { DiagnosticCode } from '@kovojs/core/diagnostics';
import {
  assertRegisteredDiagnostic,
  createRegisteredDiagnostic,
  isDiagnosticCode,
} from '@kovojs/core/internal/diagnostics';
import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';
import {
  clientModuleHrefForSourceFile,
  clientModuleRepresentationDigest,
  parseVersionedClientModuleTarget,
} from '@kovojs/core/internal/client-module-url';
import { computeRenderPlanFingerprint } from '@kovojs/core/internal/render-plan-token';
import { ESCAPE_CENSUS_DOORS, validateKovoExplainInput } from '@kovojs/core/internal/graph';
import {
  snapshotCacheInfluenceManifest,
  type CacheInfluenceManifestEntry,
  type CacheInfluenceSurface,
} from '@kovojs/core/internal/cache-influence';
import { isParanoidSecurityAdvisoryCode } from '@kovojs/core/internal/security-markers';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import {
  compileComponentModule,
  compileRouteModule,
  kovoVitePlugin,
  type CompileResult,
  type CompileRouteModuleResult,
} from '@kovojs/compiler';
import { deriveAppGraph } from '@kovojs/compiler/graph';
import {
  analyzeCapabilityClosure,
  collectCapabilityPackageRequests,
  compilerOwnedProjectMutationRegistryFactsFromFiles,
  componentTaskBSourceOperationFacts,
  type CompilerClientModuleHandoffInstaller,
  compilerGeneratedCapabilityDependencies,
  compilerOwnedViteClientModuleRole,
  compilerViteClientModuleRoleProtocol,
  createCompilerOwnedAppContractProject,
  createFrameworkKovoCssCollectorVitePlugin,
  cssRouteDeliveryGate,
  dedupeCss,
  deriveBrowserPostureManifestFromSourceFiles,
  deriveRegistryIdentity,
  lowerStandaloneSourceDerivedRegistryDeclarations,
  mutationHandlerFingerprintFromRuntimeSource,
  mutationSessionAuthorityFacts,
  parseComponentModule,
  projectMutationRegistryFactsFromFiles,
  type AppDependencyCapabilityManifest,
  type CompilerGeneratedCapabilityDependency,
  type CompilerOwnedViteClientModuleRole,
  type CompilerOwnedAppContractProject,
  type CompilerOwnedAppContractStaticFact,
  type ProjectMutationRegistryFacts,
  type QueryShapeFact,
  type AnalyzeCapabilityClosureResult,
  viteFrameworkIdentityFiles,
} from '@kovojs/compiler/internal';
import {
  compilerSourceModuleSpecifiers,
  createCompilerSourceFileSystem,
  type CompilerSourceFileSystem,
} from '@kovojs/compiler/internal/source-filesystem';
import { extractAppRouteCssTargets } from '@kovojs/compiler/package-styles';
import type {
  collectStaticBuildTrustFactsFromProject,
  CompilerSecuritySemanticSource,
  CompilerTaskBFiniteVerdict,
} from '@kovojs/drizzle/internal/static';
import type { AccessDecision, Guard, StylesheetAsset } from '@kovojs/server';
import type { AppEgressOptions } from '@kovojs/server/egress';
import type {
  StaticExportCompileDiagnostic,
  StaticExportResult,
} from '@kovojs/server/static-export';
import type {
  CompilerClientModuleBuildInstaller,
  KovoApp,
  KovoNeutralBuild,
} from '@kovojs/server/internal/build';
import type {
  KovoBuildPreset,
  KovoBuildPresetContext,
  KovoBuildPresetDiagnostic,
} from '@kovojs/server/internal/build-preset';
import { type EscapeObligationReviewSubject } from '@kovojs/server/internal/execution';
import { withKovoBuildContext } from '@kovojs/server/internal/build-context';
import { assertDocumentCspConfigMatchesBrowserPosture } from '@kovojs/server/internal/csp';
import type { KovoAppShellCompiledClientModule } from '@kovojs/server/internal/app-shell-vite';
import type {
  DataPlaneSourceFile as BuildCheckSourceFile,
  QueryReadFactLike,
  StaticDataPlaneBuildFacts,
} from '@kovojs/server/internal/data-plane-static-analysis';
import {
  runtimeRegistryWireFactsFromGraph,
  type RuntimeRegistryWireFacts,
} from '@kovojs/server/internal/runtime-registry-wire';
import {
  build as viteBuild,
  createRunnableDevEnvironment,
  resolveConfig as resolveViteConfig,
  type InlineConfig,
  type Plugin,
} from 'vite-plus';

import { parseKovoCommandInvocation } from '../commands-manifest.js';
import { requireKovoCommandResultProtocol } from '../command-schema.js';
import type {
  KovoDiagnosticFormat,
  KovoDiagnosticRecord,
  KovoDiagnosticSourceAnchor,
} from '../diagnostic.js';
import { KOVO_DIAGNOSTIC_VERSION, projectKovoDiagnostic } from '../diagnostic.js';
import {
  createKovoCheckDiagnosticSourceCatalog,
  kovoCheck,
  kovoCheckDiagnosticSource,
  kovoCheckWithDiagnosticSourceCatalog,
  type KovoCheckDiagnosticSourceCatalog,
  type KovoCheckDiagnosticSourceFact,
} from '../graph-output.js';
import { kovoInvocationEnvironmentValue } from '../invocation-environment.js';
import { kovoCertificatePolicyV1Json, kovoCertificateV1Json } from '../certificate.js';
import { escapeCensusReviewManifestForBuild } from '../escape-census-review-subjects.js';
import {
  readCapabilityPackageSummaries,
  resolveCapabilityPackages,
} from '../capability-closure-packages.js';
import {
  dependencyCapabilityLoaderVitePlugin,
  htmlModuleSourcePaths,
} from '../dependency-capability-loader.js';
import {
  buildOutputVersion,
  type CliCommandResult,
  type KovoCheckResult,
  stableText,
  stableValue,
} from '../shared.js';
import { resolveKovoArtifactProvenance } from '../artifact-provenance.js';
import {
  createKovoGraphProof,
  createKovoRuntimePostureManifest,
  deriveKovoAppBuildToken,
} from '../graph-proof.js';
import { findNearestFile, readJsonRecord } from '../tooling.js';
import {
  kovoCommandBootSecurityDisposition,
  type KovoCommandSecurityDisposition,
} from './security-disposition.js';
import {
  captureBuildTimeViteRunnableLifetime,
  combineBuildTimeViteFailures,
  type BuildTimeViteRunnableLifetime,
} from './build-vite-lifetime.js';
import { declaresKovoLifecyclePolicy, runLifecyclePolicyCheck } from './lifecycle-policy.js';
import { runProjectQualityCheck } from './project-quality.js';
import { runSoundSubsetCheck } from './sound-subset.js';
import { kovoBuildOneShotDigest, type KovoBuildOneShotIdentity } from './build-one-shot-handoff.js';
import {
  buildByteLength,
  buildSecurityArrayAppend,
  buildArrayIsArray,
  buildArrayJoin,
  buildCreateNullRecord,
  buildCreateMap,
  buildCreateSet,
  buildFunctionSource,
  buildJsonStringify,
  buildMapGet,
  buildMapHas,
  buildMapSet,
  buildObjectKeys,
  buildOwnDataProperty,
  buildOwnDataValue,
  buildPromiseAll,
  buildRegExpExec,
  buildRegExpReplace,
  buildSetAdd,
  buildSetHas,
  buildSnapshotDenseArray,
  buildStringIncludes,
  buildStringEndsWith,
  buildStringSplit,
  buildStringStartsWith,
  buildStringTrim,
  buildStringTrimEnd,
} from './build-security-intrinsics.js';

const execFile = builtinExecFile;
const spawn = builtinSpawn;
const bufferFrom = builtinBuffer.from;
const createHmac = builtinCreateHmac;
const hash = builtinHash;
const randomBytes = builtinRandomBytes;
const timingSafeEqual = builtinTimingSafeEqual;
const jsonParse = JSON.parse;
const accessSync = builtinAccessSync;
const fsWriteOk = builtinFsConstants.W_OK;
const existsSync = builtinExistsSync;
const lstatSync = builtinLstatSync;
const mkdirSync = builtinMkdirSync;
const mkdtempSync = builtinMkdtempSync;
const readFile = builtinReadFile;
const readFileSync = builtinReadFileSync;
const readdirSync = builtinReaddirSync;
const realpathSync = builtinRealpathSync;
const renameSync = builtinRenameSync;
const rmSync = builtinRmSync;
const statSync = builtinStatSync;
const writeFileSync = builtinWriteFileSync;
const createRequire = builtinCreateRequire;
const tmpdir = builtinTmpdir;
const basename = builtinBasename;
const dirname = builtinDirname;
const isAbsolute = builtinIsAbsolute;
const join = builtinJoin;
const relative = builtinRelative;
const resolve = builtinResolve;
const pathSeparator = builtinPathSeparator;
const fileURLToPath = builtinFileURLToPath;
const pathToFileURL = builtinPathToFileURL;
const promisify = builtinPromisify;
const performanceNow = builtinPerformance.now.bind(builtinPerformance);
const processKill = process.kill.bind(process);
const processPlatform = process.platform;
const staticClearTimeout = globalThis.clearTimeout.bind(globalThis);
const staticSetTimeout = globalThis.setTimeout.bind(globalThis);
const collectBuildGarbage =
  typeof globalThis.gc === 'function' ? globalThis.gc.bind(globalThis) : undefined;
const staticTrustWorkerSchema = 'kovo-static-trust-worker/v1';
const staticTrustWorkerMaxOutputBytes = 256 * 1024 * 1024;
// CI run 30612746165 exhausted the old 120s ceiling while deriving a valid generated app's trust
// facts. Keep the worker bounded at 2.5x that exhausted ceiling; the deadline path still SIGKILLs
// the complete process group and rejects without accepting partial trust output.
const staticTrustWorkerTimeoutMs = 300_000;

type BuildStaticAnalysisRuntime = typeof import('./build-static-analysis-runtime.js');
let buildStaticAnalysisRuntime: BuildStaticAnalysisRuntime | undefined;

async function installBuildStaticAnalysisRuntime(): Promise<void> {
  buildStaticAnalysisRuntime ??= await import('./build-static-analysis-runtime.js');
}

function requiredBuildStaticAnalysisRuntime(): BuildStaticAnalysisRuntime {
  if (buildStaticAnalysisRuntime === undefined) {
    throw new TypeError(
      'Kovo static analysis runtime is unavailable outside the disposable trust worker.',
    );
  }
  return buildStaticAnalysisRuntime;
}

const requireFromCli = createRequire(new URL('../index.ts', import.meta.url));

/**
 * A caller-selected path/configuration was unusable before Kovo could evaluate the build proof.
 *
 * The class is module-private so app code cannot manufacture an exit-2 result and disguise a
 * compiler/security finding as a usage mistake. G5 in plans/worldclass-devex.md reserves exit 2
 * for invocation/configuration mistakes while SPEC §5.2 build findings remain exit 1.
 */
class KovoCommandConfigurationError extends Error {}

// Exact first-party package names whose source entries may live inside the invocation root while
// dogfooding the workspace. Ordinary workspace/package dependencies remain app source and must be
// present in the preflight snapshot; this exception is deliberately limited to Kovo's reviewed
// package graph (SPEC §5.2/§6.6).
const kovoFrameworkSourcePackages = [
  '@kovojs/better-auth',
  '@kovojs/browser',
  '@kovojs/compiler',
  '@kovojs/core',
  '@kovojs/devtool',
  '@kovojs/drizzle',
  '@kovojs/headless-ui',
  '@kovojs/icons',
  '@kovojs/server',
  '@kovojs/style',
  '@kovojs/ui',
  '@kovojs/verify',
] as const;

const KOVO_FRAMEWORK_SOURCE_MAX_CONTEXTS = 256;
const KOVO_FRAMEWORK_SOURCE_MAX_DIRECTORIES = 20_000;
const KOVO_FRAMEWORK_SOURCE_MAX_FILES = 40_000;
const KOVO_FRAMEWORK_SOURCE_MAX_DEPTH = 64;
const KOVO_FRAMEWORK_SOURCE_MAX_FILE_BYTES = 16 * 1024 * 1024;
const KOVO_FRAMEWORK_SOURCE_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const KOVO_DEVEX_CHECK_PHASE_CENSUS_ENV = 'KOVO_DEVEX_CHECK_PHASE_CENSUS_SOURCE';
const KOVO_DEVEX_CHECK_PHASE_CENSUS_SCHEMA = 'kovo-check-phase-census/v1';
const KOVO_SOURCE_CHECK_PHASES = [
  'lifecycle-policy',
  'config-trust',
  'typescript',
  'project-quality',
  'sound-subset',
  'session-authority',
  'app-source-trust',
  'stylesheet',
  'app-evaluation',
  'build-check-graph',
  'graph-diagnostics',
] as const;

export type KovoSourceCheckPhase = (typeof KOVO_SOURCE_CHECK_PHASES)[number];
export type KovoSourceCheckPhaseStatus = 'executed' | 'not-applicable';

export interface KovoSourceCheckPhaseCensus {
  readonly phases: {
    readonly durationMs: number;
    readonly name: KovoSourceCheckPhase;
    readonly status: KovoSourceCheckPhaseStatus;
  }[];
  readonly sourcePath: string;
}

// Resolve the framework graph while this bootstrap-first module is initializing. App evaluation
// must not be able to rewrite package manifests and widen the later production-build exemption
// (SPEC §5.2/§6.6).
const trustedKovoFrameworkSourceRoots = resolveKovoFrameworkSourceRoots(
  fileURLToPath(new URL('../index.ts', import.meta.url)),
  requireFromCli,
);
const trustedKovoServerRuntimeEntry = resolveTrustedKovoServerRuntimeEntry();
const trustedCloudflareSqlParserRuntimeSubject = resolveTrustedCloudflareSqlParserRuntimeSubject(
  trustedKovoServerRuntimeEntry,
);
// Vite/OXC can present manifest main entries and its framework-configured automatic JSX runtime
// as resolved absolute paths rather than authored bare specifiers. Keep the exception finite and
// boot-pinned; arbitrary package internals are intentionally absent.
const trustedKovoDirectFrameworkEntrySources = buildCreateSet<string>();
for (let index = 0; index < kovoFrameworkSourcePackages.length; index += 1) {
  const packageName = kovoFrameworkSourcePackages[index]!;
  try {
    buildSetAdd(
      trustedKovoDirectFrameworkEntrySources,
      realpathSync(requireFromCli.resolve(packageName)),
    );
  } catch {
    // Optional first-party packages that are not in this CLI installation add no trusted entry.
  }
}
try {
  buildSetAdd(
    trustedKovoDirectFrameworkEntrySources,
    realpathSync(requireFromCli.resolve('@kovojs/server/jsx-runtime')),
  );
} catch {
  // The root build artifact deliberately contains package outputs without recreating pnpm's
  // package-local dependency links. In that verification layout there is no resolvable automatic
  // JSX runtime to trust; packed/installed CLI layouts resolve and pin it here.
}

const execFileAsync = promisify(execFile);

function isKovoServerHandlerExternalDependency(id: string): boolean {
  return (
    id === '@electric-sql/pglite' ||
    buildStringStartsWith(id, '@electric-sql/pglite/') ||
    id === '@node-rs/argon2' ||
    buildStringStartsWith(id, '@node-rs/argon2-') ||
    id === 'pg' ||
    buildStringStartsWith(id, 'pg/')
  );
}

function isKovoServerHandlerExternalDependencyForTarget(
  id: string,
  runtimeTarget: KovoBuildPresetName,
): boolean {
  if (
    runtimeTarget === 'cloudflare' &&
    (id === '@electric-sql/pglite' || buildStringStartsWith(id, '@electric-sql/pglite/'))
  ) {
    // Let the exact framework-owned import reach the Cloudflare database plugin instead of being
    // externalized before resolve hooks run. App-owned edges receive no framework substitution.
    return false;
  }
  return isKovoServerHandlerExternalDependency(id);
}

function dependencyCapabilityCompleteBundleNoExternal(): true {
  // Every supported artifact and pre-evaluation SSR graph must traverse unknown package children;
  // the loader's source-level edge census closes builtins before Vite can externalize them.
  return true;
}

function dependencyCapabilityCompleteSsrOptions(): {
  readonly external: string[];
  readonly noExternal: true;
} {
  // Native/CommonJS framework dependencies cannot all execute correctly as Vite-inlined ESM
  // namespaces. This exact list is trusted compiler/runtime host tooling, not app packages. A
  // reviewed app dependency cannot exploit these externals because its own source is parsed first
  // and every bare child edge closes before Vite's externalization decision (SPEC §6.6; C13).
  return {
    external: [
      '@electric-sql/pglite',
      '@material/material-color-utilities',
      '@node-rs/argon2',
      'better-sqlite3',
      'es-module-lexer',
      'pg',
      'pgsql-ast-parser',
      'ts-morph',
      'typescript',
      'undici',
    ],
    noExternal: true,
  };
}

function isKovoServerHandlerModuleSideEffectFree(id: string): boolean {
  return isKovoServerHandlerModuleSideEffectFreeFromTrust(
    trustedKovoFrameworkSourceRoots,
    trustedKovoServerRuntimeEntry,
    id,
  );
}

function isKovoServerHandlerModuleSideEffectFreeFromTrust(
  trust: readonly KovoFrameworkSourceRoot[],
  serverRuntimeEntry: string | undefined,
  id: string,
): boolean {
  // These modules' top-level work only prepares their exported runtime primitives. Let Rollup
  // remove them when an app does not use those primitives, so an unused native Argon2 sink is not
  // loaded by Cloudflare/non-password handlers merely because the server barrel re-exports it.
  // The Node SQL parser bootstrap is retained through explicit readiness calls in the SQLite and
  // Postgres constructors; only a bundle that drops those constructors may drop node:fs/node:vm.
  //
  // SPEC §6.6 / §14: published server output preserves source module boundaries with fixed names.
  // Apply the same reviewed side-effect posture only inside the exact server runtime root captured
  // before app evaluation and only while its boot-time bytes still match. An app-owned lookalike
  // therefore cannot turn itself, or an authored node:dgram edge, into framework-owned code.
  const fileName = viteBuildSourceFileName(id);
  if (serverRuntimeEntry === undefined || fileName === undefined) return false;
  const runtimeRoot = dirname(serverRuntimeEntry);
  const relativeFileName = slashPath(relative(runtimeRoot, fileName));
  if (
    buildRegExpExec(
      /^(?:managed-db-public|password|postgres-runtime|sqlite-runtime|sql-parser-authority|sql-parser-authority-bootstrap)\.(?:js|mjs|ts)$/u,
      relativeFileName,
    ) === null
  ) {
    return false;
  }
  return kovoFrameworkSourcePathMatchesSnapshot(trust, fileName);
}

function resolveTrustedKovoServerRuntimeEntry(): string | undefined {
  try {
    return realpathSync(requireFromCli.resolve('@kovojs/server'));
  } catch {
    return undefined;
  }
}

interface CloudflareSqlParserRuntimeSubject {
  readonly entry: string;
  readonly source: string;
}

function resolveTrustedCloudflareSqlParserRuntimeSubject(
  serverRuntimeEntry: string | undefined,
): CloudflareSqlParserRuntimeSubject | undefined {
  if (serverRuntimeEntry === undefined) return undefined;
  try {
    const serverResolver = createRequire(pathToFileURL(serverRuntimeEntry));
    const entry = realpathSync(serverResolver.resolve('pgsql-ast-parser'));
    return { entry, source: readFileSync(entry, 'utf8') };
  } catch {
    return undefined;
  }
}

/** @internal Regression seam for source/packed server module-side-effect authentication. */
export function kovoServerHandlerModuleSideEffectFreeForTesting(
  trust: readonly KovoFrameworkSourceRoot[],
  serverRuntimeEntry: string | undefined,
  id: string,
): boolean {
  return isKovoServerHandlerModuleSideEffectFreeFromTrust(trust, serverRuntimeEntry, id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !buildArrayIsArray(value);
}

function buildMapDense<Value, Result>(
  values: readonly Value[],
  label: string,
  map: (value: Value, index: number) => Result,
): Result[] {
  const source = buildSnapshotDenseArray(values, label);
  const result: Result[] = [];
  for (let index = 0; index < source.length; index += 1) {
    buildSecurityArrayAppend(
      result,
      map(source[index]!, index),
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  return result;
}

function buildFlatMapDense<Value, Result>(
  values: readonly Value[],
  label: string,
  map: (value: Value, index: number) => readonly Result[],
): Result[] {
  const source = buildSnapshotDenseArray(values, label);
  const result: Result[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const mapped = buildSnapshotDenseArray(map(source[index]!, index), `${label} mapped result`);
    for (let mappedIndex = 0; mappedIndex < mapped.length; mappedIndex += 1) {
      buildSecurityArrayAppend(
        result,
        mapped[mappedIndex]!,
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
    }
  }
  return result;
}

function buildConcatDense<Value>(
  first: readonly Value[],
  second: readonly Value[],
  label: string,
): Value[] {
  const result = buildSnapshotDenseArray(first, `${label} first collection`);
  const tail = buildSnapshotDenseArray(second, `${label} second collection`);
  for (let index = 0; index < tail.length; index += 1) {
    buildSecurityArrayAppend(
      result,
      tail[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  return result;
}

function buildFilterDense<Value, Narrowed extends Value>(
  values: readonly Value[],
  label: string,
  keep: (value: Value, index: number) => value is Narrowed,
): Narrowed[];
function buildFilterDense<Value>(
  values: readonly Value[],
  label: string,
  keep: (value: Value, index: number) => boolean,
): Value[];
function buildFilterDense<Value>(
  values: readonly Value[],
  label: string,
  keep: (value: Value, index: number) => boolean,
): Value[] {
  const source = buildSnapshotDenseArray(values, label);
  const result: Value[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (keep(source[index]!, index))
      buildSecurityArrayAppend(
        result,
        source[index]!,
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
  }
  return result;
}

function buildSomeDense<Value>(
  values: readonly Value[],
  label: string,
  predicate: (value: Value, index: number) => boolean,
): boolean {
  const source = buildSnapshotDenseArray(values, label);
  for (let index = 0; index < source.length; index += 1) {
    if (predicate(source[index]!, index)) return true;
  }
  return false;
}

function buildEveryDense<Value>(
  values: readonly Value[],
  label: string,
  predicate: (value: Value, index: number) => boolean,
): boolean {
  const source = buildSnapshotDenseArray(values, label);
  for (let index = 0; index < source.length; index += 1) {
    if (!predicate(source[index]!, index)) return false;
  }
  return true;
}

function buildFindDense<Value>(
  values: readonly Value[],
  label: string,
  predicate: (value: Value, index: number) => boolean,
): Value | undefined {
  const source = buildSnapshotDenseArray(values, label);
  for (let index = 0; index < source.length; index += 1) {
    if (predicate(source[index]!, index)) return source[index]!;
  }
  return undefined;
}

function buildJoinStrings(values: readonly string[], separator: string, label: string): string {
  return buildArrayJoin(buildSnapshotDenseArray(values, label), separator);
}

function appendDense<Value>(
  first: readonly Value[],
  second: readonly Value[],
  label: string,
): Value[] {
  const result = buildSnapshotDenseArray(first, `${label} first values`);
  const tail = buildSnapshotDenseArray(second, `${label} second values`);
  for (let index = 0; index < tail.length; index += 1)
    buildSecurityArrayAppend(
      result,
      tail[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  return result;
}

function buildPathSegments(value: string): string[] {
  const slashSegments = buildStringSplit(value, '/');
  const result: string[] = [];
  for (let index = 0; index < slashSegments.length; index += 1) {
    const segments = buildStringSplit(slashSegments[index]!, '\\');
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      buildSecurityArrayAppend(
        result,
        segments[segmentIndex]!,
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
    }
  }
  return result;
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
  vite?: boolean;
}

type ExportArgParseResult =
  | { ok: true; options: KovoExportOptions }
  | { message: string; ok: false };

type KovoBuildPresetName = 'cloudflare' | 'node' | 'vercel';
type ExportStaticApp = (typeof import('@kovojs/server/internal/static-export'))['exportStaticApp'];

export interface KovoBuildOptions {
  appModulePath: string;
  cache: boolean;
  check: boolean;
  outDir: string;
  preset?: KovoBuildPresetName;
}

export interface KovoSourceCheckOptions {
  appModulePath: string;
  cache: boolean;
}

export interface KovoSourceCheckOneShotAnalysis {
  readonly approvedConfig?: KovoBuildOneShotApprovedConfig;
  readonly artifactProvenance: ReturnType<typeof resolveKovoArtifactProvenance>;
  readonly devexCheckGraphDigest?: string;
  readonly diagnosticSourceFacts: readonly KovoCheckDiagnosticSourceFact[];
  readonly graph: CoreGraph.KovoCheckInput;
  readonly phaseCensus?: KovoSourceCheckPhaseCensus;
  readonly sourceFiles: readonly BuildCheckSourceFile[];
}

export interface KovoBuildOneShotApprovedConfig {
  readonly files: readonly BuildCheckSourceFile[];
  readonly path: string;
}

/** Serializable proof output from the fresh one-shot analysis process. */
export interface KovoBuildOneShotAnalysis {
  readonly approvedConfig?: KovoBuildOneShotApprovedConfig;
  readonly approvedSourceFiles: readonly BuildCheckSourceFile[];
  readonly artifactProvenance: ReturnType<typeof resolveKovoArtifactProvenance>;
  readonly buildStylesheetCss: Awaited<ReturnType<typeof kovoBuildStylesheetCss>>;
  readonly checkGraph: CoreGraph.KovoCheckInput;
  readonly clientEntry?: BuildCheckSourceFile;
  readonly dependencyCapabilities: AppDependencyCapabilityManifest;
  readonly queryShapeFacts: readonly QueryShapeFact[];
  readonly runtimeRegistry: KovoBuildCheckArtifacts['runtimeRegistry'];
  readonly selectedPresetName: KovoBuildPresetName;
  readonly sourceDerivedRegistryTransforms: readonly SourceDerivedRegistryTransform[];
}

export interface KovoBuildOneShotClientPhase {
  readonly appBuildToken: string;
  readonly buildCssAssets: KovoBuildStylesheetAssets;
  readonly clientBuild: KovoClientManifestBuild;
  readonly clientBuildClientModuleRoles: readonly CompilerOwnedViteClientModuleRole[];
  readonly commonRuntimeRegistry: Partial<RuntimeRegistryWireFacts>;
  readonly completedCheckGraph: CoreGraph.KovoCheckInput;
  readonly discoveredServerClientModules: readonly KovoAppShellCompiledClientModule[];
  readonly discoveredServerClientModuleRoles: readonly CompilerOwnedViteClientModuleRole[];
  readonly manualClientModules: readonly { readonly path: string; readonly source: string }[];
  readonly nonCompilerClientModules: readonly { readonly path: string; readonly source: string }[];
  readonly selectedPresetName: KovoBuildPresetName;
  readonly serverProjectMutationFacts: ProjectMutationRegistryFacts;
  readonly transaction: KovoBuildOutputTransaction;
}

export interface KovoBuildOneShotServerPhase {
  readonly clientModules: readonly KovoAppShellCompiledClientModule[];
  readonly clientModuleRoles: readonly CompilerOwnedViteClientModuleRole[];
  readonly serverHandlerSource: string;
}

interface LoadedBuildAppModule {
  appModule: unknown;
  compilerClientModuleBuildInstaller: CompilerClientModuleBuildInstaller;
  serverBuildModule: typeof import('@kovojs/server/build');
  serverBuildPresetModule: typeof import('@kovojs/server/internal/build-preset');
  serverExecutionModule: typeof import('@kovojs/server/internal/execution');
  serverInternalBuildModule: typeof import('@kovojs/server/internal/build');
}

type BuildExecutionModule = Pick<
  typeof import('@kovojs/server/internal/execution'),
  | 'accessDecisionFor'
  | 'accessFactsFromApp'
  | 'appEgressPosture'
  | 'authorizationCorrespondenceFactsFromApp'
  | 'explainGuard'
  | 'guardAuditName'
>;

interface LoadedExportAppModule {
  appModule: unknown;
  close?: () => Promise<void>;
  exportStaticApp: ExportStaticApp;
  isStaticExportDiagnostic: (value: unknown) => boolean;
  isStaticExportDiagnosticError: (value: unknown) => boolean;
  staticExportCompileDiagnosticsFromModule: (
    moduleValue: unknown,
  ) => StaticExportCompileDiagnostic[];
  resolveKovoAppToken: typeof import('@kovojs/server/internal/build').resolveKovoAppToken;
}

export interface KovoExportCommandResult extends KovoCheckResult {
  staticExport: StaticExportResult;
}

type BuildArgParseResult =
  | { format: KovoDiagnosticFormat; ok: true; options: KovoBuildOptions }
  | { message: string; ok: false };

interface LoadedKovoBuildConfig {
  path?: string;
  preset?: KovoBuildPreset;
}

interface SelectedKovoBuildPreset {
  name: KovoBuildPresetName;
  preset?: KovoBuildPreset;
}

export function parseBuildArgs(args: readonly string[]): BuildArgParseResult {
  const parsed = parseKovoCommandInvocation('build', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };
  const appModule = parsed.value.arguments.appModule;
  const preset = parsed.value.options.preset;

  return {
    format: parsed.value.options.format,
    ok: true,
    options: {
      appModulePath: appModule,
      cache: parsed.value.options.cache,
      check: parsed.value.options.check,
      outDir: parsed.value.options.out,
      ...(preset === undefined ? {} : { preset }),
    },
  };
}

function parseKovoBuildPresetName(value: string): KovoBuildPresetName | undefined {
  return value === 'node' || value === 'vercel' || value === 'cloudflare' ? value : undefined;
}

export function parseExportArgs(args: readonly string[]): ExportArgParseResult {
  const parsed = parseKovoCommandInvocation('export', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };
  const appModule = parsed.value.arguments.appModule;
  const {
    assetBase,
    dist: distDir,
    manifest: manifestFile,
    origin,
    root,
    vite,
  } = parsed.value.options;
  const onNonExportable = parsed.value.options.skipNonExportable ? ('skip' as const) : undefined;

  return {
    ok: true,
    options: {
      appModulePath: appModule,
      ...(assetBase === undefined ? {} : { assetBase }),
      ...(distDir === undefined ? {} : { distDir }),
      ...(manifestFile === undefined ? {} : { manifestFile }),
      ...(onNonExportable === undefined ? {} : { onNonExportable }),
      ...(origin === undefined ? {} : { origin }),
      outDir: parsed.value.options.out,
      ...(root === undefined ? {} : { root }),
      ...(vite ? { vite } : {}),
    },
  };
}

/**
 * Derive the complete standalone verification result from current authored source.
 *
 * This intentionally stops before preset selection, neutral/deploy artifact emission, and preset
 * inspection. Those deployment proofs—including SPEC §14 retention/KV417—remain owned by
 * {@link runBuildCommand}. The source command still runs the same TypeScript, compiler, static
 * security, graph, fixpoint, render-equivalence, and cache-freshness work that build consumes.
 */
export async function runSourceCheckCommand(
  options: KovoSourceCheckOptions,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<CliCommandResult> {
  const analysis = await produceKovoSourceCheckOneShotAnalysis(options, security);
  if ('exitCode' in analysis) return analysis;
  return finishKovoSourceCheckOneShot(
    options,
    analysis,
    kovoSourceCheckOneShotIdentity(options, analysis, security),
    security,
  );
}

export async function produceKovoSourceCheckOneShotAnalysis(
  options: KovoSourceCheckOptions,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<KovoSourceCheckOneShotAnalysis | CliCommandResult> {
  try {
    options = configurationBoundary(() => snapshotKovoSourceCheckOptions(options));
    const invocationRoot = security.invocationCwd;
    const resolvedAppModulePath = resolve(invocationRoot, options.appModulePath);
    const phaseCensus = sourceCheckPhaseCensus(security.invocationEnv);
    assertReadableKovoInputFile(resolvedAppModulePath, 'kovo check app module');
    const strictLifecyclePolicy = declaresKovoLifecyclePolicy(invocationRoot);
    if (strictLifecyclePolicy) {
      const startedAt = startSourceCheckPhase(phaseCensus);
      const lifecyclePolicy = runLifecyclePolicyCheck(invocationRoot);
      if (lifecyclePolicy.exitCode !== 0) return lifecyclePolicy;
      recordSourceCheckPhase(phaseCensus, 'lifecycle-policy', 'executed', startedAt);
    } else {
      recordSourceCheckPhase(phaseCensus, 'lifecycle-policy', 'not-applicable');
    }
    const configPath = findKovoBuildConfig(invocationRoot);
    if (configPath !== undefined) {
      assertReadableKovoInputFile(configPath, 'kovo check config');
    }

    let approvedConfig: PreEvaluationBuildConfigTrust | undefined;
    if (configPath !== undefined) {
      const startedAt = startSourceCheckPhase(phaseCensus);
      approvedConfig = await runPreEvaluationBuildConfigTrustPreflightInWorker(
        configPath,
        invocationRoot,
        security.paranoidStaticAdvisory,
        'check',
        security.invocationEnv,
      );
      recordSourceCheckPhase(phaseCensus, 'config-trust', 'executed', startedAt);
    } else {
      recordSourceCheckPhase(phaseCensus, 'config-trust', 'not-applicable');
    }

    // Keep the independent whole-project analyzers sequential and run them before allocating the
    // entry-reachable compiler graph. A copied catalog is deliberately outside that closure, but
    // TypeScript, formatting, and lint still inspect it. Retaining both heaps made valid
    // 44-component apps exceed 2 GiB even when the processes did not overlap.
    const typescriptStartedAt = startSourceCheckPhase(phaseCensus);
    const typescriptExecuted = await runTypeScriptBuildPreflight(
      resolvedAppModulePath,
      invocationRoot,
      security.invocationEnv,
      'check',
    );
    recordSourceCheckPhase(
      phaseCensus,
      'typescript',
      typescriptExecuted ? 'executed' : 'not-applicable',
      typescriptStartedAt,
    );
    if (strictLifecyclePolicy) {
      const projectQualityStartedAt = startSourceCheckPhase(phaseCensus);
      const projectQuality = await runProjectQualityCheck(
        invocationRoot,
        security.invocationEnv,
        'kovo-check/v1',
      );
      if (projectQuality.exitCode !== 0) return projectQuality;
      recordSourceCheckPhase(phaseCensus, 'project-quality', 'executed', projectQualityStartedAt);
      const soundSubsetStartedAt = startSourceCheckPhase(phaseCensus);
      const soundSubset = await runSoundSubsetCheck(
        invocationRoot,
        security.invocationEnv,
        'kovo-check/v1',
      );
      if (soundSubset.exitCode !== 0) return soundSubset;
      recordSourceCheckPhase(phaseCensus, 'sound-subset', 'executed', soundSubsetStartedAt);
    } else {
      recordSourceCheckPhase(phaseCensus, 'project-quality', 'not-applicable');
      recordSourceCheckPhase(phaseCensus, 'sound-subset', 'not-applicable');
    }

    // SPEC §6.6 rule 6: source checking evaluates the same authored authority as build. Capture
    // source/config authority before any authored module is evaluated, but only after independent
    // process preflights have exited and released their bounded heaps.
    const sessionAuthorityStartedAt = startSourceCheckPhase(phaseCensus);
    const reachableSessionAuthorityFacts =
      await sessionAuthorityFactsFromEntry(resolvedAppModulePath);
    recordSourceCheckPhase(phaseCensus, 'session-authority', 'executed', sessionAuthorityStartedAt);

    const artifacts = await deriveCurrentSourceCheckArtifacts(
      resolvedAppModulePath,
      options.cache,
      reachableSessionAuthorityFacts,
      security,
      invocationRoot,
      phaseCensus,
    );
    return {
      ...(approvedConfig === undefined
        ? {}
        : {
            approvedConfig: {
              files: approvedConfig.files,
              path: approvedConfig.path,
            },
          }),
      artifactProvenance: resolveKovoArtifactProvenance({
        appModulePath: resolvedAppModulePath,
      }),
      ...(artifacts.devexCheckGraphDigest === undefined
        ? {}
        : { devexCheckGraphDigest: artifacts.devexCheckGraphDigest }),
      diagnosticSourceFacts: artifacts.diagnosticSourceFacts,
      graph: artifacts.graph,
      ...(phaseCensus === undefined ? {} : { phaseCensus }),
      sourceFiles: artifacts.sourceFiles,
    };
  } catch (error) {
    return sourceCheckErrorResult(error);
  }
}

export function kovoSourceCheckOneShotIdentity(
  inputOptions: KovoSourceCheckOptions,
  analysis: KovoSourceCheckOneShotAnalysis,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): KovoBuildOneShotIdentity {
  const options = configurationBoundary(() => snapshotKovoSourceCheckOptions(inputOptions));
  const invocationRoot = realpathSync(security.invocationCwd);
  return {
    appModulePath: slashPath(
      relative(invocationRoot, resolve(invocationRoot, options.appModulePath)),
    ),
    compilerProvenanceDigest: kovoBuildOneShotDigest(analysis.artifactProvenance),
    configSourceDigest:
      analysis.approvedConfig === undefined
        ? null
        : kovoBuildOneShotDigest({
            files: analysis.approvedConfig.files,
            path: slashPath(relative(invocationRoot, analysis.approvedConfig.path)),
          }),
    invocationRoot,
    optionsDigest: kovoBuildOneShotDigest(options),
    sourceSetDigest: kovoBuildOneShotDigest(analysis.sourceFiles),
  };
}

export async function finishKovoSourceCheckOneShot(
  inputOptions: KovoSourceCheckOptions,
  inputAnalysis: unknown,
  expectedIdentity: KovoBuildOneShotIdentity,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<CliCommandResult> {
  try {
    const options = configurationBoundary(() => snapshotKovoSourceCheckOptions(inputOptions));
    const analysis = requireKovoSourceCheckOneShotAnalysis(inputAnalysis);
    const invocationRoot = realpathSync(security.invocationCwd);
    const resolvedAppModulePath = resolve(invocationRoot, options.appModulePath);
    const currentProvenance = resolveKovoArtifactProvenance({
      appModulePath: resolvedAppModulePath,
    });
    if (
      kovoBuildOneShotDigest(currentProvenance) !==
      kovoBuildOneShotDigest(analysis.artifactProvenance)
    ) {
      throw new TypeError('Kovo check handoff compiler provenance is stale.');
    }
    const configPath = findKovoBuildConfig(invocationRoot);
    revalidateKovoBuildConfigTrustSourceSnapshot(
      analysis.approvedConfig,
      invocationRoot,
      configPath,
      'check',
    );
    for (let index = 0; index < analysis.sourceFiles.length; index += 1) {
      const file = analysis.sourceFiles[index]!;
      if (readFileSync(resolve(invocationRoot, file.fileName), 'utf8') !== file.source) {
        throw new TypeError(`Kovo check handoff source ${file.fileName} is stale.`);
      }
    }
    const currentIdentity = kovoSourceCheckOneShotIdentity(options, analysis, security);
    if (buildJsonStringify(currentIdentity) !== buildJsonStringify(expectedIdentity)) {
      throw new TypeError('Kovo check handoff invocation identity changed before consumption.');
    }
    const phaseCensus =
      analysis.phaseCensus === undefined
        ? undefined
        : {
            phases: buildMapDense(
              analysis.phaseCensus.phases,
              'Kovo check handoff phase census',
              (phase) => ({ ...phase }),
            ),
            sourcePath: analysis.phaseCensus.sourcePath,
          };
    const graphDiagnosticsStartedAt = startSourceCheckPhase(phaseCensus);
    const result = kovoCheckWithDiagnosticSourceCatalog(
      analysis.graph,
      { paranoidStaticAdvisory: security.paranoidStaticAdvisory },
      createKovoCheckDiagnosticSourceCatalog(analysis.diagnosticSourceFacts),
    );
    recordSourceCheckPhase(phaseCensus, 'graph-diagnostics', 'executed', graphDiagnosticsStartedAt);
    return appendSourceCheckPhaseCensus(result, phaseCensus, {
      ...(analysis.devexCheckGraphDigest === undefined
        ? {}
        : { devexCheckGraphDigest: analysis.devexCheckGraphDigest }),
      sourceFiles: analysis.sourceFiles,
    });
  } catch (error) {
    return sourceCheckErrorResult(error);
  }
}

/** @internal Transaction state exported only for adversarial CLI tests. */
export interface KovoBuildOutputTransaction {
  readonly buildId: string;
  readonly finalOutDir: string;
  readonly stagedOutDir: string;
  promoted: boolean;
}

/** @internal */
export function createKovoBuildOutputTransaction(finalOutDir: string): KovoBuildOutputTransaction {
  // SPEC §5.2.4: all deploy bytes are assembled under one unique same-project directory. The
  // requested output remains untouched until the complete preset artifact is ready.
  const parent = dirname(finalOutDir);
  mkdirSync(parent, { recursive: true });
  // A sibling stage guarantees the final rename stays on one filesystem even when --out is
  // outside the invocation root.
  const stagedOutDir = mkdtempSync(join(parent, '.kovo-build-stage-'));
  return {
    buildId: basename(stagedOutDir),
    finalOutDir,
    promoted: false,
    stagedOutDir,
  };
}

/** @internal */
export function promoteKovoBuildOutputTransaction(transaction: KovoBuildOutputTransaction): void {
  if (transaction.promoted) {
    throw new TypeError('Kovo build output transaction was already promoted.');
  }
  const parent = dirname(transaction.finalOutDir);
  mkdirSync(parent, { recursive: true });
  const backup = `${transaction.stagedOutDir}-last-good`;
  const hadPrevious = existsSync(transaction.finalOutDir);
  if (hadPrevious) renameSync(transaction.finalOutDir, backup);
  try {
    renameSync(transaction.stagedOutDir, transaction.finalOutDir);
    transaction.promoted = true;
  } catch (error) {
    if (hadPrevious && existsSync(backup) && !existsSync(transaction.finalOutDir)) {
      renameSync(backup, transaction.finalOutDir);
    }
    throw error;
  }
  if (hadPrevious) {
    // The new output is already committed. Backup cleanup is deliberately best-effort so an
    // inability to remove old bytes cannot relabel a successfully promoted build as failed.
    try {
      rmSync(backup, { force: true, recursive: true });
    } catch {
      // A sibling last-good backup is not deploy output and remains safe to remove manually.
    }
  }
}

/** @internal */
export function abortKovoBuildOutputTransaction(transaction: KovoBuildOutputTransaction): void {
  if (transaction.promoted) return;
  rmSync(transaction.stagedOutDir, { force: true, recursive: true });
}

/** @internal Persist only framework-owned, non-secret facts for an explicitly requested failure. */
export function writeKovoBuildDebugEvidence(
  transaction: KovoBuildOutputTransaction,
  error: unknown,
  security: KovoCommandSecurityDisposition,
): void {
  if (kovoInvocationEnvironmentValue(security.invocationEnv, 'KOVO_BUILD_DEBUG') !== '1') return;
  const debugDir = join(security.invocationCwd, '.kovo', 'debug', transaction.buildId);
  mkdirSync(debugDir, { recursive: true });
  writeFileSync(
    join(debugDir, 'build.json'),
    `${stringifyBuildValue(
      {
        buildId: transaction.buildId,
        errorClass: error instanceof KovoCommandConfigurationError ? 'configuration' : 'finding',
        message:
          'Kovo build failed before output promotion; rerun the same command for the producer-owned diagnostic.',
        schema: 'kovo.build-debug/v1',
        status: 'failed',
      },
      2,
    )}\n`,
    'utf8',
  );
}

/**
 * Run every diagnostic-producing source phase in a disposable process and return only immutable
 * data required by deployment compilation. Authored app/config objects and their Vite graph never
 * cross this boundary.
 */
export async function produceKovoBuildOneShotAnalysis(
  inputOptions: KovoBuildOptions,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<KovoBuildOneShotAnalysis | CliCommandResult> {
  try {
    const options = configurationBoundary(() => snapshotKovoBuildOptions(inputOptions));
    const invocationRoot = security.invocationCwd;
    const resolvedAppModulePath = resolve(invocationRoot, options.appModulePath);
    assertReadableKovoInputFile(resolvedAppModulePath, 'kovo build app module');
    const strictLifecyclePolicy = declaresKovoLifecyclePolicy(invocationRoot);
    if (strictLifecyclePolicy) {
      const lifecyclePolicy = runLifecyclePolicyCheck(invocationRoot, 'kovo-build/v1');
      if (lifecyclePolicy.exitCode !== 0) return lifecyclePolicy;
    }
    const outDir = resolve(invocationRoot, options.outDir);
    assertKovoOutputDirectoryTarget(outDir, 'kovo build --out');
    const configPath = findKovoBuildConfig(invocationRoot);
    if (configPath !== undefined) {
      assertReadableKovoInputFile(configPath, 'kovo build config');
    }
    const artifactProvenance = resolveKovoArtifactProvenance({
      appModulePath: resolvedAppModulePath,
    });
    const approvedConfig =
      configPath === undefined
        ? undefined
        : await runPreEvaluationBuildConfigTrustPreflightInWorker(
            configPath,
            invocationRoot,
            security.paranoidStaticAdvisory,
            'build',
            security.invocationEnv,
          );
    await runTypeScriptBuildPreflight(
      resolvedAppModulePath,
      invocationRoot,
      security.invocationEnv,
    );
    if (strictLifecyclePolicy) {
      const projectQuality = await runProjectQualityCheck(
        invocationRoot,
        security.invocationEnv,
        'kovo-build/v1',
      );
      if (projectQuality.exitCode !== 0) return projectQuality;
      const soundSubset = await runSoundSubsetCheck(
        invocationRoot,
        security.invocationEnv,
        'kovo-build/v1',
      );
      if (soundSubset.exitCode !== 0) return soundSubset;
    }

    const reachableSessionAuthorityFacts =
      await sessionAuthorityFactsFromEntry(resolvedAppModulePath);
    const loadedConfig = await configurationBoundaryAsync(() =>
      loadKovoBuildConfig(invocationRoot, resolvedAppModulePath, approvedConfig),
    );
    const selectedPreset = configurationBoundary(() =>
      selectedKovoBuildPreset(options, loadedConfig.preset, security.invocationEnv),
    );
    const loadAndCheck = await loadAndCheckBuildApp(
      resolvedAppModulePath,
      options,
      reachableSessionAuthorityFacts,
      security,
      invocationRoot,
    );
    return {
      ...(approvedConfig === undefined
        ? {}
        : {
            approvedConfig: {
              files: approvedConfig.files,
              path: approvedConfig.path,
            },
          }),
      approvedSourceFiles: loadAndCheck.approvedSourceFiles,
      artifactProvenance,
      buildStylesheetCss: loadAndCheck.buildStylesheetCss,
      checkGraph: loadAndCheck.checkGraph,
      ...(loadAndCheck.approvedClientEntry === undefined
        ? {}
        : { clientEntry: loadAndCheck.approvedClientEntry }),
      dependencyCapabilities: loadAndCheck.dependencyCapabilities,
      queryShapeFacts: loadAndCheck.queryShapeFacts,
      runtimeRegistry: loadAndCheck.runtimeRegistry,
      selectedPresetName: selectedPreset.name,
      sourceDerivedRegistryTransforms: loadAndCheck.sourceDerivedRegistryTransforms,
    };
  } catch (error) {
    return buildErrorResult(error);
  }
}

/** Derive the invocation identity sent over the producer's private control pipe. */
export function kovoBuildOneShotIdentity(
  inputOptions: KovoBuildOptions,
  analysis: KovoBuildOneShotAnalysis,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): KovoBuildOneShotIdentity {
  const options = configurationBoundary(() => snapshotKovoBuildOptions(inputOptions));
  const invocationRoot = realpathSync(security.invocationCwd);
  const appModulePath = slashPath(
    relative(invocationRoot, resolve(invocationRoot, options.appModulePath)),
  );
  return {
    appModulePath,
    compilerProvenanceDigest: kovoBuildOneShotDigest(analysis.artifactProvenance),
    configSourceDigest:
      analysis.approvedConfig === undefined
        ? null
        : kovoBuildOneShotDigest({
            files: analysis.approvedConfig.files,
            path: slashPath(relative(invocationRoot, analysis.approvedConfig.path)),
          }),
    invocationRoot,
    optionsDigest: kovoBuildOneShotDigest(options),
    sourceSetDigest: kovoBuildOneShotDigest({
      clientEntry: analysis.clientEntry ?? null,
      files: analysis.approvedSourceFiles,
    }),
  };
}

export async function runBuildCommand(
  options: KovoBuildOptions,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<CliCommandResult> {
  let transaction: KovoBuildOutputTransaction | undefined;
  try {
    options = configurationBoundary(() => snapshotKovoBuildOptions(options));
    const invocationRoot = security.invocationCwd;
    const resolvedAppModulePath = resolve(invocationRoot, options.appModulePath);
    assertReadableKovoInputFile(resolvedAppModulePath, 'kovo build app module');
    const strictLifecyclePolicy = declaresKovoLifecyclePolicy(invocationRoot);
    if (strictLifecyclePolicy) {
      const lifecyclePolicy = runLifecyclePolicyCheck(invocationRoot, 'kovo-build/v1');
      if (lifecyclePolicy.exitCode !== 0) return lifecyclePolicy;
    }
    const outDir = resolve(invocationRoot, options.outDir);
    assertKovoOutputDirectoryTarget(outDir, 'kovo build --out');
    const configPath = findKovoBuildConfig(invocationRoot);
    if (configPath !== undefined) {
      assertReadableKovoInputFile(configPath, 'kovo build config');
    }
    // SPEC §5.2.3: capture path-free artifact identity inputs before config or app evaluation.
    // The resulting stamp identifies the exact lock bytes, shipped guarantee register, graph
    // schema, and resolved Kovo package versions that were in force for this build.
    const artifactProvenance = resolveKovoArtifactProvenance({
      appModulePath: resolvedAppModulePath,
    });
    const approvedConfig =
      configPath === undefined
        ? undefined
        : await runPreEvaluationBuildConfigTrustPreflightInWorker(
            configPath,
            invocationRoot,
            security.paranoidStaticAdvisory,
            'build',
            security.invocationEnv,
          );
    // Run independent whole-project analyzers before allocating the entry-reachable compiler graph
    // or evaluating approved config. Copy-in source still participates in TypeScript, formatting,
    // lint, and sound-subset proof; retaining compiler/Vite state while the formatter ran made
    // otherwise valid catalogs exceed the 2 GiB first-loop ceiling. TypeScript remains first so
    // the established type-error-first contract holds.
    await runTypeScriptBuildPreflight(
      resolvedAppModulePath,
      invocationRoot,
      security.invocationEnv,
    );
    if (strictLifecyclePolicy) {
      const projectQuality = await runProjectQualityCheck(
        invocationRoot,
        security.invocationEnv,
        'kovo-build/v1',
      );
      if (projectQuality.exitCode !== 0) return projectQuality;
      const soundSubset = await runSoundSubsetCheck(
        invocationRoot,
        security.invocationEnv,
        'kovo-build/v1',
      );
      if (soundSubset.exitCode !== 0) return soundSubset;
    }
    transaction = createKovoBuildOutputTransaction(outDir);
    const stagedOutDir = transaction.stagedOutDir;
    // Keep graph derivation, compiler transforms, and Vite discovery in a closed lexical lifetime.
    // Preset inspection/emission needs only the completed neutral artifact and handler bytes. If
    // these project-owned intermediates remain live in runBuildCommand's frame, V8 retains the
    // TypeScript/compiler/Vite graphs through preset emission and a valid packed catalog exceeds
    // the reviewed 2 GiB process-tree ceiling even though copied-but-unimported files never enter
    // the app closure (SPEC §5.2 rules 6/9; §11.4).
    const preparedEmission = await (async () => {
      // SPEC §6.6 rule 6: classify app-authored authority before config, plugins, or app evaluation
      // can mutate shared-realm prototypes. Runtime handler identity is joined after evaluation.
      const reachableSessionAuthorityFacts =
        await sessionAuthorityFactsFromEntry(resolvedAppModulePath);
      const loadedConfig = await configurationBoundaryAsync(() =>
        loadKovoBuildConfig(invocationRoot, resolvedAppModulePath, approvedConfig),
      );
      const selectedPreset = configurationBoundary(() =>
        selectedKovoBuildPreset(options, loadedConfig.preset, security.invocationEnv),
      );
      // plans/fast-kovo-check2.md (#A dedup): the module/css loads below spin up throwaway vite dev
      // servers purely to evaluate app source so we can derive the build graph and collect CSS. The
      // app's `@kovojs/server` vite plugin would otherwise re-run the whole-project drizzle data-plane
      // analysis in each — the SAME analysis runKovoBuildCheckPreflight runs authoritatively just
      // below — costing ~9s of duplicate ts-morph work cold. Flag the entire (concurrent) load span so
      // the plugin skips it; the production client/server build passes run with the flag cleared, so
      // their fail-closed gate still fires.
      const loadAndCheck = await loadAndCheckBuildApp(
        resolvedAppModulePath,
        options,
        reachableSessionAuthorityFacts,
        security,
        invocationRoot,
      );
      const {
        app,
        approvedClientEntry,
        approvedSourceFiles,
        buildStylesheetCss,
        checkGraph,
        cloudflare,
        compilerClientModuleBuildInstaller,
        dependencyCapabilities,
        declaredKovoAppId,
        deriveClosedKovoApp,
        node,
        queryShapeFacts,
        resolveKovoBuildPreset,
        snapshotVersionedClientModuleStaging,
        vercel,
        writeKovoNeutralBuild,
      } = loadAndCheck;
      const graphWithProvenance: CoreGraph.KovoCheckInput = {
        ...checkGraph,
        analysisInputs: buildAnalysisInputs({
          appSources: approvedSourceFiles,
          clientEntrySources: approvedClientEntry === undefined ? [] : [approvedClientEntry],
          configSources: approvedConfig?.files ?? [],
          runtimeTarget: selectedPreset.name,
        }),
        provenance: artifactProvenance,
      };
      const clientRoot = kovoClientBuildRoot(resolvedAppModulePath, invocationRoot);
      const clientProjectMutationFacts = projectMutationRegistryFactsForBuild(
        resolvedAppModulePath,
        clientRoot,
        approvedSourceFiles,
        invocationRoot,
      );
      const serverProjectMutationFacts = projectMutationRegistryFactsForBuild(
        resolvedAppModulePath,
        invocationRoot,
        approvedSourceFiles,
      );
      // Reuse the exact entry-reachable source proof. Re-censusing dirname(app) here used to admit
      // and repeatedly analyze every unimported copied UI module, making the documented full-catalog
      // workflow exceed 6 GiB process-tree RSS. The preflight-derived registry is both narrower and
      // stronger: Vite below rejects any later module load outside the same immutable snapshot
      // (SPEC §5.2 rules 6/9; §11.4).
      const staticRuntimeRegistry = loadAndCheck.runtimeRegistry;
      if (app.document.csp !== undefined) {
        assertDocumentCspConfigMatchesBrowserPosture(
          app.document.csp,
          staticRuntimeRegistry.browserPosture,
        );
      }
      const clientBuild = await buildKovoClientManifest(
        join(stagedOutDir, '.kovo-client'),
        clientRoot,
        resolvedAppModulePath,
        {
          ...(approvedClientEntry === undefined ? {} : { approvedClientEntry }),
          approvedSourceFiles,
          cache: options.cache,
          dependencyCapabilities,
          projectMutationFacts: clientProjectMutationFacts,
          queryShapeFacts,
          sourceIdentityRoot: invocationRoot,
        },
      );
      const buildCssAssets = mergeKovoBuildStylesheetAssets([
        buildStylesheetCss.assets,
        clientBuild.assets,
      ]);
      const buildApp = appWithBuildStylesheetAssets(app, buildCssAssets, deriveClosedKovoApp);
      const commonRuntimeRegistry = {
        ...(staticRuntimeRegistry.browserPosture === undefined
          ? {}
          : { browserPosture: staticRuntimeRegistry.browserPosture }),
        ...(staticRuntimeRegistry.tableSecurity === undefined
          ? {}
          : { tableSecurity: staticRuntimeRegistry.tableSecurity }),
      };
      // SPEC §5.2 rules 1/6/9: replay only the immutable approved sources that the already-required
      // app component scan actually reached. The former discovery server bundle rebuilt the entire
      // SSR graph only to read this compiler-owned result, retaining another Vite/Rollup graph
      // beside the final bundle and pushing valid copy-in catalogs over the 2 GiB ceiling. The
      // final runtime-posture bundle below remains an independent compilation and must retain exact
      // path/representation/fingerprint/role equality before any artifact is promoted.
      const discoveredServerClientModules = await compilerClientModulesFromApprovedSources(
        resolvedAppModulePath,
        {
          approvedSourceFiles: clientBuild.appCompilerSourceFiles,
          buildRoot: invocationRoot,
          projectMutationFacts: serverProjectMutationFacts,
          queryShapeFacts,
        },
      );
      const discoveredClientModules = uniqueKovoCompiledClientModules([
        ...clientBuild.clientModules,
        ...discoveredServerClientModules,
      ]);
      const appClientModuleStaging = snapshotVersionedClientModuleStaging(buildApp.clientModules);
      const hasGeneratedAppBootstrap = buildSomeDense(
        discoveredClientModules,
        'discovered compiler client modules',
        (module) => compilerOwnedViteClientModuleRole(module) === 'app-bootstrap',
      );
      const nonCompilerClientModules = hasGeneratedAppBootstrap
        ? appClientModuleStaging.stable
        : appendDense(
            appClientModuleStaging.stable,
            appClientModuleStaging.mandatory,
            'build app stable and mandatory client modules',
          );
      const appBuildToken = deriveKovoAppBuildToken(
        discoveredClientModules,
        nonCompilerClientModules,
      );
      const graphWithProof: CoreGraph.KovoCheckInput = {
        ...graphWithProvenance,
        proof: createKovoGraphProof(graphWithProvenance, appBuildToken, declaredKovoAppId(app)),
      };
      const runtimePosture = createKovoRuntimePostureManifest(graphWithProof);
      const completedCheckGraph: CoreGraph.KovoCheckInput = {
        ...graphWithProof,
        runtimePosture,
      };
      const serverHandlerBuild = await bundleKovoServerHandler(resolvedAppModulePath, {
        approvedSourceFiles,
        buildRoot: invocationRoot,
        dependencyCapabilities,
        projectMutationFacts: serverProjectMutationFacts,
        queryShapeFacts,
        runtimeTarget: selectedPreset.name,
        runtimeRegistry: {
          ...runtimeRegistryWireFactsFromGraph(completedCheckGraph),
          ...commonRuntimeRegistry,
        },
        generatedClientModules: discoveredClientModules,
        manualClientModules: appClientModuleStaging.stable,
        stylesheetAssets: buildCssAssets,
      });
      const clientModules = finalCompilerClientModulesFromBuildPasses(
        clientBuild.clientModules,
        discoveredServerClientModules,
        serverHandlerBuild.clientModules,
      );
      if (deriveKovoAppBuildToken(clientModules, nonCompilerClientModules) !== appBuildToken) {
        throw new TypeError(
          'Kovo final runtime-posture bundle changed the discovered client-module identity.',
        );
      }
      const neutralBuildClientModules = adoptCompilerClientModulesForNeutralBuild(
        clientModules,
        compilerClientModuleBuildInstaller,
      );
      const neutralBuild = await writeKovoNeutralBuild({
        app: buildApp,
        buildStylesheetCss: [...buildStylesheetCss.stylesheetCss, ...clientBuild.stylesheetCss],
        clientModules: neutralBuildClientModules,
        manifestFile: clientBuild.manifestFile,
        outDir: join(stagedOutDir, '.kovo'),
        serverHandlerSource: serverHandlerBuild.source,
        stylesheetSourceRoot: dirname(resolvedAppModulePath),
      });
      // Validate every trustedAssign review subject only after the deployment graph is complete.
      const escapeObligationManifest = escapeObligationManifestForBuild(completedCheckGraph);
      // Metric E signatures are a separate domain-separated subject family under the same anchor.
      const escapeCensusReviewManifest = escapeCensusReviewManifestForBuild(completedCheckGraph);
      writeKovoBuildGraphArtifact(
        neutralBuild,
        completedCheckGraph,
        escapeObligationManifest,
        escapeCensusReviewManifest,
      );
      const presetToken =
        selectedPreset.name === 'cloudflare'
          ? cloudflare()
          : selectedPreset.name === 'vercel'
            ? vercel()
            : node();
      const preset = selectedPreset.preset ?? resolveKovoBuildPreset(presetToken);
      if (preset === undefined) {
        throw new Error(
          `kovo build could not resolve framework-owned preset ${selectedPreset.name}.`,
        );
      }
      const presetOutDir = buildPresetOutDir(stagedOutDir, selectedPreset.name);
      const presetLogs: string[] = [];
      const serverHandlerSource = serverHandlerBuild.source;
      const declaredEnv = inferredKovoBuildDeclaredEnv(serverHandlerSource);
      const presetContext: KovoBuildPresetContext = {
        declaredEnv,
        log(message) {
          presetLogs.push(message);
        },
        outDir: presetOutDir,
        projectRoot: invocationRoot,
        readServerHandlerSource() {
          return serverHandlerSource;
        },
        readNeutral() {
          return neutralBuild;
        },
      };
      const presetDiagnostics = await inspectKovoBuildPreset(preset, neutralBuild, presetContext);
      const blockingDiagnostics = buildFilterDense(
        presetDiagnostics,
        'Build preset diagnostics',
        (diagnostic) => diagnostic.severity === 'error',
      );
      if (blockingDiagnostics.length > 0) {
        throw new KovoBuildPresetDiagnosticError(blockingDiagnostics);
      }
      return {
        neutralBuild,
        preset,
        presetContext,
        presetDiagnostics,
        presetLogs,
        selectedPresetName: selectedPreset.name,
      };
    })();
    const {
      neutralBuild,
      preset,
      presetContext,
      presetDiagnostics,
      presetLogs,
      selectedPresetName,
    } = preparedEmission;

    if (options.check) {
      // plans/fast-kovo-check2.md #6: validate-only. Every diagnostic-producing phase has
      // already run by this point — the tsc preflight, the kovo-check security gate
      // (which throws fail-closed on KV407/KV414/etc.), the client/server compiler transform
      // that raises KV235, and the preset inspection above. `--check` skips ONLY the
      // deployable `preset.emit`, so it is a strict subset of a full build and cannot pass
      // where a full build would fail.
      abortKovoBuildOutputTransaction(transaction);
      transaction = undefined;
      return kovoBuildCheckResult({
        appModulePath: resolvedAppModulePath,
        neutralOutDir: join(outDir, '.kovo'),
        preset: selectedPresetName,
        presetDiagnostics,
        presetLogs,
      });
    }

    await preset.emit(neutralBuild, presetContext);
    promoteKovoBuildOutputTransaction(transaction);
    transaction = undefined;

    return kovoBuildResult({
      appModulePath: resolvedAppModulePath,
      neutralOutDir: join(outDir, '.kovo'),
      outDir,
      preset: selectedPresetName,
      presetDiagnostics,
      presetLogs,
      serverOutDir: buildPresetOutDir(outDir, selectedPresetName),
    });
  } catch (error) {
    if (transaction !== undefined) {
      // Failed-build evidence and staging cleanup are secondary to the original diagnostic.
      // Neither may erase the producer-owned build failure if the local filesystem is unhealthy.
      try {
        writeKovoBuildDebugEvidence(transaction, error, security);
      } catch {
        // Debug evidence is opt-in and never part of deploy correctness.
      }
      try {
        abortKovoBuildOutputTransaction(transaction);
      } catch {
        // The unique sibling staging path is safe to remove manually.
      }
    }
    return buildErrorResult(error);
  }
}

export async function produceKovoBuildOneShotClientPhase(
  inputOptions: KovoBuildOptions,
  inputAnalysis: unknown,
  expectedIdentity: KovoBuildOneShotIdentity,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<KovoBuildOneShotClientPhase | CliCommandResult> {
  let transaction: KovoBuildOutputTransaction | undefined;
  try {
    const options = configurationBoundary(() => snapshotKovoBuildOptions(inputOptions));
    const analysis = requireKovoBuildOneShotAnalysis(inputAnalysis);
    const invocationRoot = security.invocationCwd;
    const resolvedAppModulePath = resolve(invocationRoot, options.appModulePath);
    assertReadableKovoInputFile(resolvedAppModulePath, 'kovo build app module');
    const outDir = resolve(invocationRoot, options.outDir);
    assertKovoOutputDirectoryTarget(outDir, 'kovo build --out');
    const currentConfig = await revalidateKovoBuildOneShotAnalysis(
      options,
      analysis,
      expectedIdentity,
      security,
      resolvedAppModulePath,
    );
    const loadedConfig = await configurationBoundaryAsync(() =>
      loadKovoBuildConfig(invocationRoot, resolvedAppModulePath, currentConfig),
    );
    const selectedPreset = configurationBoundary(() =>
      selectedKovoBuildPreset(options, loadedConfig.preset, security.invocationEnv),
    );
    if (selectedPreset.name !== analysis.selectedPresetName) {
      throw new TypeError('Kovo build handoff preset selection is stale.');
    }

    transaction = createKovoBuildOutputTransaction(outDir);
    const loadedBuildApp = await withBuildGraphDerivationContext(() =>
      loadBuildAppModule(
        resolvedAppModulePath,
        invocationRoot,
        analysis.approvedSourceFiles,
        analysis.dependencyCapabilities,
        analysis.sourceDerivedRegistryTransforms,
      ),
    );
    const { declaredKovoAppId, deriveClosedKovoApp, snapshotVersionedClientModuleStaging } =
      loadedBuildApp.serverInternalBuildModule;
    const app = appFromModule(
      loadedBuildApp.appModule,
      resolvedAppModulePath,
      loadedBuildApp.serverInternalBuildModule.resolveKovoAppToken,
    );
    const approvedClientEntry = analysis.clientEntry;
    const approvedSourceFiles = analysis.approvedSourceFiles;
    const graphWithProvenance: CoreGraph.KovoCheckInput = {
      ...analysis.checkGraph,
      analysisInputs: buildAnalysisInputs({
        appSources: approvedSourceFiles,
        clientEntrySources: approvedClientEntry === undefined ? [] : [approvedClientEntry],
        configSources: currentConfig?.files ?? [],
        runtimeTarget: selectedPreset.name,
      }),
      provenance: analysis.artifactProvenance,
    };
    const clientRoot = kovoClientBuildRoot(resolvedAppModulePath, invocationRoot);
    const clientProjectMutationFacts = projectMutationRegistryFactsForBuild(
      resolvedAppModulePath,
      clientRoot,
      approvedSourceFiles,
      invocationRoot,
    );
    const serverProjectMutationFacts = projectMutationRegistryFactsForBuild(
      resolvedAppModulePath,
      invocationRoot,
      approvedSourceFiles,
    );
    const staticRuntimeRegistry = analysis.runtimeRegistry;
    if (app.document.csp !== undefined) {
      assertDocumentCspConfigMatchesBrowserPosture(
        app.document.csp,
        staticRuntimeRegistry.browserPosture,
      );
    }
    const clientBuild = await buildKovoClientManifest(
      join(transaction.stagedOutDir, '.kovo-client'),
      clientRoot,
      resolvedAppModulePath,
      {
        ...(approvedClientEntry === undefined ? {} : { approvedClientEntry }),
        approvedSourceFiles,
        cache: options.cache,
        dependencyCapabilities: analysis.dependencyCapabilities,
        projectMutationFacts: clientProjectMutationFacts,
        queryShapeFacts: analysis.queryShapeFacts,
        sourceIdentityRoot: invocationRoot,
      },
    );
    const buildCssAssets = mergeKovoBuildStylesheetAssets([
      analysis.buildStylesheetCss.assets,
      clientBuild.assets,
    ]);
    const buildApp = appWithBuildStylesheetAssets(app, buildCssAssets, deriveClosedKovoApp);
    const commonRuntimeRegistry: Partial<RuntimeRegistryWireFacts> = {
      ...(staticRuntimeRegistry.browserPosture === undefined
        ? {}
        : { browserPosture: staticRuntimeRegistry.browserPosture }),
      ...(staticRuntimeRegistry.tableSecurity === undefined
        ? {}
        : { tableSecurity: staticRuntimeRegistry.tableSecurity }),
    };
    const discoveredServerClientModules = await compilerClientModulesFromApprovedSources(
      resolvedAppModulePath,
      {
        approvedSourceFiles: clientBuild.appCompilerSourceFiles,
        buildRoot: invocationRoot,
        projectMutationFacts: serverProjectMutationFacts,
        queryShapeFacts: analysis.queryShapeFacts,
      },
    );
    const discoveredClientModules = uniqueKovoCompiledClientModules([
      ...clientBuild.clientModules,
      ...discoveredServerClientModules,
    ]);
    const appClientModuleStaging = snapshotVersionedClientModuleStaging(buildApp.clientModules);
    const hasGeneratedAppBootstrap = buildSomeDense(
      discoveredClientModules,
      'discovered compiler client modules',
      (module) => compilerOwnedViteClientModuleRole(module) === 'app-bootstrap',
    );
    const nonCompilerClientModules = hasGeneratedAppBootstrap
      ? appClientModuleStaging.stable
      : appendDense(
          appClientModuleStaging.stable,
          appClientModuleStaging.mandatory,
          'build app stable and mandatory client modules',
        );
    const appBuildToken = deriveKovoAppBuildToken(
      discoveredClientModules,
      nonCompilerClientModules,
    );
    const graphWithProof: CoreGraph.KovoCheckInput = {
      ...graphWithProvenance,
      proof: createKovoGraphProof(graphWithProvenance, appBuildToken, declaredKovoAppId(app)),
    };
    const completedCheckGraph: CoreGraph.KovoCheckInput = {
      ...graphWithProof,
      runtimePosture: createKovoRuntimePostureManifest(graphWithProof),
    };
    const result: KovoBuildOneShotClientPhase = {
      appBuildToken,
      buildCssAssets,
      clientBuild,
      clientBuildClientModuleRoles: compilerClientModuleRoles(
        clientBuild.clientModules,
        'client-build compiler client modules',
      ),
      commonRuntimeRegistry,
      completedCheckGraph,
      discoveredServerClientModules,
      discoveredServerClientModuleRoles: compilerClientModuleRoles(
        discoveredServerClientModules,
        'discovered server compiler client modules',
      ),
      manualClientModules: appClientModuleStaging.stable,
      nonCompilerClientModules,
      selectedPresetName: selectedPreset.name,
      serverProjectMutationFacts,
      transaction,
    };
    transaction = undefined;
    return result;
  } catch (error) {
    if (transaction !== undefined) abortKovoBuildOutputTransaction(transaction);
    return buildErrorResult(error);
  }
}

export async function produceKovoBuildOneShotServerPhase(
  inputOptions: KovoBuildOptions,
  inputAnalysis: unknown,
  clientPhase: KovoBuildOneShotClientPhase,
  expectedIdentity: KovoBuildOneShotIdentity,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<KovoBuildOneShotServerPhase | CliCommandResult> {
  try {
    const options = configurationBoundary(() => snapshotKovoBuildOptions(inputOptions));
    const analysis = requireKovoBuildOneShotAnalysis(inputAnalysis);
    const invocationRoot = security.invocationCwd;
    const resolvedAppModulePath = resolve(invocationRoot, options.appModulePath);
    await revalidateKovoBuildOneShotAnalysis(
      options,
      analysis,
      expectedIdentity,
      security,
      resolvedAppModulePath,
    );
    if (clientPhase.selectedPresetName !== analysis.selectedPresetName) {
      throw new TypeError('Kovo build client phase selected a stale preset.');
    }
    const serverHandlerBuild = await bundleKovoServerHandler(resolvedAppModulePath, {
      approvedSourceFiles: analysis.approvedSourceFiles,
      buildRoot: invocationRoot,
      dependencyCapabilities: analysis.dependencyCapabilities,
      projectMutationFacts: clientPhase.serverProjectMutationFacts,
      queryShapeFacts: analysis.queryShapeFacts,
      runtimeTarget: clientPhase.selectedPresetName,
      runtimeRegistry: {
        ...runtimeRegistryWireFactsFromGraph(clientPhase.completedCheckGraph),
        ...clientPhase.commonRuntimeRegistry,
      },
      generatedClientModules: uniqueKovoCompiledClientModules([
        ...clientPhase.clientBuild.clientModules,
        ...clientPhase.discoveredServerClientModules,
      ]),
      manualClientModules: clientPhase.manualClientModules,
      stylesheetAssets: clientPhase.buildCssAssets,
    });
    const clientModules = finalCompilerClientModulesFromBuildPasses(
      clientPhase.clientBuild.clientModules,
      clientPhase.discoveredServerClientModules,
      serverHandlerBuild.clientModules,
    );
    if (
      deriveKovoAppBuildToken(clientModules, clientPhase.nonCompilerClientModules) !==
      clientPhase.appBuildToken
    ) {
      throw new TypeError(
        'Kovo final runtime-posture bundle changed the discovered client-module identity.',
      );
    }
    return {
      clientModuleRoles: compilerClientModuleRoles(
        clientModules,
        'server-phase compiler client modules',
      ),
      clientModules,
      serverHandlerSource: serverHandlerBuild.source,
    };
  } catch (error) {
    try {
      abortKovoBuildOutputTransaction({ ...clientPhase.transaction });
    } catch {
      // The unique sibling staging path remains safe to remove manually.
    }
    return buildErrorResult(error);
  }
}

export async function finishKovoBuildOneShot(
  inputOptions: KovoBuildOptions,
  inputAnalysis: unknown,
  clientPhase: KovoBuildOneShotClientPhase,
  serverPhase: KovoBuildOneShotServerPhase,
  expectedIdentity: KovoBuildOneShotIdentity,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<CliCommandResult> {
  const transaction: KovoBuildOutputTransaction = { ...clientPhase.transaction };
  try {
    const options = configurationBoundary(() => snapshotKovoBuildOptions(inputOptions));
    const analysis = requireKovoBuildOneShotAnalysis(inputAnalysis);
    const invocationRoot = security.invocationCwd;
    const resolvedAppModulePath = resolve(invocationRoot, options.appModulePath);
    const currentConfig = await revalidateKovoBuildOneShotAnalysis(
      options,
      analysis,
      expectedIdentity,
      security,
      resolvedAppModulePath,
    );
    const loadedConfig = await configurationBoundaryAsync(() =>
      loadKovoBuildConfig(invocationRoot, resolvedAppModulePath, currentConfig),
    );
    const selectedPreset = configurationBoundary(() =>
      selectedKovoBuildPreset(options, loadedConfig.preset, security.invocationEnv),
    );
    if (
      selectedPreset.name !== analysis.selectedPresetName ||
      selectedPreset.name !== clientPhase.selectedPresetName
    ) {
      throw new TypeError('Kovo build final phase selected a stale preset.');
    }
    const loadedBuildApp = await withBuildGraphDerivationContext(() =>
      loadBuildAppModule(
        resolvedAppModulePath,
        invocationRoot,
        analysis.approvedSourceFiles,
        analysis.dependencyCapabilities,
        analysis.sourceDerivedRegistryTransforms,
      ),
    );
    const { cloudflare, node, vercel } = loadedBuildApp.serverBuildModule;
    const { resolveKovoBuildPreset } = loadedBuildApp.serverBuildPresetModule;
    const { deriveClosedKovoApp, writeKovoNeutralBuild } = loadedBuildApp.serverInternalBuildModule;
    const app = appFromModule(
      loadedBuildApp.appModule,
      resolvedAppModulePath,
      loadedBuildApp.serverInternalBuildModule.resolveKovoAppToken,
    );
    const buildApp = appWithBuildStylesheetAssets(
      app,
      clientPhase.buildCssAssets,
      deriveClosedKovoApp,
    );
    const neutralBuildClientModules = adoptCompilerClientModulesForNeutralBuild(
      serverPhase.clientModules,
      loadedBuildApp.compilerClientModuleBuildInstaller,
    );
    const neutralBuild = await writeKovoNeutralBuild({
      app: buildApp,
      buildStylesheetCss: [
        ...analysis.buildStylesheetCss.stylesheetCss,
        ...clientPhase.clientBuild.stylesheetCss,
      ],
      clientModules: neutralBuildClientModules,
      manifestFile: clientPhase.clientBuild.manifestFile,
      outDir: join(transaction.stagedOutDir, '.kovo'),
      serverHandlerSource: serverPhase.serverHandlerSource,
      stylesheetSourceRoot: dirname(resolvedAppModulePath),
    });
    const escapeObligationManifest = escapeObligationManifestForBuild(
      clientPhase.completedCheckGraph,
    );
    const escapeCensusReviewManifest = escapeCensusReviewManifestForBuild(
      clientPhase.completedCheckGraph,
    );
    writeKovoBuildGraphArtifact(
      neutralBuild,
      clientPhase.completedCheckGraph,
      escapeObligationManifest,
      escapeCensusReviewManifest,
    );
    const presetToken =
      selectedPreset.name === 'cloudflare'
        ? cloudflare()
        : selectedPreset.name === 'vercel'
          ? vercel()
          : node();
    const preset = selectedPreset.preset ?? resolveKovoBuildPreset(presetToken);
    if (preset === undefined) {
      throw new Error(
        `kovo build could not resolve framework-owned preset ${selectedPreset.name}.`,
      );
    }
    const presetOutDir = buildPresetOutDir(transaction.stagedOutDir, selectedPreset.name);
    const presetLogs: string[] = [];
    const declaredEnv = inferredKovoBuildDeclaredEnv(serverPhase.serverHandlerSource);
    const presetContext: KovoBuildPresetContext = {
      declaredEnv,
      log(message) {
        presetLogs.push(message);
      },
      outDir: presetOutDir,
      projectRoot: invocationRoot,
      readServerHandlerSource() {
        return serverPhase.serverHandlerSource;
      },
      readNeutral() {
        return neutralBuild;
      },
    };
    const presetDiagnostics = await inspectKovoBuildPreset(preset, neutralBuild, presetContext);
    const blockingDiagnostics = buildFilterDense(
      presetDiagnostics,
      'Build preset diagnostics',
      (diagnostic) => diagnostic.severity === 'error',
    );
    if (blockingDiagnostics.length > 0) {
      throw new KovoBuildPresetDiagnosticError(blockingDiagnostics);
    }
    if (options.check) {
      abortKovoBuildOutputTransaction(transaction);
      return kovoBuildCheckResult({
        appModulePath: resolvedAppModulePath,
        neutralOutDir: join(transaction.finalOutDir, '.kovo'),
        preset: selectedPreset.name,
        presetDiagnostics,
        presetLogs,
      });
    }
    await preset.emit(neutralBuild, presetContext);
    promoteKovoBuildOutputTransaction(transaction);
    return kovoBuildResult({
      appModulePath: resolvedAppModulePath,
      neutralOutDir: join(transaction.finalOutDir, '.kovo'),
      outDir: transaction.finalOutDir,
      preset: selectedPreset.name,
      presetDiagnostics,
      presetLogs,
      serverOutDir: buildPresetOutDir(transaction.finalOutDir, selectedPreset.name),
    });
  } catch (error) {
    try {
      abortKovoBuildOutputTransaction(transaction);
    } catch {
      // The unique sibling staging path remains safe to remove manually.
    }
    return buildErrorResult(error);
  }
}

/**
 * Consume an authenticated analysis handoff in one process.
 *
 * The supported CLI uses the phase-specific entrypoints above; this in-process composition remains
 * for internal programmatic callers and regression tests.
 */
export async function runBuildCommandFromOneShotAnalysis(
  inputOptions: KovoBuildOptions,
  inputAnalysis: unknown,
  expectedIdentity: KovoBuildOneShotIdentity,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<CliCommandResult> {
  let transaction: KovoBuildOutputTransaction | undefined;
  try {
    const options = configurationBoundary(() => snapshotKovoBuildOptions(inputOptions));
    const analysis = requireKovoBuildOneShotAnalysis(inputAnalysis);
    const invocationRoot = security.invocationCwd;
    const resolvedAppModulePath = resolve(invocationRoot, options.appModulePath);
    assertReadableKovoInputFile(resolvedAppModulePath, 'kovo build app module');
    const strictLifecyclePolicy = declaresKovoLifecyclePolicy(invocationRoot);
    if (strictLifecyclePolicy) {
      const lifecyclePolicy = runLifecyclePolicyCheck(invocationRoot, 'kovo-build/v1');
      if (lifecyclePolicy.exitCode !== 0) return lifecyclePolicy;
    }
    const outDir = resolve(invocationRoot, options.outDir);
    assertKovoOutputDirectoryTarget(outDir, 'kovo build --out');

    const currentConfig = await revalidateKovoBuildOneShotAnalysis(
      options,
      analysis,
      expectedIdentity,
      security,
      resolvedAppModulePath,
    );
    const loadedConfig = await configurationBoundaryAsync(() =>
      loadKovoBuildConfig(invocationRoot, resolvedAppModulePath, currentConfig),
    );
    const selectedPreset = configurationBoundary(() =>
      selectedKovoBuildPreset(options, loadedConfig.preset, security.invocationEnv),
    );
    if (selectedPreset.name !== analysis.selectedPresetName) {
      throw new TypeError('Kovo build handoff preset selection is stale.');
    }

    transaction = createKovoBuildOutputTransaction(outDir);
    const stagedOutDir = transaction.stagedOutDir;
    const loadedBuildApp = await withBuildGraphDerivationContext(() =>
      loadBuildAppModule(
        resolvedAppModulePath,
        invocationRoot,
        analysis.approvedSourceFiles,
        analysis.dependencyCapabilities,
        analysis.sourceDerivedRegistryTransforms,
      ),
    );
    const { cloudflare, node, vercel } = loadedBuildApp.serverBuildModule;
    const { resolveKovoBuildPreset } = loadedBuildApp.serverBuildPresetModule;
    const {
      declaredKovoAppId,
      deriveClosedKovoApp,
      snapshotVersionedClientModuleStaging,
      writeKovoNeutralBuild,
    } = loadedBuildApp.serverInternalBuildModule;
    const compilerClientModuleBuildInstaller = loadedBuildApp.compilerClientModuleBuildInstaller;
    const app = appFromModule(
      loadedBuildApp.appModule,
      resolvedAppModulePath,
      loadedBuildApp.serverInternalBuildModule.resolveKovoAppToken,
    );
    const approvedClientEntry = analysis.clientEntry;
    const approvedSourceFiles = analysis.approvedSourceFiles;
    const buildStylesheetCss = analysis.buildStylesheetCss;
    const dependencyCapabilities = analysis.dependencyCapabilities;
    const queryShapeFacts = analysis.queryShapeFacts;
    const graphWithProvenance: CoreGraph.KovoCheckInput = {
      ...analysis.checkGraph,
      analysisInputs: buildAnalysisInputs({
        appSources: approvedSourceFiles,
        clientEntrySources: approvedClientEntry === undefined ? [] : [approvedClientEntry],
        configSources: currentConfig?.files ?? [],
        runtimeTarget: selectedPreset.name,
      }),
      provenance: analysis.artifactProvenance,
    };
    const clientRoot = kovoClientBuildRoot(resolvedAppModulePath, invocationRoot);
    const clientProjectMutationFacts = projectMutationRegistryFactsForBuild(
      resolvedAppModulePath,
      clientRoot,
      approvedSourceFiles,
      invocationRoot,
    );
    const serverProjectMutationFacts = projectMutationRegistryFactsForBuild(
      resolvedAppModulePath,
      invocationRoot,
      approvedSourceFiles,
    );
    const staticRuntimeRegistry = analysis.runtimeRegistry;
    if (app.document.csp !== undefined) {
      assertDocumentCspConfigMatchesBrowserPosture(
        app.document.csp,
        staticRuntimeRegistry.browserPosture,
      );
    }
    const clientBuild = await buildKovoClientManifest(
      join(stagedOutDir, '.kovo-client'),
      clientRoot,
      resolvedAppModulePath,
      {
        ...(approvedClientEntry === undefined ? {} : { approvedClientEntry }),
        approvedSourceFiles,
        cache: options.cache,
        dependencyCapabilities,
        projectMutationFacts: clientProjectMutationFacts,
        queryShapeFacts,
        sourceIdentityRoot: invocationRoot,
      },
    );
    const buildCssAssets = mergeKovoBuildStylesheetAssets([
      buildStylesheetCss.assets,
      clientBuild.assets,
    ]);
    const buildApp = appWithBuildStylesheetAssets(app, buildCssAssets, deriveClosedKovoApp);
    const commonRuntimeRegistry = {
      ...(staticRuntimeRegistry.browserPosture === undefined
        ? {}
        : { browserPosture: staticRuntimeRegistry.browserPosture }),
      ...(staticRuntimeRegistry.tableSecurity === undefined
        ? {}
        : { tableSecurity: staticRuntimeRegistry.tableSecurity }),
    };
    const discoveredServerClientModules = await compilerClientModulesFromApprovedSources(
      resolvedAppModulePath,
      {
        approvedSourceFiles: clientBuild.appCompilerSourceFiles,
        buildRoot: invocationRoot,
        projectMutationFacts: serverProjectMutationFacts,
        queryShapeFacts,
      },
    );
    const discoveredClientModules = uniqueKovoCompiledClientModules([
      ...clientBuild.clientModules,
      ...discoveredServerClientModules,
    ]);
    const appClientModuleStaging = snapshotVersionedClientModuleStaging(buildApp.clientModules);
    const hasGeneratedAppBootstrap = buildSomeDense(
      discoveredClientModules,
      'discovered compiler client modules',
      (module) => compilerOwnedViteClientModuleRole(module) === 'app-bootstrap',
    );
    const nonCompilerClientModules = hasGeneratedAppBootstrap
      ? appClientModuleStaging.stable
      : appendDense(
          appClientModuleStaging.stable,
          appClientModuleStaging.mandatory,
          'build app stable and mandatory client modules',
        );
    const appBuildToken = deriveKovoAppBuildToken(
      discoveredClientModules,
      nonCompilerClientModules,
    );
    const graphWithProof: CoreGraph.KovoCheckInput = {
      ...graphWithProvenance,
      proof: createKovoGraphProof(graphWithProvenance, appBuildToken, declaredKovoAppId(app)),
    };
    const runtimePosture = createKovoRuntimePostureManifest(graphWithProof);
    const completedCheckGraph: CoreGraph.KovoCheckInput = {
      ...graphWithProof,
      runtimePosture,
    };
    const serverHandlerBuild = await bundleKovoServerHandler(resolvedAppModulePath, {
      approvedSourceFiles,
      buildRoot: invocationRoot,
      dependencyCapabilities,
      projectMutationFacts: serverProjectMutationFacts,
      queryShapeFacts,
      runtimeTarget: selectedPreset.name,
      runtimeRegistry: {
        ...runtimeRegistryWireFactsFromGraph(completedCheckGraph),
        ...commonRuntimeRegistry,
      },
      generatedClientModules: discoveredClientModules,
      manualClientModules: appClientModuleStaging.stable,
      stylesheetAssets: buildCssAssets,
    });
    const clientModules = finalCompilerClientModulesFromBuildPasses(
      clientBuild.clientModules,
      discoveredServerClientModules,
      serverHandlerBuild.clientModules,
    );
    if (deriveKovoAppBuildToken(clientModules, nonCompilerClientModules) !== appBuildToken) {
      throw new TypeError(
        'Kovo final runtime-posture bundle changed the discovered client-module identity.',
      );
    }
    const neutralBuildClientModules = adoptCompilerClientModulesForNeutralBuild(
      clientModules,
      compilerClientModuleBuildInstaller,
    );
    const neutralBuild = await writeKovoNeutralBuild({
      app: buildApp,
      buildStylesheetCss: [...buildStylesheetCss.stylesheetCss, ...clientBuild.stylesheetCss],
      clientModules: neutralBuildClientModules,
      manifestFile: clientBuild.manifestFile,
      outDir: join(stagedOutDir, '.kovo'),
      serverHandlerSource: serverHandlerBuild.source,
      stylesheetSourceRoot: dirname(resolvedAppModulePath),
    });
    const escapeObligationManifest = escapeObligationManifestForBuild(completedCheckGraph);
    const escapeCensusReviewManifest = escapeCensusReviewManifestForBuild(completedCheckGraph);
    writeKovoBuildGraphArtifact(
      neutralBuild,
      completedCheckGraph,
      escapeObligationManifest,
      escapeCensusReviewManifest,
    );
    const presetToken =
      selectedPreset.name === 'cloudflare'
        ? cloudflare()
        : selectedPreset.name === 'vercel'
          ? vercel()
          : node();
    const preset = selectedPreset.preset ?? resolveKovoBuildPreset(presetToken);
    if (preset === undefined) {
      throw new Error(
        `kovo build could not resolve framework-owned preset ${selectedPreset.name}.`,
      );
    }
    const presetOutDir = buildPresetOutDir(stagedOutDir, selectedPreset.name);
    const presetLogs: string[] = [];
    const serverHandlerSource = serverHandlerBuild.source;
    const declaredEnv = inferredKovoBuildDeclaredEnv(serverHandlerSource);
    const presetContext: KovoBuildPresetContext = {
      declaredEnv,
      log(message) {
        presetLogs.push(message);
      },
      outDir: presetOutDir,
      projectRoot: invocationRoot,
      readServerHandlerSource() {
        return serverHandlerSource;
      },
      readNeutral() {
        return neutralBuild;
      },
    };
    const presetDiagnostics = await inspectKovoBuildPreset(preset, neutralBuild, presetContext);
    const blockingDiagnostics = buildFilterDense(
      presetDiagnostics,
      'Build preset diagnostics',
      (diagnostic) => diagnostic.severity === 'error',
    );
    if (blockingDiagnostics.length > 0) {
      throw new KovoBuildPresetDiagnosticError(blockingDiagnostics);
    }

    if (options.check) {
      abortKovoBuildOutputTransaction(transaction);
      transaction = undefined;
      return kovoBuildCheckResult({
        appModulePath: resolvedAppModulePath,
        neutralOutDir: join(outDir, '.kovo'),
        preset: selectedPreset.name,
        presetDiagnostics,
        presetLogs,
      });
    }
    await preset.emit(neutralBuild, presetContext);
    promoteKovoBuildOutputTransaction(transaction);
    transaction = undefined;
    return kovoBuildResult({
      appModulePath: resolvedAppModulePath,
      neutralOutDir: join(outDir, '.kovo'),
      outDir,
      preset: selectedPreset.name,
      presetDiagnostics,
      presetLogs,
      serverOutDir: buildPresetOutDir(outDir, selectedPreset.name),
    });
  } catch (error) {
    if (transaction !== undefined) {
      try {
        writeKovoBuildDebugEvidence(transaction, error, security);
      } catch {
        // Debug evidence is secondary to the producer-owned failure.
      }
      try {
        abortKovoBuildOutputTransaction(transaction);
      } catch {
        // The unique sibling staging path remains safe to remove manually.
      }
    }
    return buildErrorResult(error);
  }
}

async function revalidateKovoBuildOneShotAnalysis(
  options: KovoBuildOptions,
  analysis: KovoBuildOneShotAnalysis,
  expectedIdentity: KovoBuildOneShotIdentity,
  security: KovoCommandSecurityDisposition,
  resolvedAppModulePath: string,
): Promise<KovoBuildOneShotApprovedConfig | undefined> {
  const invocationRoot = security.invocationCwd;
  const currentProvenance = resolveKovoArtifactProvenance({
    appModulePath: resolvedAppModulePath,
  });
  if (
    kovoBuildOneShotDigest(currentProvenance) !==
    kovoBuildOneShotDigest(analysis.artifactProvenance)
  ) {
    throw new TypeError('Kovo build handoff compiler provenance is stale.');
  }
  const configPath = findKovoBuildConfig(invocationRoot);
  const currentConfig = revalidateKovoBuildConfigTrustSourceSnapshot(
    analysis.approvedConfig,
    invocationRoot,
    configPath,
    'build',
  );

  const currentClientEntry = preEvaluationClientEntryFile(resolvedAppModulePath, invocationRoot);
  const currentFiles = preEvaluationAppSourceFiles(
    resolvedAppModulePath,
    invocationRoot,
    currentClientEntry,
  );
  const currentApprovedSourceFiles = preEvaluationApprovedBuildFiles(
    resolvedAppModulePath,
    invocationRoot,
    currentFiles,
  );
  const currentSourceDigest = kovoBuildOneShotDigest({
    clientEntry: currentClientEntry ?? null,
    files: currentApprovedSourceFiles,
  });
  const recordedSourceDigest = kovoBuildOneShotDigest({
    clientEntry: analysis.clientEntry ?? null,
    files: analysis.approvedSourceFiles,
  });
  if (currentSourceDigest !== recordedSourceDigest) {
    throw new TypeError('Kovo build handoff app source set is stale.');
  }
  const currentIdentity = kovoBuildOneShotIdentity(options, analysis, security);
  if (JSON.stringify(currentIdentity) !== JSON.stringify(expectedIdentity)) {
    throw new TypeError('Kovo build handoff invocation identity changed before consumption.');
  }
  return currentConfig;
}

interface KovoBuildOneShotAnalysisPhasePayload {
  readonly analysis: KovoBuildOneShotAnalysis;
}

interface KovoBuildOneShotClientPhasePayload extends KovoBuildOneShotAnalysisPhasePayload {
  readonly clientPhase: KovoBuildOneShotClientPhase;
}

interface KovoBuildOneShotServerPhasePayload extends KovoBuildOneShotClientPhasePayload {
  readonly serverPhase: KovoBuildOneShotServerPhase;
}

function requireKovoSourceCheckOneShotAnalysis(value: unknown): KovoSourceCheckOneShotAnalysis {
  const required = ['artifactProvenance', 'diagnosticSourceFacts', 'graph', 'sourceFiles'];
  requireKovoBuildOneShotExactKeys(
    value,
    [...required, 'approvedConfig', 'devexCheckGraphDigest', 'phaseCensus'],
    'source-check analysis',
    required,
  );
  const sourceFiles = validateStaticTrustSourceFiles(
    buildOwnDataValue(value, 'sourceFiles', 'Kovo check handoff analysis'),
    'Kovo check handoff source files',
  );
  const graph = buildOwnDataValue(value, 'graph', 'Kovo check handoff analysis');
  if (validateKovoExplainInput(graph).length > 0) {
    throw new TypeError('Kovo check handoff analysis contains an invalid graph.');
  }
  const diagnosticSourceFacts = buildOwnDataValue(
    value,
    'diagnosticSourceFacts',
    'Kovo check handoff analysis',
  );
  if (!buildArrayIsArray(diagnosticSourceFacts)) {
    throw new TypeError('Kovo check handoff analysis contains invalid diagnostic source facts.');
  }
  createKovoCheckDiagnosticSourceCatalog(
    diagnosticSourceFacts as readonly KovoCheckDiagnosticSourceFact[],
  );
  const approvedConfig = buildOwnDataProperty(
    value,
    'approvedConfig',
    'Kovo check handoff analysis',
  );
  if (approvedConfig.present) {
    requireKovoBuildOneShotExactKeys(
      approvedConfig.value,
      ['files', 'path'],
      'source-check approved config',
    );
    validateStaticTrustSourceFiles(
      buildOwnDataValue(approvedConfig.value, 'files', 'Kovo check handoff approved config'),
      'Kovo check handoff approved config files',
    );
    if (
      typeof buildOwnDataValue(
        approvedConfig.value,
        'path',
        'Kovo check handoff approved config',
      ) !== 'string'
    ) {
      throw new TypeError('Kovo check handoff approved config path is invalid.');
    }
  }
  const phaseCensus = buildOwnDataProperty(value, 'phaseCensus', 'Kovo check handoff analysis');
  if (phaseCensus.present) requireKovoSourceCheckPhaseCensus(phaseCensus.value);
  const digest = buildOwnDataProperty(
    value,
    'devexCheckGraphDigest',
    'Kovo check handoff analysis',
  );
  if (digest.present && typeof digest.value !== 'string') {
    throw new TypeError('Kovo check handoff graph digest is invalid.');
  }
  return {
    ...(approvedConfig.present
      ? { approvedConfig: approvedConfig.value as KovoBuildOneShotApprovedConfig }
      : {}),
    artifactProvenance: buildOwnDataValue(
      value,
      'artifactProvenance',
      'Kovo check handoff analysis',
    ) as KovoSourceCheckOneShotAnalysis['artifactProvenance'],
    ...(digest.present ? { devexCheckGraphDigest: digest.value as string } : {}),
    diagnosticSourceFacts: diagnosticSourceFacts as readonly KovoCheckDiagnosticSourceFact[],
    graph: graph as CoreGraph.KovoCheckInput,
    ...(phaseCensus.present
      ? { phaseCensus: phaseCensus.value as KovoSourceCheckPhaseCensus }
      : {}),
    sourceFiles,
  };
}

function requireKovoSourceCheckPhaseCensus(value: unknown): void {
  requireKovoBuildOneShotExactKeys(value, ['phases', 'sourcePath'], 'source-check phase census');
  const sourcePath = buildOwnDataValue(value, 'sourcePath', 'Kovo check handoff phase census');
  const phases = buildOwnDataValue(value, 'phases', 'Kovo check handoff phase census');
  if (typeof sourcePath !== 'string' || !buildArrayIsArray(phases)) {
    throw new TypeError('Kovo check handoff phase census is invalid.');
  }
  if (phases.length !== KOVO_SOURCE_CHECK_PHASES.length - 1) {
    throw new TypeError('Kovo check handoff phase census is incomplete.');
  }
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    requireKovoBuildOneShotExactKeys(
      phase,
      ['durationMs', 'name', 'status'],
      'source-check phase census entry',
    );
    const durationMs = buildOwnDataValue(phase, 'durationMs', 'Kovo check handoff phase census');
    const name = buildOwnDataValue(phase, 'name', 'Kovo check handoff phase census');
    const status = buildOwnDataValue(phase, 'status', 'Kovo check handoff phase census');
    if (
      typeof durationMs !== 'number' ||
      !(durationMs >= 0 && durationMs < Infinity) ||
      name !== KOVO_SOURCE_CHECK_PHASES[index] ||
      (status !== 'executed' && status !== 'not-applicable')
    ) {
      throw new TypeError('Kovo check handoff phase census entry is invalid.');
    }
  }
}

export function requireKovoBuildOneShotPhasePayload(
  value: unknown,
  phase: 'analysis',
): KovoBuildOneShotAnalysisPhasePayload;
export function requireKovoBuildOneShotPhasePayload(
  value: unknown,
  phase: 'client',
): KovoBuildOneShotClientPhasePayload;
export function requireKovoBuildOneShotPhasePayload(
  value: unknown,
  phase: 'server',
): KovoBuildOneShotServerPhasePayload;
export function requireKovoBuildOneShotPhasePayload(
  value: unknown,
  phase: 'analysis' | 'client' | 'server',
):
  | KovoBuildOneShotAnalysisPhasePayload
  | KovoBuildOneShotClientPhasePayload
  | KovoBuildOneShotServerPhasePayload {
  const expectedKeys =
    phase === 'analysis'
      ? ['analysis']
      : phase === 'client'
        ? ['analysis', 'clientPhase']
        : ['analysis', 'clientPhase', 'serverPhase'];
  requireKovoBuildOneShotExactKeys(value, expectedKeys, `${phase} phase handoff`);
  const analysis = requireKovoBuildOneShotAnalysis(
    buildOwnDataValue(value, 'analysis', `${phase} phase handoff`),
  );
  if (phase === 'analysis') return { analysis };
  const clientPhase = requireKovoBuildOneShotClientPhase(
    buildOwnDataValue(value, 'clientPhase', `${phase} phase handoff`),
  );
  if (phase === 'client') return { analysis, clientPhase };
  return {
    analysis,
    clientPhase,
    serverPhase: requireKovoBuildOneShotServerPhase(
      buildOwnDataValue(value, 'serverPhase', `${phase} phase handoff`),
    ),
  };
}

function requireKovoBuildOneShotAnalysis(value: unknown): KovoBuildOneShotAnalysis {
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) {
    throw new TypeError('Kovo build handoff analysis is invalid.');
  }
  const required = [
    'approvedSourceFiles',
    'artifactProvenance',
    'buildStylesheetCss',
    'checkGraph',
    'dependencyCapabilities',
    'queryShapeFacts',
    'runtimeRegistry',
    'selectedPresetName',
    'sourceDerivedRegistryTransforms',
  ];
  const allowed = [...required, 'approvedConfig', 'clientEntry'];
  requireKovoBuildOneShotExactKeys(value, allowed, 'analysis', required);
  const selectedPresetName = buildOwnDataValue(
    value,
    'selectedPresetName',
    'Kovo build handoff analysis',
  );
  if (parseKovoBuildPresetName(String(selectedPresetName)) === undefined) {
    throw new TypeError('Kovo build handoff analysis has an invalid preset.');
  }
  if (
    !buildArrayIsArray(
      buildOwnDataValue(value, 'approvedSourceFiles', 'Kovo build handoff analysis'),
    ) ||
    !buildArrayIsArray(
      buildOwnDataValue(value, 'queryShapeFacts', 'Kovo build handoff analysis'),
    ) ||
    !buildArrayIsArray(
      buildOwnDataValue(value, 'sourceDerivedRegistryTransforms', 'Kovo build handoff analysis'),
    )
  ) {
    throw new TypeError('Kovo build handoff analysis has invalid collection fields.');
  }
  validateStaticTrustSourceFiles(
    buildOwnDataValue(value, 'approvedSourceFiles', 'Kovo build handoff analysis'),
    'Kovo build handoff approved source files',
  );
  const clientEntry = buildOwnDataProperty(value, 'clientEntry', 'Kovo build handoff analysis');
  if (clientEntry.present) {
    validateStaticTrustSourceFiles([clientEntry.value], 'Kovo build handoff approved client entry');
  }
  const graphErrors = validateKovoExplainInput(
    buildOwnDataValue(value, 'checkGraph', 'Kovo build handoff analysis'),
  );
  if (graphErrors.length > 0) {
    throw new TypeError('Kovo build handoff analysis contains an invalid check graph.');
  }
  return value as KovoBuildOneShotAnalysis;
}

function requireKovoBuildOneShotClientPhase(value: unknown): KovoBuildOneShotClientPhase {
  const fields = [
    'appBuildToken',
    'buildCssAssets',
    'clientBuild',
    'clientBuildClientModuleRoles',
    'commonRuntimeRegistry',
    'completedCheckGraph',
    'discoveredServerClientModules',
    'discoveredServerClientModuleRoles',
    'manualClientModules',
    'nonCompilerClientModules',
    'selectedPresetName',
    'serverProjectMutationFacts',
    'transaction',
  ];
  requireKovoBuildOneShotExactKeys(value, fields, 'client phase');
  if (
    typeof buildOwnDataValue(value, 'appBuildToken', 'Kovo build handoff client phase') !==
      'string' ||
    parseKovoBuildPresetName(
      String(buildOwnDataValue(value, 'selectedPresetName', 'Kovo build handoff client phase')),
    ) === undefined
  ) {
    throw new TypeError('Kovo build handoff client phase has invalid scalar fields.');
  }
  for (const key of [
    'clientBuildClientModuleRoles',
    'discoveredServerClientModules',
    'discoveredServerClientModuleRoles',
    'manualClientModules',
    'nonCompilerClientModules',
  ]) {
    if (!buildArrayIsArray(buildOwnDataValue(value, key, 'Kovo build handoff client phase'))) {
      throw new TypeError(`Kovo build handoff client phase has invalid ${key}.`);
    }
  }
  const clientBuild = buildOwnDataValue(value, 'clientBuild', 'Kovo build handoff client phase');
  if (!isRecord(clientBuild)) {
    throw new TypeError('Kovo build handoff client phase has an invalid client build.');
  }
  const clientBuildModules = buildOwnDataValue(
    clientBuild,
    'clientModules',
    'Kovo build handoff client build',
  );
  if (!buildArrayIsArray(clientBuildModules)) {
    throw new TypeError('Kovo build handoff client build has invalid client modules.');
  }
  const discoveredServerClientModules = buildOwnDataValue(
    value,
    'discoveredServerClientModules',
    'Kovo build handoff client phase',
  ) as readonly unknown[];
  validateCompilerClientModuleHandoffRecords(
    clientBuildModules,
    'Kovo build handoff client-build modules',
  );
  validateCompilerClientModuleHandoffRecords(
    discoveredServerClientModules,
    'Kovo build handoff discovered server modules',
  );
  requireCompilerClientModuleRoleCensus(
    buildOwnDataValue(value, 'clientBuildClientModuleRoles', 'Kovo build handoff client phase'),
    clientBuildModules.length,
    'Kovo build handoff client-build roles',
  );
  requireCompilerClientModuleRoleCensus(
    buildOwnDataValue(
      value,
      'discoveredServerClientModuleRoles',
      'Kovo build handoff client phase',
    ),
    discoveredServerClientModules.length,
    'Kovo build handoff discovered server roles',
  );
  const graphErrors = validateKovoExplainInput(
    buildOwnDataValue(value, 'completedCheckGraph', 'Kovo build handoff client phase'),
  );
  if (graphErrors.length > 0) {
    throw new TypeError('Kovo build handoff client phase contains an invalid completed graph.');
  }
  requireKovoBuildOneShotTransaction(
    buildOwnDataValue(value, 'transaction', 'Kovo build handoff client phase'),
  );
  return value as KovoBuildOneShotClientPhase;
}

function requireKovoBuildOneShotServerPhase(value: unknown): KovoBuildOneShotServerPhase {
  requireKovoBuildOneShotExactKeys(
    value,
    ['clientModuleRoles', 'clientModules', 'serverHandlerSource'],
    'server phase',
  );
  const clientModules = buildOwnDataValue(
    value,
    'clientModules',
    'Kovo build handoff server phase',
  );
  if (
    !buildArrayIsArray(clientModules) ||
    typeof buildOwnDataValue(value, 'serverHandlerSource', 'Kovo build handoff server phase') !==
      'string'
  ) {
    throw new TypeError('Kovo build handoff server phase is invalid.');
  }
  validateCompilerClientModuleHandoffRecords(
    clientModules,
    'Kovo build handoff server compiler modules',
  );
  requireCompilerClientModuleRoleCensus(
    buildOwnDataValue(value, 'clientModuleRoles', 'Kovo build handoff server phase'),
    clientModules.length,
    'Kovo build handoff server compiler roles',
  );
  return value as KovoBuildOneShotServerPhase;
}

function validateCompilerClientModuleHandoffRecords(
  value: readonly unknown[],
  label: string,
): void {
  const modules = buildSnapshotDenseArray(value, label);
  for (let index = 0; index < modules.length; index += 1) {
    const module = modules[index];
    requireKovoBuildOneShotExactKeys(
      module,
      ['path', 'renderPlanFingerprint', 'source'],
      `${label}[${index}]`,
    );
    const path = buildOwnDataValue(module, 'path', `${label}[${index}]`);
    const renderPlanFingerprint = buildOwnDataValue(
      module,
      'renderPlanFingerprint',
      `${label}[${index}]`,
    );
    const source = buildOwnDataValue(module, 'source', `${label}[${index}]`);
    if (
      typeof path !== 'string' ||
      path.length === 0 ||
      typeof source !== 'string' ||
      typeof renderPlanFingerprint !== 'string' ||
      buildRegExpExec(/^[0-9a-f]{64}$/u, renderPlanFingerprint) === null
    ) {
      throw new TypeError(`${label}[${index}] is malformed.`);
    }
  }
}

function requireCompilerClientModuleRoleCensus(
  value: unknown,
  expectedLength: number,
  label: string,
): asserts value is readonly CompilerOwnedViteClientModuleRole[] {
  if (!buildArrayIsArray(value) || value.length !== expectedLength) {
    throw new TypeError(`${label} is incomplete.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const role = value[index];
    if (
      role !== 'app-bootstrap' &&
      role !== 'component-client' &&
      role !== 'deferred-app-runtime' &&
      role !== 'optimistic-plan'
    ) {
      throw new TypeError(`${label}[${index}] is invalid.`);
    }
  }
}

function requireKovoBuildOneShotTransaction(value: unknown): KovoBuildOutputTransaction {
  requireKovoBuildOneShotExactKeys(
    value,
    ['buildId', 'finalOutDir', 'promoted', 'stagedOutDir'],
    'output transaction',
  );
  const buildId = buildOwnDataValue(value, 'buildId', 'Kovo build handoff output transaction');
  const finalOutDir = buildOwnDataValue(
    value,
    'finalOutDir',
    'Kovo build handoff output transaction',
  );
  const promoted = buildOwnDataValue(value, 'promoted', 'Kovo build handoff output transaction');
  const stagedOutDir = buildOwnDataValue(
    value,
    'stagedOutDir',
    'Kovo build handoff output transaction',
  );
  if (
    typeof buildId !== 'string' ||
    typeof finalOutDir !== 'string' ||
    promoted !== false ||
    typeof stagedOutDir !== 'string' ||
    basename(stagedOutDir) !== buildId ||
    dirname(stagedOutDir) !== dirname(finalOutDir) ||
    !buildStringStartsWith(buildId, '.kovo-build-stage-')
  ) {
    throw new TypeError('Kovo build handoff output transaction is invalid.');
  }
  const stat = lstatSync(stagedOutDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError('Kovo build handoff output transaction staging path is invalid.');
  }
  return { buildId, finalOutDir, promoted, stagedOutDir };
}

function requireKovoBuildOneShotExactKeys(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
  requiredKeys: readonly string[] = allowedKeys,
): asserts value is object {
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) {
    throw new TypeError(`Kovo build handoff ${label} is invalid.`);
  }
  const keys = buildObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    let allowed = false;
    for (let allowedIndex = 0; allowedIndex < allowedKeys.length; allowedIndex += 1) {
      if (keys[index] === allowedKeys[allowedIndex]) {
        allowed = true;
        break;
      }
    }
    if (!allowed) throw new TypeError(`Kovo build handoff ${label} has an unsupported field.`);
  }
  for (let index = 0; index < requiredKeys.length; index += 1) {
    if (!buildOwnDataProperty(value, requiredKeys[index]!, `Kovo build handoff ${label}`).present) {
      throw new TypeError(`Kovo build handoff ${label} omitted ${requiredKeys[index]}.`);
    }
  }
}

async function loadAndCheckBuildApp(
  resolvedAppModulePath: string,
  options: KovoBuildOptions,
  reachableSessionAuthorityFacts: readonly CoreGraph.SessionAuthorityFact[],
  security: KovoCommandSecurityDisposition,
  invocationRoot: string,
) {
  const preEvaluationStaticTrust = await runPreEvaluationStaticTrustPreflightInWorker(
    resolvedAppModulePath,
    invocationRoot,
    security.paranoidStaticAdvisory,
    security.invocationEnv,
    options.cache,
  );
  // Stylesheet compilation is source proof, so keep it post-trust, but finish it before app/Vite
  // evaluation allocates the authenticated runtime graph. The packed full-catalog workload proved
  // that overlapping those independent heaps can exceed the reviewed 2 GiB first-loop ceiling.
  const buildStylesheetCss = await withBuildGraphDerivationContext(() =>
    kovoBuildStylesheetCss(resolvedAppModulePath),
  );
  // SPEC §6.6 rule 6: the exact app-resolved SSR graph must finish its trust-root transition
  // before any other build lane is allowed to evaluate authored modules. In particular, do not
  // race any authored module evaluation against the server/compiler/data-plane preload.
  const loadedBuildApp = await withBuildGraphDerivationContext(() =>
    loadBuildAppModule(
      resolvedAppModulePath,
      invocationRoot,
      preEvaluationStaticTrust.approvedSourceFiles,
      preEvaluationStaticTrust.capabilityClosure.dependencyManifest,
      preEvaluationStaticTrust.sourceGraphFacts.sourceDerivedRegistryTransforms,
    ),
  );
  const { cloudflare, node, vercel } = loadedBuildApp.serverBuildModule;
  const { resolveKovoBuildPreset } = loadedBuildApp.serverBuildPresetModule;
  const execution = loadedBuildApp.serverExecutionModule;
  const {
    declaredKovoAppId,
    deriveClosedKovoApp,
    snapshotVersionedClientModuleStaging,
    writeKovoNeutralBuild,
  } = loadedBuildApp.serverInternalBuildModule;
  const appModule = loadedBuildApp.appModule;
  const app = appFromModule(
    appModule,
    options.appModulePath,
    loadedBuildApp.serverInternalBuildModule.resolveKovoAppToken,
  );
  const buildCheck = await runKovoBuildCheckPreflight(app, {
    cache: options.cache,
    execution,
    paranoidStaticAdvisory: security.paranoidStaticAdvisory,
    preEvaluationStaticTrust,
    reachableSessionAuthorityFacts,
    root: invocationRoot,
  });
  return {
    app,
    approvedClientEntry: preEvaluationStaticTrust.clientEntry,
    approvedSourceFiles: preEvaluationStaticTrust.approvedSourceFiles,
    buildStylesheetCss,
    checkGraph: buildCheck.graph,
    cloudflare,
    compilerClientModuleBuildInstaller: loadedBuildApp.compilerClientModuleBuildInstaller,
    dependencyCapabilities: preEvaluationStaticTrust.capabilityClosure.dependencyManifest,
    declaredKovoAppId,
    deriveClosedKovoApp,
    node,
    queryShapeFacts: buildCheck.queryShapeFacts,
    runtimeRegistry: buildCheck.runtimeRegistry,
    resolveKovoBuildPreset,
    snapshotVersionedClientModuleStaging,
    sourceDerivedRegistryTransforms:
      preEvaluationStaticTrust.sourceGraphFacts.sourceDerivedRegistryTransforms,
    vercel,
    writeKovoNeutralBuild,
  };
}

async function deriveCurrentSourceCheckArtifacts(
  resolvedAppModulePath: string,
  cache: boolean,
  reachableSessionAuthorityFacts: readonly CoreGraph.SessionAuthorityFact[],
  security: KovoCommandSecurityDisposition,
  invocationRoot: string,
  phaseCensus: KovoSourceCheckPhaseCensus | undefined,
): Promise<KovoBuildCheckArtifacts> {
  const appSourceTrustStartedAt = startSourceCheckPhase(phaseCensus);
  const preEvaluationStaticTrust = await runPreEvaluationStaticTrustPreflightInWorker(
    resolvedAppModulePath,
    invocationRoot,
    security.paranoidStaticAdvisory,
    security.invocationEnv,
    cache,
  );
  recordSourceCheckPhase(phaseCensus, 'app-source-trust', 'executed', appSourceTrustStartedAt);
  // Stylesheet compilation is source proof even though asset placement is deployment proof. Keep
  // it after authenticated source trust but before app/Vite evaluation so their independent
  // compiler heaps cannot overlap on valid copied-catalog projects (SPEC §5.2 rules 6/9; §11.4).
  const stylesheetStartedAt = startSourceCheckPhase(phaseCensus);
  await withBuildGraphDerivationContext(() => kovoBuildStylesheetCss(resolvedAppModulePath));
  collectBuildGarbage?.();
  recordSourceCheckPhase(phaseCensus, 'stylesheet', 'executed', stylesheetStartedAt);
  const appEvaluationStartedAt = startSourceCheckPhase(phaseCensus);
  const loadedBuildApp = await withBuildGraphDerivationContext(() =>
    loadBuildAppModule(
      resolvedAppModulePath,
      invocationRoot,
      preEvaluationStaticTrust.approvedSourceFiles,
      preEvaluationStaticTrust.capabilityClosure.dependencyManifest,
      preEvaluationStaticTrust.sourceGraphFacts.sourceDerivedRegistryTransforms,
    ),
  );
  collectBuildGarbage?.();
  recordSourceCheckPhase(phaseCensus, 'app-evaluation', 'executed', appEvaluationStartedAt);
  const app = appFromModule(
    loadedBuildApp.appModule,
    resolvedAppModulePath,
    loadedBuildApp.serverInternalBuildModule.resolveKovoAppToken,
  );
  const buildCheckGraphStartedAt = startSourceCheckPhase(phaseCensus);
  const artifacts = await buildCheckGraph(app, {
    cache,
    execution: loadedBuildApp.serverExecutionModule,
    includeDevexCheckGraphDigest: phaseCensus !== undefined,
    preEvaluationStaticTrust,
    reachableSessionAuthorityFacts,
    root: invocationRoot,
  });
  recordSourceCheckPhase(phaseCensus, 'build-check-graph', 'executed', buildCheckGraphStartedAt);
  return artifacts;
}

function sourceCheckPhaseCensus(
  invocationEnv: NodeJS.ProcessEnv,
): KovoSourceCheckPhaseCensus | undefined {
  const sourcePath = kovoInvocationEnvironmentValue(
    invocationEnv,
    KOVO_DEVEX_CHECK_PHASE_CENSUS_ENV,
  );
  if (sourcePath === undefined) return undefined;
  if (!exactBuildAnalysisPath(sourcePath)) {
    throw new KovoCommandConfigurationError(
      `${KOVO_DEVEX_CHECK_PHASE_CENSUS_ENV} must name one project-relative source file.`,
    );
  }
  return { phases: [], sourcePath };
}

function recordSourceCheckPhase(
  census: KovoSourceCheckPhaseCensus | undefined,
  name: KovoSourceCheckPhase,
  status: KovoSourceCheckPhaseStatus,
  startedAt?: number,
): void {
  if (census === undefined) return;
  const expected = KOVO_SOURCE_CHECK_PHASES[census.phases.length];
  if (expected !== name) {
    throw new TypeError(
      `kovo check phase census expected ${expected ?? '<complete>'}, received ${name}.`,
    );
  }
  let durationMs = 0;
  if (status === 'executed') {
    if (startedAt === undefined) {
      throw new TypeError(`kovo check phase census has no start time for executed phase ${name}.`);
    }
    durationMs = performanceNow() - startedAt;
  }
  if (!(durationMs >= 0 && durationMs < Infinity)) {
    throw new TypeError(`kovo check phase census measured an invalid duration for ${name}.`);
  }
  buildSecurityArrayAppend(
    census.phases,
    { durationMs, name, status },
    'Kovo source-check phase census',
  );
}

function startSourceCheckPhase(census: KovoSourceCheckPhaseCensus | undefined): number | undefined {
  return census === undefined ? undefined : performanceNow();
}

function appendSourceCheckPhaseCensus(
  result: KovoCheckResult,
  census: KovoSourceCheckPhaseCensus | undefined,
  artifacts: Pick<KovoBuildCheckArtifacts, 'devexCheckGraphDigest' | 'sourceFiles'>,
): KovoCheckResult {
  if (census === undefined) return result;
  if (census.phases.length !== KOVO_SOURCE_CHECK_PHASES.length) {
    throw new TypeError(
      `kovo check phase census recorded ${String(census.phases.length)} of ${String(
        KOVO_SOURCE_CHECK_PHASES.length,
      )} required phases.`,
    );
  }

  let requestedSource: BuildCheckSourceFile | undefined;
  const sourceFiles = buildSnapshotDenseArray(
    artifacts.sourceFiles,
    'Kovo source-check census input files',
  );
  for (let index = 0; index < sourceFiles.length; index += 1) {
    const candidate = sourceFiles[index]!;
    if (candidate.fileName === census.sourcePath) {
      requestedSource = candidate;
      break;
    }
  }
  if (requestedSource === undefined) {
    throw new KovoCommandConfigurationError(
      `${KOVO_DEVEX_CHECK_PHASE_CENSUS_ENV} source ${census.sourcePath} is outside the analyzed app closure.`,
    );
  }

  if (artifacts.devexCheckGraphDigest === undefined) {
    throw new TypeError('kovo check phase census omitted its check-graph digest.');
  }
  const sourceDigest = `sha256:${hash(
    'sha256',
    bufferFrom(requestedSource.source, 'utf16le'),
    'hex',
  )}`;
  const evidence = {
    checkGraphDigest: artifacts.devexCheckGraphDigest,
    phases: census.phases,
    schema: KOVO_DEVEX_CHECK_PHASE_CENSUS_SCHEMA,
    source: {
      codeUnitLength: requestedSource.source.length,
      contentHash: sourceDigest,
      encoding: 'utf16le',
      path: requestedSource.fileName,
    },
  };
  return {
    ...result,
    output: `${result.output}${KOVO_DEVEX_CHECK_PHASE_CENSUS_SCHEMA} ${stringifyBuildValue(
      evidence,
    )}\n`,
  };
}

interface PreEvaluationStaticTrust {
  readonly approvedSourceFiles: readonly BuildCheckSourceFile[];
  readonly capabilityClosure: AnalyzeCapabilityClosureResult;
  readonly clientEntry?: BuildCheckSourceFile;
  readonly derivedProof?: PreEvaluationStaticDerivedProof;
  readonly facts: ReturnType<typeof collectStaticBuildTrustFactsFromProject>;
  readonly files: readonly BuildCheckSourceFile[];
  readonly sourceGraphFacts: StaticTrustSourceGraphFacts;
}

interface PreEvaluationStaticTrustAnalysis extends Omit<
  PreEvaluationStaticTrust,
  'derivedProof' | 'sourceGraphFacts'
> {
  readonly sourceGraphFacts: SourceGraphFacts;
}

type StaticTrustSourceGraphFacts = Pick<
  SourceGraphFacts,
  | 'components'
  | 'domainDeclarationNames'
  | 'registryDeclarationAnchors'
  | 'routeOutcomes'
  | 'routePages'
  | 'sourceDerivedRegistryTransforms'
>;

interface PreEvaluationStaticDerivedProof {
  readonly browserPosture: ReturnType<typeof deriveBrowserPostureManifestFromSourceFiles>;
  readonly dataPlaneFacts: Omit<StaticDataPlaneBuildFacts, 'queryShapeFacts'>;
  readonly queryShapeFacts: readonly QueryShapeFact[];
}

interface PreEvaluationBuildConfigTrust {
  readonly facts: ReturnType<typeof collectStaticBuildTrustFactsFromProject>;
  readonly files: readonly BuildCheckSourceFile[];
  readonly path: string;
}

/**
 * Re-snapshot only the exact config closure that the disposable analyzer worker approved.
 *
 * Handoff revalidation must prove byte and module-resolution identity, but it must not allocate a
 * second static-analysis heap beside retained app/build graphs. The descriptor-bound source walk
 * rejects escaping/special symlinks and unstable reads and re-resolves extension candidates, so a
 * source edit, config-path swap, or newly shadowing relative module changes this snapshot and fails
 * closed.
 */
export function snapshotKovoBuildConfigTrustSources(
  configPath: string,
  root: string,
): KovoBuildOneShotApprovedConfig {
  const configRoot = dirname(configPath);
  const files = buildMapDense(
    buildCheckSourceGraphFiles(configPath, root),
    'Project-root-relative pre-evaluation config sources',
    (file) => ({
      fileName: slashPath(relative(root, resolve(configRoot, file.fileName))),
      source: file.source,
    }),
  );
  return { files, path: configPath };
}

/** @internal Fail-closed source-only handoff revalidation shared by build and source check. */
export function revalidateKovoBuildConfigTrustSourceSnapshot(
  approved: KovoBuildOneShotApprovedConfig | undefined,
  root: string,
  configPath: string | undefined,
  command: 'build' | 'check',
): KovoBuildOneShotApprovedConfig | undefined {
  const current =
    configPath === undefined ? undefined : snapshotKovoBuildConfigTrustSources(configPath, root);
  if (
    kovoBuildConfigTrustSourceDigest(current, root) !==
    kovoBuildConfigTrustSourceDigest(approved, root)
  ) {
    throw new TypeError(`Kovo ${command} handoff config source is stale.`);
  }
  return current;
}

function kovoBuildConfigTrustSourceDigest(
  snapshot: KovoBuildOneShotApprovedConfig | undefined,
  root: string,
): string | null {
  return snapshot === undefined
    ? null
    : kovoBuildOneShotDigest({
        files: snapshot.files,
        path: slashPath(relative(realpathSync(root), snapshot.path)),
      });
}

function runPreEvaluationBuildConfigTrustPreflight(
  configPath: string,
  root: string,
  paranoidStaticAdvisory: boolean,
  command: 'build' | 'check' = 'build',
): PreEvaluationBuildConfigTrust {
  // SPEC §6.6 rule 6: kovo.config is authored authority-bearing code. Snapshot its exact entry and
  // relative-import closure through the descriptor-bound source capability, classify both eager
  // module execution and deferred preset methods, and only then permit Vite to evaluate those same
  // bytes. Config discovery is intentionally performed once by the caller so an extension swap
  // cannot select a different file after approval.
  const approved = snapshotKovoBuildConfigTrustSources(configPath, root);
  const files = approved.files;
  const entryFileName = relative(root, configPath) || basename(configPath);
  const facts = requiredBuildStaticAnalysisRuntime().collectStaticBuildTrustFactsFromProject({
    buildConfigEntryFileName: slashPath(entryFileName),
    files,
  });
  const { diagnostics, unregisteredSinks } = facts;
  if (diagnostics.length === 0 && unregisteredSinks.length === 0) {
    return { ...approved, facts };
  }

  const result = kovoCheck(
    {
      ...(diagnostics.length === 0 ? {} : { diagnostics }),
      ...(unregisteredSinks.length === 0 ? {} : { unregisteredSinks }),
    },
    { paranoidStaticAdvisory },
  );
  if (result.exitCode === 0) return { ...approved, facts };
  if (paranoidStaticAdvisory && paranoidBuildCheckMayProceed(result.output)) {
    return { ...approved, facts };
  }
  throw new KovoBuildCheckDiagnosticError(
    `kovo ${command} config preflight failed:\n${buildCheckFailureOutput(result.output)}`,
    result.diagnostics,
  );
}

function runPreEvaluationStaticTrustPreflight(
  appModulePath: string,
  root: string,
  paranoidStaticAdvisory: boolean,
): PreEvaluationStaticTrustAnalysis {
  const clientEntry = preEvaluationClientEntryFile(appModulePath, root);
  // SPEC §5.2 rules 6/9 / §6.6: the pre-evaluation authority gate owns only the selected app
  // entry, HTML-selected client module entries, and their exact relative-import closures. A
  // conventional src/ census incorrectly promotes unimported copy-in catalogs and authored
  // tooling into app runtime authority, and multiplies every whole-project analyzer pass.
  const files = preEvaluationAppSourceFiles(appModulePath, root, clientEntry);
  const approvedSourceFiles = preEvaluationApprovedBuildFiles(appModulePath, root, files);
  // Parse and lower this exact snapshot before deriving the loader manifest. Private ABI rows are
  // admitted only when the reviewed compiler added their exact names; authored spellings remain
  // ordinary closed package edges (SPEC §5.2 rule 10 / §6.6).
  const sourceGraphFacts = sourceGraphFactsFromFiles(files, root);
  const packageRequests = collectCapabilityPackageRequests(
    files,
    sourceGraphFacts.compilerDependencies,
  );
  const capabilityClosure = analyzeCapabilityClosure({
    compilerDependencies: sourceGraphFacts.compilerDependencies,
    files,
    packageSummaries: readCapabilityPackageSummaries(root),
    packages: resolveCapabilityPackages(packageRequests, appModulePath),
  });
  // The same typed component/semantic facts are retained for graph assembly below; neither the
  // verdict nor framework identity is re-derived from disk.
  const compilerDiagnostics = buildPreflightComponentDiagnostics(sourceGraphFacts.components);
  const compilerSecurityRegisteredDiagnostics = buildFilterDense(
    compilerDiagnostics,
    'Pre-evaluation registered compiler security diagnostics',
    (diagnostic) =>
      diagnostic.code === 'KV235' ||
      diagnostic.code === 'KV449' ||
      diagnostic.code === 'KV450' ||
      diagnostic.code === 'KV452',
  );
  const compilerSecurityDiagnostics = buildMapDense(
    compilerSecurityRegisteredDiagnostics,
    'Pre-evaluation compiler security diagnostic facts',
    staticDiagnosticFact,
  );
  // SPEC §6.6: authored modules are untrusted inputs to the compiler. Reject statically visible
  // authority and credential-wire escapes before SSR evaluation can execute top-level app code.
  // TASK B may consume only semantic summaries bound to these exact source bytes.
  const facts =
    files.length === 0
      ? {
          capabilities: [],
          cookieDowngrades: [],
          diagnostics: [],
          revealed: [],
          trustEscapes: [],
          unregisteredSinks: [],
        }
      : requiredBuildStaticAnalysisRuntime().collectStaticBuildTrustFactsFromProject({
          // SPEC §6.6 TASK B: the residual parser receives the compiler-owned exact app-contract
          // resolution, not a structural `.task`/`.mutation` spelling. Drizzle independently
          // validates every file/source/span/member/owner row before using it to reconstruct the
          // same enrolled root and compare the semantic and capability carriers below.
          appContractStaticFacts: sourceGraphFacts.appContractStaticFacts,
          compilerSecuritySemanticSources: sourceGraphFacts.compilerSecuritySemanticSources,
          compilerTaskBClosure: {
            capabilityFacts: capabilityClosure.facts,
            dependencyManifest: capabilityClosure.dependencyManifest,
            finiteVerdict: sourceGraphFacts.compilerTaskBFiniteVerdict,
            files,
            schema: 'kovo-task-b-closure/v2',
          },
          files,
        });
  const accessGuardRegisteredDiagnostics = buildFilterDense(
    compilerDiagnostics,
    'Pre-evaluation registered compiler access/guard diagnostics',
    (diagnostic) => diagnostic.code === 'KV436',
  );
  const accessGuardDiagnostics = buildMapDense(
    accessGuardRegisteredDiagnostics,
    'Pre-evaluation compiler access/guard diagnostic facts',
    staticDiagnosticFact,
  );
  const capabilityClosureRegisteredDiagnostics = buildSnapshotDenseArray(
    capabilityClosure.diagnostics,
    'Pre-evaluation registered capability-closure diagnostics',
  );
  const capabilityClosureDiagnostics = buildMapDense(
    capabilityClosureRegisteredDiagnostics,
    'Capability-closure diagnostics',
    staticDiagnosticFact,
  );
  const preEvaluationDiagnostics = buildConcatDense(
    buildConcatDense(
      accessGuardDiagnostics,
      capabilityClosureDiagnostics,
      'Pre-evaluation access/capability diagnostics',
    ),
    compilerSecurityDiagnostics,
    'Pre-evaluation compiler-routed security diagnostics',
  );
  const { diagnostics: revealDiagnostics, unregisteredSinks } = facts;
  const allPreEvaluationDiagnostics = buildConcatDense(
    preEvaluationDiagnostics,
    revealDiagnostics,
    'Pre-evaluation compiler and runtime-reveal audit diagnostics',
  );
  if (unregisteredSinks.length === 0 && allPreEvaluationDiagnostics.length === 0) {
    return {
      approvedSourceFiles,
      capabilityClosure,
      ...(clientEntry === undefined ? {} : { clientEntry }),
      facts,
      files,
      sourceGraphFacts,
    };
  }

  const result = kovoCheck(
    {
      ...(allPreEvaluationDiagnostics.length === 0
        ? {}
        : { diagnostics: allPreEvaluationDiagnostics }),
      ...(unregisteredSinks.length === 0 ? {} : { unregisteredSinks }),
    },
    { paranoidStaticAdvisory },
  );
  if (result.exitCode === 0) {
    return {
      approvedSourceFiles,
      capabilityClosure,
      ...(clientEntry === undefined ? {} : { clientEntry }),
      facts,
      files,
      sourceGraphFacts,
    };
  }
  if (paranoidStaticAdvisory && paranoidBuildCheckMayProceed(result.output)) {
    return {
      approvedSourceFiles,
      capabilityClosure,
      ...(clientEntry === undefined ? {} : { clientEntry }),
      facts,
      files,
      sourceGraphFacts,
    };
  }

  const registeredPreEvaluationDiagnostics = buildConcatDense(
    buildConcatDense(
      accessGuardRegisteredDiagnostics,
      capabilityClosureRegisteredDiagnostics,
      'Registered pre-evaluation access/capability diagnostics',
    ),
    compilerSecurityRegisteredDiagnostics,
    'Registered pre-evaluation compiler diagnostics',
  );
  const projectedPreEvaluationDiagnostics = buildConcatDense(
    buildConcatDense(
      buildMapDense(
        registeredPreEvaluationDiagnostics,
        'Projected registered pre-evaluation worker diagnostics',
        (diagnostic) => projectKovoDiagnostic(diagnostic, 'proof'),
      ),
      buildMapDense(
        revealDiagnostics,
        'Projected static pre-evaluation worker diagnostics',
        projectStaticTrustDiagnosticForWorker,
      ),
      'Projected pre-evaluation source diagnostics',
    ),
    buildMapDense(
      unregisteredSinks,
      'Projected pre-evaluation unregistered sinks',
      projectStaticTrustUnregisteredSinkForWorker,
    ),
    'Complete projected pre-evaluation diagnostics',
  );
  throw new KovoBuildCheckDiagnosticError(
    `kovo build check preflight failed:\n${buildCheckFailureOutput(result.output)}`,
    projectedPreEvaluationDiagnostics.length === 0
      ? result.diagnostics
      : projectedPreEvaluationDiagnostics,
  );
}

async function derivePreEvaluationStaticProof(
  trust: PreEvaluationStaticTrustAnalysis,
  cache: boolean,
): Promise<PreEvaluationStaticDerivedProof> {
  const dataPlaneFacts =
    trust.files.length === 0
      ? emptyStaticDataPlaneBuildFacts()
      : await requiredBuildStaticAnalysisRuntime().staticDataPlaneBuildFacts(trust.files, {
          appContractStaticFacts: trust.sourceGraphFacts.appContractStaticFacts,
          cache,
        });
  const queryShapeFacts = requiredBuildStaticAnalysisRuntime().buildCompilerQueryShapeFacts(
    trust.files,
    dataPlaneFacts,
    trust.sourceGraphFacts.appContractStaticFacts,
  ) as readonly QueryShapeFact[];
  const { queryShapeFacts: _redundantQueryShapeFacts, ...compactDataPlaneFacts } = dataPlaneFacts;
  return {
    browserPosture: deriveBrowserPostureManifestFromSourceFiles(trust.files),
    dataPlaneFacts: compactDataPlaneFacts,
    queryShapeFacts,
  };
}

interface StaticTrustWorkerSuccessPayload {
  readonly approvedSourceFiles: readonly BuildCheckSourceFile[];
  readonly capabilityClosure: AnalyzeCapabilityClosureResult;
  readonly clientEntry?: BuildCheckSourceFile;
  readonly derivedProof?: PreEvaluationStaticDerivedProof;
  readonly facts: ReturnType<typeof collectStaticBuildTrustFactsFromProject>;
  readonly files: readonly BuildCheckSourceFile[];
  readonly sourceGraphFacts: Omit<
    StaticTrustSourceGraphFacts,
    'registryDeclarationAnchors' | 'routeOutcomes'
  > & {
    readonly registryDeclarationAnchors: readonly (readonly [
      string,
      KovoDiagnosticSourceAnchor | null,
    ])[];
    readonly routeOutcomes: readonly (readonly [string, 'file' | 'stream'])[];
  };
}

interface StaticTrustWorkerEnvelope {
  readonly authentication: string;
  readonly digest: string;
  readonly factsDigest?: string;
  readonly payload: string;
  readonly requestDigest: string;
  readonly schema: typeof staticTrustWorkerSchema;
  readonly sourceDigest?: string;
}

export interface StaticTrustWorkerRequest {
  readonly authenticationKey: string;
  readonly cache: boolean | null;
  readonly challenge: string;
  readonly command: 'build' | 'check' | null;
  readonly kind: 'app' | 'config';
  readonly modulePath: string;
  readonly paranoidStaticAdvisory: boolean;
  readonly root: string;
}

function staticTrustDigest(value: string): string {
  return `sha256:${hash('sha256', bufferFrom(value, 'utf8'), 'hex')}`;
}

function staticTrustRequestDigest(request: StaticTrustWorkerRequest): string {
  return staticTrustDigest(
    stringifyBuildValue({
      cache: request.cache,
      challenge: request.challenge,
      command: request.command,
      kind: request.kind,
      modulePath: request.modulePath,
      paranoidStaticAdvisory: request.paranoidStaticAdvisory,
      root: request.root,
    }),
  );
}

function staticTrustAuthentication(
  authenticationKey: string,
  requestDigest: string,
  payload: string,
): string {
  if (!/^[0-9a-f]{64}$/u.test(authenticationKey)) {
    throw new TypeError('Kovo static-trust worker authentication key is invalid.');
  }
  return `hmac-sha256:${createHmac('sha256', bufferFrom(authenticationKey, 'hex'))
    .update(requestDigest, 'utf8')
    .update('\0', 'utf8')
    .update(payload, 'utf8')
    .digest('hex')}`;
}

function equalStaticTrustAuthentication(actual: string, expected: string): boolean {
  const actualBytes = bufferFrom(actual, 'utf8');
  const expectedBytes = bufferFrom(expected, 'utf8');
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function staticTrustSourceDigest(
  files: readonly BuildCheckSourceFile[],
  clientEntry?: BuildCheckSourceFile,
): string {
  const framed: string[] = [];
  const snapshot = appendDense(
    files,
    clientEntry === undefined ? [] : [clientEntry],
    'Static-trust digest source files',
  );
  for (let index = 0; index < snapshot.length; index += 1) {
    const file = snapshot[index]!;
    const fileNameBytes = bufferFrom(file.fileName, 'utf8');
    const sourceBytes = bufferFrom(file.source, 'utf8');
    buildSecurityArrayAppend(
      framed,
      `${fileNameBytes.length}:${file.fileName}${sourceBytes.length}:${file.source}`,
      'Static-trust source digest frames',
    );
  }
  return staticTrustDigest(buildJoinStrings(framed, '', 'Static-trust source digest frames'));
}

function staticTrustSuccessPayload(
  trust: PreEvaluationStaticTrustAnalysis,
  derivedProof: PreEvaluationStaticDerivedProof | undefined,
): StaticTrustWorkerSuccessPayload {
  return {
    approvedSourceFiles: trust.approvedSourceFiles,
    capabilityClosure: trust.capabilityClosure,
    ...(trust.clientEntry === undefined ? {} : { clientEntry: trust.clientEntry }),
    ...(derivedProof === undefined ? {} : { derivedProof }),
    facts: trust.facts,
    files: trust.files,
    sourceGraphFacts: {
      components: trust.sourceGraphFacts.components,
      domainDeclarationNames: trust.sourceGraphFacts.domainDeclarationNames,
      registryDeclarationAnchors: sortedStaticTrustMapEntries(
        trust.sourceGraphFacts.registryDeclarationAnchors,
      ),
      routeOutcomes: sortedStaticTrustMapEntries(trust.sourceGraphFacts.routeOutcomes),
      routePages: trust.sourceGraphFacts.routePages,
      sourceDerivedRegistryTransforms: trust.sourceGraphFacts.sourceDerivedRegistryTransforms,
    },
  };
}

function sortedStaticTrustMapEntries<Value>(
  values: ReadonlyMap<string, Value>,
): (readonly [string, Value])[] {
  const result: (readonly [string, Value])[] = [];
  for (const entry of values.entries()) {
    buildSecurityArrayAppend(result, entry, 'Static-trust sorted map entries');
    let insertAt = result.length - 1;
    while (insertAt > 0 && result[insertAt - 1]![0] > entry[0]) {
      result[insertAt] = result[insertAt - 1]!;
      insertAt -= 1;
    }
    result[insertAt] = entry;
  }
  return result;
}

/**
 * Internal subprocess entry. The child owns the complete compiler/static-analysis lifetime and
 * returns inert JSON only; authored modules are not evaluated in this process.
 */
export async function runPreEvaluationStaticTrustWorkerRequest(
  requestJson: string,
): Promise<string> {
  const request = parseStaticTrustWorkerRequest(requestJson);
  const requestDigest = staticTrustRequestDigest(request);
  try {
    await installBuildStaticAnalysisRuntime();
    let payload: string;
    let factsDigest: string;
    let sourceDigest: string;
    if (request.kind === 'app') {
      const trust = runPreEvaluationStaticTrustPreflight(
        request.modulePath,
        request.root,
        request.paranoidStaticAdvisory,
      );
      const success = staticTrustSuccessPayload(
        trust,
        request.cache === null
          ? undefined
          : await derivePreEvaluationStaticProof(trust, request.cache),
      );
      payload = stringifyBuildValue({ kind: 'app', status: 'ok', trust: success });
      factsDigest = staticTrustDigest(stringifyBuildValue(success.facts));
      sourceDigest = staticTrustSourceDigest(success.approvedSourceFiles, success.clientEntry);
    } else {
      if (request.command === null) {
        throw new TypeError('Kovo config static-trust request omitted its command.');
      }
      const success = runPreEvaluationBuildConfigTrustPreflight(
        request.modulePath,
        request.root,
        request.paranoidStaticAdvisory,
        request.command,
      );
      payload = stringifyBuildValue({ kind: 'config', status: 'ok', trust: success });
      factsDigest = staticTrustDigest(stringifyBuildValue(success.facts));
      sourceDigest = staticTrustSourceDigest(success.files);
    }
    return stringifyBuildValue({
      authentication: staticTrustAuthentication(request.authenticationKey, requestDigest, payload),
      digest: staticTrustDigest(payload),
      factsDigest,
      payload,
      requestDigest,
      schema: staticTrustWorkerSchema,
      sourceDigest,
    } satisfies StaticTrustWorkerEnvelope);
  } catch (error) {
    const diagnosticError = error instanceof KovoBuildCheckDiagnosticError;
    const payload = stringifyBuildValue({
      error: {
        ...(diagnosticError && error.diagnostics !== undefined
          ? { diagnostics: error.diagnostics }
          : {}),
        kind: diagnosticError ? 'diagnostic' : error instanceof TypeError ? 'type' : 'error',
        message: error instanceof Error ? error.message : String(error),
      },
      status: 'error',
    });
    return stringifyBuildValue({
      authentication: staticTrustAuthentication(request.authenticationKey, requestDigest, payload),
      digest: staticTrustDigest(payload),
      payload,
      requestDigest,
      schema: staticTrustWorkerSchema,
    } satisfies StaticTrustWorkerEnvelope);
  }
}

function parseStaticTrustWorkerRequest(requestJson: string): StaticTrustWorkerRequest {
  const request = jsonParse(requestJson) as unknown;
  if (request === null || typeof request !== 'object' || buildArrayIsArray(request)) {
    throw new TypeError('Kovo static-trust worker received an invalid request.');
  }
  assertStaticTrustExactKeys(
    request,
    [
      'authenticationKey',
      'cache',
      'challenge',
      'command',
      'kind',
      'modulePath',
      'paranoidStaticAdvisory',
      'root',
    ],
    'request',
  );
  const authenticationKey = buildOwnDataValue(
    request,
    'authenticationKey',
    'Static-trust worker request',
  );
  const cache = buildOwnDataValue(request, 'cache', 'Static-trust worker request');
  const challenge = buildOwnDataValue(request, 'challenge', 'Static-trust worker request');
  const command = buildOwnDataValue(request, 'command', 'Static-trust worker request');
  const kind = buildOwnDataValue(request, 'kind', 'Static-trust worker request');
  const modulePath = buildOwnDataValue(request, 'modulePath', 'Static-trust worker request');
  const paranoidStaticAdvisory = buildOwnDataValue(
    request,
    'paranoidStaticAdvisory',
    'Static-trust worker request',
  );
  const root = buildOwnDataValue(request, 'root', 'Static-trust worker request');
  if (
    typeof authenticationKey !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(authenticationKey) ||
    (typeof cache !== 'boolean' && cache !== null) ||
    typeof challenge !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(challenge) ||
    (command !== 'build' && command !== 'check' && command !== null) ||
    (kind !== 'app' && kind !== 'config') ||
    typeof modulePath !== 'string' ||
    typeof paranoidStaticAdvisory !== 'boolean' ||
    typeof root !== 'string' ||
    (kind === 'app' && command !== null) ||
    (kind === 'config' && (command === null || cache !== null))
  ) {
    throw new TypeError('Kovo static-trust worker received an invalid request.');
  }
  return {
    authenticationKey,
    cache,
    challenge,
    command,
    kind,
    modulePath,
    paranoidStaticAdvisory,
    root,
  };
}

async function runPreEvaluationStaticTrustPreflightInWorker(
  appModulePath: string,
  root: string,
  paranoidStaticAdvisory: boolean,
  invocationEnv: NodeJS.ProcessEnv,
  cache: boolean | null,
): Promise<PreEvaluationStaticTrust> {
  const workerRequest: StaticTrustWorkerRequest = {
    authenticationKey: randomBytes(32).toString('hex'),
    cache,
    challenge: randomBytes(32).toString('hex'),
    command: null,
    kind: 'app',
    modulePath: appModulePath,
    paranoidStaticAdvisory,
    root,
  };
  return staticTrustFromWorkerEnvelopeForTesting(
    await executeStaticTrustWorker(workerRequest, invocationEnv),
    workerRequest,
  );
}

async function runPreEvaluationBuildConfigTrustPreflightInWorker(
  configPath: string,
  root: string,
  paranoidStaticAdvisory: boolean,
  command: 'build' | 'check',
  invocationEnv: NodeJS.ProcessEnv,
): Promise<PreEvaluationBuildConfigTrust> {
  const workerRequest: StaticTrustWorkerRequest = {
    authenticationKey: randomBytes(32).toString('hex'),
    cache: null,
    challenge: randomBytes(32).toString('hex'),
    command,
    kind: 'config',
    modulePath: configPath,
    paranoidStaticAdvisory,
    root,
  };
  return staticConfigTrustFromWorkerEnvelopeForTesting(
    await executeStaticTrustWorker(workerRequest, invocationEnv),
    workerRequest,
  );
}

async function executeStaticTrustWorker(
  workerRequest: StaticTrustWorkerRequest,
  invocationEnv: NodeJS.ProcessEnv,
): Promise<string> {
  const currentModulePath = fileURLToPath(import.meta.url);
  const sourceMode = buildStringEndsWith(currentModulePath, '.ts');
  const packagedWorkerPath = resolve(
    dirname(currentModulePath),
    'commands/build-static-trust-worker.mjs',
  );
  // Package builds place the worker at dist/commands beside shared chunks. The repository root
  // acceptance bundle preserves entry source paths under dist/cli/src while sharing chunks at
  // dist/. Resolve that finite, framework-owned layout without falling back to authored paths.
  const rootAcceptanceWorkerPath = resolve(
    dirname(currentModulePath),
    'cli/src/commands/build-static-trust-worker.mjs',
  );
  const workerPath = sourceMode
    ? resolve(dirname(currentModulePath), 'build-static-trust-worker.ts')
    : existsSync(packagedWorkerPath)
      ? packagedWorkerPath
      : rootAcceptanceWorkerPath;
  const request = stringifyBuildValue(workerRequest);
  try {
    const result = await executeBoundedStaticTrustWorkerProcess(
      process.execPath,
      [
        ...(sourceMode
          ? [
              '--disable-warning=ExperimentalWarning',
              '--experimental-transform-types',
              '--import',
              pathToFileURL(
                resolve(dirname(currentModulePath), 'build-static-trust-source-hook.mjs'),
              ).href,
            ]
          : []),
        workerPath,
        request,
      ],
      invocationEnv,
      staticTrustWorkerTimeoutMs,
    );
    return result.stdout;
  } catch (error) {
    throw new Error(`Kovo static-trust worker failed: ${execFileErrorOutput(error)}`);
  }
}

interface StaticTrustWorkerProcessResult {
  readonly stderr: string;
  readonly stdout: string;
}

function executeBoundedStaticTrustWorkerProcess(
  executable: string,
  args: readonly string[],
  invocationEnv: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<StaticTrustWorkerProcessResult> {
  return new Promise((resolveProcess, rejectProcess) => {
    let timedOut = false;
    let outputExceeded = false;
    let spawnError: Error | undefined;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn(executable, args, {
      detached: processPlatform !== 'win32',
      env: invocationEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const appendOutput = (chunks: Buffer[], chunk: Buffer, stream: 'stderr' | 'stdout'): void => {
      if (outputExceeded) return;
      const nextBytes = (stream === 'stdout' ? stdoutBytes : stderrBytes) + chunk.byteLength;
      if (nextBytes > staticTrustWorkerMaxOutputBytes) {
        outputExceeded = true;
        terminateStaticTrustWorkerProcessTree(child);
        return;
      }
      chunks.push(chunk);
      if (stream === 'stdout') stdoutBytes = nextBytes;
      else stderrBytes = nextBytes;
    };
    child.stdout.on('data', (chunk: Buffer) => appendOutput(stdoutChunks, chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => appendOutput(stderrChunks, chunk, 'stderr'));
    child.once('error', (error) => {
      spawnError = error;
    });
    const timeout = staticSetTimeout(() => {
      timedOut = true;
      terminateStaticTrustWorkerProcessTree(child);
    }, timeoutMs);
    child.once('close', (code, signal) => {
      staticClearTimeout(timeout);
      const stdout = builtinBuffer.concat(stdoutChunks).toString('utf8');
      const stderr = builtinBuffer.concat(stderrChunks).toString('utf8');
      if (timedOut) {
        const message = `Kovo static-trust worker exceeded its ${String(timeoutMs)}ms deadline.`;
        rejectProcess(staticTrustWorkerProcessError(message, stdout, stderr));
        return;
      }
      if (outputExceeded) {
        rejectProcess(
          staticTrustWorkerProcessError(
            `Kovo static-trust worker output exceeded ${String(staticTrustWorkerMaxOutputBytes)} bytes.`,
            stdout,
            stderr,
          ),
        );
        return;
      }
      if (spawnError !== undefined) {
        rejectProcess(staticTrustWorkerProcessError(spawnError.message, stdout, stderr));
        return;
      }
      if (code !== 0) {
        rejectProcess(
          staticTrustWorkerProcessError(
            `Kovo static-trust worker exited with code ${String(code)} signal ${String(signal)}.`,
            stdout,
            stderr,
          ),
        );
        return;
      }
      resolveProcess({ stderr, stdout });
    });
  });
}

function staticTrustWorkerProcessError(message: string, stdout: string, stderr: string): Error {
  const processError = new Error(message) as Error & { stderr: string; stdout: string };
  processError.stdout = stdout;
  processError.stderr = stderr.length === 0 ? message : `${stderr}\n${message}`;
  return processError;
}

function terminateStaticTrustWorkerProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;

  if (processPlatform !== 'win32') {
    try {
      // The worker is its own process-group leader. Kill the entire group so Vite/OXC descendants
      // cannot retain stdout/stderr and keep the close event alive past the stated deadline.
      processKill(-pid, 'SIGKILL');
      return;
    } catch {
      // If process-group delivery races process startup or is unavailable, still fail closed on the
      // direct worker. Termination is called from stream/timer handlers and must never escape them.
      terminateStaticTrustWorkerProcess(pid);
    }
    return;
  }

  // Node has no negative-PID process groups on Windows. taskkill /T is the platform process-tree
  // primitive; the direct kill remains a fail-closed fallback if taskkill itself cannot launch.
  const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  taskkill.once('error', () => terminateStaticTrustWorkerProcess(pid));
  taskkill.once('exit', (code) => {
    if (code !== 0) terminateStaticTrustWorkerProcess(pid);
  });
}

function terminateStaticTrustWorkerProcess(pid: number): void {
  try {
    processKill(pid, 'SIGKILL');
  } catch {
    // The worker may already have exited between the deadline/output check and signal delivery.
  }
}

/** @internal Deterministic process-tree deadline seam for orchestration regression tests. */
export async function boundedStaticTrustWorkerProcessForTesting(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string> {
  const result = await executeBoundedStaticTrustWorkerProcess(
    executable,
    args,
    process.env,
    timeoutMs,
  );
  return result.stdout;
}

/** @internal Adversarial protocol seam; production callers consume the same fail-closed parser. */
export function staticTrustFromWorkerEnvelopeForTesting(
  output: string,
  expectedRequest: StaticTrustWorkerRequest,
): PreEvaluationStaticTrust {
  if (expectedRequest.kind !== 'app') {
    throw new TypeError('Kovo app static-trust parser received a config request.');
  }
  const success = authenticatedStaticTrustWorkerSuccess(output, expectedRequest);
  return validateStaticTrustSuccess(success.envelope, success.trust, expectedRequest);
}

/** @internal Adversarial config protocol seam; production consumes the same fail-closed parser. */
export function staticConfigTrustFromWorkerEnvelopeForTesting(
  output: string,
  expectedRequest: StaticTrustWorkerRequest,
): PreEvaluationBuildConfigTrust {
  if (expectedRequest.kind !== 'config') {
    throw new TypeError('Kovo config static-trust parser received an app request.');
  }
  const success = authenticatedStaticTrustWorkerSuccess(output, expectedRequest);
  return validateStaticConfigTrustSuccess(success.envelope, success.trust, expectedRequest);
}

function authenticatedStaticTrustWorkerSuccess(
  output: string,
  expectedRequest: StaticTrustWorkerRequest,
): { readonly envelope: object; readonly trust: unknown } {
  if (buildByteLength(output) > staticTrustWorkerMaxOutputBytes) {
    throw new TypeError('Kovo static-trust worker output exceeded its byte limit.');
  }
  let envelopeValue: unknown;
  try {
    envelopeValue = jsonParse(output);
  } catch {
    throw new TypeError('Kovo static-trust worker returned malformed output.');
  }
  if (
    envelopeValue === null ||
    typeof envelopeValue !== 'object' ||
    buildArrayIsArray(envelopeValue)
  ) {
    throw new TypeError('Kovo static-trust worker returned an invalid envelope.');
  }
  const schema = buildOwnDataValue(envelopeValue, 'schema', 'Static-trust worker envelope');
  const authentication = buildOwnDataValue(
    envelopeValue,
    'authentication',
    'Static-trust worker envelope',
  );
  const digest = buildOwnDataValue(envelopeValue, 'digest', 'Static-trust worker envelope');
  const payload = buildOwnDataValue(envelopeValue, 'payload', 'Static-trust worker envelope');
  const requestDigest = buildOwnDataValue(
    envelopeValue,
    'requestDigest',
    'Static-trust worker envelope',
  );
  const expectedRequestDigest = staticTrustRequestDigest(expectedRequest);
  if (
    schema !== staticTrustWorkerSchema ||
    typeof authentication !== 'string' ||
    typeof digest !== 'string' ||
    typeof payload !== 'string' ||
    requestDigest !== expectedRequestDigest ||
    !equalStaticTrustAuthentication(
      authentication,
      staticTrustAuthentication(expectedRequest.authenticationKey, expectedRequestDigest, payload),
    ) ||
    digest !== staticTrustDigest(payload)
  ) {
    throw new TypeError('Kovo static-trust worker returned an unauthenticated envelope.');
  }
  let payloadValue: unknown;
  try {
    payloadValue = jsonParse(payload);
  } catch {
    throw new TypeError('Kovo static-trust worker returned a malformed payload.');
  }
  if (
    payloadValue === null ||
    typeof payloadValue !== 'object' ||
    buildArrayIsArray(payloadValue)
  ) {
    throw new TypeError('Kovo static-trust worker returned an invalid payload.');
  }
  const status = buildOwnDataValue(payloadValue, 'status', 'Static-trust worker payload');
  if (status === 'error') {
    assertStaticTrustExactKeys(
      envelopeValue,
      ['authentication', 'digest', 'payload', 'requestDigest', 'schema'],
      'error envelope',
    );
    const error = buildOwnDataValue(payloadValue, 'error', 'Static-trust worker payload');
    if (error === null || typeof error !== 'object' || buildArrayIsArray(error)) {
      throw new TypeError('Kovo static-trust worker returned an invalid error.');
    }
    const message = buildOwnDataValue(error, 'message', 'Static-trust worker error');
    const kind = buildOwnDataValue(error, 'kind', 'Static-trust worker error');
    if (typeof message !== 'string') {
      throw new TypeError('Kovo static-trust worker returned an invalid error message.');
    }
    if (kind === 'diagnostic') {
      const diagnostics = buildOwnDataValue(error, 'diagnostics', 'Static-trust worker error');
      return throwStaticTrustDiagnostic(message, diagnostics);
    }
    if (kind === 'type') throw new TypeError(message);
    throw new Error(message);
  }
  if (status !== 'ok') {
    throw new TypeError('Kovo static-trust worker returned an unknown payload status.');
  }
  assertStaticTrustExactKeys(payloadValue, ['kind', 'status', 'trust'], 'success payload');
  if (
    buildOwnDataValue(payloadValue, 'kind', 'Static-trust worker payload') !== expectedRequest.kind
  ) {
    throw new TypeError('Kovo static-trust worker returned the wrong proof kind.');
  }
  assertStaticTrustExactKeys(
    envelopeValue,
    [
      'authentication',
      'digest',
      'factsDigest',
      'payload',
      'requestDigest',
      'schema',
      'sourceDigest',
    ],
    'success envelope',
  );
  const trustValue = buildOwnDataValue(payloadValue, 'trust', 'Static-trust worker payload');
  return { envelope: envelopeValue, trust: trustValue };
}

function throwStaticTrustDiagnostic(message: string, diagnostics: unknown): never {
  if (diagnostics !== undefined && !buildArrayIsArray(diagnostics)) {
    throw new TypeError('Kovo static-trust worker returned invalid diagnostics.');
  }
  const rehydrated =
    diagnostics === undefined
      ? undefined
      : buildMapDense(
          buildSnapshotDenseArray(
            diagnostics as readonly unknown[],
            'Static-trust worker error diagnostics',
          ),
          'Rehydrated static-trust worker error diagnostics',
          (diagnostic, index) =>
            rehydrateStaticTrustWorkerDiagnostic(
              diagnostic,
              `Static-trust worker error diagnostics[${index}]`,
            ),
        );
  throw new KovoBuildCheckDiagnosticError(message, rehydrated);
}

/**
 * Re-enroll one authenticated worker diagnostic in this process's private CLI registry.
 *
 * The worker HMAC authenticates bytes, not WeakSet identity. Treating parsed JSON as a
 * `KovoDiagnosticRecord` would make the later formatter discard real KV findings as an
 * unauthenticated `KOVO_DIAGNOSTIC_CONTRACT` fallback. Validate the finite wire shape, remint the
 * core diagnostic through its code registry, then project it into the exact original category.
 */
function rehydrateStaticTrustWorkerDiagnostic(value: unknown, label: string): KovoDiagnosticRecord {
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  assertStaticTrustAllowedKeys(
    value,
    ['category', 'code', 'help', 'message', 'severity', 'source', 'version'],
    ['category', 'code', 'message', 'severity', 'version'],
    label,
  );
  const category = buildOwnDataValue(value, 'category', label);
  const code = buildOwnDataValue(value, 'code', label);
  const help = buildOwnDataValue(value, 'help', label);
  const message = buildOwnDataValue(value, 'message', label);
  const severity = buildOwnDataValue(value, 'severity', label);
  const source = buildOwnDataValue(value, 'source', label);
  const version = buildOwnDataValue(value, 'version', label);
  if (
    (category !== 'build' &&
      category !== 'config' &&
      category !== 'proof' &&
      category !== 'runtime') ||
    !isDiagnosticCode(code) ||
    (help !== undefined && (typeof help !== 'string' || help.length === 0)) ||
    typeof message !== 'string' ||
    message.length === 0 ||
    typeof severity !== 'string' ||
    version !== KOVO_DIAGNOSTIC_VERSION
  ) {
    throw new TypeError(`${label} has an invalid diagnostic wire shape.`);
  }
  const registered = createRegisteredDiagnostic(code, source === undefined ? {} : { source }, {
    ...(help === undefined ? {} : { help }),
    message,
  });
  if (registered.severity !== severity) {
    throw new TypeError(`${label}.severity does not match the registered diagnostic definition.`);
  }
  return projectKovoDiagnostic(registered, category);
}

function assertStaticTrustExactKeys(
  value: object,
  expectedKeys: readonly string[],
  label: string,
): void {
  const keys = buildObjectKeys(value);
  if (keys.length !== expectedKeys.length) {
    throw new TypeError(`Kovo static-trust worker returned invalid ${label} fields.`);
  }
  for (let expectedIndex = 0; expectedIndex < expectedKeys.length; expectedIndex += 1) {
    const expected = expectedKeys[expectedIndex]!;
    let found = false;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      if (keys[keyIndex] === expected) {
        found = true;
        break;
      }
    }
    if (!found) {
      throw new TypeError(`Kovo static-trust worker omitted ${label}.${expected}.`);
    }
  }
}

function assertStaticTrustAllowedKeys(
  value: object,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
): void {
  const keys = buildObjectKeys(value);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    let allowed = false;
    for (let allowedIndex = 0; allowedIndex < allowedKeys.length; allowedIndex += 1) {
      if (keys[keyIndex] === allowedKeys[allowedIndex]) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      throw new TypeError(`Kovo static-trust worker returned unsupported ${label} field.`);
    }
  }
  for (let requiredIndex = 0; requiredIndex < requiredKeys.length; requiredIndex += 1) {
    if (
      !buildOwnDataProperty(value, requiredKeys[requiredIndex]!, `Static-trust ${label}`).present
    ) {
      throw new TypeError(
        `Kovo static-trust worker omitted ${label}.${requiredKeys[requiredIndex]}.`,
      );
    }
  }
}

function validateStaticTrustSuccess(
  envelope: object,
  value: unknown,
  expectedRequest: StaticTrustWorkerRequest,
): PreEvaluationStaticTrust {
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) {
    throw new TypeError('Kovo static-trust worker returned invalid trust facts.');
  }
  assertStaticTrustAllowedKeys(
    value,
    [
      'approvedSourceFiles',
      'capabilityClosure',
      'clientEntry',
      'derivedProof',
      'facts',
      'files',
      'sourceGraphFacts',
    ],
    [
      'approvedSourceFiles',
      'capabilityClosure',
      ...(expectedRequest.cache === null ? [] : ['derivedProof']),
      'facts',
      'files',
      'sourceGraphFacts',
    ],
    'trust facts',
  );
  const approvedSourceFiles = validateStaticTrustSourceFiles(
    buildOwnDataValue(value, 'approvedSourceFiles', 'Static-trust worker facts'),
    'approved source files',
  );
  const files = validateStaticTrustSourceFiles(
    buildOwnDataValue(value, 'files', 'Static-trust worker facts'),
    'source files',
  );
  assertStaticTrustSourceSubset(files, approvedSourceFiles);
  const facts = buildOwnDataValue(value, 'facts', 'Static-trust worker facts');
  if (facts === null || typeof facts !== 'object' || buildArrayIsArray(facts)) {
    throw new TypeError('Kovo static-trust worker returned invalid build facts.');
  }
  const buildFactKeys = [
    'capabilities',
    'cookieDowngrades',
    'diagnostics',
    'revealed',
    'trustEscapes',
    'unregisteredSinks',
  ] as const;
  for (let index = 0; index < buildFactKeys.length; index += 1) {
    staticTrustArrayProperty(facts, buildFactKeys[index]!, 'build facts');
  }
  const factsDigest = buildOwnDataValue(envelope, 'factsDigest', 'Static-trust worker envelope');
  if (factsDigest !== staticTrustDigest(stringifyBuildValue(facts))) {
    throw new TypeError('Kovo static-trust worker returned a stale facts digest.');
  }
  const sourceGraphValue = buildOwnDataValue(
    value,
    'sourceGraphFacts',
    'Static-trust worker facts',
  );
  if (
    sourceGraphValue === null ||
    typeof sourceGraphValue !== 'object' ||
    buildArrayIsArray(sourceGraphValue)
  ) {
    throw new TypeError('Kovo static-trust worker returned invalid source-graph facts.');
  }
  const registryDeclarationAnchors = staticTrustMap(
    buildOwnDataValue(
      sourceGraphValue,
      'registryDeclarationAnchors',
      'Static-trust source-graph facts',
    ),
    'registry declaration anchors',
    (entry, key) =>
      staticTrustRegistryDeclarationKey(key) &&
      (entry === null || staticTrustSourceAnchor(entry, files)),
  );
  const routeOutcomes = staticTrustMap(
    buildOwnDataValue(sourceGraphValue, 'routeOutcomes', 'Static-trust source-graph facts'),
    'route outcomes',
    (entry) => entry === 'file' || entry === 'stream',
  );
  const sourceGraphArrayKeys = [
    'components',
    'domainDeclarationNames',
    'routePages',
    'sourceDerivedRegistryTransforms',
  ] as const;
  for (let index = 0; index < sourceGraphArrayKeys.length; index += 1) {
    staticTrustArrayProperty(sourceGraphValue, sourceGraphArrayKeys[index]!, 'source-graph facts');
  }
  const components = rehydrateStaticTrustComponents(
    buildOwnDataValue(sourceGraphValue, 'components', 'Static-trust source-graph facts'),
  );
  assertStaticTrustExactKeys(
    sourceGraphValue,
    [
      'components',
      'domainDeclarationNames',
      'registryDeclarationAnchors',
      'routeOutcomes',
      'routePages',
      'sourceDerivedRegistryTransforms',
    ],
    'source-graph facts',
  );
  const sourceDerivedRegistryTransforms = buildOwnDataValue(
    sourceGraphValue,
    'sourceDerivedRegistryTransforms',
    'Static-trust source-graph facts',
  );
  if (!buildArrayIsArray(sourceDerivedRegistryTransforms)) {
    throw new TypeError('Kovo static-trust worker returned invalid registry transforms.');
  }
  assertStaticTrustTransforms(sourceDerivedRegistryTransforms, files);
  const clientEntryValue = buildOwnDataValue(value, 'clientEntry', 'Static-trust worker facts');
  const clientEntry =
    clientEntryValue === undefined
      ? undefined
      : validateStaticTrustSourceFiles([clientEntryValue], 'client entry')[0]!;
  const sourceDigest = buildOwnDataValue(envelope, 'sourceDigest', 'Static-trust worker envelope');
  if (sourceDigest !== staticTrustSourceDigest(approvedSourceFiles, clientEntry)) {
    throw new TypeError('Kovo static-trust worker returned a stale source digest.');
  }
  const capabilityClosure = buildOwnDataValue(
    value,
    'capabilityClosure',
    'Static-trust worker facts',
  );
  if (capabilityClosure === null || typeof capabilityClosure !== 'object') {
    throw new TypeError('Kovo static-trust worker returned invalid capability facts.');
  }
  if (
    buildOwnDataValue(capabilityClosure, 'dependencyManifest', 'Static-trust capability facts') ===
      null ||
    typeof buildOwnDataValue(
      capabilityClosure,
      'dependencyManifest',
      'Static-trust capability facts',
    ) !== 'object'
  ) {
    throw new TypeError('Kovo static-trust worker returned invalid capability manifest.');
  }
  const capabilityArrayKeys = ['diagnostics', 'facts', 'packageRequests'] as const;
  for (let index = 0; index < capabilityArrayKeys.length; index += 1) {
    staticTrustArrayProperty(capabilityClosure, capabilityArrayKeys[index]!, 'capability facts');
  }
  const {
    registryDeclarationAnchors: _registryDeclarationAnchors,
    routeOutcomes: _routeOutcomes,
    ...sourceGraphFacts
  } = sourceGraphValue as StaticTrustWorkerSuccessPayload['sourceGraphFacts'];
  const derivedProof = validateStaticTrustDerivedProof(
    buildOwnDataValue(value, 'derivedProof', 'Static-trust worker facts'),
    expectedRequest.cache,
  );
  return {
    approvedSourceFiles,
    capabilityClosure: capabilityClosure as AnalyzeCapabilityClosureResult,
    ...(clientEntry === undefined ? {} : { clientEntry }),
    ...(derivedProof === undefined ? {} : { derivedProof }),
    facts: facts as ReturnType<typeof collectStaticBuildTrustFactsFromProject>,
    files,
    sourceGraphFacts: {
      ...sourceGraphFacts,
      components,
      registryDeclarationAnchors: registryDeclarationAnchors as Map<
        string,
        KovoDiagnosticSourceAnchor | null
      >,
      routeOutcomes: routeOutcomes as Map<string, 'file' | 'stream'>,
    },
  };
}

function validateStaticConfigTrustSuccess(
  envelope: object,
  value: unknown,
  expectedRequest: StaticTrustWorkerRequest,
): PreEvaluationBuildConfigTrust {
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) {
    throw new TypeError('Kovo static-trust worker returned invalid config trust facts.');
  }
  assertStaticTrustExactKeys(value, ['facts', 'files', 'path'], 'config trust facts');
  const path = buildOwnDataValue(value, 'path', 'Static-trust config facts');
  if (path !== expectedRequest.modulePath) {
    throw new TypeError('Kovo static-trust worker returned config facts for the wrong path.');
  }
  const files = validateStaticTrustSourceFiles(
    buildOwnDataValue(value, 'files', 'Static-trust config facts'),
    'config source files',
  );
  const facts = buildOwnDataValue(value, 'facts', 'Static-trust config facts');
  if (facts === null || typeof facts !== 'object' || buildArrayIsArray(facts)) {
    throw new TypeError('Kovo static-trust worker returned invalid config build facts.');
  }
  const buildFactKeys = [
    'capabilities',
    'cookieDowngrades',
    'diagnostics',
    'revealed',
    'trustEscapes',
    'unregisteredSinks',
  ] as const;
  assertStaticTrustExactKeys(facts, buildFactKeys, 'config build facts');
  for (let index = 0; index < buildFactKeys.length; index += 1) {
    staticTrustArrayProperty(facts, buildFactKeys[index]!, 'config build facts');
  }
  const factsDigest = buildOwnDataValue(envelope, 'factsDigest', 'Static-trust worker envelope');
  if (factsDigest !== staticTrustDigest(stringifyBuildValue(facts))) {
    throw new TypeError('Kovo static-trust worker returned a stale config facts digest.');
  }
  const sourceDigest = buildOwnDataValue(envelope, 'sourceDigest', 'Static-trust worker envelope');
  if (sourceDigest !== staticTrustSourceDigest(files)) {
    throw new TypeError('Kovo static-trust worker returned a stale config source digest.');
  }
  return {
    facts: facts as ReturnType<typeof collectStaticBuildTrustFactsFromProject>,
    files,
    path,
  };
}

function validateStaticTrustDerivedProof(
  value: unknown,
  cache: boolean | null,
): PreEvaluationStaticDerivedProof | undefined {
  if (cache === null) {
    if (value !== undefined) {
      throw new TypeError('Kovo static-trust worker returned an unexpected derived proof.');
    }
    return undefined;
  }
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) {
    throw new TypeError('Kovo static-trust worker omitted its derived proof.');
  }
  assertStaticTrustExactKeys(
    value,
    ['browserPosture', 'dataPlaneFacts', 'queryShapeFacts'],
    'derived proof',
  );
  const browserPosture = buildOwnDataValue(value, 'browserPosture', 'Static-trust derived proof');
  const dataPlaneFacts = buildOwnDataValue(value, 'dataPlaneFacts', 'Static-trust derived proof');
  const queryShapeFacts = buildOwnDataValue(value, 'queryShapeFacts', 'Static-trust derived proof');
  if (
    browserPosture === null ||
    typeof browserPosture !== 'object' ||
    buildArrayIsArray(browserPosture) ||
    dataPlaneFacts === null ||
    typeof dataPlaneFacts !== 'object' ||
    buildArrayIsArray(dataPlaneFacts) ||
    !buildArrayIsArray(queryShapeFacts)
  ) {
    throw new TypeError('Kovo static-trust worker returned invalid derived proof facts.');
  }
  const requiredDataPlaneArrays = [
    'grants',
    'massAssignmentFacts',
    'ownerDomains',
    'queries',
    'queryWriteReachability',
    'scopeAudits',
    'sqlSafetyDiagnostics',
    'toctouFacts',
  ] as const;
  assertStaticTrustAllowedKeys(
    dataPlaneFacts,
    [...requiredDataPlaneArrays, 'revealed', 'runtimeTableSecurityManifest', 'touchGraph'],
    requiredDataPlaneArrays,
    'data-plane facts',
  );
  for (let index = 0; index < requiredDataPlaneArrays.length; index += 1) {
    staticTrustArrayProperty(dataPlaneFacts, requiredDataPlaneArrays[index]!, 'data-plane facts');
  }
  const revealed = buildOwnDataValue(dataPlaneFacts, 'revealed', 'Static-trust data-plane facts');
  if (revealed !== undefined && !buildArrayIsArray(revealed)) {
    throw new TypeError('Kovo static-trust worker returned invalid data-plane reveal facts.');
  }
  for (const key of ['runtimeTableSecurityManifest', 'touchGraph'] as const) {
    const entry = buildOwnDataValue(dataPlaneFacts, key, 'Static-trust data-plane facts');
    if (
      entry !== undefined &&
      (entry === null || typeof entry !== 'object' || buildArrayIsArray(entry))
    ) {
      throw new TypeError(`Kovo static-trust worker returned invalid data-plane ${key}.`);
    }
  }
  return {
    browserPosture: browserPosture as ReturnType<
      typeof deriveBrowserPostureManifestFromSourceFiles
    >,
    dataPlaneFacts: dataPlaneFacts as Omit<StaticDataPlaneBuildFacts, 'queryShapeFacts'>,
    queryShapeFacts: queryShapeFacts as readonly QueryShapeFact[],
  };
}

/**
 * Reconstruct compiler diagnostic identity after the trusted static-analysis subprocess boundary.
 *
 * The worker authenticates and descriptor-snapshots compiler output before emitting inert JSON.
 * JSON deliberately cannot carry the diagnostic registry WeakSet identity, so the parent validates
 * the complete finite wire shape and mints a fresh local registered record before any later
 * build/check consumer treats it as compiler truth (SPEC §5.2 rule 5 / §6.6).
 */
function rehydrateStaticTrustComponents(value: unknown): SourceComponentGraphFacts[] {
  const source = buildSnapshotDenseArray(
    value as readonly SourceComponentGraphFacts[],
    'Static-trust source-graph components',
  );
  const components: SourceComponentGraphFacts[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const component = source[index] as unknown;
    if (component === null || typeof component !== 'object' || buildArrayIsArray(component)) {
      throw new TypeError(`Static-trust source-graph components[${index}] must be an object.`);
    }
    const label = `Static-trust source-graph components[${index}]`;
    const diagnosticSource = buildSnapshotDenseArray(
      buildOwnDataValue(component, 'diagnostics', label) as readonly unknown[],
      `${label}.diagnostics`,
    );
    const diagnostics: CompileResult['diagnostics'][number][] = [];
    for (let diagnosticIndex = 0; diagnosticIndex < diagnosticSource.length; diagnosticIndex += 1) {
      buildSecurityArrayAppend(
        diagnostics,
        rehydrateStaticTrustDiagnostic(
          diagnosticSource[diagnosticIndex],
          `${label}.diagnostics[${diagnosticIndex}]`,
        ),
        'Rehydrated static-trust compiler diagnostics',
      );
    }
    buildSecurityArrayAppend(
      components,
      {
        agentGraphFacts: staticTrustComponentArray(component, 'agentGraphFacts', label),
        componentGraphFacts: staticTrustComponentArray(component, 'componentGraphFacts', label),
        diagnostics,
        handlerWriteSinkFacts: staticTrustComponentArray(component, 'handlerWriteSinkFacts', label),
        publishToClientFacts: staticTrustComponentArray(component, 'publishToClientFacts', label),
        taskGraphFacts: staticTrustComponentArray(component, 'taskGraphFacts', label),
        updateCoverage: staticTrustComponentArray(component, 'updateCoverage', label),
      },
      'Rehydrated static-trust source-graph components',
    );
  }
  return components;
}

function staticTrustComponentArray<
  Key extends Exclude<keyof SourceComponentGraphFacts, 'diagnostics'>,
>(component: object, key: Key, label: string): SourceComponentGraphFacts[Key] {
  return buildSnapshotDenseArray(
    buildOwnDataValue(component, key, label) as readonly unknown[],
    `${label}.${key}`,
  ) as unknown as SourceComponentGraphFacts[Key];
}

function rehydrateStaticTrustDiagnostic(
  value: unknown,
  label: string,
): CompileResult['diagnostics'][number] {
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const keys = buildSnapshotDenseArray(buildObjectKeys(value), `${label} keys`);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (
      key !== 'code' &&
      key !== 'fileName' &&
      key !== 'help' &&
      key !== 'length' &&
      key !== 'message' &&
      key !== 'severity' &&
      key !== 'source' &&
      key !== 'start'
    ) {
      throw new TypeError(`${label}.${key} is not a compiler diagnostic field.`);
    }
  }
  const code = buildOwnDataValue(value, 'code', label);
  const fileName = buildOwnDataValue(value, 'fileName', label);
  const help = buildOwnDataValue(value, 'help', label);
  const length = buildOwnDataValue(value, 'length', label);
  const message = buildOwnDataValue(value, 'message', label);
  const severity = buildOwnDataValue(value, 'severity', label);
  if (
    !isDiagnosticCode(code) ||
    typeof fileName !== 'string' ||
    fileName.length === 0 ||
    (help !== undefined && (typeof help !== 'string' || help.length === 0)) ||
    (length !== undefined && !staticTrustNonNegativeInteger(length)) ||
    typeof message !== 'string' ||
    message.length === 0 ||
    typeof severity !== 'string'
  ) {
    throw new TypeError(`${label} has an invalid compiler diagnostic wire shape.`);
  }
  const source = staticTrustDiagnosticSource(buildOwnDataValue(value, 'source', label), label);
  const start = staticTrustDiagnosticStart(buildOwnDataValue(value, 'start', label), label);
  const registered = createRegisteredDiagnostic(
    code,
    {
      fileName,
      ...(length === undefined ? {} : { length }),
      ...(source === undefined ? {} : { source }),
      ...(start === undefined ? {} : { start }),
    },
    {
      ...(help === undefined ? {} : { help }),
      message,
    },
  );
  if (registered.severity !== severity) {
    throw new TypeError(`${label}.severity does not match the registered diagnostic definition.`);
  }
  return registered;
}

function staticTrustDiagnosticSource(
  value: unknown,
  label: string,
): { end: number; file: string; start: number } | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) {
    throw new TypeError(`${label}.source must be an object.`);
  }
  const keys = buildSnapshotDenseArray(buildObjectKeys(value), `${label}.source keys`);
  if (!staticTrustExactKeys(keys, ['end', 'file', 'start'])) {
    throw new TypeError(`${label}.source must contain only end, file, and start.`);
  }
  const end = buildOwnDataValue(value, 'end', `${label}.source`);
  const file = buildOwnDataValue(value, 'file', `${label}.source`);
  const start = buildOwnDataValue(value, 'start', `${label}.source`);
  if (
    !staticTrustNonNegativeInteger(end) ||
    typeof file !== 'string' ||
    file.length === 0 ||
    !staticTrustNonNegativeInteger(start) ||
    start > end
  ) {
    throw new TypeError(`${label}.source has an invalid source range.`);
  }
  return { end, file, start };
}

function staticTrustDiagnosticStart(
  value: unknown,
  label: string,
): { column: number; line: number } | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) {
    throw new TypeError(`${label}.start must be an object.`);
  }
  const keys = buildSnapshotDenseArray(buildObjectKeys(value), `${label}.start keys`);
  if (!staticTrustExactKeys(keys, ['column', 'line'])) {
    throw new TypeError(`${label}.start must contain only column and line.`);
  }
  const column = buildOwnDataValue(value, 'column', `${label}.start`);
  const line = buildOwnDataValue(value, 'line', `${label}.start`);
  if (
    !staticTrustNonNegativeInteger(column) ||
    column < 1 ||
    !staticTrustNonNegativeInteger(line) ||
    line < 1
  ) {
    throw new TypeError(`${label}.start has an invalid line or column.`);
  }
  return { column, line };
}

function staticTrustExactKeys(keys: readonly string[], expected: readonly string[]): boolean {
  if (keys.length !== expected.length) return false;
  const seen = buildCreateSet<string>();
  for (let index = 0; index < keys.length; index += 1) {
    buildSetAdd(seen, keys[index]!);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (!buildSetHas(seen, expected[index]!)) return false;
  }
  return true;
}

function staticTrustNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && value >= 0 && value <= 9_007_199_254_740_991 && value % 1 === 0
  );
}

function validateStaticTrustSourceFiles(value: unknown, label: string): BuildCheckSourceFile[] {
  const files = buildSnapshotDenseArray(
    value as readonly BuildCheckSourceFile[],
    `Static-trust ${label}`,
  );
  if (files.length > 100_000) throw new TypeError(`Kovo static-trust ${label} is too large.`);
  const seen = buildCreateSet<string>();
  let totalBytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index] as unknown;
    if (file === null || typeof file !== 'object' || buildArrayIsArray(file)) {
      throw new TypeError(`Kovo static-trust ${label} contains an invalid file.`);
    }
    const fileName = buildOwnDataValue(file, 'fileName', `Static-trust ${label}`);
    const source = buildOwnDataValue(file, 'source', `Static-trust ${label}`);
    if (
      typeof fileName !== 'string' ||
      typeof source !== 'string' ||
      fileName.length === 0 ||
      buildStringIncludes(fileName, '\0') ||
      isAbsolute(fileName) ||
      slashPath(fileName) !== fileName ||
      buildSomeDense(
        buildStringSplit(fileName, '/'),
        'Static-trust source path segments',
        (segment) => segment === '..',
      ) ||
      buildSetHas(seen, fileName)
    ) {
      throw new TypeError(`Kovo static-trust ${label} contains an invalid path.`);
    }
    buildSetAdd(seen, fileName);
    totalBytes += buildByteLength(fileName) + buildByteLength(source);
    if (totalBytes > staticTrustWorkerMaxOutputBytes) {
      throw new TypeError(`Kovo static-trust ${label} exceeded its byte limit.`);
    }
  }
  return files;
}

function assertStaticTrustSourceSubset(
  subset: readonly BuildCheckSourceFile[],
  superset: readonly BuildCheckSourceFile[],
): void {
  const approved = buildCreateMap<string, string>();
  for (let index = 0; index < superset.length; index += 1) {
    buildMapSet(approved, superset[index]!.fileName, superset[index]!.source);
  }
  for (let index = 0; index < subset.length; index += 1) {
    const file = subset[index]!;
    if (
      !buildMapHas(approved, file.fileName) ||
      buildMapGet(approved, file.fileName) !== file.source
    ) {
      throw new TypeError(`Kovo static-trust source ${file.fileName} is outside approval.`);
    }
  }
}

function staticTrustMap(
  value: unknown,
  label: string,
  validateValue: (value: unknown, key: string) => boolean,
): Map<string, unknown> {
  const entries = buildSnapshotDenseArray(
    value as readonly (readonly [string, unknown])[],
    `Static-trust ${label}`,
  );
  if (entries.length > 1_000_000) throw new TypeError(`Kovo static-trust ${label} is too large.`);
  const result = buildCreateMap<string, unknown>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = buildSnapshotDenseArray(entries[index]!, `Static-trust ${label} entry`);
    if (
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      buildMapHas(result, entry[0]) ||
      !validateValue(entry[1], entry[0])
    ) {
      throw new TypeError(`Kovo static-trust ${label} contains an invalid entry.`);
    }
    buildMapSet(result, entry[0], entry[1]);
  }
  return result;
}

function staticTrustRegistryDeclarationKey(key: string): boolean {
  const parts = buildStringSplit(key, '\0');
  if (parts.length !== 2 || parts[1]!.length === 0) return false;
  const kind = parts[0]!;
  return (
    kind === 'agent' ||
    kind === 'domain' ||
    kind === 'endpoint' ||
    kind === 'mutation' ||
    kind === 'page' ||
    kind === 'query' ||
    kind === 'task' ||
    kind === 'tool' ||
    kind === 'webhook'
  );
}

function staticTrustSourceAnchor(
  value: unknown,
  files: readonly BuildCheckSourceFile[],
): value is KovoDiagnosticSourceAnchor {
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) return false;
  const keys = buildSnapshotDenseArray(
    buildObjectKeys(value),
    'Static-trust registry declaration anchor keys',
  );
  if (!staticTrustExactKeys(keys, ['end', 'file', 'start'])) return false;
  const end = buildOwnDataValue(value, 'end', 'Static-trust registry declaration anchor');
  const file = buildOwnDataValue(value, 'file', 'Static-trust registry declaration anchor');
  const start = buildOwnDataValue(value, 'start', 'Static-trust registry declaration anchor');
  if (
    !staticTrustNonNegativeInteger(end) ||
    typeof file !== 'string' ||
    !staticTrustNonNegativeInteger(start) ||
    start > end
  ) {
    return false;
  }
  for (let index = 0; index < files.length; index += 1) {
    const sourceFile = files[index]!;
    if (sourceFile.fileName === file) return end <= sourceFile.source.length;
  }
  return false;
}

function assertStaticTrustTransforms(
  transforms: readonly unknown[],
  files: readonly BuildCheckSourceFile[],
): void {
  const approved = buildCreateMap<string, string>();
  const seen = buildCreateSet<string>();
  for (let index = 0; index < files.length; index += 1) {
    buildMapSet(approved, files[index]!.fileName, files[index]!.source);
  }
  for (let index = 0; index < transforms.length; index += 1) {
    const transform = transforms[index];
    if (transform === null || typeof transform !== 'object' || buildArrayIsArray(transform)) {
      throw new TypeError('Kovo static-trust worker returned an invalid registry transform.');
    }
    const fileName = buildOwnDataValue(transform, 'fileName', 'Static-trust registry transform');
    const source = buildOwnDataValue(transform, 'source', 'Static-trust registry transform');
    const code = buildOwnDataValue(transform, 'code', 'Static-trust registry transform');
    if (
      typeof fileName !== 'string' ||
      typeof source !== 'string' ||
      (typeof code !== 'string' && code !== null) ||
      !buildMapHas(approved, fileName) ||
      buildMapGet(approved, fileName) !== source ||
      buildSetHas(seen, fileName)
    ) {
      throw new TypeError('Kovo static-trust worker returned a stale registry transform.');
    }
    buildSetAdd(seen, fileName);
  }
  if (transforms.length !== files.length) {
    throw new TypeError('Kovo static-trust worker omitted a registry transform.');
  }
}

function staticTrustArrayProperty(source: object, key: string, label: string): readonly unknown[] {
  const value = buildOwnDataValue(source, key, `Static-trust ${label}`);
  if (!buildArrayIsArray(value)) {
    throw new TypeError(`Kovo static-trust worker returned invalid ${label}.${key}.`);
  }
  return buildSnapshotDenseArray(value, `Static-trust ${label}.${key}`);
}

function preEvaluationClientEntryFile(
  appModulePath: string,
  root: string,
): BuildCheckSourceFile | undefined {
  const clientRoot = kovoClientBuildRoot(appModulePath, root);
  const entryPath = resolve(clientRoot, 'index.html');
  const fileSystem = createCompilerSourceFileSystem(clientRoot);
  if (fileSystem === null) {
    throw new TypeError(`Kovo client root is unavailable or unstable: ${clientRoot}`);
  }
  const kind = fileSystem.kind(entryPath);
  if (kind === 'other' && !existsSync(entryPath)) return undefined;
  if (kind !== 'file') {
    throw new TypeError(`Kovo client entry is not a stable regular file: ${entryPath}`);
  }
  const source = fileSystem.readFile(entryPath);
  if (source === null) {
    throw new TypeError(`Kovo client entry is unavailable or unstable: ${entryPath}`);
  }
  return { fileName: slashPath(relative(root, entryPath)), source };
}

const buildCheckSourceModuleExtensions = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
] as const;

/**
 * Snapshot one authored entry and its relative-import closure without enrolling the server's
 * Drizzle/ts-morph static-analysis runtime in the long-lived build process.
 */
function buildCheckSourceGraphFiles(
  entryModulePath: string,
  sourceBoundaryRoot: string = dirname(entryModulePath),
): BuildCheckSourceFile[] {
  const entryPath = resolve(entryModulePath);
  const boundaryRoot = resolve(sourceBoundaryRoot);
  if (!existsSync(boundaryRoot)) return [];
  if (!buildCheckPathWithinBoundary(boundaryRoot, entryPath)) {
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
  if (!buildCheckSourceModulePath(entryPath)) {
    throw new TypeError(`Kovo source entry is not a supported source module: ${entryPath}`);
  }
  const source = fileSystem.readFile(entryPath);
  if (source === null) {
    throw new TypeError(`Kovo source entry is unavailable or unstable: ${entryPath}`);
  }
  const fileNameRoot = dirname(entryPath);
  const files: BuildCheckSourceFile[] = [
    { fileName: slashPath(relative(fileNameRoot, entryPath)), source },
  ];
  collectBuildCheckImportedSourceFiles(fileNameRoot, boundaryRoot, fileSystem, files);
  return files;
}

function collectBuildCheckImportedSourceFiles(
  fileNameRoot: string,
  boundaryRoot: string,
  fileSystem: CompilerSourceFileSystem,
  files: BuildCheckSourceFile[],
): void {
  const knownPaths = buildCreateSet<string>();
  for (let index = 0; index < files.length; index += 1) {
    buildSetAdd(knownPaths, resolve(fileNameRoot, files[index]!.fileName));
  }
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex]!;
    const importerPath = resolve(fileNameRoot, file.fileName);
    const specifiers = buildSnapshotDenseArray(
      compilerSourceModuleSpecifiers(file.source),
      `Build-check imports for ${file.fileName}`,
    );
    for (let specifierIndex = 0; specifierIndex < specifiers.length; specifierIndex += 1) {
      const specifier = specifiers[specifierIndex]!;
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
      const candidates = buildCheckRelativeSourceCandidates(importerPath, specifier, boundaryRoot);
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        const candidate = candidates[candidateIndex]!;
        const kind = fileSystem.kind(candidate);
        if (kind === 'directory') continue;
        if (kind === 'other') {
          if (existsSync(candidate)) {
            throw new TypeError(
              `Kovo source import resolves through a symbolic link or special entry: ${candidate}`,
            );
          }
          continue;
        }
        if (buildSetHas(knownPaths, candidate)) break;
        if (!buildCheckSourceModulePath(candidate)) break;
        const source = fileSystem.readFile(candidate);
        if (source === null) {
          throw new TypeError(`Kovo imported source is unavailable: ${candidate}`);
        }
        buildSetAdd(knownPaths, candidate);
        buildSecurityArrayAppend(
          files,
          { fileName: slashPath(relative(fileNameRoot, candidate)), source },
          'Build-check imported source closure',
        );
        break;
      }
    }
  }
}

function buildCheckRelativeSourceCandidates(
  importerPath: string,
  specifier: string,
  boundaryRoot: string,
): string[] {
  const queryIndex = specifier.indexOf('?');
  const fragmentIndex = specifier.indexOf('#');
  let end = specifier.length;
  if (queryIndex >= 0) end = Math.min(end, queryIndex);
  if (fragmentIndex >= 0) end = Math.min(end, fragmentIndex);
  const pathSpecifier = specifier.slice(0, end);
  if (pathSpecifier.includes('%')) {
    throw new TypeError(`Kovo relative imports cannot use URL escapes: ${specifier}`);
  }
  const base = resolve(dirname(importerPath), pathSpecifier);
  if (!buildCheckPathWithinBoundary(boundaryRoot, base)) {
    throw new TypeError(`Kovo relative import escapes the app root: ${specifier}`);
  }
  const candidates: string[] = [];
  if (base.endsWith('.mjs')) {
    buildSecurityArrayAppend(candidates, `${base.slice(0, -4)}.mts`, 'Build-check candidates');
  } else if (base.endsWith('.cjs')) {
    buildSecurityArrayAppend(candidates, `${base.slice(0, -4)}.cts`, 'Build-check candidates');
  } else if (base.endsWith('.jsx')) {
    buildSecurityArrayAppend(candidates, `${base.slice(0, -4)}.tsx`, 'Build-check candidates');
  } else if (base.endsWith('.js')) {
    const stem = base.slice(0, -3);
    buildSecurityArrayAppend(candidates, `${stem}.ts`, 'Build-check candidates');
    buildSecurityArrayAppend(candidates, `${stem}.tsx`, 'Build-check candidates');
  }
  if (candidates.length > 0) {
    buildSecurityArrayAppend(candidates, base, 'Build-check candidates');
    return candidates;
  }
  for (let index = 0; index < buildCheckSourceModuleExtensions.length; index += 1) {
    if (base.endsWith(buildCheckSourceModuleExtensions[index]!)) {
      return [base];
    }
  }
  if (/\.[^/\\]+$/u.test(pathSpecifier)) return candidates;
  buildSecurityArrayAppend(candidates, base, 'Build-check candidates');
  for (let index = 0; index < buildCheckSourceModuleExtensions.length; index += 1) {
    buildSecurityArrayAppend(
      candidates,
      `${base}${buildCheckSourceModuleExtensions[index]}`,
      'Build-check candidates',
    );
  }
  for (let index = 0; index < buildCheckSourceModuleExtensions.length; index += 1) {
    buildSecurityArrayAppend(
      candidates,
      resolve(base, `index${buildCheckSourceModuleExtensions[index]}`),
      'Build-check candidates',
    );
  }
  return candidates;
}

function buildCheckPathWithinBoundary(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return relativePath === '' || !/^(?:\.\.(?:[/\\]|$)|[/\\]|[A-Za-z]:)/u.test(relativePath);
}

function buildCheckSourceModulePath(filePath: string): boolean {
  const normalized = slashPath(filePath.split(/[?#]/u, 1)[0]!).toLowerCase();
  const baseName = normalized.slice(normalized.lastIndexOf('/') + 1);
  return !baseName.endsWith('.d.ts') && /\.(?:[cm]?[jt]sx?)$/u.test(baseName);
}

function preEvaluationAppSourceFiles(
  appModulePath: string,
  root: string,
  clientEntry?: BuildCheckSourceFile,
): BuildCheckSourceFile[] {
  const entries = [resolve(appModulePath)];
  if (clientEntry !== undefined) {
    const clientEntryPath = resolve(root, clientEntry.fileName);
    const clientEntries = htmlModuleSourcePaths(clientEntry.source, clientEntryPath, root);
    for (let index = 0; index < clientEntries.length; index += 1) {
      buildSecurityArrayAppend(
        entries,
        clientEntries[index]!,
        'Pre-evaluation HTML module source entries',
      );
    }
  }

  const files: BuildCheckSourceFile[] = [];
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entryPath = entries[entryIndex]!;
    const sourceRoot = dirname(entryPath);
    const graphFiles = buildCheckSourceGraphFiles(entryPath, root);
    for (let fileIndex = 0; fileIndex < graphFiles.length; fileIndex += 1) {
      const graphFile = graphFiles[fileIndex]!;
      const fileName = slashPath(relative(root, resolve(sourceRoot, graphFile.fileName)));
      let existing: BuildCheckSourceFile | undefined;
      for (let candidateIndex = 0; candidateIndex < files.length; candidateIndex += 1) {
        if (files[candidateIndex]!.fileName === fileName) {
          existing = files[candidateIndex];
          break;
        }
      }
      if (existing !== undefined) {
        if (existing.source !== graphFile.source) {
          throw new TypeError(`Kovo app source snapshot conflicts for ${fileName}.`);
        }
        continue;
      }
      buildSecurityArrayAppend(
        files,
        { fileName, source: graphFile.source },
        'Pre-evaluation app and client source closure',
      );
    }
  }
  return files;
}

/** @internal Regression seam for the exact pre-evaluation app/client source closure. */
export function preEvaluationAppSourceFilesForTesting(
  appModulePath: string,
  root: string,
  clientEntry?: BuildCheckSourceFile,
): readonly BuildCheckSourceFile[] {
  return preEvaluationAppSourceFiles(appModulePath, root, clientEntry);
}

function preEvaluationApprovedBuildFiles(
  appModulePath: string,
  root: string,
  sourceFiles: readonly BuildCheckSourceFile[],
): BuildCheckSourceFile[] {
  const files = buildSnapshotDenseArray(sourceFiles, 'Pre-evaluation approved module sources');
  const stylesheetFiles = preEvaluationClientStylesheetFiles(
    kovoClientBuildRoot(appModulePath, root),
    root,
  );
  for (let index = 0; index < stylesheetFiles.length; index += 1) {
    const stylesheet = stylesheetFiles[index]!;
    let existing: BuildCheckSourceFile | undefined;
    for (let candidateIndex = 0; candidateIndex < files.length; candidateIndex += 1) {
      if (files[candidateIndex]!.fileName === stylesheet.fileName) {
        existing = files[candidateIndex];
        break;
      }
    }
    if (existing !== undefined) {
      if (existing.source !== stylesheet.source) {
        throw new TypeError(`Kovo app source snapshot conflicts for ${stylesheet.fileName}.`);
      }
      continue;
    }
    buildSecurityArrayAppend(
      files,
      stylesheet,
      'Pre-evaluation app and client stylesheet snapshot',
    );
  }
  return files;
}

function preEvaluationClientStylesheetFiles(
  clientRoot: string,
  sourceRoot: string,
): BuildCheckSourceFile[] {
  const sourceDir = resolve(clientRoot, 'src');
  const fileSystem = createCompilerSourceFileSystem(clientRoot);
  if (fileSystem === null) {
    throw new TypeError(`Kovo client source root is unavailable or unstable: ${clientRoot}`);
  }
  const sourceKind = fileSystem.kind(sourceDir);
  if (sourceKind === 'other') return [];
  if (sourceKind !== 'directory') {
    throw new TypeError(`Kovo client source path is not a stable directory: ${sourceDir}`);
  }

  const files: BuildCheckSourceFile[] = [];
  const pending: Array<{ depth: number; path: string }> = [{ depth: 0, path: sourceDir }];
  let bytes = 0;
  for (let index = 0; index < pending.length; index += 1) {
    if (pending.length > 512) {
      throw new TypeError('Kovo client stylesheet snapshot exceeds the directory limit.');
    }
    const directory = pending[index]!;
    const entries = fileSystem.readDirectory(directory.path);
    if (entries === null) {
      throw new TypeError(`Kovo client stylesheet directory is unavailable: ${directory.path}`);
    }
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const path = resolve(directory.path, entries[entryIndex]!);
      const kind = fileSystem.kind(path);
      if (kind === 'directory') {
        if (directory.depth >= 32) {
          throw new TypeError('Kovo client stylesheet snapshot exceeds the depth limit.');
        }
        buildSecurityArrayAppend(
          pending,
          { depth: directory.depth + 1, path },
          'Kovo client stylesheet directories',
        );
        continue;
      }
      if (kind === 'other') {
        throw new TypeError(`Kovo client source tree contains an unstable entry: ${path}`);
      }
      if (buildRegExpExec(/\.css$/iu, path) === null) continue;
      const source = fileSystem.readFile(path);
      if (source === null) {
        throw new TypeError(`Kovo client stylesheet is unavailable or unstable: ${path}`);
      }
      bytes += buildByteLength(source);
      if (files.length >= 2_048 || bytes > 8_388_608) {
        throw new TypeError('Kovo client stylesheet snapshot exceeds its file or byte limit.');
      }
      buildSecurityArrayAppend(
        files,
        { fileName: slashPath(relative(sourceRoot, path)), source },
        'Kovo client stylesheet snapshot',
      );
    }
  }
  return files;
}

async function runTypeScriptBuildPreflight(
  appModulePath: string,
  invocationRoot: string,
  invocationEnv: NodeJS.ProcessEnv,
  command: 'build' | 'check' = 'build',
): Promise<boolean> {
  const tsconfigPath = findBuildTsconfig(appModulePath, invocationRoot);
  if (tsconfigPath === undefined) return false;

  const projectDir = dirname(tsconfigPath);
  let tscBin: string;
  try {
    tscBin = createRequire(`${projectDir}/package.json`).resolve('typescript/bin/tsc');
  } catch (error) {
    throw new Error(
      `kovo ${command} TypeScript preflight could not resolve typescript from ${projectDir}. Install typescript or remove ${tsconfigPath}.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Incremental preflight: persist a `.tsbuildinfo` under the gitignored `.kovo/cache` so a
  // warm rebuild only re-checks changed files (plans/fast-kovo-check2.md #2). `--noEmit` is
  // kept, so only the build-info is written, never JS; tsc still invalidates by file content,
  // so type errors continue to surface on the affected files.
  // The TypeScript subprocess must never receive the project-controlled cache path directly:
  // `tsc` follows parent symlinks and final hardlinks. Run against a framework-minted temporary
  // file, then import the resulting bytes through the project-root filesystem capability. This
  // keeps the incremental cache while enforcing SPEC §10.6 confinement and atomic replacement.
  const projectOutput = createFrameworkOutputFileSystemBoundary(projectDir);
  const projectBuildInfoFile = '.kovo/cache/tsc-preflight.tsbuildinfo';
  const tempDir = mkdtempSync(join(tmpdir(), 'kovo-tsc-preflight-'));
  const buildInfoFile = join(tempDir, 'tsc-preflight.tsbuildinfo');

  try {
    const previousBuildInfo = await projectOutput.fileBytes(projectBuildInfoFile);
    if (previousBuildInfo !== undefined) writeFileSync(buildInfoFile, previousBuildInfo);
    // Async subprocess so the caller can overlap this independent `tsc --noEmit` preflight with
    // the vite app load and the kovo-check security preflight (plans/fast-kovo-check3.md). `execFile`
    // pipes and captures stdout/stderr by default, so a non-zero exit rejects with an error carrying
    // the same `.stdout`/`.stderr` shape `execFileErrorOutput` reads; the thrown message is
    // byte-identical to the previous synchronous preflight.
    await execFileAsync(
      process.execPath,
      [
        tscBin,
        '--noEmit',
        '--allowImportingTsExtensions',
        '--incremental',
        '--tsBuildInfoFile',
        buildInfoFile,
        '--project',
        tsconfigPath,
      ],
      {
        cwd: projectDir,
        encoding: 'utf8',
        env: invocationEnv,
      },
    );
    await projectOutput.writeFile(projectBuildInfoFile, readFileSync(buildInfoFile));
    return true;
  } catch (error) {
    throw new Error(`kovo ${command} TypeScript preflight failed:\n${execFileErrorOutput(error)}`);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

async function runKovoBuildCheckPreflight(
  app: KovoApp,
  options: {
    cache: boolean;
    execution: BuildExecutionModule;
    paranoidStaticAdvisory: boolean;
    preEvaluationStaticTrust: PreEvaluationStaticTrust;
    reachableSessionAuthorityFacts: readonly CoreGraph.SessionAuthorityFact[];
    root: string;
  },
): Promise<KovoBuildCheckArtifacts> {
  const artifacts = await buildCheckGraph(app, options);
  const result = kovoCheckWithDiagnosticSourceCatalog(
    artifacts.graph,
    {
      paranoidStaticAdvisory: options.paranoidStaticAdvisory,
    },
    artifacts.diagnosticSourceCatalog,
  );
  if (result.exitCode === 0) return artifacts;
  if (options.paranoidStaticAdvisory && paranoidBuildCheckMayProceed(result.output)) {
    return artifacts;
  }

  throw new KovoBuildCheckDiagnosticError(
    `kovo build check preflight failed:\n${buildCheckFailureOutput(result.output)}`,
    result.diagnostics,
  );
}

function paranoidBuildCheckMayProceed(output: string): boolean {
  const errorLines = buildFilterDense(
    buildStringSplit(output, '\n'),
    'Paranoid build-check output lines',
    (line) => buildStringStartsWith(line, 'ERROR '),
  );
  return (
    errorLines.length > 0 &&
    buildEveryDense(errorLines, 'Paranoid build-check error lines', (line) => {
      const code = buildRegExpExec(/^ERROR\s+(\S+)/u, line)?.[1];
      return code !== undefined && isParanoidSecurityAdvisoryCode(code);
    })
  );
}

interface KovoBuildCheckArtifacts {
  components?: readonly SourceComponentGraphFacts[];
  devexCheckGraphDigest?: string;
  diagnosticSourceCatalog: KovoCheckDiagnosticSourceCatalog;
  diagnosticSourceFacts: readonly KovoCheckDiagnosticSourceFact[];
  graph: CoreGraph.KovoCheckInput;
  queryShapeFacts: readonly QueryShapeFact[];
  runtimeRegistry: RuntimeRegistryWireFacts;
  routePages?: readonly SourceRoutePageFacts[];
  sourceFiles: readonly BuildCheckSourceFile[];
}

type SourceComponentGraphFacts = Pick<
  CompileResult,
  | 'agentGraphFacts'
  | 'componentGraphFacts'
  | 'diagnostics'
  | 'handlerWriteSinkFacts'
  | 'publishToClientFacts'
  | 'taskGraphFacts'
  | 'updateCoverage'
>;

type SourceRoutePageFacts = Pick<CompileRouteModuleResult, 'routePageFacts'>;

function writeKovoBuildGraphArtifact(
  neutralBuild: KovoNeutralBuild,
  graph: CoreGraph.KovoCheckInput,
  escapeObligations: ReturnType<typeof escapeObligationManifestForBuild>,
  escapeCensusReviews: ReturnType<typeof escapeCensusReviewManifestForBuild>,
): void {
  // SPEC §5.2.3/§5.3: the build-derived graph is a review/debug artifact, not just an
  // in-memory preflight input. Persist it in the neutral build metadata directory
  // so `kovo explain ...` can discover it after an ordinary scaffold build. Provenance is
  // build-owned and overwrites any untrusted graph field with the boot-time identity snapshot.
  writeFileSync(join(neutralBuild.outDir, 'graph.json'), `${stringifyBuildValue(graph, 2)}\n`);
  // Plan 3 §2.1: the release-bound framework certificate is an independently-checkable sibling,
  // not an app-authored graph field. Its committed canonical bytes are embedded in the CLI build.
  writeFileSync(join(neutralBuild.outDir, 'certificate.json'), kovoCertificateV1Json);
  writeFileSync(join(neutralBuild.outDir, 'certificate-policy.json'), kovoCertificatePolicyV1Json);
  // Plan 3 §4.2: this is deliberately unsigned build output. A second-party reviewer signs each
  // subject outside the build/coding-agent environment with the already-pinned deployment
  // attestation key; `kovo explain attest --escape-reviews` verifies the detached envelopes.
  writeFileSync(
    join(neutralBuild.outDir, 'escape-obligations.json'),
    `${stringifyBuildValue(escapeObligations, 2)}\n`,
  );
  // Plan 3 §4.1–4.2: every counted escape root gets one unsigned, artifact-bound subject. The
  // out-of-band reviewer may sign these bytes with the existing runtime-posture anchor; build owns
  // neither signing authority nor a second trust root.
  writeFileSync(
    join(neutralBuild.outDir, 'escape-census-review-subjects.json'),
    `${stringifyBuildValue(escapeCensusReviews, 2)}\n`,
  );
}

/** @internal Derive detached review subjects without ever acquiring signing authority. */
export function escapeObligationManifestForBuild(graph: CoreGraph.KovoCheckInput): {
  artifactSubject: `sha256:${string}`;
  schema: 'kovo.escape-obligations/v1';
  subjects: readonly EscapeObligationReviewSubject[];
} {
  const artifactSubject = graph.runtimePosture?.artifactSubject;
  if (artifactSubject === undefined) {
    throw new TypeError('Escape-obligation emission requires the build-owned artifact subject.');
  }
  const subjects: EscapeObligationReviewSubject[] = [];
  for (const capability of graph.capabilities ?? []) {
    if (capability.target !== 'trustedAssign') continue;
    if (capability.obligation === undefined) {
      throw new TypeError(
        `KV438: trustedAssign at ${capability.site} requires an analyzer-checked structured obligation before artifact emission.`,
      );
    }
    if (capability.siteIdentity === undefined) {
      throw new TypeError(
        `KV438: trustedAssign at ${capability.site} requires an analyzer-owned call-site identity before artifact emission.`,
      );
    }
    subjects.push({
      artifactSubject,
      obligation: capability.obligation,
      schema: 'kovo.escape-obligation-review/v1',
      siteIdentity: capability.siteIdentity,
    });
  }
  return {
    artifactSubject,
    schema: 'kovo.escape-obligations/v1',
    subjects,
  };
}

/**
 * Retain every exact source snapshot that was admitted before app/config evaluation. The runtime
 * posture subject hashes this manifest together with the derived graph, so a same-path/same-length
 * semantic source edit invalidates detached review evidence. This is deliberately an analyzed-input
 * identity; emitted-code and host identity remain explicit attestation nonclaims (SPEC §11.2).
 */
function buildAnalysisInputs(options: {
  appSources: readonly BuildCheckSourceFile[];
  clientEntrySources: readonly BuildCheckSourceFile[];
  configSources: readonly BuildCheckSourceFile[];
  runtimeTarget: KovoBuildPresetName;
}): CoreGraph.KovoAnalysisInputs {
  const sources: CoreGraph.KovoAnalysisInputSource[] = [];
  appendAnalysisInputSources(sources, options.appSources, 'app');
  appendAnalysisInputSources(sources, options.clientEntrySources, 'client-entry');
  appendAnalysisInputSources(sources, options.configSources, 'config');
  return {
    runtimeTarget: options.runtimeTarget,
    schema: 'kovo.analysis.inputs/v1',
    sources,
  };
}

function appendAnalysisInputSources(
  target: CoreGraph.KovoAnalysisInputSource[],
  values: readonly BuildCheckSourceFile[],
  role: CoreGraph.KovoAnalysisInputSource['role'],
): void {
  const sources = buildSnapshotDenseArray(values, `Build analysis ${role} source inputs`);
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]!;
    if (typeof source.fileName !== 'string' || !exactBuildAnalysisPath(source.fileName)) {
      throw new TypeError(`Build analysis ${role} source path is not a stable relative identity.`);
    }
    insertAnalysisInputSource(target, {
      codeUnitLength: source.source.length,
      contentHash: `sha256:${hash('sha256', bufferFrom(source.source, 'utf16le'), 'hex')}`,
      encoding: 'utf16le',
      path: source.fileName,
      role,
    });
  }
}

function exactBuildAnalysisPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value ||
    isAbsolute(value) ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':')
  ) {
    return false;
  }
  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    ) {
      return false;
    }
  }
  return true;
}

function insertAnalysisInputSource(
  target: CoreGraph.KovoAnalysisInputSource[],
  source: CoreGraph.KovoAnalysisInputSource,
): void {
  for (let index = 0; index < target.length; index += 1) {
    const existing = target[index]!;
    if (existing.role === source.role && existing.path === source.path) {
      if (
        existing.codeUnitLength !== source.codeUnitLength ||
        existing.contentHash !== source.contentHash
      ) {
        throw new TypeError(
          `Build analysis ${source.role} source snapshot conflicts for ${source.path}.`,
        );
      }
      return;
    }
  }
  buildSecurityArrayAppend(target, source, 'Sorted build analysis source inputs');
  let insertAt = target.length - 1;
  while (insertAt > 0 && compareArtifactInputSources(source, target[insertAt - 1]!) < 0) {
    target[insertAt] = target[insertAt - 1]!;
    insertAt -= 1;
  }
  target[insertAt] = source;
}

function compareArtifactInputSources(
  left: CoreGraph.KovoAnalysisInputSource,
  right: CoreGraph.KovoAnalysisInputSource,
): number {
  const leftKey = `${left.role}\u0000${left.path}`;
  const rightKey = `${right.role}\u0000${right.path}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function buildCheckFailureOutput(output: string): string {
  const trimmed = buildStringTrimEnd(output);
  const fatalWarnings = buildFlatMapDense(
    buildStringSplit(trimmed, '\n'),
    'Build-check failure output lines',
    (line) => buildFatalWarningSummaryLine(line),
  );
  if (fatalWarnings.length === 0) return trimmed;
  return `${buildJoinStrings(fatalWarnings, '\n', 'Build-fatal warning summaries')}\n${trimmed}`;
}

function buildFatalWarningSummaryLine(line: string): string[] {
  const match = buildRegExpExec(/^WARN (KV(?:310|311)) (.*)$/u, line);
  if (!match) return [];
  return [`ERROR BUILD_FATAL ${match[1]} ${match[2]}`];
}

async function buildCheckGraph(
  app: KovoApp,
  options: {
    cache: boolean;
    execution: BuildExecutionModule;
    includeDevexCheckGraphDigest?: boolean;
    preEvaluationStaticTrust: PreEvaluationStaticTrust;
    reachableSessionAuthorityFacts: readonly CoreGraph.SessionAuthorityFact[];
    root: string;
  },
): Promise<KovoBuildCheckArtifacts> {
  const staticArtifacts = await staticBuildCheckGraph(app, options);
  const graph = staticArtifacts.graph;
  const accessFacts = accessFactsWithDiagnosticSourceSites(
    options.execution.accessFactsFromApp(app),
    staticArtifacts.diagnosticSourceCatalog,
  );
  const result = deriveAppGraph({
    ...(staticArtifacts.components === undefined ? {} : { components: staticArtifacts.components }),
    graph: {
      ...graph,
      access: accessFacts,
    },
    ...(staticArtifacts.routePages === undefined ? {} : { routePages: staticArtifacts.routePages }),
  });
  assertBuildCacheGenerality(app, result.graph);
  const diagnostics: CoreGraph.StaticDiagnosticFact[] = [];
  const existingDiagnostics = buildSnapshotDenseArray(
    graph.diagnostics ?? [],
    'Existing static build diagnostics',
  );
  for (let index = 0; index < existingDiagnostics.length; index += 1) {
    buildSecurityArrayAppend(
      diagnostics,
      existingDiagnostics[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  const componentDiagnostics = buildPreflightComponentDiagnostics(staticArtifacts.components ?? []);
  const mappedComponentDiagnostics = buildMapDense(
    componentDiagnostics,
    'Build component diagnostics',
    staticDiagnosticFact,
  );
  for (let index = 0; index < mappedComponentDiagnostics.length; index += 1) {
    buildSecurityArrayAppend(
      diagnostics,
      mappedComponentDiagnostics[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  const derivedDiagnostics = buildMapDense(
    result.diagnostics,
    'Derived app-graph diagnostics',
    staticDiagnosticFact,
  );
  for (let index = 0; index < derivedDiagnostics.length; index += 1) {
    buildSecurityArrayAppend(
      diagnostics,
      derivedDiagnostics[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  const runtimeRegistry: RuntimeRegistryWireFacts = {
    ...runtimeRegistryWireFactsFromGraph(result.graph),
    ...(staticArtifacts.runtimeRegistry.browserPosture === undefined
      ? {}
      : { browserPosture: staticArtifacts.runtimeRegistry.browserPosture }),
    ...(staticArtifacts.runtimeRegistry.tableSecurity === undefined
      ? {}
      : { tableSecurity: staticArtifacts.runtimeRegistry.tableSecurity }),
  };
  const finalGraph =
    diagnostics.length === 0
      ? result.graph
      : {
          ...result.graph,
          diagnostics,
        };
  const devexCheckGraphDigest = options.includeDevexCheckGraphDigest
    ? kovoBuildOneShotDigest(finalGraph)
    : undefined;
  return {
    ...(devexCheckGraphDigest === undefined ? {} : { devexCheckGraphDigest }),
    diagnosticSourceCatalog: staticArtifacts.diagnosticSourceCatalog,
    diagnosticSourceFacts: staticArtifacts.diagnosticSourceFacts,
    graph: finalGraph,
    queryShapeFacts: staticArtifacts.queryShapeFacts,
    runtimeRegistry,
    sourceFiles: staticArtifacts.sourceFiles,
  };
}

function accessFactsWithDiagnosticSourceSites(
  accessFacts: readonly CoreGraph.AccessExplainFact[],
  catalog: KovoCheckDiagnosticSourceCatalog,
): CoreGraph.AccessExplainFact[] {
  return buildMapDense(accessFacts, 'Build access facts with source sites', (fact) => {
    const source = kovoCheckDiagnosticSource(catalog, fact.kind, fact.name);
    return source === undefined || fact.site !== undefined ? fact : { ...fact, site: source.file };
  });
}

interface BuildCacheIntent {
  readonly auditedEscape?: { readonly name: string; readonly retainedObligation: string };
  readonly cacheControl?: string;
  readonly externalDataVersions: readonly {
    readonly key: { readonly axis: string; readonly name?: string };
    readonly name: string;
  }[];
  readonly posture: 'non-public' | 'public';
  readonly root: string;
  readonly surface: CacheInfluenceSurface;
}

/**
 * Fail the real build before artifact emission when evaluated app declarations disagree with the
 * compiler-owned cache-influence manifest. Runtime inspection is an equality/rejection check only;
 * it never supplies positive shared-cache evidence (SPEC §9.4).
 *
 * @internal Security regression seam for `check:cache-generality`.
 */
export function assertBuildCacheGenerality(
  app: Pick<KovoApp, 'endpoints' | 'queries'>,
  graph: CoreGraph.KovoCheckInput,
): void {
  const manifestValue = buildOwnDataValue(graph, 'cacheInfluence', 'Build cache graph');
  const entriesByRoot = buildCreateMap<string, CacheInfluenceManifestEntry>();
  if (manifestValue !== undefined) {
    const manifest = snapshotCacheInfluenceManifest(manifestValue);
    const entries = buildSnapshotDenseArray(manifest.entries, 'Build cache influence entries');
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      if (buildMapHas(entriesByRoot, entry.root)) {
        throw new Error(`Kovo cache generality check failed: duplicate root ${entry.root}.`);
      }
      buildMapSet(entriesByRoot, entry.root, entry);
    }
  }

  const queries = buildSnapshotDenseArray(app.queries, 'Build cache query declarations');
  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index]!;
    const key = requiredBuildCacheText(
      buildOwnDataValue(query, 'key', `Build cache query[${index}]`),
      `query[${index}].key`,
    );
    const read = optionalBuildCacheRecord(
      buildOwnDataValue(query, 'read', `Build cache query ${key}`),
      `query:${key}.read`,
    );
    const cacheControl = optionalBuildCacheText(
      read === undefined
        ? undefined
        : buildOwnDataValue(read, 'cacheControl', `Build cache query ${key} read`),
      `query:${key}.read.cacheControl`,
    );
    assertBuildCacheIntent(
      {
        ...buildCacheDeclarationIntent(
          read === undefined
            ? undefined
            : buildOwnDataValue(read, 'cacheInfluence', `Build cache query ${key} read`),
          `query:${key}`,
        ),
        ...(cacheControl === undefined ? {} : { cacheControl }),
        posture:
          cacheControl !== undefined &&
          buildRegExpExec(/(?:^|,)\s*public(?:\s|,|$)/iu, cacheControl) !== null
            ? 'public'
            : 'non-public',
        root: `query:${key}`,
        surface: 'query',
      },
      entriesByRoot,
    );
  }

  const endpoints = buildSnapshotDenseArray(app.endpoints, 'Build cache endpoint declarations');
  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index]!;
    const path = requiredBuildCacheText(
      buildOwnDataValue(endpoint, 'path', `Build cache endpoint[${index}]`),
      `endpoint[${index}].path`,
    );
    const response = optionalBuildCacheRecord(
      buildOwnDataValue(endpoint, 'response', `Build cache endpoint ${path}`),
      `endpoint:${path}.response`,
    );
    if (response === undefined) {
      throw new Error(
        `Kovo cache generality check failed: endpoint:${path} has no response posture.`,
      );
    }
    const cacheControl = requiredBuildCacheText(
      buildOwnDataValue(response, 'cache', `Build cache endpoint ${path} response`),
      `endpoint:${path}.response.cache`,
    );
    assertBuildCacheIntent(
      {
        ...buildCacheDeclarationIntent(
          buildOwnDataValue(response, 'cacheInfluence', `Build cache endpoint ${path} response`),
          `endpoint:${path}`,
        ),
        cacheControl,
        posture: cacheControl === 'public' ? 'public' : 'non-public',
        root: `endpoint:${path}`,
        surface: 'endpoint',
      },
      entriesByRoot,
    );
  }
}

function assertBuildCacheIntent(
  intent: BuildCacheIntent,
  entriesByRoot: Map<string, CacheInfluenceManifestEntry>,
): void {
  const entry = buildMapGet(entriesByRoot, intent.root);
  if (entry === undefined) {
    if (intent.posture === 'public') {
      throw new Error(
        `Kovo cache generality check failed: ${intent.root} public intent has no compiler manifest entry.`,
      );
    }
    return;
  }
  const sameAuthoredIntent =
    entry.surface === intent.surface &&
    entry.authored.posture === intent.posture &&
    entry.authored.cacheControl === intent.cacheControl &&
    cacheAuditEscapeKey(entry.authored.auditedEscape) ===
      cacheAuditEscapeKey(intent.auditedEscape) &&
    buildJsonStringify(cacheExternalVersionsFromEntry(entry)) ===
      buildJsonStringify(intent.externalDataVersions);
  if (!sameAuthoredIntent) {
    throw new Error(
      `Kovo cache generality check failed: ${intent.root} authored intent differs from the compiler manifest.`,
    );
  }
  if (intent.posture === 'public' && entry.verdict === 'shared-cache-closed') {
    throw new Error(
      `Kovo cache generality check failed: ${intent.root} public intent is closed by compiler influence analysis.`,
    );
  }
}

function buildCacheDeclarationIntent(
  value: unknown,
  root: string,
): Pick<BuildCacheIntent, 'auditedEscape' | 'externalDataVersions'> {
  const declaration = optionalBuildCacheRecord(value, `${root}.cacheInfluence`);
  if (declaration === undefined) return { externalDataVersions: [] };
  const auditedValue = buildOwnDataValue(declaration, 'auditedEscape', `${root}.cacheInfluence`);
  const audited = optionalBuildCacheRecord(auditedValue, `${root}.cacheInfluence.auditedEscape`);
  const auditedEscape =
    audited === undefined
      ? undefined
      : {
          name: requiredBuildCacheText(
            buildOwnDataValue(audited, 'name', `${root}.cacheInfluence.auditedEscape`),
            `${root}.cacheInfluence.auditedEscape.name`,
          ),
          retainedObligation: requiredBuildCacheText(
            buildOwnDataValue(
              audited,
              'retainedObligation',
              `${root}.cacheInfluence.auditedEscape`,
            ),
            `${root}.cacheInfluence.auditedEscape.retainedObligation`,
          ),
        };
  const externalValue = buildOwnDataValue(
    declaration,
    'externalDataVersions',
    `${root}.cacheInfluence`,
  );
  const externalSource =
    externalValue === undefined
      ? []
      : buildSnapshotDenseArray(
          externalValue as readonly unknown[],
          `${root}.cacheInfluence.externalDataVersions`,
        );
  const externalDataVersions: BuildCacheIntent['externalDataVersions'][number][] = [];
  for (let index = 0; index < externalSource.length; index += 1) {
    const version = optionalBuildCacheRecord(
      externalSource[index],
      `${root}.cacheInfluence.externalDataVersions[${index}]`,
    );
    if (version === undefined) {
      throw new Error(
        `Kovo cache generality check failed: ${root} has an invalid external version.`,
      );
    }
    const key = optionalBuildCacheRecord(
      buildOwnDataValue(version, 'key', `${root}.cacheInfluence.externalDataVersions[${index}]`),
      `${root}.cacheInfluence.externalDataVersions[${index}].key`,
    );
    if (key === undefined) {
      throw new Error(`Kovo cache generality check failed: ${root} external version has no key.`);
    }
    const axis = requiredBuildCacheText(
      buildOwnDataValue(key, 'axis', `${root}.cacheInfluence external version key`),
      `${root}.cacheInfluence external version key axis`,
    );
    const nameValue = buildOwnDataValue(key, 'name', `${root}.cacheInfluence external version key`);
    const name = optionalBuildCacheText(
      nameValue,
      `${root}.cacheInfluence external version key name`,
    );
    buildSecurityArrayAppend(
      externalDataVersions,
      {
        key: { axis, ...(name === undefined ? {} : { name }) },
        name: requiredBuildCacheText(
          buildOwnDataValue(
            version,
            'name',
            `${root}.cacheInfluence.externalDataVersions[${index}]`,
          ),
          `${root}.cacheInfluence external version name`,
        ),
      },
      'Build cache external data versions',
    );
  }
  return {
    ...(auditedEscape === undefined ? {} : { auditedEscape }),
    externalDataVersions,
  };
}

function cacheExternalVersionsFromEntry(
  entry: CacheInfluenceManifestEntry,
): BuildCacheIntent['externalDataVersions'] {
  const result: BuildCacheIntent['externalDataVersions'][number][] = [];
  const axes = buildSnapshotDenseArray(entry.axes, `Build cache axes for ${entry.root}`);
  for (let index = 0; index < axes.length; index += 1) {
    const axis = axes[index]!;
    if (axis.kind !== 'external-data-version') continue;
    if (axis.key === undefined) {
      throw new Error(
        `Kovo cache generality check failed: ${entry.root} external version has no key contribution.`,
      );
    }
    buildSecurityArrayAppend(
      result,
      {
        key: axis.key,
        name: axis.name,
      },
      'Compiler cache external data versions',
    );
  }
  return result;
}

function cacheAuditEscapeKey(
  value: { readonly name: string; readonly retainedObligation: string } | undefined,
): string {
  return value === undefined ? '' : `${value.name}\u0000${value.retainedObligation}`;
}

function optionalBuildCacheRecord(value: unknown, label: string): object | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) {
    throw new Error(`Kovo cache generality check failed: ${label} must be an own-data record.`);
  }
  return value;
}

function optionalBuildCacheText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredBuildCacheText(value, label);
}

function requiredBuildCacheText(value: unknown, label: string): string {
  if (typeof value !== 'string' || buildStringTrim(value) === '') {
    throw new Error(`Kovo cache generality check failed: ${label} must be non-empty text.`);
  }
  return buildStringTrim(value);
}

function buildPreflightComponentDiagnostics(
  components: NonNullable<KovoBuildCheckArtifacts['components']>,
): CompileResult['diagnostics'] {
  const diagnostics = buildFlatMapDense(
    components,
    'Build preflight components',
    (component) => component.diagnostics,
  );
  for (let index = 0; index < diagnostics.length; index += 1) {
    assertRegisteredDiagnostic(diagnostics[index], `Build component diagnostics[${index}]`);
  }
  return diagnostics;
}

function staticDiagnosticFact(
  diagnostic: CompileResult['diagnostics'][number],
): CoreGraph.StaticDiagnosticFact {
  assertRegisteredDiagnostic(diagnostic, 'Build compiler diagnostic projection');
  return {
    code: diagnostic.code,
    ...(diagnostic.length === undefined ? {} : { length: diagnostic.length }),
    message: diagnostic.message,
    severity: diagnostic.severity ?? 'error',
    site: diagnostic.fileName,
    ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
    ...(diagnostic.start === undefined ? {} : { start: diagnostic.start }),
  };
}

function projectStaticTrustDiagnosticForWorker(
  diagnostic: CoreGraph.StaticDiagnosticFact,
): KovoDiagnosticRecord {
  const registered = createRegisteredDiagnostic(
    diagnostic.code,
    diagnostic.source === undefined ? {} : { source: diagnostic.source },
    {
      includeHelp: true,
      ...(diagnostic.message === undefined ? {} : { message: diagnostic.message }),
    },
  );
  if (diagnostic.severity !== undefined && registered.severity !== diagnostic.severity) {
    throw new TypeError(
      `Static-trust diagnostic ${diagnostic.code} severity does not match its registry.`,
    );
  }
  return projectKovoDiagnostic(registered, 'proof');
}

function projectStaticTrustUnregisteredSinkForWorker(
  sink: CoreGraph.UnregisteredSinkFact,
): KovoDiagnosticRecord {
  return projectKovoDiagnostic(
    createRegisteredDiagnostic(
      'KV424',
      {},
      {
        includeHelp: true,
        message: `Unregistered app sink ${stringifyBuildValue(sink.sink)} at ${stringifyBuildValue(sink.site)}; ${sink.safePath}.`,
      },
    ),
    'proof',
  );
}

function appendBuildTaskBFiniteDiagnostics(
  target: CoreGraph.StaticDiagnosticFact[],
  diagnostics: readonly CompileResult['diagnostics'][number][],
  label: string,
): void {
  const snapshot = buildSnapshotDenseArray(diagnostics, label);
  for (let diagnosticIndex = 0; diagnosticIndex < snapshot.length; diagnosticIndex += 1) {
    const diagnostic = snapshot[diagnosticIndex]!;
    if (diagnostic.code === 'KV449' || diagnostic.code === 'KV450' || diagnostic.code === 'KV452') {
      buildSecurityArrayAppend(target, staticDiagnosticFact(diagnostic), label);
    }
  }
}

async function staticBuildCheckGraph(
  app: KovoApp,
  options: {
    cache: boolean;
    execution: BuildExecutionModule;
    preEvaluationStaticTrust: PreEvaluationStaticTrust;
    reachableSessionAuthorityFacts: readonly CoreGraph.SessionAuthorityFact[];
    root: string;
  },
): Promise<KovoBuildCheckArtifacts> {
  const files = options.preEvaluationStaticTrust.files;
  const sourceGraphFacts = options.preEvaluationStaticTrust.sourceGraphFacts;
  const derivedProof = options.preEvaluationStaticTrust.derivedProof;
  if (derivedProof === undefined) {
    throw new TypeError('Kovo build/check omitted its authenticated static derived proof.');
  }
  const drizzleFacts: StaticDataPlaneBuildFacts = {
    ...derivedProof.dataPlaneFacts,
    queryShapeFacts: derivedProof.queryShapeFacts,
  };
  // SPEC §5.2 rule 9 / §6.6: graph assembly consumes the compiler facts that already authorized
  // evaluation. Recompiling or re-reading identity files here would create a second carrier whose
  // verdict could disagree with the exact bytes admitted by the pre-evaluation gate.
  // SPEC §6.6/§9.1 (audit-only, threat-matrix M3): surface every app-authored escape-hatch call site
  // (`kovo explain capabilities`) and credential-cookie downgrade (`cookies`) in the REAL build
  // graph.json — the static producers detect them at their call site, so a merely-built (not run) app
  // still enumerates its whole intentional-security-hole surface for a reviewer. (The runtime
  // `drain*Facts()` collectors only fire during live requests and never populate a built graph.)
  // SPEC §6.6 / KV424: the full build preflight must consume the same immutable app-source
  // snapshots as standalone static analysis. This preserves the existing browser-handler sink
  // corpus and adds request-handler process/call-closure facts before any deploy artifact writes.
  // The aggregate shares one in-memory syntactic project across all four build trust surfaces.
  const {
    capabilities,
    cookieDowngrades,
    revealed: runtimeReveals,
    trustEscapes: staticTrustEscapes,
    unregisteredSinks,
  } = options.preEvaluationStaticTrust.facts;
  const capabilityClosure = options.preEvaluationStaticTrust.capabilityClosure.facts;
  const queryShapeFacts = derivedProof.queryShapeFacts;
  const revealed = mergeBuildRevealFacts(drizzleFacts.revealed ?? [], runtimeReveals);
  const queryReadSets = buildMapDense(app.queries, 'Build app queries', (query) =>
    queryCheckFact(
      query,
      drizzleFacts.queries,
      options.execution,
      requiredRegistryDeclarationSource(
        sourceGraphFacts.registryDeclarationAnchors,
        'query',
        query.key,
      ),
    ),
  );
  const diagnosticSourceFacts = queryDiagnosticSourceFacts(
    app.queries,
    sourceGraphFacts.registryDeclarationAnchors,
  );
  const diagnosticSourceCatalog = createKovoCheckDiagnosticSourceCatalog(diagnosticSourceFacts);
  const routeOutcomeFacts = routeFileStreamEndpointFacts(
    app.routes,
    sourceGraphFacts.routeOutcomes,
    options.execution,
  );
  const sessionAuthorityFacts = completeMutationSessionAuthorityFacts(
    app,
    options.reachableSessionAuthorityFacts,
  );
  const updateCoverage = buildFlatMapDense(
    sourceGraphFacts.components,
    'Source component graph facts',
    (component) =>
      buildMapDense(component.updateCoverage, 'Component update-coverage facts', (fact) => ({
        component: fact.componentName,
        ...(fact.detail === undefined ? {} : { detail: fact.detail }),
        position: fact.position,
        query: fact.query,
        ...(fact.source === undefined ? {} : { source: fact.source }),
        ...(fact.sourceAnchor === undefined ? {} : { sourceAnchor: fact.sourceAnchor }),
        status: fact.status,
      })),
  );
  const domains = buildFlatMapDense(
    sourceGraphFacts.domainDeclarationNames,
    'Source domain declaration names',
    (name): CoreGraph.DomainExplain[] => {
      const source = registryDeclarationSource(
        sourceGraphFacts.registryDeclarationAnchors,
        'domain',
        name,
      );
      return source === undefined ? [] : [{ name, source }];
    },
  );
  const endpoints = buildMapDense(app.endpoints, 'Build app endpoints', (endpoint) =>
    endpointCheckFact(
      endpoint,
      options.execution,
      requiredEndpointDeclarationSource(sourceGraphFacts.registryDeclarationAnchors, endpoint.path),
    ),
  );
  for (let index = 0; index < routeOutcomeFacts.length; index += 1) {
    buildSecurityArrayAppend(
      endpoints,
      routeOutcomeFacts[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  const mutations = buildMapDense(app.mutations, 'Build app mutations', (mutation) =>
    mutationCheckFact(
      mutation,
      queryReadSets,
      options.execution,
      requiredRegistryDeclarationSource(
        sourceGraphFacts.registryDeclarationAnchors,
        'mutation',
        mutation.key,
      ),
    ),
  );
  const trustEscapes = completeBuildTrustEscapes(staticTrustEscapes, mutations);
  const optimistic = buildFlatMapDense(
    app.mutations,
    'Build app mutations for optimistic coverage',
    mutationOptimisticCheckFacts,
  );
  const pages = buildMapDense(app.routes, 'Build app routes', (route) =>
    routeCheckFact(
      route,
      options.execution,
      requiredRegistryDeclarationSource(
        sourceGraphFacts.registryDeclarationAnchors,
        'page',
        route.path,
      ),
    ),
  );
  const authorizationCorrespondence =
    drizzleFacts.runtimeTableSecurityManifest === undefined
      ? []
      : options.execution.authorizationCorrespondenceFactsFromApp({
          app,
          mutations,
          pages,
          queries: queryReadSets,
          tableSecurity: drizzleFacts.runtimeTableSecurityManifest,
        });
  const egressPosture = buildEgressPosture(options.execution.appEgressPosture(app));

  return {
    components: sourceGraphFacts.components,
    diagnosticSourceCatalog,
    diagnosticSourceFacts,
    graph: {
      ...(drizzleFacts.grants.length === 0 ? {} : { grants: drizzleFacts.grants }),
      ...(drizzleFacts.touchGraph === undefined ? {} : { touchGraph: drizzleFacts.touchGraph }),
      ...(drizzleFacts.sqlSafetyDiagnostics.length === 0
        ? {}
        : { sqlSafetyDiagnostics: drizzleFacts.sqlSafetyDiagnostics }),
      ...(drizzleFacts.ownerDomains.length === 0
        ? {}
        : { ownerDomains: drizzleFacts.ownerDomains }),
      ...(drizzleFacts.scopeAudits.length === 0 ? {} : { scopeAudits: drizzleFacts.scopeAudits }),
      ...(drizzleFacts.massAssignmentFacts.length === 0
        ? {}
        : { massAssignmentFacts: drizzleFacts.massAssignmentFacts }),
      ...(drizzleFacts.queryWriteReachability.length === 0
        ? {}
        : { queryWriteReachability: drizzleFacts.queryWriteReachability }),
      ...(drizzleFacts.toctouFacts.length === 0 ? {} : { toctouFacts: drizzleFacts.toctouFacts }),
      ...(capabilities.length === 0 ? {} : { capabilities }),
      ...(capabilityClosure.length === 0 ? {} : { capabilityClosure }),
      // SPEC §6.6: retain the exact pre-evaluation package verdict as a reviewable artifact and
      // as the single bound consumed by every supported app Vite loader below. An explicit empty
      // manifest distinguishes a proved-zero dependency surface from a missing producer.
      dependencyCapabilities: options.preEvaluationStaticTrust.capabilityClosure.dependencyManifest,
      ...(cookieDowngrades.length === 0 ? {} : { cookieDowngrades }),
      ...(domains.length === 0 ? {} : { domains }),
      egressPosture,
      escapeCensus: {
        doors: ESCAPE_CENSUS_DOORS,
        schema: 'kovo.escape-census-coverage/v2',
        sources: {
          allowControlChars: 'trustEscapes',
          'csrf:false': 'trustEscapes',
          'ctx.fetch': 'securitySemanticGraph',
          kovoAnalyzerSummary: 'trustEscapes',
          trustedHtml: 'trustEscapes',
          trustedSql: 'trustEscapes',
        },
      },
      ...(revealed.length === 0 ? {} : { revealed }),
      // Keep the authoritative producer result explicit even when empty: the read-only census
      // must distinguish a proved zero from a missing fact source (SPEC §2 / §5.3).
      trustEscapes,
      ...(unregisteredSinks.length === 0 ? {} : { unregisteredSinks }),
      ...(authorizationCorrespondence.length === 0 ? {} : { authorizationCorrespondence }),
      endpoints,
      mutations,
      optimistic,
      pages,
      queries: queryReadSets,
      ...(sessionAuthorityFacts.length === 0 ? {} : { sessionAuthority: sessionAuthorityFacts }),
      ...(updateCoverage.length === 0 ? {} : { updateCoverage }),
    },
    queryShapeFacts,
    runtimeRegistry: {
      browserPosture: derivedProof.browserPosture,
      mutationTouches: {},
      queryReads: [],
      ...(drizzleFacts.runtimeTableSecurityManifest === undefined
        ? {}
        : { tableSecurity: drizzleFacts.runtimeTableSecurityManifest }),
    },
    routePages: sourceGraphFacts.routePages,
    sourceFiles: files,
  };
}

function buildEgressPosture(value: AppEgressOptions | undefined): CoreGraph.EgressPostureFact {
  if (value === false) {
    return { allowDestinations: [], allowInternal: [], disabled: true };
  }
  if (value !== undefined && 'enabled' in value) {
    return { allowDestinations: [], allowInternal: [], disabled: true };
  }
  return {
    allowDestinations: buildSnapshotDenseArray(
      value?.allowDestinations ?? [],
      'Build egress allowDestinations posture',
    ),
    allowInternal: buildSnapshotDenseArray(
      value?.allowInternal ?? [],
      'Build egress allowInternal posture',
    ),
    disabled: false,
  };
}

function completeBuildTrustEscapes(
  staticFacts: readonly CoreGraph.TrustEscapeExplain[],
  mutations: readonly CoreGraph.MutationExplain[],
): CoreGraph.TrustEscapeExplain[] {
  const mutationSnapshot = buildSnapshotDenseArray(mutations, 'Build mutation escape facts');
  const executableCsrfRoots = buildCreateSet<string>();
  for (let index = 0; index < mutationSnapshot.length; index += 1) {
    const mutation = mutationSnapshot[index]!;
    if (mutation.csrf === 'exempt') buildSetAdd(executableCsrfRoots, `mutation:${mutation.key}`);
  }
  const staticSnapshot = buildSnapshotDenseArray(staticFacts, 'Static build trust-escape facts');
  const result: CoreGraph.TrustEscapeExplain[] = [];
  const linkedCsrfRoots = buildCreateSet<string>();
  for (let index = 0; index < staticSnapshot.length; index += 1) {
    const fact = staticSnapshot[index]!;
    const countedRoot =
      fact.kind === 'csrfFalse'
        ? countedCsrfRootForStaticFact(fact, executableCsrfRoots)
        : undefined;
    const linked =
      fact.kind !== 'csrfFalse'
        ? fact
        : countedRoot === undefined
          ? { ...fact, countedRootDisposition: 'proven-unreachable' as const }
          : { ...fact, countedRoot, countedRootDisposition: 'linked' as const };
    buildSecurityArrayAppend(result, linked, 'Static build trust-escape facts');
    if (countedRoot !== undefined) buildSetAdd(linkedCsrfRoots, countedRoot);
  }
  for (let index = 0; index < mutationSnapshot.length; index += 1) {
    const mutation = mutationSnapshot[index]!;
    if (mutation.csrf !== 'exempt') continue;
    const root = `mutation:${mutation.key}`;
    if (!buildSetHas(linkedCsrfRoots, root)) {
      throw new TypeError(
        `Build mutation escape ${mutation.key} lacks an exact analyzer-owned source binding.`,
      );
    }
  }
  return result;
}

function countedCsrfRootForStaticFact(
  fact: CoreGraph.TrustEscapeExplain,
  executableRoots: ReadonlySet<string>,
): string | undefined {
  if (fact.root !== undefined && buildSetHas(executableRoots, fact.root)) return fact.root;
  if (typeof fact.source !== 'string' || typeof fact.site !== 'string') return undefined;
  const match = buildRegExpExec(/^(.+):[0-9]+$/u, fact.site);
  if (match === null || typeof match[1] !== 'string') return undefined;
  const candidate = `mutation:${deriveRegistryIdentity(match[1], fact.source).key}`;
  return buildSetHas(executableRoots, candidate) ? candidate : undefined;
}

/** @internal */ export function mergeBuildRevealFacts(
  queryReveals: readonly CoreGraph.RevealExplainFact[],
  runtimeReveals: readonly CoreGraph.RevealExplainFact[],
): CoreGraph.RevealExplainFact[] {
  const merged: CoreGraph.RevealExplainFact[] = [];
  const queryCallIdentities = buildCreateSet<string>();
  const querySnapshot = buildSnapshotDenseArray(queryReveals, 'Build query reveal facts');
  for (let index = 0; index < querySnapshot.length; index += 1) {
    const reveal = querySnapshot[index]!;
    if (reveal.callIdentity !== undefined) {
      buildSetAdd(queryCallIdentities, reveal.callIdentity);
    }
    insertBuildRevealFact(merged, buildRevealFactWithoutCallIdentity(reveal));
  }
  const runtimeSnapshot = buildSnapshotDenseArray(runtimeReveals, 'Build runtime reveal facts');
  for (let index = 0; index < runtimeSnapshot.length; index += 1) {
    const reveal = runtimeSnapshot[index]!;
    if (
      reveal.callIdentity !== undefined &&
      buildSetHas(queryCallIdentities, reveal.callIdentity)
    ) {
      continue;
    }
    insertBuildRevealFact(merged, buildRevealFactWithoutCallIdentity(reveal));
  }
  return merged;
}

function buildRevealFactWithoutCallIdentity(
  reveal: CoreGraph.RevealExplainFact,
): CoreGraph.RevealExplainFact {
  const { callIdentity: _callIdentity, ...fact } = reveal;
  return fact;
}

function insertBuildRevealFact(
  facts: CoreGraph.RevealExplainFact[],
  reveal: CoreGraph.RevealExplainFact,
): void {
  buildSecurityArrayAppend(facts, reveal, 'Sorted build reveal facts');
  let insertAt = facts.length - 1;
  while (insertAt > 0 && compareBuildRevealFacts(reveal, facts[insertAt - 1]!) < 0) {
    facts[insertAt] = facts[insertAt - 1]!;
    insertAt -= 1;
  }
  facts[insertAt] = reveal;
}

function compareBuildRevealFacts(
  left: CoreGraph.RevealExplainFact,
  right: CoreGraph.RevealExplainFact,
): number {
  const leftKey = `${left.query}\u0000${left.path}\u0000${left.site}`;
  const rightKey = `${right.query}\u0000${right.path}\u0000${right.site}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

interface SourceGraphFacts {
  appContractStaticFacts: readonly CompilerOwnedAppContractStaticFact[];
  compilerDependencies: CompilerGeneratedCapabilityDependency[];
  compilerSecuritySemanticSources: CompilerSecuritySemanticSource[];
  compilerTaskBFiniteVerdict: CompilerTaskBFiniteVerdict;
  components: SourceComponentGraphFacts[];
  domainDeclarationNames: string[];
  registryDeclarationAnchors: Map<string, KovoDiagnosticSourceAnchor | null>;
  routeOutcomes: Map<string, 'file' | 'stream'>;
  routePages: SourceRoutePageFacts[];
  sourceDerivedRegistryTransforms: readonly SourceDerivedRegistryTransform[];
}

interface SourceDerivedRegistryTransform {
  readonly code: string | null;
  readonly fileName: string;
  readonly source: string;
}

async function sessionAuthorityFactsFromEntry(
  appModulePath: string,
): Promise<CoreGraph.SessionAuthorityFact[]> {
  const root = dirname(appModulePath);
  const entry = {
    fileName: basename(appModulePath),
    source: readFileSync(appModulePath, 'utf8'),
  };
  const reachable: BuildCheckSourceFile[] = [entry];
  const identityFiles = buildSnapshotDenseArray(
    viteFrameworkIdentityFiles(root, entry.fileName, entry.source),
    'Reachable framework-identity files',
  );
  for (let index = 0; index < identityFiles.length; index += 1) {
    const file = identityFiles[index]!;
    let existingIndex = -1;
    for (let candidateIndex = 0; candidateIndex < reachable.length; candidateIndex += 1) {
      if (reachable[candidateIndex]!.fileName === file.fileName) {
        existingIndex = candidateIndex;
        break;
      }
    }
    if (existingIndex < 0)
      buildSecurityArrayAppend(
        reachable,
        file,
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
    else reachable[existingIndex] = file;
  }

  const appContractProject = compilerOwnedAppContractProjectForBuild(reachable, root);
  const result: CoreGraph.SessionAuthorityFact[] = [];
  for (let index = 0; index < reachable.length; index += 1) {
    const file = reachable[index]!;
    const extraFiles = buildSnapshotDenseArray(
      viteFrameworkIdentityFiles(root, file.fileName, file.source),
      `Framework-identity files for ${file.fileName}`,
    );
    const facts = withBuildAppContractResolutions(
      appContractProject,
      file.fileName,
      file.source,
      () =>
        buildSnapshotDenseArray(
          mutationSessionAuthorityFacts(
            parseComponentModule(
              file.fileName,
              file.source,
              extraFiles.length === 0 ? {} : { frameworkIdentityFiles: extraFiles },
            ),
          ),
          `Session-authority facts for ${file.fileName}`,
        ),
    );
    for (let factIndex = 0; factIndex < facts.length; factIndex += 1) {
      buildSecurityArrayAppend(
        result,
        facts[factIndex]!,
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
    }
  }
  return result;
}

/** @internal Security-order regression seam for the SPEC §2/§11.4 static/runtime authority join. */
export function completeMutationSessionAuthorityFacts(
  app: KovoApp,
  sourceFacts: readonly CoreGraph.SessionAuthorityFact[],
): CoreGraph.SessionAuthorityFact[] {
  // SPEC §2/§11.4: these facts bind statically inspected authority to the exact runtime
  // handler. App evaluation precedes this join, so collection prototypes cannot participate.
  const facts: { fact: CoreGraph.SessionAuthorityFact; key: string }[] = [];
  const sourceSnapshot = buildSnapshotDenseArray(sourceFacts, 'Static session-authority facts');
  for (let index = 0; index < sourceSnapshot.length; index += 1) {
    const fact = sourceSnapshot[index]!;
    const unresolvedName = buildOwnDataValue(fact, 'unresolvedName', 'Session-authority fact');
    const name = buildOwnDataValue(fact, 'name', 'Session-authority fact');
    const referencesSession = buildOwnDataValue(
      fact,
      'referencesSession',
      'Session-authority fact',
    );
    if (typeof name !== 'string' || typeof referencesSession !== 'boolean') {
      throw new TypeError('Session-authority facts require own name/referencesSession values.');
    }
    const key = unresolvedName === true ? 'unresolved:*' : `name:${name}`;
    const factIndex = sessionAuthorityFactIndex(facts, key);
    const previous = factIndex < 0 ? undefined : facts[factIndex]!.fact;
    if (previous?.referencesSession === true && referencesSession !== true) continue;
    const handlerFingerprints = referencesSession
      ? []
      : uniqueHandlerFingerprints(
          previous?.handlerFingerprints ?? [],
          (buildOwnDataValue(fact, 'handlerFingerprints', 'Session-authority fact') ??
            []) as readonly string[],
        );
    const merged: CoreGraph.SessionAuthorityFact = {
      ...fact,
      ...(handlerFingerprints.length === 0 ? {} : { handlerFingerprints }),
    };
    if (factIndex < 0)
      buildSecurityArrayAppend(
        facts,
        { fact: merged, key },
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
    else facts[factIndex] = { fact: merged, key };
  }

  let unresolvedAuthority = false;
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]!.fact;
    if (fact.unresolvedName === true && fact.referencesSession) {
      unresolvedAuthority = true;
      break;
    }
  }
  const mutations = buildSnapshotDenseArray(app.mutations, 'Build app mutations');
  for (let index = 0; index < mutations.length; index += 1) {
    const mutation = mutations[index]!;
    if (mutation.csrf !== false || unresolvedAuthority) continue;
    const exactKey = `name:${mutation.key}`;
    const exactIndex = sessionAuthorityFactIndex(facts, exactKey);
    const exact = exactIndex < 0 ? undefined : facts[exactIndex]!.fact;
    if (exact?.referencesSession === true) continue;
    const handlerFingerprint = runtimeMutationHandlerFingerprint(mutation.handler);
    const unresolvedIndex = sessionAuthorityFactIndex(facts, 'unresolved:*');
    const unresolved = unresolvedIndex < 0 ? undefined : facts[unresolvedIndex]!.fact;
    const coveredFingerprints = uniqueHandlerFingerprints(
      exact?.handlerFingerprints ?? [],
      unresolved?.handlerFingerprints ?? [],
    );
    if (
      handlerFingerprint !== undefined &&
      handlerFingerprintIsCovered(coveredFingerprints, handlerFingerprint)
    ) {
      continue;
    }
    const ambientFact: CoreGraph.SessionAuthorityFact = {
      detail: 'runtime csrf-exempt handler identity was not covered by the static authority scan',
      kind: 'mutation',
      name: mutation.key,
      referencesSession: true,
      source: 'session-authority',
    };
    if (exactIndex < 0)
      buildSecurityArrayAppend(
        facts,
        { fact: ambientFact, key: exactKey },
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
    else facts[exactIndex] = { fact: ambientFact, key: exactKey };
  }

  const result: CoreGraph.SessionAuthorityFact[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]!.fact;
    buildSecurityArrayAppend(result, fact, 'Sorted session-authority facts');
    let insertAt = result.length - 1;
    while (insertAt > 0 && fact.name < result[insertAt - 1]!.name) {
      result[insertAt] = result[insertAt - 1]!;
      insertAt -= 1;
    }
    result[insertAt] = fact;
  }
  return result;
}

function sessionAuthorityFactIndex(
  facts: readonly { fact: CoreGraph.SessionAuthorityFact; key: string }[],
  key: string,
): number {
  for (let index = 0; index < facts.length; index += 1) {
    if (facts[index]!.key === key) return index;
  }
  return -1;
}

function uniqueHandlerFingerprints(first: readonly string[], second: readonly string[]): string[] {
  const result: string[] = [];
  const sources = [first, second] as const;
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = buildSnapshotDenseArray(
      sources[sourceIndex]!,
      'Session-authority handler fingerprints',
    );
    for (let index = 0; index < source.length; index += 1) {
      const value = source[index];
      if (typeof value !== 'string') {
        throw new TypeError('Session-authority handler fingerprints must be strings.');
      }
      if (!handlerFingerprintIsCovered(result, value))
        buildSecurityArrayAppend(
          result,
          value,
          'CLI packages/cli/src/commands/build-export.ts collection',
        );
    }
  }
  return result;
}

function handlerFingerprintIsCovered(fingerprints: readonly string[], candidate: string): boolean {
  for (let index = 0; index < fingerprints.length; index += 1) {
    if (fingerprints[index] === candidate) return true;
  }
  return false;
}

function runtimeMutationHandlerFingerprint(handler: unknown): string | undefined {
  if (typeof handler !== 'function') return undefined;
  try {
    const source = buildFunctionSource(handler);
    return mutationHandlerFingerprintFromRuntimeSource(source);
  } catch {
    return undefined;
  }
}

function compilerOwnedAppContractProjectForBuild(
  files: readonly BuildCheckSourceFile[],
  rootDirectory: string,
): CompilerOwnedAppContractProject | undefined {
  const rootNames: string[] = [];
  const seen = buildCreateSet<string>();
  const sources = buildSnapshotDenseArray(files, 'App-contract compiler source roots');
  for (let index = 0; index < sources.length; index += 1) {
    const fileName = sources[index]!.fileName;
    const canonicalFileName = resolve(rootDirectory, fileName);
    if (!/\.[cm]?[jt]sx?$/u.test(fileName) || buildSetHas(seen, canonicalFileName)) continue;
    buildSetAdd(seen, canonicalFileName);
    buildSecurityArrayAppend(rootNames, fileName, 'App-contract compiler source roots');
  }
  return rootNames.length === 0
    ? undefined
    : createCompilerOwnedAppContractProject({ rootDirectory, rootNames });
}

function withBuildAppContractResolutions<Value>(
  project: CompilerOwnedAppContractProject | undefined,
  fileName: string,
  source: string,
  operation: () => Value,
): Value {
  if (project === undefined) return operation();
  return project.withEntryResolutions(fileName, (programSource) => {
    if (programSource !== source) {
      throw new Error(
        `Kovo app-contract compiler refused a stale source snapshot for ${fileName}.`,
      );
    }
    return operation();
  });
}

function sourceGraphFactsFromFiles(
  files: readonly BuildCheckSourceFile[],
  rootDirectory: string = process.cwd(),
): SourceGraphFacts {
  const compilerDependencies: CompilerGeneratedCapabilityDependency[] = [];
  const compilerSecuritySemanticSources: CompilerSecuritySemanticSource[] = [];
  const compilerTaskBBlockingDiagnostics: CoreGraph.StaticDiagnosticFact[] = [];
  const components: SourceComponentGraphFacts[] = [];
  const domainDeclarationNames: string[] = [];
  const registryDeclarationAnchors = buildCreateMap<string, KovoDiagnosticSourceAnchor | null>();
  const routeOutcomes = buildCreateMap<string, 'file' | 'stream'>();
  const routePages: SourceRoutePageFacts[] = [];
  const sourceDerivedRegistryTransforms: SourceDerivedRegistryTransform[] = [];

  const sourceFiles = buildSnapshotDenseArray(files, 'Build-check source files');
  const appContractProject = compilerOwnedAppContractProjectForBuild(sourceFiles, rootDirectory);
  // SPEC §5.2 rule 10 / §6.3: derive imported mutation-form ownership once from the same immutable
  // source snapshot used by build/check. Lowering receives only typed, path-scoped facts and never
  // infers authority from a bare identifier or a post-evaluation runtime object.
  const projectMutationFacts =
    appContractProject?.projectMutationRegistryFacts(sourceFiles) ??
    projectMutationRegistryFactsFromFiles(sourceFiles);
  const appContractStaticFacts = appContractProject?.staticFacts(sourceFiles) ?? [];
  collectAppContractDeclarationAnchors(registryDeclarationAnchors, appContractStaticFacts);
  for (let fileIndex = 0; fileIndex < sourceFiles.length; fileIndex += 1) {
    const file = sourceFiles[fileIndex]!;
    // Every identity input comes from the same descriptor-bound source census. Supplying the
    // other snapshotted files lets the compiler resolve exact local imports without reopening the
    // filesystem after authority approval.
    const extraFiles = buildSnapshotDenseArray(
      buildFilterDense(
        sourceFiles,
        `Same-snapshot framework-identity files for ${file.fileName}`,
        (candidate) => candidate.fileName !== file.fileName,
      ),
      `Framework-identity files for ${file.fileName}`,
    );
    const componentOptions = {
      ...(extraFiles.length === 0 ? {} : { extraFiles }),
      fileName: file.fileName,
      ...(projectMutationFacts.mutationBindings.length === 0
        ? {}
        : { registryFacts: projectMutationFacts }),
      source: file.source,
      sourceProvenance: 'app',
    } as const;
    const resolvedCompilation = withBuildAppContractResolutions(
      appContractProject,
      file.fileName,
      file.source,
      () => ({
        component: compileComponentModule(componentOptions),
        parsedModule: parseComponentModule(
          file.fileName,
          file.source,
          extraFiles.length === 0 ? {} : { frameworkIdentityFiles: extraFiles },
        ),
        routePage: compileRouteModule({ fileName: file.fileName, source: file.source }),
        standaloneRegistrySource: lowerStandaloneSourceDerivedRegistryDeclarations({
          fileName: file.fileName,
          source: file.source,
        }),
      }),
    );
    const component = resolvedCompilation.component;
    buildSecurityArrayAppend(
      sourceDerivedRegistryTransforms,
      {
        code: resolvedCompilation.standaloneRegistrySource,
        fileName: file.fileName,
        source: file.source,
      },
      'Preflight-authenticated source-derived registry transforms',
    );
    appendBuildTaskBFiniteDiagnostics(
      compilerTaskBBlockingDiagnostics,
      component.diagnostics,
      'TASK B component compiler finite diagnostics',
    );
    const standaloneRegistrySource = resolvedCompilation.standaloneRegistrySource;
    const compilerLoweredSources = [component.loweredSource, standaloneRegistrySource] as const;
    for (let loweredIndex = 0; loweredIndex < compilerLoweredSources.length; loweredIndex += 1) {
      const generatedDependencies = buildSnapshotDenseArray(
        compilerGeneratedCapabilityDependencies({
          authoredSource: file.source,
          fileName: file.fileName,
          loweredSource: compilerLoweredSources[loweredIndex]!,
        }),
        `Compiler-generated dependencies for ${file.fileName}`,
      );
      for (
        let dependencyIndex = 0;
        dependencyIndex < generatedDependencies.length;
        dependencyIndex += 1
      ) {
        buildSecurityArrayAppend(
          compilerDependencies,
          generatedDependencies[dependencyIndex]!,
          'CLI compiler-generated dependency carriers',
        );
      }
    }
    const semanticGraphs = buildFlatMapDense(
      component.componentGraphFacts,
      `Compiler semantic graph facts for ${file.fileName}`,
      (fact) => (fact.securitySemanticGraph === undefined ? [] : [fact.securitySemanticGraph]),
    );
    const parsedModule = resolvedCompilation.parsedModule;
    collectRegistryDeclarationAnchors(
      registryDeclarationAnchors,
      file.fileName,
      parsedModule.calls,
      domainDeclarationNames,
    );
    buildSecurityArrayAppend(
      compilerSecuritySemanticSources,
      {
        fileName: file.fileName,
        graphs: semanticGraphs,
        operations: componentTaskBSourceOperationFacts(parsedModule),
        source: file.source,
      },
      'CLI compiler semantic source carriers',
    );
    const routePage = resolvedCompilation.routePage;
    const routeDiagnostics = buildSnapshotDenseArray(
      routePage.diagnostics,
      `Compiler route diagnostics for ${file.fileName}`,
    );
    appendBuildTaskBFiniteDiagnostics(
      compilerTaskBBlockingDiagnostics,
      routeDiagnostics,
      'TASK B route compiler finite diagnostics',
    );
    const mergedComponent: SourceComponentGraphFacts =
      routeDiagnostics.length === 0
        ? component
        : {
            ...component,
            diagnostics: buildConcatDense(
              component.diagnostics,
              routeDiagnostics,
              `Component and route diagnostics for ${file.fileName}`,
            ),
          };
    if (
      mergedComponent.componentGraphFacts.length > 0 ||
      mergedComponent.agentGraphFacts.length > 0 ||
      mergedComponent.diagnostics.length > 0 ||
      mergedComponent.handlerWriteSinkFacts.length > 0 ||
      mergedComponent.publishToClientFacts.length > 0 ||
      mergedComponent.taskGraphFacts.length > 0 ||
      mergedComponent.updateCoverage.length > 0
    ) {
      buildSecurityArrayAppend(
        components,
        mergedComponent,
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
    }
    const routeFiles = buildSnapshotDenseArray(
      routePage.files,
      `Compiler-emitted route files for ${file.fileName}`,
    );
    for (let routeFileIndex = 0; routeFileIndex < routeFiles.length; routeFileIndex += 1) {
      const generatedDependencies = buildSnapshotDenseArray(
        compilerGeneratedCapabilityDependencies({
          authoredSource: file.source,
          fileName: file.fileName,
          loweredSource: routeFiles[routeFileIndex]!.source,
        }),
        `Compiler-generated route dependencies for ${file.fileName}`,
      );
      for (
        let dependencyIndex = 0;
        dependencyIndex < generatedDependencies.length;
        dependencyIndex += 1
      ) {
        buildSecurityArrayAppend(
          compilerDependencies,
          generatedDependencies[dependencyIndex]!,
          'CLI compiler-generated route dependency carriers',
        );
      }
    }
    if (routePage.routePageFacts.length > 0) {
      buildSecurityArrayAppend(
        routePages,
        routePage,
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
      const routePageFacts = buildSnapshotDenseArray(
        routePage.routePageFacts,
        `Route page facts for ${file.fileName}`,
      );
      for (let factIndex = 0; factIndex < routePageFacts.length; factIndex += 1) {
        const fact = routePageFacts[factIndex]!;
        if (fact.source !== undefined) {
          collectRegistryDeclarationAnchor(
            registryDeclarationAnchors,
            `page\0${fact.route}`,
            fact.source,
          );
        }
        if (fact.outcome !== undefined && !buildMapHas(routeOutcomes, fact.route)) {
          buildMapSet(routeOutcomes, fact.route, fact.outcome.kind);
        }
      }
    }
  }

  return {
    appContractStaticFacts,
    compilerDependencies,
    compilerSecuritySemanticSources,
    compilerTaskBFiniteVerdict:
      requiredBuildStaticAnalysisRuntime().snapshotCompilerTaskBFiniteVerdict({
        blockingDiagnostics: compilerTaskBBlockingDiagnostics,
        semanticSources: compilerSecuritySemanticSources,
      }),
    components,
    domainDeclarationNames,
    registryDeclarationAnchors,
    routeOutcomes,
    routePages,
    sourceDerivedRegistryTransforms,
  };
}

function collectAppContractDeclarationAnchors(
  target: Map<string, KovoDiagnosticSourceAnchor | null>,
  facts: readonly CompilerOwnedAppContractStaticFact[],
): void {
  const snapshot = buildSnapshotDenseArray(facts, 'Compiler-owned app-contract declarations');
  for (let index = 0; index < snapshot.length; index += 1) {
    const fact = snapshot[index]!;
    const declaration = fact.declaration;
    if (declaration === undefined) continue;
    const expectedKind =
      fact.memberName === 'route'
        ? 'page'
        : fact.memberName === 'integrateMutation'
          ? 'mutation'
          : fact.memberName === 'mutation' ||
              fact.memberName === 'query' ||
              fact.memberName === 'task'
            ? fact.memberName
            : undefined;
    if (expectedKind !== declaration.kind) {
      throw new TypeError(
        `Compiler-owned app-contract ${fact.memberName} declaration has invalid ${declaration.kind} registry kind.`,
      );
    }
    collectRegistryDeclarationAnchor(target, `${declaration.kind}\0${declaration.name}`, {
      end: declaration.end,
      file: fact.fileName,
      start: declaration.start,
    });
  }
}

function collectRegistryDeclarationAnchors(
  target: Map<string, KovoDiagnosticSourceAnchor | null>,
  fileName: string,
  calls: ReturnType<typeof parseComponentModule>['calls'],
  domainNames?: string[],
): void {
  const snapshot = buildSnapshotDenseArray(calls, `Registry declaration calls for ${fileName}`);
  for (let index = 0; index < snapshot.length; index += 1) {
    const call = snapshot[index]!;
    const kind = call.frameworkFactory;
    if (
      kind !== 'agent' &&
      kind !== 'domain' &&
      kind !== 'endpoint' &&
      kind !== 'mutation' &&
      kind !== 'query' &&
      kind !== 'task' &&
      kind !== 'tool' &&
      kind !== 'webhook'
    ) {
      continue;
    }
    const name = sourceRegistryDeclarationName(fileName, call);
    if (name === undefined) continue;
    const key = `${kind}\0${name}`;
    if (kind === 'domain' && domainNames !== undefined && !buildMapHas(target, key)) {
      buildSecurityArrayAppend(domainNames, name, 'Compiler-owned domain declaration names');
    }
    collectRegistryDeclarationAnchor(target, key, {
      end: call.end,
      file: fileName,
      start: call.start,
    });
  }
}

function collectRegistryDeclarationAnchor(
  target: Map<string, KovoDiagnosticSourceAnchor | null>,
  key: string,
  source: KovoDiagnosticSourceAnchor,
): void {
  if (buildMapHas(target, key)) {
    const existing = buildMapGet(target, key);
    if (
      existing !== null &&
      existing !== undefined &&
      existing.file === source.file &&
      existing.start === source.start &&
      existing.end === source.end
    ) {
      return;
    }
    // Duplicate declarations are invalid at runtime. Preserve explicit ambiguity so every
    // downstream association fails closed instead of guessing which authored range owns the fact.
    buildMapSet(target, key, null);
    return;
  }
  buildMapSet(target, key, source);
}

function sourceRegistryDeclarationName(
  fileName: string,
  call: ReturnType<typeof parseComponentModule>['calls'][number],
): string | undefined {
  if (call.frameworkRegistryDeclarationName !== undefined) {
    return call.frameworkRegistryDeclarationName;
  }
  const argumentsSnapshot = buildSnapshotDenseArray(
    call.arguments,
    `Registry declaration arguments for ${fileName}`,
  );
  const firstStaticValue = buildOwnDataProperty(
    call.argumentStaticValues,
    0,
    `Registry declaration values for ${fileName}`,
  );
  if (argumentsSnapshot.length > 0 && !firstStaticValue.present) {
    throw new TypeError(
      `Registry declaration values for ${fileName}[0] must be a dense own value.`,
    );
  }
  const explicit = firstStaticValue.present ? firstStaticValue.value : undefined;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  if (argumentsSnapshot.length !== 1 || call.exportedConstName === undefined) return undefined;
  return deriveRegistryIdentity(fileName, call.exportedConstName).key;
}

function registryDeclarationSource(
  anchors: ReadonlyMap<string, KovoDiagnosticSourceAnchor | null>,
  kind:
    | 'agent'
    | 'domain'
    | 'endpoint'
    | 'mutation'
    | 'page'
    | 'query'
    | 'task'
    | 'tool'
    | 'webhook',
  name: string,
): KovoDiagnosticSourceAnchor | undefined {
  const source = buildMapGet(anchors, `${kind}\0${name}`);
  if (source === null) {
    throw new TypeError(
      `Kovo build source provenance refused ambiguous ${kind} declaration ${name}.`,
    );
  }
  return source;
}

function requiredRegistryDeclarationSource(
  anchors: ReadonlyMap<string, KovoDiagnosticSourceAnchor | null>,
  kind:
    | 'agent'
    | 'domain'
    | 'endpoint'
    | 'mutation'
    | 'page'
    | 'query'
    | 'task'
    | 'tool'
    | 'webhook',
  name: string,
): KovoDiagnosticSourceAnchor {
  const source = registryDeclarationSource(anchors, kind, name);
  if (source === undefined) {
    throw new TypeError(
      `Kovo build source provenance could not associate runtime ${kind} declaration ${name} with the immutable authored-source census.`,
    );
  }
  return source;
}

function requiredEndpointDeclarationSource(
  anchors: ReadonlyMap<string, KovoDiagnosticSourceAnchor | null>,
  path: string,
): KovoDiagnosticSourceAnchor {
  const endpoint = registryDeclarationSource(anchors, 'endpoint', path);
  const webhook = registryDeclarationSource(anchors, 'webhook', path);
  if (endpoint !== undefined && webhook !== undefined) {
    throw new TypeError(
      `Kovo build source provenance refused endpoint/webhook declaration collision ${path}.`,
    );
  }
  if (endpoint !== undefined) return endpoint;
  if (webhook !== undefined) return webhook;
  throw new TypeError(
    `Kovo build source provenance could not associate runtime endpoint declaration ${path} with the immutable authored-source census.`,
  );
}

function queryDiagnosticSourceFacts(
  queries: readonly KovoApp['queries'][number][],
  anchors: ReadonlyMap<string, KovoDiagnosticSourceAnchor | null>,
): readonly KovoCheckDiagnosticSourceFact[] {
  return buildFlatMapDense(
    queries,
    'Build query diagnostic source facts',
    (query): KovoCheckDiagnosticSourceFact[] => {
      const source = buildMapGet(anchors, `query\0${query.key}`);
      return source === undefined || source === null
        ? []
        : [{ kind: 'query', name: query.key, source }];
    },
  );
}

/** Internal executable seam for the TASK B caller-carrier mutation gate (SPEC §6.6). */
export async function snapshotBuildCompilerTaskBFiniteVerdictForTests(
  files: readonly { readonly fileName: string; readonly source: string }[],
): Promise<CompilerTaskBFiniteVerdict> {
  await installBuildStaticAnalysisRuntime();
  return withMaterializedBuildCompilerSourcesForTests(
    files,
    (materializedFiles) => sourceGraphFactsFromFiles(materializedFiles).compilerTaskBFiniteVerdict,
  );
}

/** Internal executable seam proving ordinary build diagnostics retain the route compiler census. */
export async function snapshotBuildCompilerDiagnosticsForTests(
  files: readonly { readonly fileName: string; readonly source: string }[],
): Promise<CoreGraph.StaticDiagnosticFact[]> {
  await installBuildStaticAnalysisRuntime();
  return withMaterializedBuildCompilerSourcesForTests(files, (materializedFiles) =>
    buildMapDense(
      buildPreflightComponentDiagnostics(sourceGraphFactsFromFiles(materializedFiles).components),
      'Build compiler diagnostic test seam',
      staticDiagnosticFact,
    ),
  );
}

/**
 * Internal regression seam for the complete authenticated pre-evaluation source closure.
 *
 * This executes the same compiler semantic projection, capability closure, and KV424 trust pass as
 * build/check, while stopping before authored module evaluation.
 */
export async function snapshotBuildPreEvaluationTrustForTests(
  entryFileName: string,
  files: readonly { readonly fileName: string; readonly source: string }[],
): Promise<{
  readonly files: readonly string[];
  readonly unregisteredSinks: ReturnType<
    typeof collectStaticBuildTrustFactsFromProject
  >['unregisteredSinks'];
}> {
  await installBuildStaticAnalysisRuntime();
  return withMaterializedBuildCompilerSourcesForTests(files, (materializedFiles, projectRoot) => {
    const entryPath = resolve(projectRoot, entryFileName);
    const trust = runPreEvaluationStaticTrustPreflight(entryPath, projectRoot, false);
    return {
      files: buildMapDense(trust.files, 'Pre-evaluation trust test source closure', (file) =>
        slashPath(isAbsolute(file.fileName) ? relative(projectRoot, file.fileName) : file.fileName),
      ),
      unregisteredSinks: trust.facts.unregisteredSinks,
    };
  });
}

/**
 * Internal adversarial seam proving TASK B does not confuse exact app declaration provenance with
 * runtime assembly membership. It removes one authenticated task root row from the otherwise exact
 * carrier; the independent residual parser must close that transport omission (SPEC §6.6).
 */
export async function snapshotBuildOmittedTaskBCapabilityRootForTests(
  entryFileName: string,
  files: readonly { readonly fileName: string; readonly source: string }[],
): Promise<ReturnType<typeof collectStaticBuildTrustFactsFromProject>['unregisteredSinks']> {
  await installBuildStaticAnalysisRuntime();
  return withMaterializedBuildCompilerSourcesForTests(files, (materializedFiles, projectRoot) => {
    const entryPath = resolve(projectRoot, entryFileName);
    const sourceFiles = preEvaluationAppSourceFiles(entryPath, projectRoot);
    const sourceGraphFacts = sourceGraphFactsFromFiles(sourceFiles, projectRoot);
    const packageRequests = collectCapabilityPackageRequests(
      sourceFiles,
      sourceGraphFacts.compilerDependencies,
    );
    const capabilityClosure = analyzeCapabilityClosure({
      compilerDependencies: sourceGraphFacts.compilerDependencies,
      files: sourceFiles,
      packageSummaries: readCapabilityPackageSummaries(projectRoot),
      packages: resolveCapabilityPackages(packageRequests, entryPath),
    });
    let omitted = false;
    const capabilityFacts = buildFilterDense(
      capabilityClosure.facts,
      'TASK B omitted task-root adversarial carrier',
      (fact) => {
        if (
          !omitted &&
          fact.kind === 'root' &&
          (fact.rootKind === 'durable-task' || fact.rootKind === 'scheduled-task')
        ) {
          omitted = true;
          return false;
        }
        return true;
      },
    );
    if (!omitted) {
      throw new TypeError('TASK B omitted-root test seam requires one authenticated task root.');
    }
    return requiredBuildStaticAnalysisRuntime().collectStaticBuildTrustFactsFromProject({
      appContractStaticFacts: sourceGraphFacts.appContractStaticFacts,
      compilerSecuritySemanticSources: sourceGraphFacts.compilerSecuritySemanticSources,
      compilerTaskBClosure: {
        capabilityFacts,
        dependencyManifest: capabilityClosure.dependencyManifest,
        finiteVerdict: sourceGraphFacts.compilerTaskBFiniteVerdict,
        files: sourceFiles,
        schema: 'kovo-task-b-closure/v2',
      },
      files: sourceFiles,
    }).unregisteredSinks;
  });
}

/**
 * Give test-supplied source the same exact Program ownership as a real build.
 *
 * The production path receives source files that already exist beneath the approved build root.
 * These test seams receive immutable in-memory snapshots, so they materialize a fresh, bounded
 * project under the repository root before invoking the same compiler-owned Program path. A
 * relative path escape or duplicate normalized identity fails before any source is compiled.
 */
function withMaterializedBuildCompilerSourcesForTests<Value>(
  files: readonly { readonly fileName: string; readonly source: string }[],
  operation: (
    files: readonly { readonly fileName: string; readonly source: string }[],
    projectRoot: string,
  ) => Value,
): Value {
  const projectRoot = builtinMkdtempSync(
    builtinJoin(process.cwd(), '.kovo-task-b-compiler-project-'),
  );
  try {
    const serverEntryPath = requireFromCli.resolve('@kovojs/server');
    const serverPackageRoot = builtinRealpathSync(
      builtinJoin(builtinDirname(serverEntryPath), '..'),
    );
    const packageScopeRoot = builtinJoin(projectRoot, 'node_modules', '@kovojs');
    builtinMkdirSync(packageScopeRoot, { recursive: true });
    builtinSymlinkSync(serverPackageRoot, builtinJoin(packageScopeRoot, 'server'), 'dir');
    const sources = buildSnapshotDenseArray(files, 'TASK B virtual compiler source files');
    const materialized: { fileName: string; source: string }[] = [];
    const seen = buildCreateSet<string>();
    for (let index = 0; index < sources.length; index += 1) {
      const file = sources[index]!;
      const fileName = buildOwnDataValue(
        file,
        'fileName',
        `TASK B virtual compiler source file[${index}]`,
      );
      const source = buildOwnDataValue(
        file,
        'source',
        `TASK B virtual compiler source file[${index}]`,
      );
      if (
        typeof fileName !== 'string' ||
        !/\.[cm]?[jt]sx?$/u.test(fileName) ||
        builtinIsAbsolute(fileName)
      ) {
        throw new TypeError(
          `TASK B virtual compiler source file[${index}] must use a project-relative JavaScript or TypeScript path.`,
        );
      }
      if (typeof source !== 'string') {
        throw new TypeError(`TASK B virtual compiler source file[${index}] must contain source.`);
      }
      const destination = builtinResolve(projectRoot, fileName);
      const relativeDestination = builtinRelative(projectRoot, destination);
      if (
        relativeDestination.length === 0 ||
        relativeDestination === '..' ||
        relativeDestination.startsWith(`..${builtinPathSeparator}`) ||
        builtinIsAbsolute(relativeDestination)
      ) {
        throw new TypeError(
          `TASK B virtual compiler source file[${index}] escapes its compiler-owned project.`,
        );
      }
      if (buildSetHas(seen, destination)) {
        throw new TypeError(
          `TASK B virtual compiler source file[${index}] duplicates ${relativeDestination}.`,
        );
      }
      buildSetAdd(seen, destination);
      builtinMkdirSync(builtinDirname(destination), { recursive: true });
      builtinWriteFileSync(destination, source, { encoding: 'utf8', flag: 'wx' });
      buildSecurityArrayAppend(
        materialized,
        { fileName: destination, source },
        'TASK B materialized compiler source files',
      );
    }
    return operation(materialized, projectRoot);
  } finally {
    try {
      builtinRmSync(projectRoot, { force: true, recursive: true });
    } catch {
      // The test seam never lets cleanup failure replace the compiler verdict under test.
    }
  }
}

/** Internal seam proving exact compiler diagnostic ranges survive the build-graph projection. */
export function snapshotBuildCompilerDiagnosticAnchorsForTests(
  files: readonly { readonly fileName: string; readonly source: string }[],
): CoreGraph.StaticDiagnosticFact[] {
  return buildFlatMapDense(files, 'Build compiler diagnostic source-anchor files', (file) =>
    buildMapDense(
      compileComponentModule({
        fileName: file.fileName,
        source: file.source,
        sourceProvenance: 'app',
      }).diagnostics,
      `Build compiler diagnostic source anchors for ${file.fileName}`,
      staticDiagnosticFact,
    ),
  );
}

/** Internal test seam for compiler-emitted declaration/node provenance in built graph artifacts. */
export function snapshotBuildCompilerSourceAnchorsForTests(
  files: readonly { readonly fileName: string; readonly source: string }[],
  declarations: readonly {
    readonly kind:
      | 'agent'
      | 'domain'
      | 'endpoint'
      | 'mutation'
      | 'page'
      | 'query'
      | 'task'
      | 'tool'
      | 'webhook';
    readonly name: string;
  }[],
): {
  components: CompileResult['componentGraphFacts'];
  declarations: readonly (CoreGraph.SourceAnchor | undefined)[];
  routes: CompileRouteModuleResult['routePageFacts'];
} {
  const anchors = buildCreateMap<string, KovoDiagnosticSourceAnchor | null>();
  const sourceFiles = buildSnapshotDenseArray(files, 'Build compiler source-anchor files');
  const components = buildFlatMapDense(
    sourceFiles,
    'Build compiler source-anchor component files',
    (file) => {
      const parsed = parseComponentModule(file.fileName, file.source);
      collectRegistryDeclarationAnchors(anchors, file.fileName, parsed.calls);
      return buildSnapshotDenseArray(
        compileComponentModule({
          fileName: file.fileName,
          source: file.source,
          sourceProvenance: 'app',
        }).componentGraphFacts,
        'Build compiler source-anchor components',
      );
    },
  );
  const routes = buildFlatMapDense(
    sourceFiles,
    'Build compiler source-anchor route files',
    (file) => {
      const routeFacts = buildSnapshotDenseArray(
        compileRouteModule({ fileName: file.fileName, source: file.source }).routePageFacts,
        'Build compiler source-anchor routes',
      );
      for (let index = 0; index < routeFacts.length; index += 1) {
        const route = routeFacts[index]!;
        if (route.source !== undefined) {
          collectRegistryDeclarationAnchor(anchors, `page\0${route.route}`, route.source);
        }
      }
      return routeFacts;
    },
  );
  return {
    components,
    declarations: buildMapDense(
      declarations,
      'Build compiler source-anchor declarations',
      (declaration) =>
        declaration.kind === 'endpoint'
          ? requiredEndpointDeclarationSource(anchors, declaration.name)
          : requiredRegistryDeclarationSource(anchors, declaration.kind, declaration.name),
    ),
    routes,
  };
}

/**
 * Internal regression seam for declaration provenance that requires the exact TypeScript project
 * used by build/check (for example, adapter mutations whose public key is carried by a type).
 */
export async function snapshotBuildAppContractSourceAnchorsForTests(
  files: readonly { readonly fileName: string; readonly source: string }[],
  declarations: readonly {
    readonly kind: 'mutation' | 'page' | 'query' | 'task';
    readonly name: string;
  }[],
): Promise<readonly (CoreGraph.SourceAnchor | undefined)[]> {
  await installBuildStaticAnalysisRuntime();
  const anchors = sourceGraphFactsFromFiles(files).registryDeclarationAnchors;
  return buildMapDense(
    declarations,
    'Build app-contract source-anchor declarations',
    (declaration) => requiredRegistryDeclarationSource(anchors, declaration.kind, declaration.name),
  );
}

function emptyStaticDataPlaneBuildFacts(): StaticDataPlaneBuildFacts {
  return {
    grants: [],
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

function queryCheckFact(
  query: KovoApp['queries'][number],
  queryFacts: readonly QueryReadFactLike[],
  execution: BuildExecutionModule,
  source?: CoreGraph.SourceAnchor,
): CoreGraph.QueryReadSet {
  const access = accessDecisionGraphFact(execution.accessDecisionFor(query), execution);
  const fact = buildFindDense(
    queryFacts,
    'Static query-read facts',
    (candidate) => candidate.query === query.key,
  );
  const factReads = buildFilterDense(fact?.reads ?? [], 'Static query read domains', isString);
  const declaredReads = buildSnapshotDenseArray(
    (query.reads ?? []) as readonly { key: string }[],
    `Declared reads for ${query.key}`,
  );
  const declaredReadKeys = buildMapDense(
    declaredReads,
    `Declared read keys for ${query.key}`,
    (read) => read.key,
  );
  const readProvenance =
    fact?.readProvenance === undefined
      ? undefined
      : buildSnapshotDenseArray(fact.readProvenance, `Read provenance for ${query.key}`);
  const readOnlyDomains = buildFilterDense(
    fact?.readOnlyDomains ?? [],
    `Read-only domains for ${query.key}`,
    isString,
  );
  return {
    ...(access === undefined ? {} : { access }),
    domains: uniqueSorted(
      appendDense(declaredReadKeys, factReads, `Read domains for ${query.key}`),
    ),
    query: query.key,
    ...(readProvenance !== undefined && readProvenance.length > 0 ? { readProvenance } : {}),
    ...(readOnlyDomains.length > 0 ? { readOnlyDomains: uniqueSorted(readOnlyDomains) } : {}),
    ...(query.guard === undefined ? {} : { guards: ['query.guard'] }),
    ...(source === undefined ? {} : { source }),
  };
}

function mutationCheckFact(
  mutation: KovoApp['mutations'][number],
  queryReadSets: readonly CoreGraph.QueryReadSet[],
  execution: BuildExecutionModule,
  source?: CoreGraph.SourceAnchor,
): CoreGraph.MutationExplain {
  const access = accessDecisionGraphFact(execution.accessDecisionFor(mutation), execution);
  const guards = uniqueSorted(
    appendDense(
      access?.kind === 'guard-chain' ? access.guards : [],
      mutation.guard === undefined ? [] : [execution.guardAuditName(mutation.guard)],
      `Mutation guards for ${mutation.key}`,
    ),
  );
  const registry = mutation.registry;
  const touches = (registry?.touches ?? []) as readonly { key: string }[];
  const inferredTouches = (registry?.inferredTouches ?? []) as readonly { domain: string }[];
  const writes = uniqueSorted(
    buildMapDense(touches, `Mutation touches for ${mutation.key}`, (touch) => touch.key),
  );
  const inferredWrites = uniqueSorted(
    buildMapDense(
      inferredTouches,
      `Inferred mutation touches for ${mutation.key}`,
      (touch) => touch.domain,
    ),
  );
  const fileFields = buildSnapshotDenseArray<string>(
    (mutation.fileFields ?? []) as readonly string[],
    `Mutation file fields for ${mutation.key}`,
  );
  const invalidates = mutationInvalidatedQueryKeys(
    mutation,
    queryReadSets,
    appendDense(writes, inferredWrites, `Mutation writes for ${mutation.key}`),
  );
  const referencesSessionAuthority = mutationGuardReferencesSessionAuthority(mutation, execution);
  return {
    ...(access === undefined ? {} : { access }),
    csrf: mutation.csrf === false ? 'exempt' : 'checked',
    // SPEC §6.6/§9.1: the runtime constructor/app snapshot already made this
    // discriminant fail closed. Preserve the exact author reason in explain/check
    // facts instead of replacing it with a generic, non-auditable placeholder.
    ...(mutation.csrf === false
      ? { csrfJustification: requiredMutationCsrfJustification(mutation) }
      : {}),
    ...(guards.length === 0 ? {} : { guards }),
    ...(referencesSessionAuthority ? { session: 'guard-chain-browser-authority' } : {}),
    ...(invalidates.length === 0 ? {} : { invalidates }),
    ...(fileFields.length === 0 ? {} : { enctype: 'multipart/form-data' as const, fileFields }),
    key: mutation.key,
    ...(source === undefined ? {} : { source }),
    ...(writes.length === 0 && inferredWrites.length === 0
      ? {}
      : {
          writes: uniqueSorted(
            appendDense(writes, inferredWrites, `Mutation writes for ${mutation.key}`),
          ),
        }),
  };
}

function requiredMutationCsrfJustification(mutation: KovoApp['mutations'][number]): string {
  const justification = mutation.csrfJustification;
  if (typeof justification !== 'string' || justification.length === 0) {
    throw new TypeError(
      `Mutation ${mutation.key} reached build graph extraction without its csrf:false justification.`,
    );
  }
  return justification;
}

function mutationGuardReferencesSessionAuthority(
  mutation: KovoApp['mutations'][number],
  execution: BuildExecutionModule,
): boolean {
  const access = execution.accessDecisionFor(mutation);
  if (buildArrayIsArray(access)) {
    return buildSomeDense(
      access as readonly Guard<any, any>[],
      `Mutation access guards for ${mutation.key}`,
      (guard) => guardReferencesSessionAuthority(guard, execution),
    );
  }
  if (access !== undefined) return false;
  return mutation.guard !== undefined && guardReferencesSessionAuthority(mutation.guard, execution);
}

function guardReferencesSessionAuthority(
  guard: Guard<any, any>,
  execution: BuildExecutionModule,
): boolean {
  const facts = buildSnapshotDenseArray(execution.explainGuard(guard), 'Guard audit facts');
  const substantive = buildFilterDense(
    facts,
    'Substantive guard audit facts',
    (fact) => fact.kind !== 'named',
  );
  if (substantive.length === 0) return true;
  return buildSomeDense(
    substantive,
    'Session-authority guard audit facts',
    (fact) => fact.kind !== 'rateLimit' || (fact.per !== 'global' && fact.per !== 'ip'),
  );
}

function mutationOptimisticCheckFacts(
  mutation: KovoApp['mutations'][number],
): CoreGraph.OptimisticCoverage[] {
  const optimistic = mutation.optimistic as Record<string, unknown> | undefined;
  if (optimistic === undefined) return [];

  const optimisticQueryKeys = buildFilterDense(
    buildObjectKeys(optimistic),
    `Optimistic query keys for ${mutation.key}`,
    isString,
  );
  const optimisticQueries = buildMapDense(
    optimisticQueryKeys,
    `Optimistic queries for ${mutation.key}`,
    (key) => ({ key }),
  );
  return buildFlatMapDense(
    uniqueQueries(optimisticQueries),
    `Unique optimistic queries for ${mutation.key}`,
    (query) => {
      const entry = buildOwnDataValue(
        optimistic,
        query.key,
        `Optimistic declarations for ${mutation.key}`,
      );
      if (entry === undefined) return [];
      return [
        {
          mutation: mutation.key,
          query: query.key,
          status: entry === 'await-fragment' ? 'await-fragment' : 'hand-written',
        },
      ];
    },
  );
}

function mutationInvalidatedQueryKeys(
  mutation: KovoApp['mutations'][number],
  queryReadSets: readonly CoreGraph.QueryReadSet[],
  writeDomains: readonly string[],
): string[] {
  // SPEC §10.4/§10.6: graph/explain and optimistic coverage share one derived
  // invalidated-query set; live targets are consumers, not mutation-wide invalidations.
  const registryQueries = (mutation.registry?.queries ?? []) as readonly { key: string }[];
  const optimistic = mutation.optimistic as Record<string, unknown> | undefined;
  const optimisticQueryKeys =
    optimistic === undefined
      ? []
      : buildFilterDense(
          buildObjectKeys(optimistic),
          `Optimistic invalidations for ${mutation.key}`,
          isString,
        );
  const writtenDomains = buildCreateSet<string>();
  const writeDomainSnapshot = buildSnapshotDenseArray(
    writeDomains,
    `Written domains for ${mutation.key}`,
  );
  for (let index = 0; index < writeDomainSnapshot.length; index += 1) {
    buildSetAdd(writtenDomains, writeDomainSnapshot[index]!);
  }
  const intersectingQueries =
    writeDomainSnapshot.length === 0
      ? []
      : buildMapDense(
          buildFilterDense(
            queryReadSets,
            `Mutation invalidation candidates for ${mutation.key}`,
            (query) =>
              buildSomeDense(query.domains, `Read domains for ${query.query}`, (domain) =>
                buildSetHas(writtenDomains, domain),
              ),
          ),
          `Intersecting mutation queries for ${mutation.key}`,
          (query) => query.query,
        );
  const registryQueryKeys = buildMapDense(
    registryQueries,
    `Registry queries for ${mutation.key}`,
    (query) => query.key,
  );

  return uniqueSorted(
    appendDense(
      appendDense(registryQueryKeys, intersectingQueries, `Invalidations for ${mutation.key}`),
      optimisticQueryKeys,
      `Optimistic invalidations for ${mutation.key}`,
    ),
  );
}

function uniqueQueries(queries: readonly { key: string }[]): { key: string }[] {
  const seen = buildCreateSet<string>();
  const unique: { key: string }[] = [];
  const snapshot = buildSnapshotDenseArray(queries, 'Queries to deduplicate');
  for (let index = 0; index < snapshot.length; index += 1) {
    const query = snapshot[index]!;
    if (buildSetHas(seen, query.key)) continue;
    buildSetAdd(seen, query.key);
    buildSecurityArrayAppend(unique, query, 'Unique sorted queries');
    let insertAt = unique.length - 1;
    while (insertAt > 0 && query.key < unique[insertAt - 1]!.key) {
      unique[insertAt] = unique[insertAt - 1]!;
      insertAt -= 1;
    }
    unique[insertAt] = query;
  }
  return unique;
}

function routeCheckFact(
  route: KovoApp['routes'][number],
  execution: BuildExecutionModule,
  source?: CoreGraph.SourceAnchor,
): CoreGraph.PageExplain {
  const access = routeEndpointAccessFact(route, execution);
  const layoutQueryRecord = route.layout?.queries ?? {};
  const layoutQueryKeys = buildObjectKeys(layoutQueryRecord);
  const layoutQueries: { key: string }[] = [];
  for (let index = 0; index < layoutQueryKeys.length; index += 1) {
    const query = buildOwnDataValue(
      layoutQueryRecord,
      layoutQueryKeys[index]!,
      `Layout queries for ${route.path}`,
    );
    if (
      query &&
      typeof query === 'object' &&
      typeof (query as { key?: unknown }).key === 'string'
    ) {
      buildSecurityArrayAppend(
        layoutQueries,
        query as { key: string },
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
    }
  }
  return {
    ...(access === undefined ? {} : { access }),
    ...(route.guard === undefined ? {} : { guards: ['route.guard'] }),
    queries: uniqueSorted(
      buildMapDense(layoutQueries, `Layout query values for ${route.path}`, (query) => query.key),
    ),
    route: route.path,
    ...(source === undefined ? {} : { source }),
  };
}

function routeFileStreamEndpointFacts(
  routes: readonly KovoApp['routes'][number][],
  outcomeByPath: ReadonlyMap<string, 'file' | 'stream'>,
  execution: BuildExecutionModule,
): CoreGraph.EndpointExplain[] {
  return buildFlatMapDense(routes, 'Routes with file/stream outcomes', (route) => {
    const outcome = buildMapGet(outcomeByPath, route.path);
    if (outcome === undefined) return [];
    return [routeFileStreamEndpointFact(route, outcome, execution)];
  });
}

function routeFileStreamEndpointFact(
  route: KovoApp['routes'][number],
  outcome: 'file' | 'stream',
  execution: BuildExecutionModule,
): CoreGraph.EndpointExplain {
  const access = routeEndpointAccessFact(route, execution);
  return {
    ...(access === undefined ? {} : { access }),
    ...(route.guard === undefined
      ? {}
      : {
          auth: 'session+guard',
          guards: ['route.guard'],
        }),
    body: outcome === 'file' ? 'bytes' : 'stream',
    cache: route.guard === undefined ? 'route-default' : 'private,no-store',
    headers: ['Content-Disposition', 'Content-Type'],
    method: 'GET',
    mount: 'exact',
    name: route.path,
    path: route.path,
    reason: `route respond.${outcome} outcome`,
    surface: outcome === 'file' ? 'route-file' : 'route-stream',
  };
}

function routeEndpointAccessFact(
  route: KovoApp['routes'][number],
  execution: BuildExecutionModule,
): CoreGraph.AccessDecisionFact | undefined {
  const access = accessDecisionGraphFact(execution.accessDecisionFor(route), execution);
  if (access !== undefined) return access;

  let layout = route.layout;
  while (layout !== undefined) {
    const layoutAccess = accessDecisionGraphFact(execution.accessDecisionFor(layout), execution);
    if (layoutAccess !== undefined) return layoutAccess;
    layout = layout.parent;
  }

  return undefined;
}

function accessDecisionGraphFact(
  access: AccessDecision | undefined,
  execution: BuildExecutionModule,
): CoreGraph.AccessDecisionFact | undefined {
  if (access === undefined) return undefined;

  if (isGuardAccessDecisionValue(access)) {
    if (access.length === 0) return undefined;
    return {
      guards: buildMapDense(access, 'Access-decision guard chain', (item) =>
        execution.guardAuditName(item),
      ),
      kind: 'guard-chain',
    };
  }

  // Array.isArray is the runtime discriminator, but TypeScript cannot subtract an open object
  // interface from an array structurally. This cast is the internal post-discrimination boundary;
  // declaration-time snapshotting has already limited the non-array branch to these two sentinels.
  const structuredAccess = access as
    | { readonly kind: 'public'; readonly reason: string }
    | { readonly kind: 'verified-machine-auth' };
  if (structuredAccess.kind === 'public') {
    return { kind: 'public', reason: structuredAccess.reason };
  }
  if (structuredAccess.kind === 'verified-machine-auth') {
    return { kind: 'verified-machine-auth' };
  }
  return undefined;
}

function isGuardAccessDecisionValue(
  access: AccessDecision,
): access is Extract<AccessDecision, readonly unknown[]> {
  return buildArrayIsArray(access);
}

function endpointCheckFact(
  endpoint: KovoApp['endpoints'][number],
  execution: BuildExecutionModule,
  source?: CoreGraph.SourceAnchor,
): CoreGraph.EndpointExplain {
  const access = accessDecisionGraphFact(execution.accessDecisionFor(endpoint), execution);
  const csrf = endpointSafeMethod(endpoint.method)
    ? 'safe:read-only'
    : endpoint.csrf?.exempt === true
      ? 'exempt'
      : 'checked';
  const name = endpointWebhookName(endpoint);
  return {
    ...(access === undefined ? {} : { access }),
    appOwnedSafety: endpoint.response.appOwnedSafety,
    ...(endpoint.auth === undefined
      ? {}
      : {
          auth: endpointCheckAuth(endpoint.auth),
          ...(endpoint.auth.kind === 'none'
            ? { authJustification: endpoint.auth.justification }
            : {}),
        }),
    body: endpointResponseBodyPosture(endpoint.response.body),
    cache: endpoint.response.cache,
    csrf,
    ...(csrf === 'exempt' ? { csrfJustification: endpoint.csrf?.justification ?? '' } : {}),
    ...(endpoint.response.longLived === undefined
      ? {}
      : {
          deadlineJustification: endpoint.response.longLived.justification,
          deadlineMs: endpoint.response.longLived.deadlineMs,
        }),
    ...(endpoint.response.reservedHeaders === undefined
      ? {}
      : { headers: endpoint.response.reservedHeaders }),
    method: endpoint.method,
    mount: endpoint.mount,
    ...(endpoint.mountJustification === undefined
      ? {}
      : { mountJustification: endpoint.mountJustification }),
    ...(name === undefined ? {} : { name }),
    path: endpoint.path,
    reason: endpoint.reason,
    ...(source === undefined ? {} : { source }),
    surface: 'webhook' in endpoint && endpoint.webhook === true ? 'webhook' : 'endpoint',
    ...endpointWrites(endpoint),
  };
}

function endpointSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function endpointResponseBodyPosture(
  body: KovoApp['endpoints'][number]['response']['body'],
): string {
  return typeof body === 'string'
    ? body
    : buildJoinStrings(body, ',', 'Endpoint response-body posture');
}

function endpointCheckAuth(auth: KovoApp['endpoints'][number]['auth']): string {
  if (auth === undefined) return 'none';
  if (auth.kind === 'none') return 'none';
  return `${auth.kind}:${auth.name}`;
}

function endpointWebhookName(endpoint: KovoApp['endpoints'][number]): string | undefined {
  if (!('webhook' in endpoint) || endpoint.webhook !== true) return undefined;
  if (!('name' in endpoint) || typeof endpoint.name !== 'string') return undefined;
  return endpoint.name;
}

function endpointWrites(
  endpoint: KovoApp['endpoints'][number],
): Pick<CoreGraph.EndpointExplain, 'writes'> {
  if (!isWebhookEndpoint(endpoint)) return {};
  const writes = buildMapDense(
    endpoint.webhookDefinition.writes ?? [],
    `Webhook writes for ${endpoint.path}`,
    (domain) => domain.key,
  );
  return writes.length === 0 ? {} : { writes: uniqueSorted(writes) };
}

function isWebhookEndpoint(
  endpoint: KovoApp['endpoints'][number],
): endpoint is KovoApp['endpoints'][number] & {
  webhook: true;
  webhookDefinition: { writes?: readonly { key: string }[] };
} {
  return 'webhook' in endpoint && endpoint.webhook === true && 'webhookDefinition' in endpoint;
}

function findBuildTsconfig(appModulePath: string, invocationRoot: string): string | undefined {
  const relativeAppPath = relative(invocationRoot, appModulePath);
  if (
    buildSomeDense(buildPathSegments(relativeAppPath), 'Build app path segments', (part) =>
      buildStringStartsWith(part, '.'),
    )
  ) {
    return undefined;
  }

  return findNearestFile(dirname(appModulePath), 'tsconfig.json', { stopDir: invocationRoot });
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function uniqueSorted(values: readonly string[]): string[] {
  const source = buildSnapshotDenseArray(values, 'Strings to deduplicate and sort');
  const seen = buildCreateSet<string>();
  const result: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index]!;
    if (buildSetHas(seen, value)) continue;
    buildSetAdd(seen, value);
    buildSecurityArrayAppend(result, value, 'Unique sorted strings');
    let insertAt = result.length - 1;
    while (insertAt > 0 && value < result[insertAt - 1]!) {
      result[insertAt] = result[insertAt - 1]!;
      insertAt -= 1;
    }
    result[insertAt] = value;
  }
  return result;
}

function execFileErrorOutput(error: unknown): string {
  if (isRecord(error)) {
    const stdout = typeof error.stdout === 'string' ? buildStringTrimEnd(error.stdout) : '';
    const stderr = typeof error.stderr === 'string' ? buildStringTrimEnd(error.stderr) : '';
    const output = buildJoinStrings(
      buildFilterDense([stdout, stderr], 'TypeScript error output', (value) => value.length > 0),
      '\n',
      'TypeScript error output lines',
    );
    if (output) return output;
  }
  return error instanceof Error ? error.message : String(error);
}

async function inspectKovoBuildPreset(
  preset: KovoBuildPreset,
  neutralBuild: KovoNeutralBuild,
  context: KovoBuildPresetContext,
): Promise<readonly KovoBuildPresetDiagnostic[]> {
  if (typeof preset.inspect !== 'function') return [];
  return preset.inspect(neutralBuild, context);
}

const kovoBuildEnvConventions = ['DATABASE_URL'] as const;

function inferredKovoBuildDeclaredEnv(serverHandlerSource: string): readonly string[] {
  return buildFilterDense(kovoBuildEnvConventions, 'Kovo build environment conventions', (name) =>
    buildStringIncludes(serverHandlerSource, name),
  );
}

function buildPresetOutDir(outDir: string, preset: KovoBuildPresetName): string {
  if (preset === 'cloudflare') return join(outDir, 'cloudflare');
  if (preset === 'vercel') return join(outDir, '.vercel/output');
  return join(outDir, 'server');
}

async function kovoBuildStylesheetCss(appModulePath: string): Promise<KovoBuildStylesheetBuild> {
  const [
    { extractAppComponentCss, extractAppRouteCssTargets, extractPackageComponentCss },
    { collectCssAssetManifest, cssRouteDeliveryGate },
    { kovoUiTokenSheetCss },
  ] = await buildPromiseAll([
    import('@kovojs/compiler/package-styles'),
    import('@kovojs/compiler/internal'),
    import('@kovojs/headless-ui/internal'),
  ]);
  const extractionOptions = {
    fileName: appModulePath,
    packagePrefixDiscoveryRoot: dirname(appModulePath),
    source: existsSync(appModulePath) ? readFileSync(appModulePath, 'utf8') : '',
  };
  const packageResult = extractPackageComponentCss('@kovojs/ui', extractionOptions);
  const appResult = extractAppComponentCss(extractionOptions);
  assertKovoBuildStylesheetExtractionDiagnostics(packageResult.diagnostics, appResult.diagnostics);
  const appRouteTargets = extractAppRouteCssTargets(extractionOptions);
  const appCssAssets = buildSnapshotDenseArray(appResult.cssAssets, 'App CSS assets');
  const routeTargets = buildSnapshotDenseArray(
    appRouteTargets.routeTargets,
    'App CSS route targets',
  );
  const appSplitManifest =
    appCssAssets.length === 0 || routeTargets.length === 0
      ? undefined
      : collectCssAssetManifest({ cssAssets: appCssAssets }, { split: { routes: routeTargets } });
  if (appSplitManifest)
    assertKovoBuildCssDelivery(appSplitManifest, routeTargets, cssRouteDeliveryGate);
  const appSplitAssets = stylesheetAssetsFromCssSplitChunks(appSplitManifest?.chunks);

  if (!packageResult.css && !appResult.css)
    return { assets: emptyKovoBuildStylesheetAssets(), stylesheetCss: [] };
  const tokenCss = buildStringTrim(
    buildRegExpReplace(/@theme[^{]*\{[\s\S]*?\n\}/, kovoUiTokenSheetCss, ''),
  );
  const monolithAppCss = appSplitManifest ? null : appResult.css;
  const stylesheetChunks = buildFilterDense(
    [tokenCss, packageResult.css, monolithAppCss],
    'Kovo build stylesheet chunks',
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return {
    assets: appSplitAssets,
    stylesheetCss: [
      {
        css: buildArrayJoin(stylesheetChunks, '\n'),
        href: '/assets/styles.css',
      },
      ...stylesheetCssFromBuildStylesheetAssets(appSplitAssets),
    ],
  };
}

/** @internal Regression seam for fail-closed production stylesheet extraction. */
export async function kovoBuildStylesheetCssForTesting(appModulePath: string): Promise<void> {
  await kovoBuildStylesheetCss(appModulePath);
}

interface KovoBuildStylesheetExtractionDiagnostic {
  readonly fileName: string;
  readonly message: string;
}

function assertKovoBuildStylesheetExtractionDiagnostics(
  packageDiagnostics: readonly KovoBuildStylesheetExtractionDiagnostic[],
  appDiagnostics: readonly KovoBuildStylesheetExtractionDiagnostic[],
): void {
  const groups = [
    { diagnostics: packageDiagnostics, label: 'package @kovojs/ui' },
    { diagnostics: appDiagnostics, label: 'app' },
  ] as const;
  const detailLines: string[] = [];
  let diagnosticCount = 0;

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex]!;
    const diagnostics = buildSnapshotDenseArray(
      group.diagnostics,
      `Kovo build ${group.label} stylesheet extraction diagnostics`,
    );
    diagnosticCount += diagnostics.length;
    for (let diagnosticIndex = 0; diagnosticIndex < diagnostics.length; diagnosticIndex += 1) {
      const diagnostic = diagnostics[diagnosticIndex]!;
      if (typeof diagnostic !== 'object' || diagnostic === null) {
        throw new TypeError(`Kovo build ${group.label} stylesheet diagnostic must be a record.`);
      }
      const fileName = buildOwnDataValue(
        diagnostic,
        'fileName',
        `Kovo build ${group.label} stylesheet diagnostic`,
      );
      const message = buildOwnDataValue(
        diagnostic,
        'message',
        `Kovo build ${group.label} stylesheet diagnostic`,
      );
      if (typeof fileName !== 'string' || typeof message !== 'string') {
        throw new TypeError(
          `Kovo build ${group.label} stylesheet diagnostic requires fileName/message strings.`,
        );
      }
      if (detailLines.length < 10) {
        buildSecurityArrayAppend(
          detailLines,
          `${group.label} ${stableText(fileName)}: ${stableText(message)}`,
          'CLI packages/cli/src/commands/build-export.ts stylesheet diagnostics',
        );
      }
    }
  }

  if (diagnosticCount === 0) return;
  const details = buildArrayJoin(detailLines, '\n');
  const omittedCount = diagnosticCount - detailLines.length;
  const suffix =
    omittedCount > 0 ? `\n... ${omittedCount} more stylesheet extraction diagnostics` : '';
  throw new Error(`kovo build stylesheet extraction failed:\n${details}${suffix}`);
}

function assertKovoBuildCssDelivery(
  manifest: Parameters<(typeof import('@kovojs/compiler/internal'))['cssRouteDeliveryGate']>[0],
  routeTargets: readonly Parameters<
    (typeof import('@kovojs/compiler/internal'))['cssRouteDeliveryGate']
  >[1][],
  cssRouteDeliveryGate: (typeof import('@kovojs/compiler/internal'))['cssRouteDeliveryGate'],
): void {
  const diagnostics = buildFlatMapDense(
    routeTargets,
    'CSS delivery route targets',
    (routeTarget) => cssRouteDeliveryGate(manifest, routeTarget).diagnostics,
  );
  if (diagnostics.length === 0) return;

  const detailLines: string[] = [];
  const detailCount = diagnostics.length < 10 ? diagnostics.length : 10;
  for (let index = 0; index < detailCount; index += 1) {
    const diagnostic = diagnostics[index]!;
    buildSecurityArrayAppend(
      detailLines,
      `${diagnostic.route} links ${diagnostic.href} atom ${diagnostic.className} ` +
        `from ${diagnostic.source}`,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  const details = buildArrayJoin(detailLines, '\n');
  const suffix =
    diagnostics.length > 10 ? `\n... ${diagnostics.length - 10} more CSS overship diagnostics` : '';
  throw new Error(`kovo build CSS overship gate failed:\n${details}${suffix}`);
}

function selectedKovoBuildPreset(
  options: KovoBuildOptions,
  configuredPreset: KovoBuildPreset | undefined,
  invocationEnv: NodeJS.ProcessEnv,
): SelectedKovoBuildPreset {
  if (options.preset !== undefined) return { name: options.preset };

  const envPreset = kovoInvocationEnvironmentValue(invocationEnv, 'KOVO_PRESET');
  if (envPreset) {
    const parsedPreset = parseKovoBuildPresetName(envPreset);
    if (!parsedPreset) {
      throw new KovoCommandConfigurationError(`unsupported KOVO_PRESET ${stableValue(envPreset)}`);
    }
    return { name: parsedPreset };
  }

  if (configuredPreset !== undefined) return selectedConfiguredKovoBuildPreset(configuredPreset);

  if (kovoInvocationEnvironmentValue(invocationEnv, 'VERCEL')) return { name: 'vercel' };
  if (
    kovoInvocationEnvironmentValue(invocationEnv, 'CF_PAGES') ||
    kovoInvocationEnvironmentValue(invocationEnv, 'CLOUDFLARE')
  ) {
    return { name: 'cloudflare' };
  }
  return { name: 'node' };
}

function selectedConfiguredKovoBuildPreset(preset: KovoBuildPreset): SelectedKovoBuildPreset {
  const name = parseKovoBuildPresetName(preset.name);
  if (!name) {
    throw new KovoCommandConfigurationError(
      `unsupported kovo.config preset ${stableValue(preset.name)}`,
    );
  }
  return { name, preset };
}

async function loadKovoBuildConfig(
  root: string,
  appModulePath: string,
  approvedConfig: KovoBuildOneShotApprovedConfig | undefined,
): Promise<LoadedKovoBuildConfig> {
  if (approvedConfig === undefined) return {};
  const configPath = approvedConfig.path;
  const requireFromApp = createRequire(pathToFileURL(appModulePath));

  const lifetime = await createBuildTimeViteRunnable({
    appType: 'custom',
    configFile: false,
    logLevel: 'error',
    plugins: [approvedBuildSourcesVitePlugin(configPath, root, approvedConfig.files, 'config')],
    root,
    server: buildTimeViteServerOptions(),
    ssr: { noExternal: [/^@kovojs\//] },
  });
  const server = lifetime;
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    await preloadKovoSsrSecurityProfile(server, appModulePath, root);
    const serverBuildPresetModule = (await server.ssrLoadModule(
      viteSsrModuleId(requireFromApp.resolve('@kovojs/server/internal/build-preset'), root),
    )) as typeof import('@kovojs/server/internal/build-preset');
    const configModule = await server.ssrLoadModule(`/${basename(configPath)}`);
    const preset = kovoBuildPresetFromModule(
      configModule,
      configPath,
      serverBuildPresetModule.resolveKovoBuildPreset,
    );
    return { path: configPath, ...(preset === undefined ? {} : { preset }) };
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
    throw error;
  } finally {
    await closeBuildTimeViteLifetime(lifetime, hasPrimaryError, primaryError);
  }
}

async function withBuildGraphDerivationContext<T>(fn: () => Promise<T>): Promise<T> {
  return await withKovoBuildContext({ graphDerivation: true }, fn);
}

async function loadBuildAppModule(
  appModulePath: string,
  root: string,
  approvedSourceFiles: readonly BuildCheckSourceFile[],
  dependencyCapabilities: AppDependencyCapabilityManifest,
  sourceDerivedRegistryTransforms: readonly SourceDerivedRegistryTransform[],
): Promise<LoadedBuildAppModule> {
  const requireFromApp = createRequire(pathToFileURL(appModulePath));
  const lifetime = await createBuildTimeViteRunnable({
    appType: 'custom',
    configFile: false,
    logLevel: 'error',
    plugins: [
      approvedBuildSourcesVitePlugin(appModulePath, root, approvedSourceFiles),
      dependencyCapabilityLoaderVitePlugin(
        appModulePath,
        approvedSourceFiles,
        dependencyCapabilities,
        'build-app',
        { sourceRoot: root },
      ),
      sourceDerivedRegistryVitePlugin(appModulePath, root, sourceDerivedRegistryTransforms),
    ],
    oxc: {
      jsx: {
        importSource: '@kovojs/server',
        runtime: 'automatic',
      },
    },
    root,
    server: buildTimeViteServerOptions(),
    // The closed-app proof is intentionally module-local. Keep the app's Kovo imports inside this
    // SSR graph so createApp() and the internal derivation capability share one app-guards WeakSet,
    // including when the CLI runs from a packed install whose node_modules would otherwise be
    // externalized by Vite.
    ssr: dependencyCapabilityCompleteSsrOptions(),
  });
  const server = lifetime;
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    await preloadKovoSsrSecurityProfile(server, appModulePath, root);
    // Keep the profile entries sequential too: the app is not permitted to overlap any portion of
    // framework initialization, even when a future build entry acquires a new eager dependency.
    const serverBuildModule = await server.ssrLoadModule(
      viteSsrModuleId(requireFromApp.resolve('@kovojs/server/build'), root),
    );
    const serverBuildPresetModule = await server.ssrLoadModule(
      viteSsrModuleId(requireFromApp.resolve('@kovojs/server/internal/build-preset'), root),
    );
    const serverExecutionModule = await server.ssrLoadModule(
      viteSsrModuleId(requireFromApp.resolve('@kovojs/server/internal/execution'), root),
    );
    const serverInternalBuildModule = await server.ssrLoadModule(
      viteSsrModuleId(requireFromApp.resolve('@kovojs/server/internal/build'), root),
    );
    const trustedInternalBuild =
      serverInternalBuildModule as LoadedBuildAppModule['serverInternalBuildModule'];
    const compilerClientModuleBuildInstaller =
      trustedInternalBuild.claimCompilerClientModuleBuildInstaller(
        compilerViteClientModuleRoleProtocol,
      );
    const appModule = await trustedInternalBuild.runWithUnavailableBuildAppEnvironment(() =>
      server.ssrLoadModule(viteSsrModuleId(appModulePath, root)),
    );
    return {
      appModule,
      compilerClientModuleBuildInstaller,
      serverBuildModule: serverBuildModule as LoadedBuildAppModule['serverBuildModule'],
      serverBuildPresetModule:
        serverBuildPresetModule as LoadedBuildAppModule['serverBuildPresetModule'],
      serverExecutionModule: serverExecutionModule as LoadedBuildAppModule['serverExecutionModule'],
      serverInternalBuildModule: trustedInternalBuild,
    };
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
    throw error;
  } finally {
    await closeBuildTimeViteLifetime(lifetime, hasPrimaryError, primaryError);
  }
}

interface KovoSsrSecurityProfileLoader {
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

/**
 * Establish the complete build proof profile inside the exact Vite SSR graph that will load the
 * app/config (SPEC §5.2, §6.6 rule 6, §11.4). A native CLI import is intentionally insufficient:
 * `ssr.noExternal` can instantiate a distinct compiler/server graph with its own captured controls.
 */
async function preloadKovoSsrSecurityProfile(
  server: KovoSsrSecurityProfileLoader,
  appModulePath: string,
  root: string,
): Promise<void> {
  const requireFromApp = createRequire(pathToFileURL(appModulePath));
  const serverRootPath = requireFromApp.resolve('@kovojs/server');
  const requireFromServer = createRequire(pathToFileURL(serverRootPath));

  // Install and seal the Node data-plane parser before the compiler and server bootstraps capture
  // their runtime controls. The server bootstrap owns the lightweight data-plane intrinsic
  // membrane in this exact SSR realm. Source/AST analysis itself already ran in the disposable
  // authenticated worker; loading its Drizzle/ts-morph implementation here would retain a second
  // analyzer heap while app/config code executes without strengthening the proof.
  await server.ssrLoadModule(
    viteSsrModuleId(
      requireFromApp.resolve('@kovojs/server/internal/sql-parser-authority-bootstrap'),
      root,
    ),
  );
  await server.ssrLoadModule(
    viteSsrModuleId(
      requireFromServer.resolve('@kovojs/compiler/internal/security-bootstrap'),
      root,
    ),
  );
  await server.ssrLoadModule(viteSsrModuleId(requireFromServer.resolve('@kovojs/compiler'), root));
  await server.ssrLoadModule(viteSsrModuleId(serverRootPath, root));
}

function viteSsrModuleId(filePath: string, root: string): string {
  const relativePath = relative(root, filePath);
  if (
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !relativePath.startsWith('/') &&
    !/^[A-Za-z]:/.test(relativePath)
  ) {
    return `/${relativePath.split(/[\\/]/).join('/')}`;
  }
  return pathToFileURL(filePath).href;
}

function sourceDerivedRegistryVitePlugin(
  appModulePath: string,
  root: string,
  transforms: readonly SourceDerivedRegistryTransform[],
): Plugin {
  const authoredSourcePaths = buildCreateSet<string>();
  const transformBySourcePath = buildCreateMap<string, SourceDerivedRegistryTransform>();
  const transformSnapshot = buildSnapshotDenseArray(
    transforms,
    'Preflight-authenticated source-derived registry transforms',
  );
  for (let index = 0; index < transformSnapshot.length; index += 1) {
    const transform = transformSnapshot[index]!;
    const sourcePath = resolve(root, transform.fileName);
    if (buildMapHas(transformBySourcePath, sourcePath)) {
      throw new TypeError(
        `Kovo source-derived registry preflight duplicated source identity ${transform.fileName}.`,
      );
    }
    buildMapSet(transformBySourcePath, sourcePath, transform);
  }
  buildSetAdd(authoredSourcePaths, resolve(appModulePath));
  return {
    enforce: 'pre',
    name: 'kovo-source-derived-registry',
    async resolveId(source, importer) {
      if (
        importer === undefined ||
        (!buildStringStartsWith(source, './') && !buildStringStartsWith(source, '../'))
      ) {
        return null;
      }
      const importerFileName = viteBuildSourceFileName(importer);
      if (importerFileName === undefined || !buildSetHas(authoredSourcePaths, importerFileName)) {
        return null;
      }
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (resolved === null) return null;
      const resolvedFileName = viteBuildSourceFileName(resolved.id);
      if (resolvedFileName !== undefined && isBuildSourceModulePath(resolvedFileName)) {
        // SPEC §5.2: source ownership follows the exact relative app-module graph. Package imports
        // remain framework/dependency code even when a monorepo resolver points them inside root.
        buildSetAdd(authoredSourcePaths, resolvedFileName);
      }
      return resolved;
    },
    transform(source, id) {
      const sourcePath = viteBuildSourceFileName(id);
      if (sourcePath === undefined || !buildSetHas(authoredSourcePaths, sourcePath)) return null;
      if (!kovoBuildViteIdWithinRoot(id, root)) return null;
      const fileName = viteSourceFileName(id, root);
      if (!/\.[cm]?[jt]sx?$/.test(fileName)) return null;
      if (source.startsWith('// @kovojs-ui-copy\n')) return null;
      // SPEC §5.2: helper names and generated-ABI imports are not provenance. Authored source
      // that claims compiler authority must be rejected before Vite evaluates any top-level code;
      // a harmless mention still proceeds through ordinary source-derived lowering.
      if (sourceClaimsKovoBuildCompilerAuthority(fileName, source)) {
        assertKovoBuildAuthoredCompilerAuthority(fileName, source);
      }
      // SPEC §5.2 rules 6/9: the pre-evaluation compiler already lowered this exact immutable
      // app-contract snapshot while its one TypeScript Program was live. Reusing the authenticated
      // result here prevents Vite evaluation from allocating a second Program, while exact
      // source/path equality keeps stale or late-authored bytes closed.
      const transform = buildMapGet(transformBySourcePath, sourcePath);
      if (transform === undefined) {
        throw new TypeError(
          `Kovo source-derived registry refused unapproved source ${fileName}; it is outside the compiler preflight snapshot.`,
        );
      }
      if (transform.source !== source) {
        throw new TypeError(
          `Kovo source-derived registry refused changed source ${fileName}; its bytes no longer match the compiler preflight snapshot.`,
        );
      }
      const code = transform.code;
      return code === null ? null : { code, map: null };
    },
  };
}

function kovoBuildViteIdWithinRoot(id: string, root: string): boolean {
  const withoutQuery = buildStringSplit(id, '?')[0] ?? id;
  let fileName = buildStringSplit(withoutQuery, '#')[0] ?? withoutQuery;
  if (buildStringStartsWith(fileName, 'file://')) {
    try {
      fileName = fileURLToPath(fileName);
    } catch {
      return false;
    }
  } else if (buildStringStartsWith(fileName, '/@fs/')) {
    fileName = fileName.slice('/@fs'.length);
  }
  if (!isAbsolute(fileName)) return true;

  const relativeFileName = relative(root, fileName);
  return (
    relativeFileName === '' ||
    (!buildStringStartsWith(relativeFileName, '..') && !isAbsolute(relativeFileName))
  );
}

const KOVO_BUILD_EMITTED_ABI_IMPORT_PATTERN =
  /^(?:kovo\/(?:internal|generated)(?:\/|$)|@kovojs\/[^/]+\/(?:internal|generated)(?:\/|$))/;

function sourceClaimsKovoBuildCompilerAuthority(fileName: string, source: string): boolean {
  if (
    buildStringIncludes(source, 'componentLiveTargetRenderer') ||
    buildStringIncludes(source, 'registerGeneratedLiveTargetRenderer')
  ) {
    return true;
  }

  const moduleSpecifiers = buildSnapshotDenseArray(
    parseComponentModule(fileName, source).moduleSpecifiers,
    'Build authored module specifiers',
  );
  for (let index = 0; index < moduleSpecifiers.length; index += 1) {
    if (KOVO_BUILD_EMITTED_ABI_IMPORT_PATTERN.test(moduleSpecifiers[index]!.specifier)) return true;
  }
  return false;
}

function assertKovoBuildAuthoredCompilerAuthority(fileName: string, source: string): void {
  const diagnostics = buildSnapshotDenseArray(
    compileComponentModule({ fileName, source }).diagnostics,
    'Build authored compiler-authority diagnostics',
  );
  const blocked: Array<CompileResult['diagnostics'][number]> = [];
  for (let index = 0; index < diagnostics.length; index += 1) {
    const diagnostic = diagnostics[index]!;
    assertRegisteredDiagnostic(diagnostic, `Build authored compiler diagnostics[${index}]`);
    if (diagnostic.code === 'KV235') {
      buildSecurityArrayAppend(
        blocked,
        diagnostic,
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
    }
  }
  if (blocked.length === 0) return;

  throw new Error(
    buildJoinStrings(
      [
        `Kovo build rejected app-authored compiler authority before module evaluation (${blocked.length} KV235 diagnostic${blocked.length === 1 ? '' : 's'}).`,
        buildJoinStrings(
          buildMapDense(
            blocked,
            'Blocked authored compiler-authority diagnostics',
            (diagnostic) => {
              const line = diagnostic.start?.line;
              const column = diagnostic.start?.column;
              const site =
                line === undefined || column === undefined
                  ? diagnostic.fileName
                  : `${diagnostic.fileName}:${line}:${column}`;
              const help = buildStringTrim(diagnostic.help ?? '');
              return help.length === 0
                ? `${diagnostic.code} ${site} ${diagnostic.message}`
                : `${diagnostic.code} ${site} ${diagnostic.message}\n${buildJoinStrings(
                    buildMapDense(
                      buildStringSplit(help, '\n'),
                      'Blocked authored compiler-authority help',
                      (entry) => `  help: ${entry}`,
                    ),
                    '\n',
                    'Blocked authored compiler-authority help lines',
                  )}`;
            },
          ),
          '\n\n',
          'Blocked authored compiler-authority diagnostic output',
        ),
      ],
      '\n\n',
      'Build authored compiler-authority rejection',
    ),
  );
}

function viteSourceFileName(id: string, root: string): string {
  const fileName = id.split(/[?#]/, 1)[0] ?? id;
  if (!isAbsolute(fileName)) return slashPath(fileName.replace(/^\/+/, ''));

  const relativeFileName = relative(root, fileName);
  if (
    relativeFileName !== '' &&
    !relativeFileName.startsWith('..') &&
    !isAbsolute(relativeFileName)
  )
    return slashPath(relativeFileName);

  return slashPath(fileName.replace(/^\/+/, ''));
}

function slashPath(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

function findKovoBuildConfig(root: string): string | undefined {
  for (const fileName of [
    'kovo.config.ts',
    'kovo.config.mts',
    'kovo.config.js',
    'kovo.config.mjs',
  ]) {
    const configPath = resolve(root, fileName);
    if (existsSync(configPath)) return configPath;
  }
  return undefined;
}

function kovoBuildPresetFromModule(
  module: unknown,
  configPath: string,
  resolveKovoBuildPreset: (value: unknown) => KovoBuildPreset | undefined,
): KovoBuildPreset | undefined {
  const moduleDefault =
    typeof module === 'object' && module !== null
      ? kovoBuildModuleDefaultExport(module, configPath)
      : undefined;
  const value = moduleDefault ?? module;
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new KovoCommandConfigurationError(`${configPath} must export a config object.`);
  }

  const token = buildOwnDataValue(value, 'preset', `${configPath} config`);
  if (token === undefined) return undefined;
  const preset = resolveKovoBuildPreset(token);
  if (preset === undefined) {
    throw new KovoCommandConfigurationError(
      `${configPath} preset must be a framework-owned value returned directly by node(), vercel(), or cloudflare().`,
    );
  }
  return preset;
}

function kovoBuildModuleDefaultExport(module: object, configPath: string): unknown {
  // Vite exposes SSR module namespaces through a standards-like live-binding proxy whose
  // descriptors are not stable data descriptors. The export-name inventory is nevertheless an
  // own-key snapshot controlled by Vite; gate the single live-binding read through that inventory
  // so an inherited Object.prototype.default can never become config authority.
  const exportNames = buildSnapshotDenseArray(
    buildObjectKeys(module),
    `${configPath} module export names`,
  );
  for (let index = 0; index < exportNames.length; index += 1) {
    if (exportNames[index] === 'default') {
      return (module as { default?: unknown }).default;
    }
  }
  return undefined;
}

interface KovoClientManifestBuild {
  appCompilerSourceFiles: readonly BuildCheckSourceFile[];
  assets: KovoBuildStylesheetAssets;
  clientModules: readonly KovoAppShellCompiledClientModule[];
  manifestFile: string;
  stylesheetCss: readonly KovoBuildStylesheetCss[];
}

interface KovoBuildStylesheetBuild {
  assets: KovoBuildStylesheetAssets;
  stylesheetCss: readonly KovoBuildStylesheetCss[];
}

interface KovoBuildStylesheetCss {
  css: string;
  href: string;
}

interface KovoBuildStylesheetAssets {
  app: readonly StylesheetAsset[];
  fragments: Readonly<Record<string, readonly StylesheetAsset[]>>;
  routes: Readonly<Record<string, readonly StylesheetAsset[]>>;
}

interface KovoBuildCssSplitChunk {
  criticalCss?: string;
  href: string;
}

interface KovoBuildCssSplitChunks {
  base: readonly KovoBuildCssSplitChunk[];
  fragments: Readonly<Record<string, readonly KovoBuildCssSplitChunk[]>>;
  routes: Readonly<Record<string, readonly KovoBuildCssSplitChunk[]>>;
}

async function buildKovoClientManifest(
  outDir: string,
  root: string,
  appModulePath: string,
  options: {
    approvedClientEntry?: BuildCheckSourceFile;
    approvedSourceFiles: readonly BuildCheckSourceFile[];
    cache: boolean;
    dependencyCapabilities: AppDependencyCapabilityManifest;
    projectMutationFacts: ProjectMutationRegistryFacts;
    queryShapeFacts: readonly QueryShapeFact[];
    sourceIdentityRoot: string;
  },
): Promise<KovoClientManifestBuild> {
  const viteAssetPlugin = createFrameworkKovoCssCollectorVitePlugin({
    include: [
      kovoBuildApprovedSourceFilter(
        appModulePath,
        root,
        options.approvedSourceFiles,
        options.sourceIdentityRoot,
      ),
    ],
    queryShapeFacts: options.queryShapeFacts,
    registryFacts: options.projectMutationFacts,
  });
  const routeTargets = buildSnapshotDenseArray(
    extractAppRouteCssTargets({
      fileName: appModulePath,
      packagePrefixDiscoveryRoot: dirname(appModulePath),
      source: existsSync(appModulePath) ? readFileSync(appModulePath, 'utf8') : '',
    }).routeTargets,
    'Client manifest CSS route targets',
  );

  await viteBuild({
    appType: 'custom',
    build: {
      emptyOutDir: true,
      manifest: true,
      // Vite's compatibility polyfill imperatively walks document collections. Kovo emits native
      // modulepreload hints and ESM remains functional when a browser ignores that performance
      // hint, so do not retain an unreviewed executable DOM carrier in production artifacts
      // (SPEC §5.2/§6.6; C13).
      modulePreload: { polyfill: false },
      outDir,
    },
    configFile: false,
    logLevel: 'silent',
    oxc: {
      jsx: {
        importSource: '@kovojs/server',
        runtime: 'automatic',
      },
    },
    plugins: [
      approvedBuildSourcesVitePlugin(
        appModulePath,
        root,
        options.approvedSourceFiles,
        'app',
        trustedKovoFrameworkSourceRoots,
        options.approvedClientEntry,
        options.sourceIdentityRoot,
      ),
      dependencyCapabilityLoaderVitePlugin(
        appModulePath,
        options.approvedSourceFiles,
        options.dependencyCapabilities,
        'build-client',
        { sourceRoot: options.sourceIdentityRoot },
      ),
      viteAssetPlugin,
    ],
    root,
  });

  const componentBuild = await buildKovoComponentClientModules(appModulePath, root, options);
  const cssAssetManifestOptions =
    routeTargets.length === 0 ? undefined : { split: { routes: routeTargets } };
  const cssAssetManifests = buildFilterDense(
    [
      viteAssetPlugin.getCssAssetManifest?.(cssAssetManifestOptions),
      componentBuild.plugin.getCssAssetManifest?.(cssAssetManifestOptions),
    ],
    'Client CSS asset manifests',
    (manifest) => manifest !== undefined,
  );
  for (let index = 0; index < cssAssetManifests.length; index += 1) {
    const cssAssetManifest = cssAssetManifests[index]!;
    if (cssAssetManifest.chunks) {
      assertKovoBuildCssDelivery(cssAssetManifest, routeTargets, cssRouteDeliveryGate);
    }
  }
  const appCss = dedupeCss(
    buildFlatMapDense(cssAssetManifests, 'Client CSS asset manifests', (manifest) =>
      buildFlatMapDense(manifest.stylesheets ?? [], 'Client CSS manifest stylesheets', (asset) =>
        asset.criticalCss ? [asset.criticalCss] : [],
      ),
    ),
  );
  const splitStylesheetAssets = mergeKovoBuildStylesheetAssets(
    buildMapDense(cssAssetManifests, 'Client CSS split manifests', (manifest) =>
      stylesheetAssetsFromCssSplitChunks(manifest.chunks),
    ),
  );
  const monolithAppCss = buildSomeDense(
    cssAssetManifests,
    'Client CSS split manifests',
    (manifest) => manifest.chunks !== undefined,
  )
    ? null
    : appCss;

  return {
    appCompilerSourceFiles: componentBuild.sourceFiles,
    assets: splitStylesheetAssets,
    // The inert CSS-enrollment transform must not discard compiler-emitted handlers for a
    // component reached through the client entry. Merge its metadata with the app-graph pass.
    clientModules: uniqueKovoCompiledClientModules([
      ...(viteAssetPlugin.getClientModules?.() ?? []),
      ...(componentBuild.plugin.getClientModules?.() ?? []),
    ]),
    manifestFile: join(outDir, '.vite/manifest.json'),
    stylesheetCss: [
      ...(monolithAppCss ? [{ css: monolithAppCss, href: '/assets/styles.css' }] : []),
      ...stylesheetCssFromBuildStylesheetAssets(splitStylesheetAssets),
    ],
  };
}

async function buildKovoComponentClientModules(
  appModulePath: string,
  root: string,
  options: {
    approvedSourceFiles: readonly BuildCheckSourceFile[];
    cache: boolean;
    dependencyCapabilities: AppDependencyCapabilityManifest;
    projectMutationFacts: ProjectMutationRegistryFacts;
    queryShapeFacts: readonly QueryShapeFact[];
    sourceIdentityRoot: string;
  },
): Promise<{
  plugin: ReturnType<typeof import('@kovojs/compiler').kovoVitePlugin>;
  sourceFiles: readonly BuildCheckSourceFile[];
}> {
  const kovoPlugin = kovoVitePlugin({
    include: [
      kovoBuildApprovedSourceFilter(
        appModulePath,
        root,
        options.approvedSourceFiles,
        options.sourceIdentityRoot,
      ),
    ],
    queryShapeFacts: options.queryShapeFacts,
    registryFacts: options.projectMutationFacts,
  });
  const tempDir = mkdtempSync(join(tmpdir(), 'kovo-client-modules-'));
  const entryPath = join(tempDir, 'entry.ts');
  const outDir = join(tempDir, 'out');
  const sourceCensus = compilerApprovedSourceCensusVitePlugin(
    options.approvedSourceFiles,
    options.sourceIdentityRoot,
  );

  try {
    writeFileSync(
      entryPath,
      [
        '// Compiler scan entry generated by kovo build.',
        `import ${stringifyBuildValue(pathToFileURL(appModulePath).href)};`,
        '',
      ].join('\n'),
      'utf8',
    );
    await viteBuild({
      appType: 'custom',
      build: {
        emptyOutDir: true,
        minify: false,
        outDir,
        rollupOptions: {
          // SPEC 6.6 keeps Argon2 as the runtime password sink. The scan build only needs module
          // reachability so the Kovo compiler sees authored TSX before production emission.
          external: isKovoServerHandlerExternalDependency,
          input: entryPath,
          output: {
            entryFileNames: 'entry.mjs',
            format: 'es',
          },
        },
        ssr: true,
        target: 'node22',
      },
      configFile: false,
      logLevel: 'silent',
      oxc: {
        jsx: {
          importSource: '@kovojs/server',
          runtime: 'automatic',
        },
      },
      plugins: [
        approvedBuildSourcesVitePlugin(
          appModulePath,
          root,
          options.approvedSourceFiles,
          'app',
          trustedKovoFrameworkSourceRoots,
          undefined,
          options.sourceIdentityRoot,
        ),
        sourceCensus.plugin,
        dependencyCapabilityLoaderVitePlugin(
          appModulePath,
          options.approvedSourceFiles,
          options.dependencyCapabilities,
          'component-scan',
          {
            allowNodeBuiltins: true,
            allowRuntimeExternal: isKovoServerHandlerExternalDependency,
            sourceRoot: options.sourceIdentityRoot,
          },
        ),
        kovoBuildLoweringVitePlugin(kovoPlugin),
        bundledUndiciRuntimeVitePlugin(),
      ],
      resolve: {
        alias: [
          { find: /^@kovojs\/core$/, replacement: requireFromCli.resolve('@kovojs/core') },
          {
            find: /^@kovojs\/core\/internal\/verifier$/,
            replacement: requireFromCli.resolve('@kovojs/core/internal/verifier'),
          },
          { find: /^@kovojs\/server$/, replacement: requireFromCli.resolve('@kovojs/server') },
          {
            find: /^@kovojs\/server\/jsx-dev-runtime$/,
            replacement: requireFromCli.resolve('@kovojs/server/jsx-dev-runtime'),
          },
          {
            find: /^@kovojs\/server\/jsx-runtime$/,
            replacement: requireFromCli.resolve('@kovojs/server/jsx-runtime'),
          },
        ],
      },
      root,
      ssr: {
        external: ['@node-rs/argon2'],
        noExternal: dependencyCapabilityCompleteBundleNoExternal(),
      },
    });

    return { plugin: kovoPlugin, sourceFiles: sourceCensus.snapshot() };
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function stylesheetAssetsFromCssSplitChunks(
  chunks: KovoBuildCssSplitChunks | undefined,
): KovoBuildStylesheetAssets {
  if (!chunks) return emptyKovoBuildStylesheetAssets();

  const base = buildOwnDataValue(
    chunks,
    'base',
    'CSS split chunks',
  ) as readonly KovoBuildCssSplitChunk[];
  const fragments = buildOwnDataValue(chunks, 'fragments', 'CSS split chunks') as Readonly<
    Record<string, readonly KovoBuildCssSplitChunk[]>
  >;
  const routes = buildOwnDataValue(chunks, 'routes', 'CSS split chunks') as Readonly<
    Record<string, readonly KovoBuildCssSplitChunk[]>
  >;

  return {
    app: buildStylesheetAssets(base),
    fragments: stylesheetAssetRecordFromChunks(fragments, 'CSS fragment split chunks'),
    routes: stylesheetAssetRecordFromChunks(routes, 'CSS route split chunks'),
  };
}

function stylesheetAssetRecordFromChunks(
  source: Readonly<Record<string, readonly KovoBuildCssSplitChunk[]>>,
  label: string,
): Readonly<Record<string, readonly StylesheetAsset[]>> {
  if (typeof source !== 'object' || source === null || buildArrayIsArray(source)) {
    throw new TypeError(`${label} must be an own-data record.`);
  }
  const output = buildCreateNullRecord<readonly StylesheetAsset[]>();
  const keys = buildSnapshotDenseArray(buildObjectKeys(source), `${label} keys`);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    output[key] = buildStylesheetAssets(
      buildOwnDataValue(source, key, label) as readonly KovoBuildCssSplitChunk[],
    );
  }
  return output;
}

function emptyKovoBuildStylesheetAssets(): KovoBuildStylesheetAssets {
  return { app: [], fragments: {}, routes: {} };
}

function buildStylesheetAssets(
  assets: readonly KovoBuildCssSplitChunk[],
): readonly StylesheetAsset[] {
  return buildFlatMapDense(assets, 'CSS split chunk assets', (asset, index) => {
    const href = buildOwnDataValue(asset, 'href', `CSS split chunk asset[${index}]`);
    const criticalCss = buildOwnDataValue(asset, 'criticalCss', `CSS split chunk asset[${index}]`);
    if (typeof href !== 'string') {
      throw new TypeError(`CSS split chunk asset[${index}].href must be a string.`);
    }
    if (criticalCss !== undefined && typeof criticalCss !== 'string') {
      throw new TypeError(`CSS split chunk asset[${index}].criticalCss must be a string.`);
    }
    return criticalCss ? [{ criticalCss, href }] : [];
  });
}

function appendBuildDense<Value>(target: Value[], source: readonly Value[], label: string): void {
  const values = buildSnapshotDenseArray(source, label);
  for (let index = 0; index < values.length; index += 1) {
    buildSecurityArrayAppend(
      target,
      values[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
}

function appendStylesheetAssetRecordValues(
  target: StylesheetAsset[],
  source: Readonly<Record<string, readonly StylesheetAsset[]>>,
  label: string,
): void {
  if (typeof source !== 'object' || source === null || buildArrayIsArray(source)) {
    throw new TypeError(`${label} must be an own-data record.`);
  }
  const keys = buildSnapshotDenseArray(buildObjectKeys(source), `${label} keys`);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    appendBuildDense(
      target,
      buildOwnDataValue(source, key, label) as readonly StylesheetAsset[],
      `${label}.${key}`,
    );
  }
}

function buildStylesheetAssetArray(source: unknown, label: string): readonly StylesheetAsset[] {
  return buildSnapshotDenseArray(source as readonly StylesheetAsset[], label);
}

function buildOptionalStylesheetAssetArray(
  source: unknown,
  label: string,
): readonly StylesheetAsset[] {
  return source === undefined ? [] : buildStylesheetAssetArray(source, label);
}

function stylesheetAssetRecord(
  source: unknown,
  label: string,
): Readonly<Record<string, readonly StylesheetAsset[]>> {
  if (typeof source !== 'object' || source === null || buildArrayIsArray(source)) {
    throw new TypeError(`${label} must be an own-data record.`);
  }
  return source as Readonly<Record<string, readonly StylesheetAsset[]>>;
}

function stylesheetAssetsFromRecord(
  source: Readonly<Record<string, readonly StylesheetAsset[]>>,
  key: string,
  label: string,
): readonly StylesheetAsset[] {
  return buildOptionalStylesheetAssetArray(
    buildOwnDataValue(source, key, label),
    `${label}.${key}`,
  );
}

function exactStylesheetAsset(
  asset: string | StylesheetAsset,
  index: number,
): {
  criticalCss?: string;
  href: string;
} {
  if (typeof asset === 'string') return { href: asset };
  const href = buildOwnDataValue(asset, 'href', `Stylesheet asset[${index}]`);
  const criticalCss = buildOwnDataValue(asset, 'criticalCss', `Stylesheet asset[${index}]`);
  if (typeof href !== 'string') {
    throw new TypeError(`Stylesheet asset[${index}].href must be a string.`);
  }
  if (criticalCss !== undefined && typeof criticalCss !== 'string') {
    throw new TypeError(`Stylesheet asset[${index}].criticalCss must be a string.`);
  }
  return criticalCss === undefined ? { href } : { criticalCss, href };
}

function buildStylesheetGroups(
  groups: readonly (readonly StylesheetAsset[])[],
  label: string,
): StylesheetAsset[] {
  return buildFlatMapDense(groups, label, (group) => group);
}

function buildStylesheetCssAssets(assets: readonly StylesheetAsset[]): KovoBuildStylesheetCss[] {
  return buildFlatMapDense(assets, 'Build stylesheet CSS assets', (asset, index) => {
    const exact = exactStylesheetAsset(asset, index);
    return exact.criticalCss ? [{ css: exact.criticalCss, href: exact.href }] : [];
  });
}

function buildStylesheetAssetRecordKeys(
  source: Readonly<Record<string, readonly StylesheetAsset[]>>,
  label: string,
): string[] {
  return buildSnapshotDenseArray(buildObjectKeys(source), `${label} keys`);
}

function buildStylesheetAssetRecordIsEmpty(
  source: Readonly<Record<string, readonly StylesheetAsset[]>>,
  label: string,
): boolean {
  return buildStylesheetAssetRecordKeys(source, label).length === 0;
}

function buildAppStylesheetGroups(
  appStylesheets: readonly StylesheetAsset[],
  buildStylesheets: readonly StylesheetAsset[],
): StylesheetAsset[] {
  return buildStylesheetGroups(
    [
      buildStylesheetAssetArray(appStylesheets, 'Closed app stylesheets'),
      buildStylesheetAssetArray(buildStylesheets, 'Build app stylesheets'),
    ],
    'Closed app and build stylesheets',
  );
}

function stylesheetCssFromBuildStylesheetAssets(
  assets: KovoBuildStylesheetAssets,
): KovoBuildStylesheetCss[] {
  const app = buildStylesheetAssetArray(
    buildOwnDataValue(assets, 'app', 'Build stylesheet assets'),
    'Build app stylesheet assets',
  );
  const routes = stylesheetAssetRecord(
    buildOwnDataValue(assets, 'routes', 'Build stylesheet assets'),
    'Build route stylesheet assets',
  );
  const fragments = stylesheetAssetRecord(
    buildOwnDataValue(assets, 'fragments', 'Build stylesheet assets'),
    'Build fragment stylesheet assets',
  );
  const all: StylesheetAsset[] = [];
  appendBuildDense(all, app, 'Build app stylesheet assets');
  appendStylesheetAssetRecordValues(all, routes, 'Build route stylesheet assets');
  appendStylesheetAssetRecordValues(all, fragments, 'Build fragment stylesheet assets');
  return buildStylesheetCssAssets(all);
}

function mergeKovoBuildStylesheetAssets(
  assetSets: readonly KovoBuildStylesheetAssets[],
): KovoBuildStylesheetAssets {
  const routes = buildCreateNullRecord<StylesheetAsset[]>();
  const fragments = buildCreateNullRecord<StylesheetAsset[]>();
  const appGroups: (readonly StylesheetAsset[])[] = [];
  const sources = buildSnapshotDenseArray(assetSets, 'Build stylesheet asset sets');

  for (let index = 0; index < sources.length; index += 1) {
    const assets = sources[index]!;
    const app = buildStylesheetAssetArray(
      buildOwnDataValue(assets, 'app', `Build stylesheet asset set[${index}]`),
      `Build stylesheet asset set[${index}].app`,
    );
    const sourceRoutes = stylesheetAssetRecord(
      buildOwnDataValue(assets, 'routes', `Build stylesheet asset set[${index}]`),
      `Build stylesheet asset set[${index}].routes`,
    );
    const sourceFragments = stylesheetAssetRecord(
      buildOwnDataValue(assets, 'fragments', `Build stylesheet asset set[${index}]`),
      `Build stylesheet asset set[${index}].fragments`,
    );
    buildSecurityArrayAppend(
      appGroups,
      app,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
    mergeStylesheetAssetsInto(routes, sourceRoutes);
    mergeStylesheetAssetsInto(fragments, sourceFragments);
  }

  return {
    app: mergeStylesheetAssets(buildStylesheetGroups(appGroups, 'Build app stylesheet groups')),
    fragments,
    routes,
  };
}

function mergeStylesheetAssetsInto(
  target: Record<string, StylesheetAsset[]>,
  source: Readonly<Record<string, readonly StylesheetAsset[]>>,
): void {
  const keys = buildStylesheetAssetRecordKeys(source, 'Build stylesheet record');
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const existing = buildOptionalStylesheetAssetArray(
      buildOwnDataValue(target, key, 'Merged stylesheet record'),
      `Merged stylesheet record.${key}`,
    );
    const incoming = stylesheetAssetsFromRecord(source, key, 'Build stylesheet record');
    target[key] = mergeStylesheetAssets(
      buildStylesheetGroups([existing, incoming], `Merged stylesheet record.${key}`),
    );
  }
}

function mergeStylesheetAssets(assets: readonly (string | StylesheetAsset)[]): StylesheetAsset[] {
  const source = buildSnapshotDenseArray(assets, 'Stylesheet merge assets');
  const byHref = buildCreateMap<string, string[]>();
  const hrefOrder: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const asset = exactStylesheetAsset(source[index]!, index);
    if (!buildMapHas(byHref, asset.href))
      buildSecurityArrayAppend(
        hrefOrder,
        asset.href,
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
    const chunks = buildMapGet(byHref, asset.href) ?? [];
    if (asset.criticalCss)
      buildSecurityArrayAppend(
        chunks,
        asset.criticalCss,
        'CLI packages/cli/src/commands/build-export.ts collection',
      );
    buildMapSet(byHref, asset.href, chunks);
  }

  return buildMapDense(hrefOrder, 'Stylesheet href order', (href) => {
    const criticalCss = buildArrayJoin(
      buildFilterDense(
        buildMapDense(buildMapGet(byHref, href) ?? [], 'Stylesheet critical CSS chunks', (chunk) =>
          buildStringTrim(chunk),
        ),
        'Trimmed stylesheet critical CSS chunks',
        (chunk) => chunk.length > 0,
      ),
      '\n',
    );
    return {
      ...(criticalCss ? { criticalCss } : {}),
      href,
    };
  });
}

/** @internal Exact closed-app CSS derivation boundary (SPEC §6.6 C9/§10.3). */
export function appWithBuildStylesheetAssets(
  app: KovoApp,
  assets: KovoBuildStylesheetAssets,
  deriveClosedApp: typeof import('@kovojs/server/internal/build').deriveClosedKovoApp,
): KovoApp {
  const appAssets = buildStylesheetAssetArray(
    buildOwnDataValue(assets, 'app', 'Build stylesheet assets'),
    'Build app stylesheet assets',
  );
  const fragmentAssets = stylesheetAssetRecord(
    buildOwnDataValue(assets, 'fragments', 'Build stylesheet assets'),
    'Build fragment stylesheet assets',
  );
  const routeAssets = stylesheetAssetRecord(
    buildOwnDataValue(assets, 'routes', 'Build stylesheet assets'),
    'Build route stylesheet assets',
  );
  if (
    appAssets.length === 0 &&
    buildStylesheetAssetRecordIsEmpty(fragmentAssets, 'Build fragment stylesheet assets') &&
    buildStylesheetAssetRecordIsEmpty(routeAssets, 'Build route stylesheet assets')
  )
    return app;

  const liveTargetRenderers = buildSnapshotDenseArray(
    buildOwnDataValue(
      app,
      'liveTargetRenderers',
      'Closed app',
    ) as readonly KovoApp['liveTargetRenderers'][number][],
    'Closed app live target renderers',
  );
  const routes = buildSnapshotDenseArray(
    buildOwnDataValue(app, 'routes', 'Closed app') as KovoApp['routes'],
    'Closed app routes',
  );
  const appStylesheets = buildStylesheetAssetArray(
    buildOwnDataValue(app, 'stylesheets', 'Closed app'),
    'Closed app stylesheets',
  );
  return deriveClosedApp(app, {
    liveTargetRenderers: buildMapDense(
      liveTargetRenderers,
      'Closed app live target renderers',
      (renderer, index) => {
        const component = buildOwnDataValue(
          renderer,
          'component',
          `Closed app live target renderer[${index}]`,
        );
        if (typeof component !== 'string') {
          throw new TypeError(
            `Closed app live target renderer[${index}].component must be a string.`,
          );
        }
        const rendererAssets = stylesheetAssetsFromRecord(
          fragmentAssets,
          component,
          'Build fragment stylesheet assets',
        );
        if (rendererAssets.length === 0) return renderer;

        return {
          ...renderer,
          stylesheets: mergeStylesheetAssets(
            buildStylesheetGroups(
              [
                buildOptionalStylesheetAssetArray(
                  buildOwnDataValue(
                    renderer,
                    'stylesheets',
                    `Closed app live target renderer[${index}]`,
                  ),
                  `Closed app live target renderer[${index}].stylesheets`,
                ),
                rendererAssets,
              ],
              `Closed app live target renderer[${index}] stylesheets`,
            ),
          ),
        };
      },
    ),
    stylesheets: mergeStylesheetAssets(buildAppStylesheetGroups(appStylesheets, appAssets)),
    routes: buildMapDense(routes, 'Closed app routes', (route, index) => {
      const path = buildOwnDataValue(route, 'path', `Closed app route[${index}]`);
      if (typeof path !== 'string') {
        throw new TypeError(`Closed app route[${index}].path must be a string.`);
      }
      const stylesheets = stylesheetAssetsFromRecord(
        routeAssets,
        path,
        'Build route stylesheet assets',
      );
      if (stylesheets.length === 0) return route;

      return {
        ...route,
        stylesheets: mergeStylesheetAssets(
          buildStylesheetGroups(
            [
              buildOptionalStylesheetAssetArray(
                buildOwnDataValue(route, 'stylesheets', `Closed app route[${index}]`),
                `Closed app route[${index}].stylesheets`,
              ),
              stylesheets,
            ],
            `Closed app route[${index}] stylesheets`,
          ),
        ),
      };
    }),
  });
}

function kovoClientBuildRoot(appModulePath: string, invocationRoot: string): string {
  const indexHtml = findNearestFile(dirname(appModulePath), 'index.html', {
    stopDir: invocationRoot,
  });
  return indexHtml === undefined ? invocationRoot : dirname(indexHtml);
}

/**
 * Bind every production transform to the exact app-source bytes approved by the build preflight.
 * Vite has already read `code` when this first/enforce-pre hook runs, so equality pins the value
 * that the remaining transform pipeline consumes without a second disk read (SPEC §5.2/§6.6).
 */
function approvedBuildSourcesVitePlugin(
  appModulePath: string,
  buildRoot: string,
  sourceFiles: readonly BuildCheckSourceFile[],
  sourceLabel: 'app' | 'config' = 'app',
  frameworkSourceRoots: readonly KovoFrameworkSourceRoot[] = trustedKovoFrameworkSourceRoots,
  approvedClientEntry?: BuildCheckSourceFile,
  sourceIdentityRoot: string = buildRoot,
): Plugin {
  const approvedByPath = buildCreateMap<string, string>();
  const appSourcePaths = buildCreateSet<string>();
  const pinnedFrameworkSourcePaths = buildCreateSet<string>();
  const approvedFiles = buildSnapshotDenseArray(sourceFiles, 'Approved build source files');
  for (let index = 0; index < approvedFiles.length; index += 1) {
    const file = approvedFiles[index];
    if (!file || typeof file !== 'object') {
      throw new TypeError(`Approved build source file[${index}] must be an own record.`);
    }
    const fileName = buildOwnDataValue(file, 'fileName', `Approved build source file[${index}]`);
    const source = buildOwnDataValue(file, 'source', `Approved build source file[${index}]`);
    if (typeof fileName !== 'string' || typeof source !== 'string') {
      throw new TypeError(
        `Approved build source file[${index}] must contain own string fileName/source values.`,
      );
    }
    const absoluteFileName = resolve(sourceIdentityRoot, fileName);
    if (
      buildMapHas(approvedByPath, absoluteFileName) &&
      buildMapGet(approvedByPath, absoluteFileName) !== source
    ) {
      throw new TypeError(`Approved build source snapshot conflicts for ${absoluteFileName}.`);
    }
    buildMapSet(approvedByPath, absoluteFileName, source);
    buildSetAdd(appSourcePaths, absoluteFileName);
  }

  const appSourceRoot = resolve(sourceIdentityRoot);
  const expectedClientEntry = slashPath(relative(appSourceRoot, resolve(buildRoot, 'index.html')));
  return {
    enforce: 'pre',
    name: 'kovo-approved-build-sources',
    ...(approvedClientEntry === undefined
      ? {}
      : {
          transformIndexHtml: {
            order: 'pre' as const,
            handler(html: string) {
              if (
                approvedClientEntry.fileName !== expectedClientEntry ||
                html !== approvedClientEntry.source
              ) {
                throw new Error(
                  'Kovo build refused changed client index.html; its bytes no longer match the security-preflight snapshot (SPEC §5.2/§6.6).',
                );
              }
              return undefined;
            },
          },
        }),
    load(id) {
      const fileName = viteBuildSourceFileName(id);
      if (fileName === undefined || buildMapHas(approvedByPath, fileName)) return null;
      const frameworkSource = classifyKovoFrameworkSourcePath(frameworkSourceRoots, fileName);
      if (frameworkSource.kind === 'outside') return null;
      if (frameworkSource.kind === 'invalid') {
        throw new Error(
          `Kovo build refused unrecognized framework source ${relative(buildRoot, fileName) || fileName}; the file was not in the boot-time declared-package snapshot (SPEC §5.2/§6.6).`,
        );
      }
      let source: string;
      try {
        source = readFileSync(frameworkSource.canonicalPath, 'utf8');
      } catch {
        throw new Error(
          `Kovo build refused unreadable framework source ${relative(buildRoot, fileName) || fileName}; its boot-time declared-package snapshot cannot be reconstructed (SPEC §5.2/§6.6).`,
        );
      }
      if (!kovoFrameworkSourceSnapshotMatches(frameworkSource.snapshot, source)) {
        throw new Error(
          `Kovo build refused changed framework source ${relative(buildRoot, fileName) || fileName}; its bytes no longer match the boot-time declared-package snapshot (SPEC §5.2/§6.6).`,
        );
      }
      buildSetAdd(pinnedFrameworkSourcePaths, frameworkSource.canonicalPath);
      // Pin the exact boot-approved package bytes at Vite's load boundary. Dev/SSR dependency
      // transforms can normalize already-built .mjs before user transform hooks run; comparing
      // that normalized text to the package snapshot is both a false rejection and too late to
      // prove which bytes entered the pipeline (SPEC §5.2/§6.6 rule 6, C15).
      return source;
    },
    async resolveId(source, importer) {
      if (importer === undefined) return null;
      const importerFileName = viteBuildSourceFileName(importer);
      if (importerFileName === undefined || !buildSetHas(appSourcePaths, importerFileName)) {
        return null;
      }
      if (isApprovedBuildVirtualSpecifier(source)) return null;
      if (isBuildBareModuleSpecifier(source)) {
        if (!buildStringStartsWith(source, '@kovojs/')) return null;
        // Resolve reviewed framework packages through the remaining plugin chain first. That
        // preserves dependency-capability enforcement while preventing Vite from re-presenting
        // an approved bare edge as an unexplained absolute app-source edge.
        const frameworkResolution = await this.resolve(source, importer, { skipSelf: true });
        if (frameworkResolution === null || frameworkResolution.external === true) return null;
        const frameworkFileName = viteBuildSourceFileName(frameworkResolution.id);
        if (
          frameworkFileName !== undefined &&
          classifyKovoFrameworkSourcePath(frameworkSourceRoots, frameworkFileName).kind ===
            'trusted'
        ) {
          return frameworkResolution;
        }
        return null;
      }
      const directSourceFileName = viteBuildSourceFileName(source);
      if (directSourceFileName !== undefined) {
        const frameworkSource = classifyKovoFrameworkSourcePath(
          frameworkSourceRoots,
          directSourceFileName,
        );
        if (frameworkSource.kind === 'invalid') {
          throw new Error(
            `Kovo build refused unrecognized framework source ${relative(buildRoot, directSourceFileName) || directSourceFileName}; the file was not in the boot-time declared-package snapshot (SPEC §5.2/§6.6).`,
          );
        }
        // The dependency-capability plugin independently admits this only when it is the exact
        // configured alias target for one compiler-derived package entry owned by this importer.
        // Returning null here prevents this source-snapshot plugin from preempting that exact join.
        if (frameworkSource.kind === 'trusted') return null;
      }
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (resolved === null || resolved.external === true) {
        throw new Error(
          `Kovo build refused unresolved ${sourceLabel} module edge ${source}; it is outside the security-preflight snapshot (SPEC \u00a75.2/\u00a76.6).`,
        );
      }
      const resolvedFileName = viteBuildSourceFileName(resolved.id);
      if (resolvedFileName === undefined) {
        throw new Error(
          `Kovo build refused virtual ${sourceLabel} module edge ${source}; it is outside the security-preflight snapshot (SPEC \u00a75.2/\u00a76.6).`,
        );
      }
      const trustedDirectFrameworkEntry =
        buildSetHas(trustedKovoDirectFrameworkEntrySources, resolvedFileName) &&
        classifyKovoFrameworkSourcePath(frameworkSourceRoots, resolvedFileName).kind === 'trusted';
      if (!buildMapHas(approvedByPath, resolvedFileName) && !trustedDirectFrameworkEntry) {
        throw unapprovedBuildSourceError(buildRoot, resolvedFileName, sourceLabel);
      }
      return resolved;
    },
    transform(code, id) {
      const fileName = viteBuildSourceFileName(id);
      if (fileName === undefined) return null;
      const approved = buildMapHas(approvedByPath, fileName);
      if (!approved) {
        const frameworkSource = classifyKovoFrameworkSourcePath(frameworkSourceRoots, fileName);
        if (frameworkSource.kind === 'invalid') {
          throw new Error(
            `Kovo build refused unrecognized framework source ${relative(buildRoot, fileName) || fileName}; the file was not in the boot-time declared-package snapshot (SPEC §5.2/§6.6).`,
          );
        }
        if (frameworkSource.kind === 'trusted') {
          if (!buildSetHas(pinnedFrameworkSourcePaths, frameworkSource.canonicalPath)) {
            throw new Error(
              `Kovo build refused unpinned framework source ${relative(buildRoot, fileName) || fileName}; it did not cross the boot-time declared-package load boundary (SPEC §5.2/§6.6).`,
            );
          }
          return null;
        }
      }
      if (!isBuildSourceModulePath(fileName) && !isBuildStylesheetSourcePath(fileName)) return null;
      if (!approved && !isBuildAppSourcePath(appSourceRoot, fileName)) return null;
      const displayName = relative(buildRoot, fileName) || fileName;
      if (!approved) {
        throw unapprovedBuildSourceError(buildRoot, fileName, sourceLabel);
      }
      if (code !== buildMapGet(approvedByPath, fileName)) {
        throw new Error(
          `Kovo build refused changed ${sourceLabel} source ${displayName}; its bytes no longer match the security-preflight snapshot (SPEC \u00a75.2/\u00a76.6).`,
        );
      }
      return null;
    },
  };
}

function compilerApprovedSourceCensusVitePlugin(
  sourceFiles: readonly BuildCheckSourceFile[],
  sourceIdentityRoot: string,
): {
  plugin: Plugin;
  snapshot(): readonly BuildCheckSourceFile[];
} {
  const approvedFiles = buildSnapshotDenseArray(
    sourceFiles,
    'Compiler source-census approved files',
  );
  const approvedByPath = buildCreateMap<string, BuildCheckSourceFile>();
  for (let index = 0; index < approvedFiles.length; index += 1) {
    const file = approvedFiles[index];
    if (!file || typeof file !== 'object') {
      throw new TypeError(`Compiler source-census approved file[${index}] must be an own record.`);
    }
    const fileName = buildOwnDataValue(
      file,
      'fileName',
      `Compiler source-census approved file[${index}]`,
    );
    const source = buildOwnDataValue(
      file,
      'source',
      `Compiler source-census approved file[${index}]`,
    );
    if (typeof fileName !== 'string' || typeof source !== 'string') {
      throw new TypeError(
        `Compiler source-census approved file[${index}] must contain own string fileName/source values.`,
      );
    }
    const absoluteFileName = resolve(sourceIdentityRoot, fileName);
    if (buildMapHas(approvedByPath, absoluteFileName)) {
      throw new TypeError(`Compiler source-census approved files repeat ${fileName}.`);
    }
    buildMapSet(approvedByPath, absoluteFileName, { fileName, source });
  }

  const reachedPaths = buildCreateSet<string>();
  const reachedFiles: BuildCheckSourceFile[] = [];
  return {
    plugin: {
      enforce: 'pre',
      name: 'kovo-compiler-approved-source-census',
      transform(code, id) {
        const fileName = viteBuildSourceFileName(id);
        if (fileName === undefined || !isBuildSourceModulePath(fileName)) return null;
        const approved = buildMapGet(approvedByPath, fileName);
        if (approved === undefined) return null;
        if (code !== approved.source) {
          throw new TypeError(
            `Compiler source census refused changed approved source ${approved.fileName}.`,
          );
        }
        if (!buildSetHas(reachedPaths, fileName)) {
          buildSetAdd(reachedPaths, fileName);
          buildSecurityArrayAppend(reachedFiles, approved, 'Compiler app source census');
        }
        return null;
      },
    },
    snapshot() {
      return buildSnapshotDenseArray(reachedFiles, 'Compiler app source census');
    },
  };
}

function isBuildBareModuleSpecifier(specifier: string): boolean {
  if (buildStringStartsWith(specifier, 'node:')) return true;
  return (
    specifier.length > 0 &&
    specifier[0] !== '\0' &&
    specifier[0] !== '#' &&
    specifier[0] !== '\\' &&
    !buildStringStartsWith(specifier, './') &&
    !buildStringStartsWith(specifier, '../') &&
    !buildStringStartsWith(specifier, 'file:') &&
    !buildStringIncludes(specifier, ':') &&
    !isAbsolute(specifier)
  );
}

function isApprovedBuildVirtualSpecifier(specifier: string): boolean {
  return specifier === '\0vite/preload-helper.js';
}

interface KovoFrameworkPackageContext {
  readonly entry: string;
  readonly manifest: Record<string, unknown>;
  readonly resolver: NodeRequire;
}

interface KovoFrameworkSourceRoot {
  readonly device: bigint;
  readonly files: ReadonlyMap<string, KovoFrameworkSourceFileSnapshot>;
  readonly inode: bigint;
  readonly path: string;
}

interface KovoFrameworkSourceFileSnapshot {
  readonly byteLength: number;
  readonly sha256: string;
}

interface KovoFrameworkSourceSnapshotBudget {
  bytes: number;
  directories: number;
  files: number;
}

function resolveKovoFrameworkSourceRoots(
  cliEntry: string,
  cliResolver: NodeRequire,
): readonly KovoFrameworkSourceRoot[] {
  const roots: KovoFrameworkSourceRoot[] = [];
  const snapshotBudget: KovoFrameworkSourceSnapshotBudget = {
    bytes: 0,
    directories: 0,
    files: 0,
  };
  const visitedEntries = buildCreateSet<string>();
  const cliManifest = exactKovoFrameworkPackageManifest(cliEntry, '@kovojs/cli');
  if (cliManifest === undefined) {
    return buildSnapshotDenseArray(roots, 'Kovo framework source roots');
  }
  const contexts: KovoFrameworkPackageContext[] = [
    { entry: cliEntry, manifest: cliManifest, resolver: cliResolver },
  ];
  for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
    if (contextIndex >= KOVO_FRAMEWORK_SOURCE_MAX_CONTEXTS) {
      throw new TypeError('Kovo framework dependency graph exceeds the bounded context limit.');
    }
    const context = contexts[contextIndex]!;
    const dependencyNames = declaredKovoFrameworkDependencies(
      context.manifest,
      `Kovo framework package ${context.entry}`,
    );
    for (let index = 0; index < dependencyNames.length; index += 1) {
      const packageName = dependencyNames[index]!;
      let entry: string;
      try {
        entry = realpathSync(resolve(context.resolver.resolve(packageName)));
      } catch {
        // A declared package not reachable from this exact dependency context contributes no root.
        continue;
      }
      if (buildSetHas(visitedEntries, entry)) continue;
      const manifest = exactKovoFrameworkPackageManifest(entry, packageName);
      if (manifest === undefined) continue;
      buildSetAdd(visitedEntries, entry);
      // Pin the canonical root now, before app/config evaluation. Re-resolving this path later
      // would let evaluated code rename it and substitute a symlink that retargets existing
      // framework trust (SPEC §5.2/§6.6).
      const rootPath = realpathSync(dirname(entry));
      const rootIdentity = kovoFrameworkSourceRootIdentity(rootPath);
      if (rootIdentity === undefined) {
        throw new TypeError(`Kovo framework source root ${rootPath} has no stable identity.`);
      }
      let duplicate = false;
      for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
        if (roots[rootIndex]!.path === rootPath) {
          duplicate = true;
          break;
        }
      }
      if (!duplicate) {
        const files = snapshotKovoFrameworkSourceFiles(rootPath, snapshotBudget);
        if (!buildMapHas(files, entry)) {
          throw new TypeError(`Kovo framework entry ${entry} is absent from its source snapshot.`);
        }
        buildSecurityArrayAppend(
          roots,
          {
            device: rootIdentity.device,
            files,
            inode: rootIdentity.inode,
            path: rootPath,
          },
          'Kovo framework source roots',
        );
      }
      buildSecurityArrayAppend(
        contexts,
        { entry, manifest, resolver: createRequire(pathToFileURL(entry)) },
        'Kovo framework package contexts',
      );
    }
  }
  return buildSnapshotDenseArray(roots, 'Kovo framework source roots');
}

function kovoFrameworkSourceRootIdentity(
  root: string,
): Pick<KovoFrameworkSourceRoot, 'device' | 'inode'> | undefined {
  try {
    const stats = statSync(root, { bigint: true });
    const device = buildOwnDataValue(stats, 'dev', `Kovo framework source root ${root}`);
    const inode = buildOwnDataValue(stats, 'ino', `Kovo framework source root ${root}`);
    if (typeof device !== 'bigint' || typeof inode !== 'bigint') return undefined;
    return { device, inode };
  } catch {
    return undefined;
  }
}

function snapshotKovoFrameworkSourceFiles(
  root: string,
  budget: KovoFrameworkSourceSnapshotBudget,
): ReadonlyMap<string, KovoFrameworkSourceFileSnapshot> {
  const files = buildCreateMap<string, KovoFrameworkSourceFileSnapshot>();
  const pending: Array<{ readonly depth: number; readonly path: string }> = [
    { depth: 0, path: root },
  ];
  for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
    const directory = pending[pendingIndex]!;
    budget.directories += 1;
    if (budget.directories > KOVO_FRAMEWORK_SOURCE_MAX_DIRECTORIES) {
      throw new TypeError('Kovo framework source snapshot exceeds the directory limit.');
    }
    const entries = buildSnapshotDenseArray(
      readdirSync(directory.path, { encoding: 'utf8' }),
      `Kovo framework source directory ${directory.path}`,
    );
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const name = entries[entryIndex]!;
      if (typeof name !== 'string' || name.length === 0 || name === '.' || name === '..') {
        throw new TypeError(
          `Kovo framework source directory ${directory.path} has an invalid entry.`,
        );
      }
      const filePath = join(directory.path, name);
      const stats = lstatSync(filePath, { bigint: true });
      const mode = buildOwnDataValue(stats, 'mode', `Kovo framework source ${filePath}`);
      if (typeof mode !== 'bigint') {
        throw new TypeError(`Kovo framework source ${filePath} has invalid mode evidence.`);
      }
      const kind = mode & 0o170000n;
      if (kind === 0o040000n) {
        if (buildRegExpExec(/^node_modules$/iu, name) !== null) continue;
        if (directory.depth >= KOVO_FRAMEWORK_SOURCE_MAX_DEPTH) {
          throw new TypeError('Kovo framework source snapshot exceeds the depth limit.');
        }
        buildSecurityArrayAppend(
          pending,
          { depth: directory.depth + 1, path: filePath },
          'Kovo framework source directories',
        );
        continue;
      }
      if (kind === 0o120000n) {
        // A symlink never creates membership. An internal target is snapshotted at its canonical
        // regular path; an external target remains outside the declared package root.
        continue;
      }
      if (kind !== 0o100000n) {
        throw new TypeError(`Kovo framework source ${filePath} is not a regular file.`);
      }
      const size = buildOwnDataValue(stats, 'size', `Kovo framework source ${filePath}`);
      if (typeof size !== 'bigint' || size < 0n || size > 16_777_216n) {
        throw new TypeError(`Kovo framework source ${filePath} exceeds the file byte limit.`);
      }
      budget.files += 1;
      if (budget.files > KOVO_FRAMEWORK_SOURCE_MAX_FILES) {
        throw new TypeError('Kovo framework source snapshot exceeds the file limit.');
      }
      const bytes = readFileSync(filePath);
      const byteLength = buildByteLength(bytes);
      if (byteLength > KOVO_FRAMEWORK_SOURCE_MAX_FILE_BYTES) {
        throw new TypeError(`Kovo framework source ${filePath} exceeds the file byte limit.`);
      }
      budget.bytes += byteLength;
      if (budget.bytes > KOVO_FRAMEWORK_SOURCE_MAX_TOTAL_BYTES) {
        throw new TypeError('Kovo framework source snapshot exceeds the total byte limit.');
      }
      const canonicalPath = realpathSync(filePath);
      if (!isBuildPathWithinRoot(root, canonicalPath)) {
        throw new TypeError(`Kovo framework source ${filePath} escapes its package root.`);
      }
      const snapshot = { byteLength, sha256: hash('sha256', bytes, 'hex') };
      if (
        buildMapHas(files, canonicalPath) &&
        (buildMapGet(files, canonicalPath)?.byteLength !== snapshot.byteLength ||
          buildMapGet(files, canonicalPath)?.sha256 !== snapshot.sha256)
      ) {
        throw new TypeError(`Kovo framework source snapshot conflicts for ${canonicalPath}.`);
      }
      buildMapSet(files, canonicalPath, snapshot);
    }
  }
  return files;
}

function exactKovoFrameworkPackageManifest(
  entry: string,
  expectedName: string,
): Record<string, unknown> | undefined {
  let directory = dirname(resolve(entry));
  for (let depth = 0; depth < 64; depth += 1) {
    const manifestPath = join(directory, 'package.json');
    const result = readJsonRecord(manifestPath);
    if (result.ok) {
      const name = buildOwnDataValue(result.value, 'name', `Kovo package manifest ${manifestPath}`);
      return name === expectedName ? result.value : undefined;
    }
    if (result.error.kind !== 'not-found') return undefined;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  return undefined;
}

function declaredKovoFrameworkDependencies(
  manifest: Record<string, unknown>,
  label: string,
): string[] {
  const names: string[] = [];
  // Only package-owned dependencies extend the trusted framework graph. Peers are selected by the
  // consuming app, and optional dependencies can likewise be substituted or omitted by the host;
  // neither is framework-owned authority for the SPEC §5.2/§6.6 source exemption.
  const dependencies = buildOwnDataValue(manifest, 'dependencies', label);
  if (dependencies === undefined) return names;
  if (!isRecord(dependencies)) throw new TypeError(`${label}.dependencies must be an own record.`);
  const candidates = buildObjectKeys(dependencies);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (!isKovoFrameworkSourcePackage(candidate)) continue;
    const range = buildOwnDataValue(dependencies, candidate, `${label}.dependencies`);
    if (typeof range !== 'string') {
      throw new TypeError(`${label}.dependencies.${candidate} must be a string.`);
    }
    let duplicate = false;
    for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
      if (names[nameIndex] === candidate) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      buildSecurityArrayAppend(names, candidate, 'Declared Kovo framework dependencies');
    }
  }
  return names;
}

function isKovoFrameworkSourcePackage(value: string): boolean {
  for (let index = 0; index < kovoFrameworkSourcePackages.length; index += 1) {
    if (kovoFrameworkSourcePackages[index] === value) return true;
  }
  return false;
}

/** @internal Packed-install regression seam for the SPEC §5.2/§6.6 source-root proof. */
export function kovoFrameworkSourceRootsForTesting(cliEntry: string): readonly string[] {
  const trust = resolveKovoFrameworkSourceRoots(cliEntry, createRequire(pathToFileURL(cliEntry)));
  const roots: string[] = [];
  for (let index = 0; index < trust.length; index += 1) {
    buildSecurityArrayAppend(roots, trust[index]!.path, 'Kovo framework source root paths');
  }
  return buildSnapshotDenseArray(roots, 'Kovo framework source root paths');
}

/** @internal Packed-install regression seam for source-path containment adversaries. */
export function kovoFrameworkSourcePathForTesting(cliEntry: string, fileName: string): boolean {
  return kovoFrameworkSourcePathMatchesSnapshot(
    resolveKovoFrameworkSourceRoots(cliEntry, createRequire(pathToFileURL(cliEntry))),
    resolve(fileName),
  );
}

/** @internal Regression seam for roots captured before app/config evaluation. */
export function kovoFrameworkSourceTrustForTesting(
  cliEntry: string,
): readonly KovoFrameworkSourceRoot[] {
  return resolveKovoFrameworkSourceRoots(cliEntry, createRequire(pathToFileURL(cliEntry)));
}

/** @internal Real-Vite regression seam for the SPEC §5.2/§6.6 framework-source sink. */
export function kovoFrameworkSourceVitePluginForTesting(
  cliEntry: string,
  buildRoot: string,
): Plugin {
  return approvedBuildSourcesVitePlugin(
    join(buildRoot, '.kovo-framework-source-test-app.mjs'),
    buildRoot,
    [],
    'app',
    resolveKovoFrameworkSourceRoots(cliEntry, createRequire(pathToFileURL(cliEntry))),
  );
}

/** @internal Real-Vite regression seam for immutable app/config source closure. */
export function approvedBuildSourcesVitePluginForTesting(
  appModulePath: string,
  buildRoot: string,
  sourceFiles: readonly BuildCheckSourceFile[],
  sourceLabel: 'app' | 'config' = 'app',
): Plugin {
  return approvedBuildSourcesVitePlugin(appModulePath, buildRoot, sourceFiles, sourceLabel);
}

/** @internal Regression seam for trust captured before app/config evaluation. */
export function kovoFrameworkSourcePathFromTrustForTesting(
  roots: readonly KovoFrameworkSourceRoot[],
  fileName: string,
): boolean {
  return kovoFrameworkSourcePathMatchesSnapshot(roots, resolve(fileName));
}

type KovoFrameworkSourceClassification =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'outside' }
  | {
      readonly canonicalPath: string;
      readonly kind: 'trusted';
      readonly snapshot: KovoFrameworkSourceFileSnapshot;
    };

function classifyKovoFrameworkSourcePath(
  roots: readonly KovoFrameworkSourceRoot[],
  fileName: string,
): KovoFrameworkSourceClassification {
  let canonicalFileName: string;
  try {
    canonicalFileName = realpathSync(fileName);
  } catch {
    for (let index = 0; index < roots.length; index += 1) {
      if (isBuildPathWithinRoot(roots[index]!.path, fileName)) return { kind: 'invalid' };
    }
    return { kind: 'outside' };
  }
  let invalid = false;
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index]!;
    const lexicalInside = isBuildPathWithinRoot(root.path, fileName);
    const canonicalInside = isBuildPathWithinRoot(root.path, canonicalFileName);
    const currentIdentity = kovoFrameworkSourceRootIdentity(root.path);
    if (
      currentIdentity === undefined ||
      currentIdentity.device !== root.device ||
      currentIdentity.inode !== root.inode
    ) {
      if (lexicalInside || canonicalInside) invalid = true;
      continue;
    }
    if (!canonicalInside) {
      if (lexicalInside) invalid = true;
      continue;
    }
    const segments = buildPathSegments(relative(root.path, canonicalFileName));
    let crossesNestedDependencyBoundary = false;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      if (buildRegExpExec(/^node_modules$/iu, segments[segmentIndex]!) !== null) {
        crossesNestedDependencyBoundary = true;
        break;
      }
    }
    // A declared root does not confer trust transitively on packages installed below it. If that
    // nested package is independently declared and resolved, its own exact entry root appears in
    // `roots` and a later iteration can accept it (SPEC §5.2/§6.6).
    if (crossesNestedDependencyBoundary) {
      invalid = true;
      continue;
    }
    const snapshot = buildMapGet(root.files, canonicalFileName);
    if (snapshot === undefined) {
      invalid = true;
      continue;
    }
    return { canonicalPath: canonicalFileName, kind: 'trusted', snapshot };
  }
  return invalid ? { kind: 'invalid' } : { kind: 'outside' };
}

function kovoFrameworkSourceSnapshotMatches(
  snapshot: KovoFrameworkSourceFileSnapshot,
  source: string | Uint8Array,
): boolean {
  return (
    buildByteLength(source) === snapshot.byteLength &&
    hash('sha256', source, 'hex') === snapshot.sha256
  );
}

function kovoFrameworkSourcePathMatchesSnapshot(
  roots: readonly KovoFrameworkSourceRoot[],
  fileName: string,
): boolean {
  const classification = classifyKovoFrameworkSourcePath(roots, fileName);
  if (classification.kind !== 'trusted') return false;
  try {
    return kovoFrameworkSourceSnapshotMatches(
      classification.snapshot,
      readFileSync(classification.canonicalPath),
    );
  } catch {
    return false;
  }
}

function unapprovedBuildSourceError(
  buildRoot: string,
  fileName: string,
  sourceLabel: 'app' | 'config' = 'app',
): Error {
  const displayName = relative(buildRoot, fileName) || fileName;
  return new Error(
    `Kovo build refused unapproved ${sourceLabel} source ${displayName}; the module was introduced after the security preflight (SPEC \u00a75.2/\u00a76.6).`,
  );
}

function viteBuildSourceFileName(id: string): string | undefined {
  const stripped = buildRegExpReplace(/[?#].*$/u, id, '');
  if (buildStringStartsWith(stripped, '\0')) return undefined;
  if (buildStringStartsWith(stripped, 'file:')) {
    try {
      return resolve(fileURLToPath(stripped));
    } catch {
      return undefined;
    }
  }
  return isAbsolute(stripped) ? resolve(stripped) : undefined;
}

function isBuildSourceModulePath(fileName: string): boolean {
  return buildRegExpExec(/\.(?:[cm]?[jt]sx?)$/iu, fileName) !== null;
}

function isBuildStylesheetSourcePath(fileName: string): boolean {
  return buildRegExpExec(/\.css$/iu, fileName) !== null;
}

function isBuildAppSourcePath(root: string, fileName: string): boolean {
  if (!isBuildPathWithinRoot(root, fileName)) return false;
  const relativePath = relative(root, fileName);
  const normalized = slashPath(relativePath);
  return !(
    normalized === 'node_modules' ||
    buildStringStartsWith(normalized, 'node_modules/') ||
    normalized === 'dist' ||
    buildStringStartsWith(normalized, 'dist/') ||
    normalized === '.kovo' ||
    buildStringStartsWith(normalized, '.kovo/')
  );
}

function isBuildPathWithinRoot(root: string, fileName: string): boolean {
  const relativePath = relative(root, fileName);
  return (
    relativePath === '' ||
    (!isAbsolute(relativePath) &&
      buildRegExpExec(/^(?:\.\.(?:[/\\]|$)|[/\\])/u, relativePath) === null)
  );
}

async function bundleKovoServerHandler(
  appModulePath: string,
  options: {
    approvedSourceFiles: readonly BuildCheckSourceFile[];
    buildRoot: string;
    dependencyCapabilities: AppDependencyCapabilityManifest;
    projectMutationFacts: ProjectMutationRegistryFacts;
    queryShapeFacts: readonly QueryShapeFact[];
    generatedClientModules?: readonly KovoAppShellCompiledClientModule[];
    manualClientModules?: readonly { path: string; source: string }[];
    runtimeTarget: KovoBuildPresetName;
    runtimeRegistry: RuntimeRegistryWireFacts;
    stylesheetAssets?: KovoBuildStylesheetAssets;
  },
): Promise<{
  clientModules: readonly KovoAppShellCompiledClientModule[];
  source: string;
}> {
  const kovoPlugin = kovoVitePlugin({
    include: [
      kovoBuildApprovedSourceFilter(appModulePath, options.buildRoot, options.approvedSourceFiles),
    ],
    queryShapeFacts: options.queryShapeFacts,
    registryFacts: options.projectMutationFacts,
  });
  const stylesheetAssets = options.stylesheetAssets ?? emptyKovoBuildStylesheetAssets();
  const tempDir = mkdtempSync(join(tmpdir(), 'kovo-build-'));
  const entryPath = join(tempDir, 'entry.mjs');
  const runtimeRegistryPath = join(tempDir, 'runtime-registry.mjs');
  const outDir = join(tempDir, 'out');

  try {
    writeFileSync(
      runtimeRegistryPath,
      serializeBuildRuntimeRegistryWireModule(options.runtimeRegistry),
      'utf8',
    );
    writeFileSync(
      entryPath,
      kovoServerHandlerEntrySource(
        appModulePath,
        stylesheetAssets,
        options.runtimeTarget,
        options.generatedClientModules,
        options.manualClientModules,
      ),
      'utf8',
    );
    await viteBuild({
      appType: 'custom',
      build: {
        emptyOutDir: true,
        minify: false,
        outDir,
        rollupOptions: {
          // SPEC 6.6/§10.3 keeps native and Postgres drivers as runtime sinks; unused
          // @kovojs/server barrel re-exports must not make every app load those drivers.
          external: (id) =>
            isKovoServerHandlerExternalDependencyForTarget(id, options.runtimeTarget),
          input: entryPath,
          output: {
            entryFileNames: 'handler.mjs',
            format: 'es',
            // The neutral build contract accepts serverHandlerSource as one file.
            // Keep SSR dynamic imports inlined so presets never miss sidecar chunks.
            codeSplitting: false,
          },
          treeshake: {
            moduleSideEffects(id) {
              return !isKovoServerHandlerModuleSideEffectFree(id);
            },
          },
        },
        ssr: true,
        target: 'node22',
      },
      configFile: false,
      define: {
        'process.env.NODE_ENV': stringifyBuildValue('production'),
      },
      logLevel: 'silent',
      mode: 'production',
      oxc: {
        jsx: {
          development: false,
          importSource: '@kovojs/server',
          runtime: 'automatic',
        },
      },
      plugins: [
        ...(options.runtimeTarget === 'cloudflare'
          ? [cloudflareUnavailableDgramFloorVitePlugin(), cloudflareDatabaseRuntimeVitePlugin()]
          : []),
        approvedBuildSourcesVitePlugin(
          appModulePath,
          options.buildRoot,
          options.approvedSourceFiles,
        ),
        dependencyCapabilityLoaderVitePlugin(
          appModulePath,
          options.approvedSourceFiles,
          options.dependencyCapabilities,
          'build-server',
          {
            allowNodeBuiltins: true,
            allowRuntimeExternal: (id) =>
              isKovoServerHandlerExternalDependencyForTarget(id, options.runtimeTarget),
            sourceRoot: options.buildRoot,
          },
        ),
        kovoBuildLoweringVitePlugin(kovoPlugin),
        bundledUndiciRuntimeVitePlugin(),
      ],
      resolve: {
        alias: [
          { find: /^@kovojs\/core$/, replacement: requireFromCli.resolve('@kovojs/core') },
          {
            find: /^@kovojs\/core\/internal\/verifier$/,
            replacement: requireFromCli.resolve('@kovojs/core/internal/verifier'),
          },
          { find: /^@kovojs\/server$/, replacement: requireFromCli.resolve('@kovojs/server') },
          {
            find: /^@kovojs\/server\/internal\/execution$/,
            replacement: requireFromCli.resolve('@kovojs/server/internal/execution'),
          },
          {
            find: /^@kovojs\/server\/internal\/sql-parser-authority-bootstrap$/,
            replacement: requireFromCli.resolve(
              '@kovojs/server/internal/sql-parser-authority-bootstrap',
            ),
          },
          {
            find: /^@kovojs\/server\/jsx-dev-runtime$/,
            replacement: requireFromCli.resolve('@kovojs/server/jsx-dev-runtime'),
          },
          {
            find: /^@kovojs\/server\/jsx-runtime$/,
            replacement: requireFromCli.resolve('@kovojs/server/jsx-runtime'),
          },
        ],
      },
      root: options.buildRoot,
      ssr: {
        external: ['@node-rs/argon2'],
        noExternal: dependencyCapabilityCompleteBundleNoExternal(),
        // Resolve provider-neutral/browser package exports for Workers. In particular, Better
        // Auth's default telemetry entry is portable while its `node` condition probes the host
        // filesystem synchronously. Node/Vercel retain Vite's Node SSR condition set.
        target: options.runtimeTarget === 'cloudflare' ? 'webworker' : 'node',
      },
    });

    const source = stableKovoServerHandlerSource(
      await readFile(join(outDir, 'handler.mjs'), 'utf8'),
    );
    assertNoUnloweredKovoClientIslandHooks(source);
    return {
      clientModules: kovoPlugin.getClientModules?.() ?? [],
      source,
    };
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

async function compilerClientModulesFromApprovedSources(
  appModulePath: string,
  options: {
    approvedSourceFiles: readonly BuildCheckSourceFile[];
    buildRoot: string;
    projectMutationFacts: ProjectMutationRegistryFacts;
    queryShapeFacts: readonly QueryShapeFact[];
  },
): Promise<readonly KovoAppShellCompiledClientModule[]> {
  const approvedSourceFiles = buildSnapshotDenseArray(
    options.approvedSourceFiles,
    'Compiler client-module census approved sources',
  );
  const approvedIdentities = buildCreateSet<string>();
  const approvedSourceFilter = kovoBuildApprovedSourceFilter(
    appModulePath,
    options.buildRoot,
    approvedSourceFiles,
  );
  const kovoPlugin = kovoVitePlugin({
    include: [approvedSourceFilter],
    queryShapeFacts: options.queryShapeFacts,
    registryFacts: options.projectMutationFacts,
  });
  kovoPlugin.configResolved?.({
    command: 'build',
    root: options.buildRoot,
    server: { fs: { allow: [options.buildRoot] } },
  });

  const expectedAppIdentity = kovoBuildFilterFileName(appModulePath, options.buildRoot);
  let sawAppModule = false;
  for (let index = 0; index < approvedSourceFiles.length; index += 1) {
    const file = approvedSourceFiles[index];
    if (!file || typeof file !== 'object') {
      throw new TypeError(
        `Compiler client-module census approved source[${index}] must be an own record.`,
      );
    }
    const fileName = buildOwnDataValue(
      file,
      'fileName',
      `Compiler client-module census approved source[${index}]`,
    );
    const source = buildOwnDataValue(
      file,
      'source',
      `Compiler client-module census approved source[${index}]`,
    );
    if (typeof fileName !== 'string' || typeof source !== 'string') {
      throw new TypeError(
        `Compiler client-module census approved source[${index}] must contain own string fileName/source values.`,
      );
    }
    const absoluteFileName = resolve(options.buildRoot, fileName);
    if (!isBuildPathWithinRoot(options.buildRoot, absoluteFileName)) {
      throw new TypeError(
        `Compiler client-module census approved source escapes the build root: ${fileName}.`,
      );
    }
    const identity = kovoBuildFilterFileName(absoluteFileName, options.buildRoot);
    if (buildSetHas(approvedIdentities, identity)) {
      throw new TypeError(
        `Compiler client-module census approved sources repeat module identity ${identity}.`,
      );
    }
    buildSetAdd(approvedIdentities, identity);
    if (identity === expectedAppIdentity) sawAppModule = true;
    if (!approvedSourceFilter(absoluteFileName)) {
      throw new TypeError(
        `Compiler client-module census refused unauthenticated approved source ${identity}.`,
      );
    }
    await kovoPlugin.transform(source, absoluteFileName);
  }
  if (!sawAppModule) {
    throw new TypeError(
      'Compiler client-module census approved sources omitted the selected app module.',
    );
  }
  return kovoPlugin.getClientModules?.() ?? [];
}

/** @internal Regression seam for the authenticated source-to-client-module build census. */
export async function compilerClientModulesFromApprovedSourcesForTests(
  appModulePath: string,
  buildRoot: string,
  approvedSourceFiles: readonly BuildCheckSourceFile[],
): Promise<readonly KovoAppShellCompiledClientModule[]> {
  return compilerClientModulesFromApprovedSources(appModulePath, {
    approvedSourceFiles,
    buildRoot,
    projectMutationFacts: { mutationBindings: [], mutationInputs: {} },
    queryShapeFacts: [],
  });
}

/** @internal Regression seam for final-bundle exact census and provenance enforcement. */
export function assertCompilerClientModuleParityForTests(
  discovered: readonly KovoAppShellCompiledClientModule[],
  final: readonly KovoAppShellCompiledClientModule[],
): void {
  assertCompilerClientModuleCensus(
    compilerClientModuleCensus(discovered, 'discovered compiler client modules'),
    compilerClientModuleCensus(final, 'final compiler client modules'),
  );
}

function finalCompilerClientModulesFromBuildPasses(
  browser: readonly KovoAppShellCompiledClientModule[],
  discoveredServer: readonly KovoAppShellCompiledClientModule[],
  finalServer: readonly KovoAppShellCompiledClientModule[],
): readonly KovoAppShellCompiledClientModule[] {
  // The browser pass may intentionally contribute app-bootstrap or other client-only modules.
  // Compare the two SSR pass results before taking that union: otherwise a module genuinely found
  // by both the browser and discovery passes can mask its omission from the final runtime-posture
  // bundle.
  assertCompilerClientModuleCensus(
    compilerClientModuleCensus(discoveredServer, 'discovered server compiler client modules'),
    compilerClientModuleCensus(finalServer, 'final server compiler client modules'),
  );
  const discovered = uniqueKovoCompiledClientModules([...browser, ...discoveredServer]);
  const final = uniqueKovoCompiledClientModules([...browser, ...finalServer]);
  assertCompilerClientModuleCensus(
    compilerClientModuleCensus(discovered, 'discovered compiler client modules'),
    compilerClientModuleCensus(final, 'final compiler client modules'),
  );
  return final;
}

/** @internal Regression seam for production discovery/final pass orchestration. */
export function finalCompilerClientModulesFromBuildPassesForTests(
  browser: readonly KovoAppShellCompiledClientModule[],
  discoveredServer: readonly KovoAppShellCompiledClientModule[],
  finalServer: readonly KovoAppShellCompiledClientModule[],
): readonly KovoAppShellCompiledClientModule[] {
  return finalCompilerClientModulesFromBuildPasses(browser, discoveredServer, finalServer);
}

function stableKovoServerHandlerSource(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\/\/#(?:end)?region(?:\s|$)/.test(line))
    .join('\n');
}

function kovoBuildLoweringVitePlugin<T extends { enforce?: unknown }>(
  plugin: T,
): T & {
  enforce: 'pre';
} {
  return Object.assign(plugin, { enforce: 'pre' as const });
}

function assertNoUnloweredKovoClientIslandHooks(source: string): void {
  if (!/\bcomponent\(\{[\s\S]{0,3000}\bon[A-Z][A-Za-z0-9_]*\s*:/.test(source)) return;

  throw new Error(
    [
      'kovo build cannot ship an authored client island that reached the server bundle before Kovo lowering.',
      'The bundled handler still contains component(...) with JSX-style on* handlers; rerun through a build path where the Kovo compiler sees TSX before JSX lowering.',
      'This fails closed instead of emitting inert production interactivity (SPEC §5.2 / §7).',
    ].join(' '),
  );
}

function uniqueKovoCompiledClientModules(
  modules: readonly KovoAppShellCompiledClientModule[],
): KovoAppShellCompiledClientModule[] {
  const snapshot = buildSnapshotDenseArray(modules, 'compiler client modules to deduplicate');
  const byPath = buildCreateMap<string, Map<string, KovoAppShellCompiledClientModule>>();
  const unique: KovoAppShellCompiledClientModule[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const module = snapshot[index]!;
    const facts = exactCompilerClientModuleFacts(
      module,
      index,
      'compiler client modules to deduplicate',
    );
    let byDigest = buildMapGet(byPath, facts.path);
    if (byDigest === undefined) {
      byDigest = buildCreateMap<string, KovoAppShellCompiledClientModule>();
      buildMapSet(byPath, facts.path, byDigest);
    }
    const digest = clientModuleRepresentationDigest(facts.source);
    const existing = buildMapGet(byDigest, digest);
    if (existing !== undefined) {
      const existingFacts = exactCompilerClientModuleFacts(
        existing,
        index,
        'deduplicated compiler client module',
      );
      if (
        existingFacts.renderPlanFingerprint !== facts.renderPlanFingerprint ||
        existingFacts.role !== facts.role
      ) {
        throw new TypeError(
          `Kovo compiler client module ${facts.path} has conflicting fingerprint or role provenance.`,
        );
      }
      continue;
    }
    buildMapSet(byDigest, digest, module);
    buildSecurityArrayAppend(unique, module, 'Unique compiler client modules');
  }
  return unique;
}

function compilerClientModuleRoles(
  modules: readonly KovoAppShellCompiledClientModule[],
  label: string,
): CompilerOwnedViteClientModuleRole[] {
  const snapshot = buildSnapshotDenseArray(modules, label);
  return buildMapDense(snapshot, label, (module, index) => {
    return exactCompilerClientModuleFacts(module, index, label).role;
  });
}

/** @internal Re-mint only a private, authenticated client-phase handoff in a fresh worker. */
export function adoptKovoBuildOneShotClientPhaseCompilerModules(
  input: KovoBuildOneShotClientPhase,
  installer: CompilerClientModuleHandoffInstaller,
): KovoBuildOneShotClientPhase {
  const clientPhase = requireKovoBuildOneShotClientPhase(input);
  const clientBuildModules = buildSnapshotDenseArray(
    clientPhase.clientBuild.clientModules,
    'Client-phase client-build compiler modules',
  );
  const discoveredServerClientModules = buildSnapshotDenseArray(
    clientPhase.discoveredServerClientModules,
    'Client-phase discovered server compiler modules',
  );
  const adoptedCollections = adoptCompilerClientModuleHandoffCollections(
    clientBuildModules,
    clientPhase.clientBuildClientModuleRoles,
    discoveredServerClientModules,
    clientPhase.discoveredServerClientModuleRoles,
    installer,
  );
  installer.seal();
  return {
    ...clientPhase,
    clientBuild: {
      ...clientPhase.clientBuild,
      clientModules: adoptedCollections.first,
    },
    discoveredServerClientModules: adoptedCollections.second,
  };
}

/** @internal Re-mint only a private, authenticated server-phase handoff in a fresh worker. */
export function adoptKovoBuildOneShotServerPhaseCompilerModules(
  input: KovoBuildOneShotServerPhase,
  installer: CompilerClientModuleHandoffInstaller,
): KovoBuildOneShotServerPhase {
  const serverPhase = requireKovoBuildOneShotServerPhase(input);
  const clientModules = adoptCompilerClientModuleHandoffRecords(
    serverPhase.clientModules,
    serverPhase.clientModuleRoles,
    installer,
  );
  installer.seal();
  return { ...serverPhase, clientModules };
}

function adoptCompilerClientModuleHandoffRecords(
  modules: readonly KovoAppShellCompiledClientModule[],
  roles: readonly CompilerOwnedViteClientModuleRole[],
  installer: CompilerClientModuleHandoffInstaller,
  adoptedByIdentity?: Map<
    string,
    {
      readonly module: KovoAppShellCompiledClientModule;
      readonly role: CompilerOwnedViteClientModuleRole;
    }
  >,
  reusePriorCollection = false,
): KovoAppShellCompiledClientModule[] {
  if (modules.length !== roles.length) {
    throw new TypeError('Kovo compiler client-module handoff role census is incomplete.');
  }
  const collectionIdentities = buildCreateSet<string>();
  return buildMapDense(modules, 'Compiler client-module handoff records', (module, index) => {
    const role = roles[index]!;
    const identity = compilerClientModuleHandoffWireIdentity(module);
    if (buildSetHas(collectionIdentities, identity)) {
      throw new TypeError('Kovo compiler client-module handoff collection repeats an identity.');
    }
    buildSetAdd(collectionIdentities, identity);
    const existing =
      adoptedByIdentity === undefined ? undefined : buildMapGet(adoptedByIdentity, identity);
    if (existing !== undefined) {
      if (!reusePriorCollection || existing.role !== role) {
        throw new TypeError(
          'Kovo compiler client-module handoff identity has conflicting collection provenance.',
        );
      }
      return existing.module;
    }
    let adopted: KovoAppShellCompiledClientModule;
    switch (role) {
      case 'app-bootstrap':
        adopted = installer.adoptAppBootstrap(module);
        break;
      case 'component-client':
        adopted = installer.adoptComponentClient(module);
        break;
      case 'deferred-app-runtime':
        adopted = installer.adoptDeferredAppRuntime(module);
        break;
      case 'optimistic-plan':
        adopted = installer.adoptOptimisticPlan(module);
        break;
      default:
        throw unknownCompilerClientModuleRole(role);
    }
    if (adoptedByIdentity !== undefined) {
      buildMapSet(adoptedByIdentity, identity, { module: adopted, role });
    }
    return adopted;
  });
}

function adoptCompilerClientModuleHandoffCollections(
  first: readonly KovoAppShellCompiledClientModule[],
  firstRoles: readonly CompilerOwnedViteClientModuleRole[],
  second: readonly KovoAppShellCompiledClientModule[],
  secondRoles: readonly CompilerOwnedViteClientModuleRole[],
  installer: CompilerClientModuleHandoffInstaller,
): {
  readonly first: readonly KovoAppShellCompiledClientModule[];
  readonly second: readonly KovoAppShellCompiledClientModule[];
} {
  const adoptedByIdentity = buildCreateMap<
    string,
    {
      readonly module: KovoAppShellCompiledClientModule;
      readonly role: CompilerOwnedViteClientModuleRole;
    }
  >();
  const adoptedFirst = adoptCompilerClientModuleHandoffRecords(
    first,
    firstRoles,
    installer,
    adoptedByIdentity,
  );
  const adoptedSecond = adoptCompilerClientModuleHandoffRecords(
    second,
    secondRoles,
    installer,
    adoptedByIdentity,
    true,
  );
  return { first: adoptedFirst, second: adoptedSecond };
}

/** @internal Regression seam for authenticated cross-pass client-module handoff joins. */
export function adoptCompilerClientModuleHandoffCollectionsForTests(
  first: readonly KovoAppShellCompiledClientModule[],
  firstRoles: readonly CompilerOwnedViteClientModuleRole[],
  second: readonly KovoAppShellCompiledClientModule[],
  secondRoles: readonly CompilerOwnedViteClientModuleRole[],
  installer: CompilerClientModuleHandoffInstaller,
): {
  readonly first: readonly KovoAppShellCompiledClientModule[];
  readonly second: readonly KovoAppShellCompiledClientModule[];
} {
  return adoptCompilerClientModuleHandoffCollections(
    first,
    firstRoles,
    second,
    secondRoles,
    installer,
  );
}

function compilerClientModuleHandoffWireIdentity(module: KovoAppShellCompiledClientModule): string {
  const path = buildOwnDataValue(module, 'path', 'Compiler client-module handoff record');
  const renderPlanFingerprint = buildOwnDataValue(
    module,
    'renderPlanFingerprint',
    'Compiler client-module handoff record',
  );
  const source = buildOwnDataValue(module, 'source', 'Compiler client-module handoff record');
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    typeof renderPlanFingerprint !== 'string' ||
    buildRegExpExec(/^[0-9a-f]{64}$/u, renderPlanFingerprint) === null ||
    typeof source !== 'string'
  ) {
    throw new TypeError('Kovo compiler client-module handoff record is malformed.');
  }
  return `${path}\u0000${clientModuleRepresentationDigest(source)}\u0000${renderPlanFingerprint}`;
}

function adoptCompilerClientModulesForNeutralBuild(
  modules: readonly KovoAppShellCompiledClientModule[],
  installer: CompilerClientModuleBuildInstaller,
): KovoAppShellCompiledClientModule[] {
  const snapshot = buildSnapshotDenseArray(modules, 'neutral-build compiler client modules');
  const roles: CompilerOwnedViteClientModuleRole[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const role = exactCompilerClientModuleFacts(
      snapshot[index]!,
      index,
      'neutral-build compiler client modules',
    ).role;
    buildSecurityArrayAppend(roles, role, 'Neutral-build compiler client-module provenance');
  }
  const adopted: KovoAppShellCompiledClientModule[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const module = snapshot[index]!;
    const role = roles[index]!;
    let pinned: KovoAppShellCompiledClientModule;
    switch (role) {
      case 'app-bootstrap':
        pinned = installer.adoptAppBootstrap(module);
        break;
      case 'component-client':
        pinned = installer.adoptComponentClient(module);
        break;
      case 'deferred-app-runtime':
        pinned = installer.adoptDeferredAppRuntime(module);
        break;
      case 'optimistic-plan':
        pinned = installer.adoptOptimisticPlan(module);
        break;
      default:
        throw unknownCompilerClientModuleRole(role);
    }
    buildSecurityArrayAppend(adopted, pinned, 'SSR-adopted neutral-build compiler client modules');
  }
  installer.seal();
  return adopted;
}

function compilerClientModuleCensus(
  modules: readonly KovoAppShellCompiledClientModule[],
  label: string,
): string[] {
  const snapshot = buildSnapshotDenseArray(modules, label);
  const seen = buildCreateSet<string>();
  const census: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const facts = exactCompilerClientModuleFacts(snapshot[index]!, index, label);
    const identity = `${facts.path}\u0000${clientModuleRepresentationDigest(facts.source)}\u0000${facts.renderPlanFingerprint}\u0000${facts.role}`;
    if (buildSetHas(seen, identity)) {
      throw new TypeError(`Kovo ${label} repeats one compiler client-module census identity.`);
    }
    buildSetAdd(seen, identity);
    buildSecurityArrayAppend(census, identity, 'Compiler client-module census');
  }
  return uniqueSorted(census);
}

function assertCompilerClientModuleCensus(
  discovered: readonly string[],
  final: readonly string[],
): void {
  if (discovered.length !== final.length) {
    throw new TypeError(
      'Kovo final runtime-posture bundle changed the discovered client-module role census.',
    );
  }
  for (let index = 0; index < discovered.length; index += 1) {
    if (discovered[index] !== final[index]) {
      throw new TypeError(
        'Kovo final runtime-posture bundle changed the discovered client-module role census.',
      );
    }
  }
}

function exactCompilerClientModuleFacts(
  module: KovoAppShellCompiledClientModule,
  index: number,
  label: string,
): {
  path: string;
  renderPlanFingerprint: string;
  role: CompilerOwnedViteClientModuleRole;
  source: string;
} {
  const role = compilerOwnedViteClientModuleRole(module);
  if (role === undefined) {
    throw new TypeError(`Kovo refused unproven ${label}[${index}].`);
  }
  const path = buildOwnDataValue(module, 'path', `${label}[${index}]`);
  const renderPlanFingerprint = buildOwnDataValue(
    module,
    'renderPlanFingerprint',
    `${label}[${index}]`,
  );
  const source = buildOwnDataValue(module, 'source', `${label}[${index}]`);
  if (
    typeof path !== 'string' ||
    typeof source !== 'string' ||
    typeof renderPlanFingerprint !== 'string' ||
    buildRegExpExec(/^[0-9a-f]{64}$/u, renderPlanFingerprint) === null
  ) {
    throw new TypeError(
      `Kovo ${label}[${index}] must carry exact path/source/fingerprint strings.`,
    );
  }
  return { path, renderPlanFingerprint, role, source };
}

function unknownCompilerClientModuleRole(_role: never): TypeError {
  return new TypeError('Kovo refused an unknown compiler client-module role.');
}

function kovoBuildApprovedSourceFilter(
  appModulePath: string,
  buildRoot: string,
  sourceFiles: readonly BuildCheckSourceFile[],
  sourceIdentityRoot: string = buildRoot,
): (fileName: string) => boolean {
  const approved = buildCreateSet<string>();
  buildSetAdd(approved, kovoBuildFilterFileName(appModulePath, buildRoot));
  const files = buildSnapshotDenseArray(sourceFiles, 'Approved compiler source files');
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file || typeof file !== 'object') {
      throw new TypeError(`Approved compiler source file[${index}] must be an own record.`);
    }
    const fileName = buildOwnDataValue(file, 'fileName', `Approved compiler source file[${index}]`);
    if (typeof fileName !== 'string') {
      throw new TypeError(`Approved compiler source file[${index}].fileName must be a string.`);
    }
    buildSetAdd(
      approved,
      kovoBuildFilterFileName(resolve(sourceIdentityRoot, fileName), buildRoot),
    );
  }
  return (fileName) => buildSetHas(approved, kovoBuildFilterFileName(fileName, buildRoot));
}

export function projectMutationRegistryFactsForBuild(
  appModulePath: string,
  buildRoot: string,
  sourceFiles: readonly BuildCheckSourceFile[],
  sourceIdentityRoot: string = buildRoot,
): ProjectMutationRegistryFacts {
  const files = buildSnapshotDenseArray(sourceFiles, 'Project mutation build source files');
  const exactFacts = compilerOwnedProjectMutationRegistryFactsFromFiles(files, sourceIdentityRoot);
  const projectFileName = (fileName: string): string =>
    kovoBuildFilterFileName(resolve(sourceIdentityRoot, fileName), buildRoot);
  const mutationInputs = buildCreateNullRecord<
    ProjectMutationRegistryFacts['mutationInputs'][string]
  >() as ProjectMutationRegistryFacts['mutationInputs'];
  const mutationInputKeys = buildSnapshotDenseArray(
    buildObjectKeys(exactFacts.mutationInputs),
    'Project mutation input keys',
  );
  for (let keyIndex = 0; keyIndex < mutationInputKeys.length; keyIndex += 1) {
    const key = mutationInputKeys[keyIndex]!;
    const fields = buildSnapshotDenseArray(
      buildOwnDataValue(
        exactFacts.mutationInputs,
        key,
        `Project mutation input ${key}`,
      ) as ProjectMutationRegistryFacts['mutationInputs'][string],
      `Project mutation input ${key}`,
    );
    const projectedFields: (typeof fields)[number][] = [];
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      const field = fields[fieldIndex]!;
      buildSecurityArrayAppend(
        projectedFields,
        {
          ...field,
          ...(field.source === undefined
            ? {}
            : {
                source: {
                  ...field.source,
                  fileName: projectFileName(field.source.fileName),
                },
              }),
        },
        `Projected mutation input ${key}`,
      );
    }
    (mutationInputs as Record<string, readonly (typeof fields)[number][]>)[key] = projectedFields;
  }
  const mutationBindings: ProjectMutationRegistryFacts['mutationBindings'] =
    exactFacts.mutationBindings.map((binding) => ({
      ...binding,
      fileName: projectFileName(binding.fileName),
      source: {
        ...binding.source,
        fileName: projectFileName(binding.source.fileName),
      },
    }));
  const moduleHrefAliases = buildCreateMap<string, string>();
  let optimisticModules: ProjectMutationRegistryFacts['optimisticModules'];
  if (exactFacts.optimisticModules !== undefined) {
    const exactModules = buildSnapshotDenseArray(
      exactFacts.optimisticModules,
      'Project optimistic build modules',
    );
    const projectedModules: NonNullable<
      ProjectMutationRegistryFacts['optimisticModules']
    >[number][] = [];
    for (let index = 0; index < exactModules.length; index += 1) {
      const module = exactModules[index]!;
      const fileName = projectFileName(module.fileName);
      const href = clientModuleHrefForSourceFile(
        fileName,
        clientModuleRepresentationDigest(module.source),
      );
      const target = parseVersionedClientModuleTarget(href);
      if (!target) {
        throw new TypeError(
          `Project optimistic build module ${module.fileName} produced a non-canonical client URL.`,
        );
      }
      if (buildMapHas(moduleHrefAliases, module.href)) {
        throw new TypeError(
          `Project optimistic build modules reused immutable URL ${module.href}.`,
        );
      }
      buildMapSet(moduleHrefAliases, module.href, href);
      buildSecurityArrayAppend(
        projectedModules,
        {
          ...module,
          fileName,
          href,
          path: target.path,
        },
        'Projected optimistic build modules',
      );
    }
    optimisticModules = projectedModules;
  }
  let mutationOptimism: ProjectMutationRegistryFacts['mutationOptimism'];
  if (exactFacts.mutationOptimism !== undefined) {
    const projectedOptimism = buildCreateNullRecord<
      NonNullable<ProjectMutationRegistryFacts['mutationOptimism']>[string]
    >() as Record<string, NonNullable<ProjectMutationRegistryFacts['mutationOptimism']>[string]>;
    const mutationKeys = buildSnapshotDenseArray(
      buildObjectKeys(exactFacts.mutationOptimism),
      'Project optimistic build mutation keys',
    );
    for (let index = 0; index < mutationKeys.length; index += 1) {
      const key = mutationKeys[index]!;
      const fact = buildOwnDataValue(
        exactFacts.mutationOptimism,
        key,
        `Project optimistic build mutation ${key}`,
      ) as NonNullable<ProjectMutationRegistryFacts['mutationOptimism']>[string];
      const moduleHref = buildMapGet(moduleHrefAliases, fact.moduleHref);
      if (moduleHref === undefined) {
        throw new TypeError(
          `Project optimistic build mutation ${key} has no projected client module.`,
        );
      }
      projectedOptimism[key] = {
        ...fact,
        inputFields: mutationInputs[key] ?? fact.inputFields,
        moduleHref,
      };
    }
    mutationOptimism = projectedOptimism;
  }
  const viteFiles: BuildCheckSourceFile[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file || typeof file !== 'object') {
      throw new TypeError(`Project mutation build source file[${index}] must be an own record.`);
    }
    const fileName = buildOwnDataValue(
      file,
      'fileName',
      `Project mutation build source file[${index}]`,
    );
    const source = buildOwnDataValue(
      file,
      'source',
      `Project mutation build source file[${index}]`,
    );
    if (typeof fileName !== 'string' || typeof source !== 'string') {
      throw new TypeError(
        `Project mutation build source file[${index}] must contain own string fileName/source values.`,
      );
    }
    buildSecurityArrayAppend(
      viteFiles,
      {
        fileName: kovoBuildFilterFileName(resolve(sourceIdentityRoot, fileName), buildRoot),
        source,
      },
      'Project mutation Vite source files',
    );
  }
  // Retain the existing exact source census here as a path-remapping integrity check. The
  // compiler-owned proof above is the only channel allowed to authenticate app.mutation.
  if (viteFiles.length !== files.length) {
    throw new TypeError('Project mutation build source census changed during path projection.');
  }
  return {
    mutationBindings,
    mutationInputs,
    ...(mutationOptimism === undefined ? {} : { mutationOptimism }),
    ...(optimisticModules === undefined ? {} : { optimisticModules }),
  };
}

function kovoBuildFilterFileName(fileName: string, root: string): string {
  const rootPrefix = `${slashPath(root).replace(/^\/+/, '').replace(/\/+$/, '')}/`;
  const normalized = slashPath(fileName).replace(/^\/+/, '');
  return normalized.startsWith(rootPrefix) ? normalized.slice(rootPrefix.length) : normalized;
}

const bundledUndiciRuntimeModuleId = '\0kovo-bundled-undici-runtime';

const cloudflareUnavailableDgramFloorModuleId = '\0kovo-cloudflare-unavailable-dgram-floor';
const cloudflareUnavailablePgliteModuleId = '\0kovo-cloudflare-unavailable-pglite';
const cloudflareUnavailableDrizzlePgliteModuleId = '\0kovo-cloudflare-unavailable-drizzle-pglite';
const cloudflareUnavailablePgliteModuleSource = `const unavailable = () => {
  throw new TypeError('Kovo Cloudflare builds require an external Postgres database; the embedded development database is unavailable.');
};
export class PGlite {
  constructor() { return unavailable(); }
  close() { return unavailable(); }
  exec() { return unavailable(); }
  query() { return unavailable(); }
  transaction() { return unavailable(); }
}
`;

/**
 * Replace Node-only database implementation details only across exact, boot-authenticated Kovo
 * server edges. External Postgres remains available through nodejs_compat, while the embedded
 * PGlite development driver fails closed and managed SQL classification uses the parser captured
 * after the generated Worker locks its request-safe realm (SPEC §6.6 rule 6, §10.3).
 */
function cloudflareDatabaseRuntimeVitePlugin(): {
  enforce: 'pre';
  load(id: string): null | string;
  name: string;
  resolveId(source: string, importer?: string): null | string;
  transform(code: string, id: string): null | string;
} {
  return {
    enforce: 'pre',
    name: 'kovo-cloudflare-database-runtime',
    resolveId(source, importer) {
      if (isCloudflareUnavailablePgliteImport(trustedKovoFrameworkSourceRoots, source, importer)) {
        return cloudflareUnavailablePgliteModuleId;
      }
      if (
        isCloudflareUnavailableDrizzlePgliteImport(
          trustedKovoFrameworkSourceRoots,
          source,
          importer,
        )
      ) {
        return cloudflareUnavailableDrizzlePgliteModuleId;
      }
      return (
        cloudflareSqlParserAuthorityReplacement(
          trustedKovoFrameworkSourceRoots,
          trustedKovoServerRuntimeEntry,
          source,
          importer,
        ) ?? null
      );
    },
    load(id) {
      if (id === cloudflareUnavailablePgliteModuleId) {
        return cloudflareUnavailablePgliteModuleSource;
      }
      if (id === cloudflareUnavailableDrizzlePgliteModuleId) {
        return `export function drizzle() {
  throw new TypeError('Kovo Cloudflare builds require an external Postgres database; the embedded development database is unavailable.');
}
`;
      }
      return null;
    },
    transform(code, id) {
      return (
        cloudflareManagedSqlParserSource(trustedCloudflareSqlParserRuntimeSubject, code, id) ?? null
      );
    },
  };
}

const cloudflareSqlParserAmbiguousDiagnostic =
  /throw new Error\(`💀 Ambiguous SQL syntax: Please file an issue stating the request that has failed at https:\/\/github\.com\/oguimbal\/pgsql-ast-parser:\s*\$\{sql\}\s*`\);/u;

/**
 * Normalize the one upstream parser diagnostic that embeds both the complete SQL text and its
 * Node package identity. Kovo's authority always replaces dependency errors with a fixed
 * host-owned rejection; stripping this unreachable payload before a Workers bundle avoids
 * retaining attacker-controlled SQL in an intermediate Error and keeps the artifact free of a
 * Node package implementation marker. Only the exact boot-captured parser entry and bytes qualify.
 */
function cloudflareManagedSqlParserSource(
  subject: CloudflareSqlParserRuntimeSubject | undefined,
  code: string,
  id: string,
): string | undefined {
  if (subject === undefined) return undefined;
  const fileName = viteBuildSourceFileName(id);
  if (fileName === undefined) return undefined;
  try {
    if (realpathSync(fileName) !== subject.entry) return undefined;
  } catch {
    return undefined;
  }
  if (
    code !== subject.source ||
    buildRegExpExec(cloudflareSqlParserAmbiguousDiagnostic, code) === null
  ) {
    throw new TypeError(
      'Kovo refused changed Workers SQL parser bytes or an unreviewed diagnostic shape.',
    );
  }
  const normalized = buildRegExpReplace(
    cloudflareSqlParserAmbiguousDiagnostic,
    code,
    'throw new Error("Ambiguous SQL syntax");',
  );
  if (
    normalized === code ||
    buildRegExpExec(cloudflareSqlParserAmbiguousDiagnostic, normalized) !== null
  ) {
    throw new TypeError('Kovo could not normalize the reviewed Workers SQL parser diagnostic.');
  }
  return normalized;
}

function isCloudflareUnavailablePgliteImport(
  trust: readonly KovoFrameworkSourceRoot[],
  source: string,
  importer: string | undefined,
): boolean {
  if (source !== '@electric-sql/pglite' || importer === undefined) return false;
  const importerFileName = viteBuildSourceFileName(importer);
  return (
    importerFileName !== undefined &&
    buildRegExpExec(
      /\/postgres-runtime(?:-[A-Za-z0-9_-]+)?\.(?:js|mjs|ts)$/u,
      slashPath(importerFileName),
    ) !== null &&
    kovoFrameworkSourcePathMatchesSnapshot(trust, importerFileName)
  );
}

function isCloudflareUnavailableDrizzlePgliteImport(
  trust: readonly KovoFrameworkSourceRoot[],
  source: string,
  importer: string | undefined,
): boolean {
  if (source !== 'drizzle-orm/pglite' || importer === undefined) return false;
  const importerFileName = viteBuildSourceFileName(importer);
  return (
    importerFileName !== undefined &&
    buildRegExpExec(
      /\/postgres-runtime(?:-[A-Za-z0-9_-]+)?\.(?:js|mjs|ts)$/u,
      slashPath(importerFileName),
    ) !== null &&
    kovoFrameworkSourcePathMatchesSnapshot(trust, importerFileName)
  );
}

function cloudflareSqlParserAuthorityReplacement(
  trust: readonly KovoFrameworkSourceRoot[],
  serverRuntimeEntry: string | undefined,
  source: string,
  importer: string | undefined,
): string | undefined {
  if (
    serverRuntimeEntry === undefined ||
    importer === undefined ||
    buildRegExpExec(/^\.\/sql-parser-authority\.(?:js|mjs|ts)$/u, slashPath(source)) === null
  ) {
    return undefined;
  }
  const importerFileName = viteBuildSourceFileName(importer);
  if (
    importerFileName === undefined ||
    buildRegExpExec(
      /\/(?:postgres-runtime|sql-parser-authority-bootstrap)(?:-[A-Za-z0-9_-]+)?\.(?:js|mjs|ts)$/u,
      slashPath(importerFileName),
    ) === null ||
    !kovoFrameworkSourcePathMatchesSnapshot(trust, importerFileName)
  ) {
    return undefined;
  }
  const replacement = serverRuntimeSiblingPath(
    serverRuntimeEntry,
    'sql-parser-authority-cloudflare',
  );
  return kovoFrameworkSourcePathMatchesSnapshot(trust, replacement) ? replacement : undefined;
}

function serverRuntimeSiblingPath(serverRuntimeEntry: string, stem: string): string {
  const extension = buildStringEndsWith(serverRuntimeEntry, '.ts')
    ? '.ts'
    : buildStringEndsWith(serverRuntimeEntry, '.mjs')
      ? '.mjs'
      : '.js';
  return join(dirname(serverRuntimeEntry), `${stem}${extension}`);
}

/** @internal Regression seam for source/packed Cloudflare PGlite substitution. */
export function cloudflareUnavailablePgliteImportForTesting(
  trust: readonly KovoFrameworkSourceRoot[],
  source: string,
  importer: string | undefined,
): boolean {
  return isCloudflareUnavailablePgliteImport(trust, source, importer);
}

/** @internal Regression seam for the fail-closed Workers PGlite substitute. */
export function cloudflareUnavailablePgliteModuleSourceForTesting(): string {
  return cloudflareUnavailablePgliteModuleSource;
}

/** @internal Regression seam for source/packed Cloudflare Drizzle-PGlite substitution. */
export function cloudflareUnavailableDrizzlePgliteImportForTesting(
  trust: readonly KovoFrameworkSourceRoot[],
  source: string,
  importer: string | undefined,
): boolean {
  return isCloudflareUnavailableDrizzlePgliteImport(trust, source, importer);
}

/** @internal Regression seam for provider-specific server-handler externalization. */
export function kovoServerHandlerExternalDependencyForTesting(
  id: string,
  runtimeTarget: KovoBuildPresetName,
): boolean {
  return isKovoServerHandlerExternalDependencyForTarget(id, runtimeTarget);
}

/** @internal Regression seam for source/packed Cloudflare parser authority selection. */
export function cloudflareSqlParserAuthorityReplacementForTesting(
  trust: readonly KovoFrameworkSourceRoot[],
  serverRuntimeEntry: string | undefined,
  source: string,
  importer: string | undefined,
): string | undefined {
  return cloudflareSqlParserAuthorityReplacement(trust, serverRuntimeEntry, source, importer);
}

/** @internal Regression seam for the authenticated Workers parser diagnostic normalization. */
export function cloudflareManagedSqlParserSourceForTesting(
  subject: CloudflareSqlParserRuntimeSubject | undefined,
  code: string,
  id: string,
): string | undefined {
  return cloudflareManagedSqlParserSource(subject, code, id);
}

/**
 * Cloudflare exposes node:dgram only as a non-functional compatibility stub. The framework's
 * Node process floor is therefore vacuously satisfied in that runtime and must not make every
 * Cloudflare build fail its own unsupported-API inspection. The private egress-dgram dist entry
 * preserves the same replacement seam in packed packages. Restrict this substitution to the
 * byte-authenticated framework-owned import from egress-bootstrap; an app-authored node:dgram
 * import stays external in the server bundle and remains a blocking
 * cloudflare-unsupported-node-api finding.
 */
function cloudflareUnavailableDgramFloorVitePlugin(): {
  enforce: 'pre';
  load(id: string): null | string;
  name: string;
  resolveId(source: string, importer?: string): null | string;
} {
  return {
    enforce: 'pre',
    name: 'kovo-cloudflare-unavailable-dgram-floor',
    resolveId(source, importer) {
      if (
        isCloudflareUnavailableDgramFloorImport(trustedKovoFrameworkSourceRoots, source, importer)
      ) {
        return cloudflareUnavailableDgramFloorModuleId;
      }
      return null;
    },
    load(id) {
      if (id !== cloudflareUnavailableDgramFloorModuleId) return null;
      return `export function installDgramFloor() { return () => {}; }
export function dgramFloorTamperStatus() {
  return { installed: true, tampered: false };
}
export function isDgramFloorInstalled() { return true; }
`;
    },
  };
}

function isCloudflareUnavailableDgramFloorImport(
  trust: readonly KovoFrameworkSourceRoot[],
  source: string,
  importer: string | undefined,
): boolean {
  if (buildRegExpExec(/^\.\/egress-dgram\.(?:js|mjs|ts)$/u, slashPath(source)) === null) {
    return false;
  }
  if (importer === undefined) return false;
  const importerFileName = viteBuildSourceFileName(importer);
  if (
    importerFileName === undefined ||
    buildRegExpExec(
      /\/egress-bootstrap(?:-[A-Za-z0-9_-]+)?\.(?:js|mjs|ts)$/u,
      slashPath(importerFileName),
    ) === null
  ) {
    return false;
  }
  return kovoFrameworkSourcePathMatchesSnapshot(trust, importerFileName);
}

/** @internal Regression seam for source and packed Cloudflare dgram-floor substitution. */
export function cloudflareUnavailableDgramFloorImportForTesting(
  trust: readonly KovoFrameworkSourceRoot[],
  source: string,
  importer: string | undefined,
): boolean {
  return isCloudflareUnavailableDgramFloorImport(trust, source, importer);
}

function bundledUndiciRuntimeVitePlugin(): {
  enforce: 'pre';
  load(id: string): null | string;
  name: string;
  resolveId(source: string, importer?: string): null | string;
  transform(code: string): null | { code: string; map: null };
} {
  return {
    enforce: 'pre',
    name: 'kovo-bundled-undici-runtime',
    resolveId(source, importer) {
      const normalizedSource = slashPath(source);
      const normalizedImporter = importer ? slashPath(importer) : '';
      if (
        normalizedSource === './egress-undici-runtime.js' &&
        normalizedImporter.includes('/egress-undici.')
      ) {
        return bundledUndiciRuntimeModuleId;
      }
      if (
        normalizedSource.endsWith('/egress-undici-runtime.js') ||
        normalizedSource.endsWith('/egress-undici-runtime.ts')
      ) {
        return bundledUndiciRuntimeModuleId;
      }
      return null;
    },
    load(id) {
      if (id !== bundledUndiciRuntimeModuleId) return null;
      return `export { Agent, getGlobalDispatcher, setGlobalDispatcher } from ${stringifyBuildValue(
        pathToFileURL(requireFromCli.resolve('undici')).href,
      )};\n`;
    },
    transform(code) {
      const rewritten = code.replace(
        /const undici = createRequire\(import\.meta\.url\)\(["']undici["']\);\s*const Agent = undici\.Agent;\s*const getGlobalDispatcher = undici\.getGlobalDispatcher;\s*const setGlobalDispatcher = undici\.setGlobalDispatcher;/,
        '',
      );
      if (rewritten === code) return null;
      return {
        code: `import { Agent, getGlobalDispatcher, setGlobalDispatcher } from ${stringifyBuildValue(
          pathToFileURL(requireFromCli.resolve('undici')).href,
        )};\n${rewritten}`,
        map: null,
      };
    },
  };
}

/** @internal Generated-entry ordering proof for SPEC §6.6 rule 6. */
export function kovoServerHandlerEntrySource(
  appModulePath: string,
  stylesheetAssets: KovoBuildStylesheetAssets,
  runtimeTarget: KovoBuildPresetName,
  generatedClientModules?: readonly KovoAppShellCompiledClientModule[],
  manualClientModules?: readonly { path: string; source: string }[],
): string {
  const generatedClientModuleEntry =
    generatedClientModules === undefined && manualClientModules === undefined
      ? undefined
      : generatedBuildClientModuleEntry(generatedClientModules ?? [], manualClientModules ?? []);
  return buildJoinStrings(
    [
      runtimeTarget === 'cloudflare'
        ? ''
        : "import '@kovojs/server/internal/sql-parser-authority-bootstrap';",
      `import { createRequestHandler, deriveClosedKovoApp, resolveKovoAppToken, runWithGeneratedLiveTargetRegistry } from ${stringifyBuildValue(
        generatedHandlerRuntimeHref(),
      )};`,
      generatedClientModuleEntry === undefined
        ? ''
        : `import { claimGeneratedBuildClientModuleInstaller } from ${stringifyBuildValue(
            generatedBuildClientModuleBootstrapHref(),
          )};`,
      "import './runtime-registry.mjs';",
      "import { appendFrameworkRuntimeArrayValue } from '@kovojs/server/internal/execution';",
      ...(generatedClientModuleEntry === undefined
        ? []
        : [
            'const generatedClientModuleInstaller = claimGeneratedBuildClientModuleInstaller();',
            ...generatedClientModuleEntry.registrationLines,
          ]),
      generatedClientModuleEntry === undefined
        ? `const appModule = await runWithGeneratedLiveTargetRegistry(() => import(${stringifyBuildValue(pathToFileURL(appModulePath).href)}));`
        : `const appModule = await runWithGeneratedLiveTargetRegistry(() => generatedClientModuleInstaller.load(${stringifyBuildValue(
            generatedClientModuleEntry.renderPlanFingerprint,
          )}, () => import(${stringifyBuildValue(pathToFileURL(appModulePath).href)})));`,
      'const appToken = appModule.default ?? appModule.app;',
      "const app = resolveKovoAppToken(appToken, 'generated production handler');",
      `const stylesheetAssets = ${stringifyBuildValue(stylesheetAssets)};`,
      'export default createRequestHandler(appWithBuildStylesheetAssets(app, stylesheetAssets));',
      '',
      'function appWithBuildStylesheetAssets(app, assets) {',
      '  const liveTargetRenderers = [];',
      '  for (let index = 0; index < app.liveTargetRenderers.length; index += 1) {',
      '    const renderer = app.liveTargetRenderers[index];',
      '    const fragmentAssets = assets.fragments[renderer.component] ?? [];',
      "    appendFrameworkRuntimeArrayValue(liveTargetRenderers, fragmentAssets.length === 0 ? renderer : { ...renderer, stylesheets: mergeStylesheetAssets(concatStylesheetAssets(renderer.stylesheets ?? [], fragmentAssets)) }, 'Generated live-target renderers');",
      '  }',
      '  const routes = [];',
      '  for (let index = 0; index < app.routes.length; index += 1) {',
      '    const route = app.routes[index];',
      '    const routeAssets = assets.routes[route.path] ?? [];',
      "    appendFrameworkRuntimeArrayValue(routes, routeAssets.length === 0 ? route : { ...route, stylesheets: mergeStylesheetAssets(concatStylesheetAssets(route.stylesheets ?? [], routeAssets)) }, 'Generated routes');",
      '  }',
      '  return deriveClosedKovoApp(app, {',
      '    liveTargetRenderers,',
      '    stylesheets: mergeStylesheetAssets(concatStylesheetAssets(app.stylesheets, assets.app)),',
      '    routes,',
      '  });',
      '}',
      '',
      'function concatStylesheetAssets(left, right) {',
      '  const result = [];',
      "  for (let index = 0; index < left.length; index += 1) appendFrameworkRuntimeArrayValue(result, left[index], 'Generated stylesheet concatenation');",
      "  for (let index = 0; index < right.length; index += 1) appendFrameworkRuntimeArrayValue(result, right[index], 'Generated stylesheet concatenation');",
      '  return result;',
      '}',
      '',
      'function mergeStylesheetAssets(assets) {',
      '  const hrefOrder = [];',
      '  const chunksByHref = [];',
      '  for (let assetIndex = 0; assetIndex < assets.length; assetIndex += 1) {',
      '    const asset = assets[assetIndex];',
      "    const href = typeof asset === 'string' ? asset : asset.href;",
      '    let hrefIndex = -1;',
      '    for (let index = 0; index < hrefOrder.length; index += 1) {',
      '      if (hrefOrder[index] === href) { hrefIndex = index; break; }',
      '    }',
      '    if (hrefIndex < 0) {',
      '      hrefIndex = hrefOrder.length;',
      "      appendFrameworkRuntimeArrayValue(hrefOrder, href, 'Generated stylesheet href order');",
      "      appendFrameworkRuntimeArrayValue(chunksByHref, [], 'Generated stylesheet chunk groups');",
      '    }',
      "    if (typeof asset !== 'string' && asset.criticalCss) {",
      '      const chunks = chunksByHref[hrefIndex];',
      "      appendFrameworkRuntimeArrayValue(chunks, asset.criticalCss, 'Generated critical CSS chunks');",
      '    }',
      '  }',
      '  const result = [];',
      '  for (let hrefIndex = 0; hrefIndex < hrefOrder.length; hrefIndex += 1) {',
      '    let criticalCss = "";',
      '    const chunks = chunksByHref[hrefIndex];',
      '    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {',
      '      const chunk = chunks[chunkIndex];',
      '      if (!chunk) continue;',
      '      if (criticalCss) criticalCss += "\\n";',
      '      criticalCss += chunk;',
      '    }',
      "    appendFrameworkRuntimeArrayValue(result, { ...(criticalCss ? { criticalCss } : {}), href: hrefOrder[hrefIndex] }, 'Generated stylesheet assets');",
      '  }',
      '  return result;',
      '}',
      '',
    ],
    '\n',
    'Generated server-handler entry lines',
  );
}

function generatedBuildClientModuleEntry(
  modules: readonly KovoAppShellCompiledClientModule[],
  manualModules: readonly { path: string; source: string }[],
): {
  registrationLines: readonly string[];
  renderPlanFingerprint: string;
} {
  const snapshot = buildSnapshotDenseArray(modules, 'generated build client modules');
  const manualSnapshot = buildSnapshotDenseArray(
    manualModules,
    'generated build manual client modules',
  );
  const registrationLines: string[] = [];
  const roleByIdentity = buildCreateMap<string, string>();
  let appBootstrapCount = 0;
  let deferredAppRuntimeCount = 0;
  let optimisticPlanCount = 0;
  let renderPlanFingerprint: string | undefined;

  for (let index = 0; index < snapshot.length; index += 1) {
    const module = snapshot[index]!;
    const role = compilerOwnedViteClientModuleRole(module);
    if (role === undefined) {
      throw new TypeError(
        `Kovo refused unproven compiler client module ${index} before generated-handler emission.`,
      );
    }
    const path = buildOwnDataValue(module, 'path', `generated build client module ${index}`);
    const source = buildOwnDataValue(module, 'source', `generated build client module ${index}`);
    const fingerprint = buildOwnDataValue(
      module,
      'renderPlanFingerprint',
      `generated build client module ${index}`,
    );
    if (typeof path !== 'string' || typeof source !== 'string' || typeof fingerprint !== 'string') {
      throw new TypeError(
        `Kovo compiler client module ${index} must carry exact path/source/fingerprint strings.`,
      );
    }
    if (renderPlanFingerprint !== undefined && renderPlanFingerprint !== fingerprint) {
      throw new TypeError('Kovo generated-handler client modules carry incoherent fingerprints.');
    }
    if (buildRegExpExec(/^[0-9a-f]{64}$/u, fingerprint) === null) {
      throw new TypeError(
        `Kovo compiler client module ${index} carries an invalid render-plan fingerprint.`,
      );
    }
    renderPlanFingerprint = fingerprint;
    const identity = `${path}\u0000${clientModuleRepresentationDigest(source)}`;
    const previousRole = buildMapGet(roleByIdentity, identity);
    if (previousRole !== undefined) {
      throw new TypeError(
        previousRole === role
          ? `Kovo compiler client module ${path} was registered twice.`
          : `Kovo compiler client module ${path} has conflicting generated roles.`,
      );
    }
    buildMapSet(roleByIdentity, identity, role);
    const method =
      role === 'app-bootstrap'
        ? 'appBootstrap'
        : role === 'component-client'
          ? 'componentClient'
          : role === 'deferred-app-runtime'
            ? 'deferredAppRuntime'
            : 'optimisticPlan';
    if (role === 'app-bootstrap') appBootstrapCount += 1;
    if (role === 'deferred-app-runtime') deferredAppRuntimeCount += 1;
    if (role === 'optimistic-plan') optimisticPlanCount += 1;
    buildSecurityArrayAppend(
      registrationLines,
      `generatedClientModuleInstaller.${method}(Object.freeze(${stringifyBuildValue({
        path,
        source,
      })}));`,
      'Generated build client-module registrations',
    );
  }

  for (let index = 0; index < manualSnapshot.length; index += 1) {
    const module = manualSnapshot[index]!;
    const path = buildOwnDataValue(module, 'path', `generated build manual client module ${index}`);
    const source = buildOwnDataValue(
      module,
      'source',
      `generated build manual client module ${index}`,
    );
    if (typeof path !== 'string' || typeof source !== 'string') {
      throw new TypeError(
        `Kovo manual client module ${index} must carry exact path/source strings.`,
      );
    }
    if (
      path === '/c/generated/app.client.js' ||
      path === '/c/kovo-generated-app-runtime.client.js'
    ) {
      throw new TypeError(`Kovo compiler-generated client-module path is reserved: ${path}.`);
    }
    const identity = `${path}\u0000${clientModuleRepresentationDigest(source)}`;
    if (buildMapHas(roleByIdentity, identity)) {
      throw new TypeError(`Kovo manual client module ${path} conflicts with a generated module.`);
    }
    buildMapSet(roleByIdentity, identity, 'manual');
    buildSecurityArrayAppend(
      registrationLines,
      `generatedClientModuleInstaller.manual(Object.freeze(${stringifyBuildValue({
        path,
        source,
      })}));`,
      'Generated build manual client-module registrations',
    );
  }

  if (
    appBootstrapCount > 1 ||
    deferredAppRuntimeCount > 1 ||
    appBootstrapCount !== deferredAppRuntimeCount ||
    (optimisticPlanCount > 0 && appBootstrapCount !== 1)
  ) {
    throw new TypeError(
      'Kovo generated-handler client modules require exactly one coherent app-bootstrap/deferred-runtime pair.',
    );
  }

  return {
    registrationLines,
    renderPlanFingerprint: renderPlanFingerprint ?? computeRenderPlanFingerprint({}),
  };
}

function generatedServerInternalSiblingHref(stem: string): string {
  const appShellEntry = requireFromCli.resolve('@kovojs/server/internal/app-shell-vite');
  const extension = buildStringEndsWith(appShellEntry, '.ts')
    ? '.ts'
    : buildStringEndsWith(appShellEntry, '.mjs')
      ? '.mjs'
      : '.js';
  return pathToFileURL(join(dirname(appShellEntry), `${stem}${extension}`)).href;
}

function generatedBuildClientModuleBootstrapHref(): string {
  return generatedServerInternalSiblingHref('generated-build-client-modules');
}

function generatedHandlerRuntimeHref(): string {
  const appShellEntry = requireFromCli.resolve('@kovojs/server/internal/app-shell-vite');
  // Published packages preserve the server source graph as fixed-name modules. The generated
  // handler and public app imports therefore share one module identity graph, while the consuming
  // app can still tree-shake unrelated Node-only database/static-analysis modules. The framework
  // source loader authenticates every file before Vite consumes it (SPEC §5.2/§6.6 and §14).
  return generatedHandlerRuntimeHrefFromAppShellEntry(appShellEntry);
}

function generatedHandlerRuntimeHrefFromAppShellEntry(appShellEntry: string): string {
  const extension = buildStringEndsWith(appShellEntry, '.ts')
    ? '.ts'
    : buildStringEndsWith(appShellEntry, '.mjs')
      ? '.mjs'
      : '.js';
  return pathToFileURL(join(dirname(appShellEntry), `generated-handler-runtime${extension}`)).href;
}

/** @internal Regression seam for source and packed generated-handler runtime resolution. */
export function generatedHandlerRuntimeHrefForTesting(appShellEntry: string): string {
  return generatedHandlerRuntimeHrefFromAppShellEntry(appShellEntry);
}

/** @internal Serialize the production registry entry with the CLI's boot-captured JSON control. */
export function serializeBuildRuntimeRegistryWireModule(
  registry: RuntimeRegistryWireFacts,
): string {
  if (registry.runtimePosture === undefined) {
    throw new TypeError(
      'Production runtime emission requires the generated runtime posture registration boundary.',
    );
  }
  return buildJoinStrings(
    [
      `import { registerGeneratedBrowserPostureManifest, registerGeneratedCacheInfluenceManifest, registerGeneratedMutationTouchRegistry, registerGeneratedQueryReadRegistry, registerGeneratedRuntimePostureManifest, registerGeneratedTableSecurityManifest } from '@kovojs/server/internal/execution';`,
      ...(registry.browserPosture === undefined
        ? []
        : [
            `registerGeneratedBrowserPostureManifest(${stringifyBuildValue(registry.browserPosture)});`,
          ]),
      ...(registry.cacheInfluence === undefined
        ? []
        : [
            `registerGeneratedCacheInfluenceManifest(${stringifyBuildValue(registry.cacheInfluence)});`,
          ]),
      ...(registry.tableSecurity === undefined
        ? []
        : [
            `registerGeneratedTableSecurityManifest(${stringifyBuildValue(registry.tableSecurity)});`,
          ]),
      `registerGeneratedRuntimePostureManifest(${stringifyBuildValue(registry.runtimePosture)});`,
      `registerGeneratedQueryReadRegistry(${stringifyBuildValue(registry.queryReads)});`,
      `registerGeneratedMutationTouchRegistry(${stringifyBuildValue(registry.mutationTouches)});`,
      '',
    ],
    '\n',
    'Generated runtime-registry entry lines',
  );
}

export async function runExportCommand(
  options: KovoExportOptions,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<CliCommandResult> {
  const result = await runExportCommandStructured(options, security);
  if ('error' in result) return result;

  return {
    exitCode: result.exitCode,
    output: result.output,
  };
}

export async function runExportCommandStructured(
  options: KovoExportOptions,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<CliCommandResult | KovoExportCommandResult> {
  let loadedExport: LoadedExportAppModule | undefined;
  let manifestPlan: ExportManifestPlan | undefined;
  let result!: CliCommandResult | KovoExportCommandResult;
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    options = configurationBoundary(() => snapshotKovoExportOptions(options));
    const resolvedOptions = configurationBoundary(() =>
      resolveKovoExportOptions(options, security.invocationCwd),
    );
    assertKovoExportInputPaths(resolvedOptions);
    const exportRoot = resolvedOptions.root ?? dirname(resolvedOptions.appModulePath);
    const preEvaluationStaticTrust = await runPreEvaluationStaticTrustPreflightInWorker(
      resolvedOptions.appModulePath,
      exportRoot,
      security.paranoidStaticAdvisory,
      security.invocationEnv,
      null,
    );
    const currentManifestPlan = await configurationBoundaryAsync(() =>
      staticExportManifestPlan(resolvedOptions),
    );
    manifestPlan = currentManifestPlan;
    const staticExport = await (async () => {
      loadedExport = await loadExportAppModule(
        resolvedOptions,
        preEvaluationStaticTrust.approvedSourceFiles,
        preEvaluationStaticTrust.capabilityClosure.dependencyManifest,
        preEvaluationStaticTrust.sourceGraphFacts.sourceDerivedRegistryTransforms,
      );
      const app = appFromModule(
        loadedExport.appModule,
        resolvedOptions.appModulePath,
        loadedExport.resolveKovoAppToken,
      );
      const realmResult = await loadedExport.exportStaticApp(app, {
        ...(currentManifestPlan.assets.length === 0 ? {} : { assets: currentManifestPlan.assets }),
        ...(resolvedOptions.onNonExportable === undefined
          ? {}
          : { onNonExportable: resolvedOptions.onNonExportable }),
        diagnostics: loadedExport.staticExportCompileDiagnosticsFromModule(loadedExport.appModule),
        ...(resolvedOptions.origin === undefined ? {} : { origin: resolvedOptions.origin }),
        outDir: resolvedOptions.outDir,
        ...(resolvedOptions.assetBase === undefined
          ? {}
          : { publicAssetBase: resolvedOptions.assetBase }),
        ...(currentManifestPlan.publicAssetRoot === undefined
          ? {}
          : { publicAssetRoot: currentManifestPlan.publicAssetRoot }),
      });
      return transferStaticExportResult(realmResult, loadedExport.isStaticExportDiagnostic);
    })();

    result = kovoExportResult(staticExport, resolvedOptions);
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
    result = exportErrorResult(
      error,
      loadedExport === undefined
        ? undefined
        : transferStaticExportDiagnosticError(error, loadedExport),
    );
  }

  let teardownError: unknown;
  let hasTeardownError = false;
  try {
    await loadedExport?.close?.();
  } catch (error) {
    teardownError = error;
    hasTeardownError = true;
  }
  try {
    manifestPlan?.cleanup?.();
  } catch (error) {
    teardownError = hasTeardownError ? combineBuildTimeViteFailures(teardownError, error) : error;
    hasTeardownError = true;
  }
  if (hasTeardownError) {
    if (hasPrimaryError) {
      return exportErrorResult(combineBuildTimeViteFailures(primaryError, teardownError));
    }
    return exportErrorResult(teardownError);
  }
  return result;
}

function configurationBoundary<Value>(run: () => Value): Value {
  try {
    return run();
  } catch (error) {
    throw asKovoCommandConfigurationError(error);
  }
}

async function configurationBoundaryAsync<Value>(run: () => Promise<Value>): Promise<Value> {
  try {
    return await run();
  } catch (error) {
    throw asKovoCommandConfigurationError(error);
  }
}

function asKovoCommandConfigurationError(error: unknown): KovoCommandConfigurationError {
  if (error instanceof KovoCommandConfigurationError) return error;
  return new KovoCommandConfigurationError(error instanceof Error ? error.message : String(error));
}

function assertReadableKovoInputFile(fileName: string, label: string): void {
  try {
    const status = statSync(fileName);
    if (!status.isFile()) {
      throw new KovoCommandConfigurationError(
        `${label} must be a readable regular file: ${stableValue(fileName)}.`,
      );
    }
    // Validate readability at the input boundary. Compiler/source snapshots still re-read through
    // their confined capabilities and own the authoritative byte/race checks.
    readFileSync(fileName);
  } catch (error) {
    if (error instanceof KovoCommandConfigurationError) throw error;
    throw new KovoCommandConfigurationError(
      `${label} is missing or unreadable: ${stableValue(fileName)}.`,
    );
  }
}

function assertReadableKovoInputDirectory(directory: string, label: string): void {
  try {
    const status = lstatSync(directory);
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new KovoCommandConfigurationError(
        `${label} must be a readable, non-symbolic-link directory: ${stableValue(directory)}.`,
      );
    }
    readdirSync(directory);
  } catch (error) {
    if (error instanceof KovoCommandConfigurationError) throw error;
    throw new KovoCommandConfigurationError(
      `${label} is missing or unreadable: ${stableValue(directory)}.`,
    );
  }
}

function assertKovoOutputDirectoryTarget(directory: string, label: string): void {
  if (existsSync(directory)) {
    assertReadableKovoInputDirectory(directory, label);
    assertWritableKovoOutputParent(directory, label);
    return;
  }

  // A missing output leaf is valid, but its nearest existing parent must already be a usable
  // directory. The framework-owned output boundary remains responsible for race-safe creation.
  let parent = dirname(directory);
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  assertReadableKovoInputDirectory(parent, `${label} parent`);
  assertWritableKovoOutputParent(parent, `${label} parent`);
}

function assertWritableKovoOutputParent(directory: string, label: string): void {
  try {
    accessSync(directory, fsWriteOk);
  } catch {
    throw new KovoCommandConfigurationError(`${label} is not writable: ${stableValue(directory)}.`);
  }
}

function assertKovoExportInputPaths(options: KovoExportOptions): void {
  assertReadableKovoInputFile(options.appModulePath, 'kovo export app module');
  assertKovoOutputDirectoryTarget(options.outDir, 'kovo export --out');
  if (options.root !== undefined) {
    assertReadableKovoInputDirectory(options.root, 'kovo export --root');
  }
  if (options.manifestFile !== undefined) {
    assertReadableKovoInputFile(options.manifestFile, 'kovo export --manifest');
  }
  if (options.distDir !== undefined) {
    assertReadableKovoInputDirectory(options.distDir, 'kovo export --dist');
  }
}

function snapshotKovoBuildOptions(value: KovoBuildOptions): KovoBuildOptions {
  if (typeof value !== 'object' || value === null) {
    throw new KovoCommandConfigurationError('Kovo build options must be an object.');
  }
  const appModulePath = requiredBuildOptionString(value, 'appModulePath', 'build');
  const outDir = requiredBuildOptionString(value, 'outDir', 'build');
  const cache = buildOwnDataValue(value, 'cache', 'Kovo build options');
  const check = buildOwnDataValue(value, 'check', 'Kovo build options');
  const preset = buildOwnDataValue(value, 'preset', 'Kovo build options');
  if (typeof cache !== 'boolean' || typeof check !== 'boolean') {
    throw new TypeError('Kovo build options cache/check must be own booleans.');
  }
  if (
    preset !== undefined &&
    parseKovoBuildPresetName(requiredString(preset, 'build preset')) === undefined
  ) {
    throw new TypeError('Kovo build options.preset must be node, vercel, or cloudflare.');
  }
  const snapshot = buildCreateNullRecord<unknown>();
  snapshot.appModulePath = appModulePath;
  snapshot.cache = cache;
  snapshot.check = check;
  snapshot.outDir = outDir;
  if (preset !== undefined) snapshot.preset = preset;
  return snapshot as unknown as KovoBuildOptions;
}

function snapshotKovoSourceCheckOptions(value: KovoSourceCheckOptions): KovoSourceCheckOptions {
  if (typeof value !== 'object' || value === null) {
    throw new KovoCommandConfigurationError('Kovo source-check options must be an object.');
  }
  const appModulePath = requiredBuildOptionString(value, 'appModulePath', 'check');
  const cache = buildOwnDataValue(value, 'cache', 'Kovo source-check options');
  if (typeof cache !== 'boolean') {
    throw new TypeError('Kovo source-check options.cache must be an own boolean.');
  }
  const snapshot = buildCreateNullRecord<unknown>();
  snapshot.appModulePath = appModulePath;
  snapshot.cache = cache;
  return snapshot as unknown as KovoSourceCheckOptions;
}

function snapshotKovoExportOptions(value: KovoExportOptions): KovoExportOptions {
  if (typeof value !== 'object' || value === null) {
    throw new KovoCommandConfigurationError('Kovo export options must be an object.');
  }
  const snapshot = buildCreateNullRecord<unknown>();
  snapshot.appModulePath = requiredBuildOptionString(value, 'appModulePath', 'export');
  snapshot.outDir = requiredBuildOptionString(value, 'outDir', 'export');
  const stringNames = ['assetBase', 'distDir', 'manifestFile', 'origin', 'root'] as const;
  for (let index = 0; index < stringNames.length; index += 1) {
    const name = stringNames[index]!;
    const option = buildOwnDataValue(value, name, 'Kovo export options');
    if (option !== undefined) snapshot[name] = requiredString(option, `export ${name}`);
  }
  const onNonExportable = buildOwnDataValue(value, 'onNonExportable', 'Kovo export options');
  if (onNonExportable !== undefined) {
    if (onNonExportable !== 'error' && onNonExportable !== 'skip') {
      throw new TypeError('Kovo export options.onNonExportable must be error or skip.');
    }
    snapshot.onNonExportable = onNonExportable;
  }
  const vite = buildOwnDataValue(value, 'vite', 'Kovo export options');
  if (vite !== undefined) {
    if (typeof vite !== 'boolean')
      throw new TypeError('Kovo export options.vite must be a boolean.');
    snapshot.vite = vite;
  }
  return snapshot as unknown as KovoExportOptions;
}

function requiredBuildOptionString(
  value: object,
  name: 'appModulePath' | 'outDir',
  command: 'build' | 'check' | 'export',
): string {
  const option = buildOwnDataValue(value, name, `Kovo ${command} options`);
  return requiredString(option, `${command} ${name}`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new KovoCommandConfigurationError(`Kovo ${label} must be a non-empty own string.`);
  }
  return value;
}

function resolveKovoExportOptions(
  options: KovoExportOptions,
  invocationRoot: string,
): KovoExportOptions {
  const root = resolve(invocationRoot, options.root ?? '.');
  // `--vite --root` accepts Vite root-relative ids such as `/src/app.ts` (the documented CLI
  // form). Resolve every path before app evaluation so authored process.chdir() cannot redirect
  // the export sink or any source/manifest authority (SPEC §6.6 rule 6).
  const appModulePath =
    options.vite && options.appModulePath.startsWith('/')
      ? resolve(root, options.appModulePath.slice(1))
      : resolve(options.root === undefined ? invocationRoot : root, options.appModulePath);
  return {
    ...options,
    appModulePath,
    ...(options.distDir === undefined ? {} : { distDir: resolve(invocationRoot, options.distDir) }),
    ...(options.manifestFile === undefined
      ? {}
      : { manifestFile: resolve(invocationRoot, options.manifestFile) }),
    outDir: resolve(invocationRoot, options.outDir),
    ...(options.root === undefined ? {} : { root }),
  };
}

async function loadExportAppModule(
  options: KovoExportOptions,
  approvedSourceFiles: readonly BuildCheckSourceFile[],
  dependencyCapabilities: AppDependencyCapabilityManifest,
  sourceDerivedRegistryTransforms: readonly SourceDerivedRegistryTransform[],
): Promise<LoadedExportAppModule> {
  const resolvedAppModulePath = options.appModulePath;
  const root = options.root ?? dirname(resolvedAppModulePath);
  const requireFromApp = createRequire(pathToFileURL(resolvedAppModulePath));

  const lifetime = await createBuildTimeViteRunnable({
    appType: 'custom',
    configFile: false,
    logLevel: 'error',
    plugins: [
      approvedBuildSourcesVitePlugin(resolvedAppModulePath, root, approvedSourceFiles),
      dependencyCapabilityLoaderVitePlugin(
        resolvedAppModulePath,
        approvedSourceFiles,
        dependencyCapabilities,
        'export',
        { sourceRoot: root },
      ),
      sourceDerivedRegistryVitePlugin(resolvedAppModulePath, root, sourceDerivedRegistryTransforms),
    ],
    oxc: {
      jsx: {
        importSource: '@kovojs/server',
        runtime: 'automatic',
      },
    },
    root,
    server: buildTimeViteServerOptions(),
    ssr: dependencyCapabilityCompleteSsrOptions(),
  });
  const server = lifetime;
  try {
    await preloadKovoSsrSecurityProfile(server, resolvedAppModulePath, root);
    const serverModule = (await server.ssrLoadModule(
      viteSsrModuleId(requireFromApp.resolve('@kovojs/server/internal/static-export'), root),
    )) as typeof import('@kovojs/server/internal/static-export');
    const serverInternalBuildModule = (await server.ssrLoadModule(
      viteSsrModuleId(requireFromApp.resolve('@kovojs/server/internal/build'), root),
    )) as typeof import('@kovojs/server/internal/build');
    const compilerClientModuleBuildInstaller =
      serverInternalBuildModule.claimCompilerClientModuleBuildInstaller(
        compilerViteClientModuleRoleProtocol,
      );
    compilerClientModuleBuildInstaller.seal();
    const appModule = await serverInternalBuildModule.runWithGeneratedLiveTargetRegistry(() =>
      server.ssrLoadModule(resolvedAppModulePath),
    );
    return {
      appModule,
      close: () => lifetime.close(),
      exportStaticApp: exportStaticAppFromModule(serverModule),
      isStaticExportDiagnostic: serverModule.isStaticExportDiagnostic,
      isStaticExportDiagnosticError: serverModule.isStaticExportDiagnosticError,
      resolveKovoAppToken: serverInternalBuildModule.resolveKovoAppToken,
      staticExportCompileDiagnosticsFromModule:
        serverModule.staticExportCompileDiagnosticsFromModule,
    };
  } catch (error) {
    await closeBuildTimeViteLifetime(lifetime, true, error);
    throw error;
  }
}

function exportStaticAppFromModule(moduleValue: unknown): ExportStaticApp {
  if (isRecord(moduleValue) && typeof moduleValue.exportStaticApp === 'function') {
    return moduleValue.exportStaticApp as ExportStaticApp;
  }
  throw new Error('@kovojs/server must export exportStaticApp for kovo export.');
}

interface ExportManifestPlan {
  assets: readonly {
    path: string;
    source: string;
  }[];
  cleanup?: () => void;
  publicAssetRoot?: string;
  stylesheetHref?: string;
}

const exportPublicSnapshotMaxFiles = 10_000;
const exportPublicSnapshotMaxBytes = 512 * 1024 * 1024;
const exportPublicSnapshotMaxDepth = 64;

function buildTimeViteServerOptions(): { hmr: false } {
  return { hmr: false };
}

async function createBuildTimeViteRunnable(
  config: InlineConfig,
): Promise<BuildTimeViteRunnableLifetime> {
  const resolvedConfig = await resolveViteConfig(config, 'serve');
  const environment = createRunnableDevEnvironment('ssr', resolvedConfig, {
    hot: false,
    runnerOptions: { hmr: false, sourcemapInterceptor: false },
  });
  try {
    await environment.init();
    // Capture the one SSR graph before framework-profile/config/app evaluation. This deliberately
    // omits Vite's client graph, HTTP/websocket server, watcher, public-file census, and dependency
    // optimizer while preserving the exact plugin pipeline and one shared module identity realm.
    // SPEC §5.2/§6.6 rule 6: authored code cannot replace the controls used for import or teardown.
    return captureBuildTimeViteRunnableLifetime(environment);
  } catch (error) {
    try {
      await environment.close();
    } catch (teardownError) {
      throw combineBuildTimeViteFailures(error, teardownError);
    }
    throw error;
  }
}

async function closeBuildTimeViteLifetime(
  lifetime: Pick<BuildTimeViteRunnableLifetime, 'close'>,
  hasPrimaryError: boolean,
  primaryError: unknown,
): Promise<void> {
  try {
    await lifetime.close();
  } catch (teardownError) {
    if (hasPrimaryError) {
      throw combineBuildTimeViteFailures(primaryError, teardownError);
    }
    throw teardownError;
  }
}

async function staticExportManifestPlan(options: KovoExportOptions): Promise<ExportManifestPlan> {
  const manifestFile =
    options.manifestFile === undefined ? undefined : resolve(options.manifestFile);
  const sourceDir =
    manifestFile === undefined
      ? staticExportDefaultPublicAssetRoot(options)
      : resolve(options.distDir ?? dirname(manifestFile));
  let manifest: Record<string, ExportManifestChunk> | undefined;
  if (manifestFile !== undefined) {
    const manifestRead = readJsonRecord(manifestFile);
    if (!manifestRead.ok) {
      throw new Error(
        `Unable to read export manifest JSON ${manifestFile}: ${manifestRead.error.kind}`,
      );
    }
    manifest = exportManifestFromUnknown(manifestRead.value);
  }
  const assets = new Map<string, { path: string; source: string }>();
  const sourceRoot = createFrameworkOutputFileSystemBoundary(sourceDir);
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'kovo-export-assets-'));
  const publicAssetRoot = join(snapshotRoot, 'public');
  const snapshotOutput = createFrameworkOutputFileSystemBoundary(publicAssetRoot);
  const excludedRelativeRoots =
    manifestFile === undefined ? defaultExportSnapshotExcludedRoots(sourceDir, options.outDir) : [];
  let stylesheetHref: string | undefined;
  let stylesheetCount = 0;
  try {
    if (manifestFile !== undefined) await sourceRoot.ensureDirectory();
    await snapshotExportPublicAssetRoot(
      sourceRoot,
      snapshotOutput,
      manifestFile === undefined ? 'skip' : 'reject',
      excludedRelativeRoots,
    );
    for (const chunk of manifest === undefined ? [] : Object.values(manifest)) {
      const fileAsset = await addExportManifestAsset(
        assets,
        chunk.file,
        snapshotOutput,
        options.assetBase,
      );
      if (fileAsset && chunk.file?.replace(/[?#].*$/, '').endsWith('.css')) {
        stylesheetHref = fileAsset.path;
        stylesheetCount += 1;
      }
      for (const stylesheet of chunk.css ?? []) {
        const asset = await addExportManifestAsset(
          assets,
          stylesheet,
          snapshotOutput,
          options.assetBase,
        );
        if (asset) {
          stylesheetHref = asset.path;
          stylesheetCount += 1;
        }
      }
    }

    return {
      assets: [...assets.values()],
      cleanup: () => rmSync(snapshotRoot, { force: true, recursive: true }),
      publicAssetRoot,
      ...(stylesheetHref === undefined ? {} : { stylesheetHref }),
    };
  } catch (error) {
    rmSync(snapshotRoot, { force: true, recursive: true });
    throw error;
  }
}

async function snapshotExportPublicAssetRoot(
  source: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  output: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  nonRegular: 'reject' | 'skip',
  excludedRelativeRoots: readonly string[],
): Promise<void> {
  await output.ensureDirectory();
  const budget = { bytes: 0, files: 0 };
  await snapshotExportPublicAssetEntries(
    source,
    output,
    await source.entries('.'),
    budget,
    0,
    nonRegular,
    excludedRelativeRoots,
  );
}

async function snapshotExportPublicAssetEntries(
  source: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  output: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  rawEntries: Awaited<ReturnType<typeof source.entries>>,
  budget: { bytes: number; files: number },
  depth: number,
  nonRegular: 'reject' | 'skip',
  excludedRelativeRoots: readonly string[],
): Promise<void> {
  if (depth > exportPublicSnapshotMaxDepth) {
    throw new Error(
      `kovo export --dist exceeds the public asset depth limit (${exportPublicSnapshotMaxDepth}).`,
    );
  }
  const entries = buildSnapshotDenseArray(rawEntries, 'Export public asset entries');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (exportSnapshotPathIsExcluded(entry.relativePath, excludedRelativeRoots)) continue;
    if (entry.kind === 'directory') {
      await snapshotExportPublicAssetEntries(
        source,
        output,
        await source.entriesOf(entry),
        budget,
        depth + 1,
        nonRegular,
        excludedRelativeRoots,
      );
      continue;
    }
    if (entry.kind !== 'file') {
      if (nonRegular === 'skip') continue;
      throw new Error(
        `kovo export --dist contains a non-regular public asset: ${entry.relativePath}`,
      );
    }
    budget.files += 1;
    if (budget.files > exportPublicSnapshotMaxFiles) {
      throw new Error(
        `kovo export --dist exceeds the public asset file limit (${exportPublicSnapshotMaxFiles}).`,
      );
    }
    const bytes = await source.fileBytesOf(entry);
    budget.bytes += buildByteLength(bytes);
    if (budget.bytes > exportPublicSnapshotMaxBytes) {
      throw new Error(
        `kovo export --dist exceeds the public asset byte limit (${exportPublicSnapshotMaxBytes}).`,
      );
    }
    await output.writeFile(entry.relativePath, bytes);
  }
}

function defaultExportSnapshotExcludedRoots(sourceDir: string, outDir: string): readonly string[] {
  const excluded = ['node_modules', '.git', '.kovo', '.vite', '.env'];
  const relativeOutDir = relative(sourceDir, resolve(outDir));
  if (relativeOutDir === '') {
    throw new Error('kovo export --out must not equal the default public asset root.');
  }
  if (
    !isAbsolute(relativeOutDir) &&
    relativeOutDir !== '..' &&
    !buildStringStartsWith(relativeOutDir, `..${pathSeparator}`)
  ) {
    buildSecurityArrayAppend(excluded, relativeOutDir, 'Default export public snapshot exclusions');
  }
  return excluded;
}

function exportSnapshotPathIsExcluded(
  relativePath: string,
  excludedRelativeRoots: readonly string[],
): boolean {
  const excluded = buildSnapshotDenseArray(
    excludedRelativeRoots,
    'Export public snapshot exclusions',
  );
  for (let index = 0; index < excluded.length; index += 1) {
    const root = excluded[index]!;
    if (
      relativePath === root ||
      buildStringStartsWith(relativePath, `${root}${pathSeparator}`) ||
      (root === '.env' && buildStringStartsWith(relativePath, '.env.'))
    ) {
      return true;
    }
  }
  return false;
}

function staticExportDefaultPublicAssetRoot(options: KovoExportOptions): string {
  return resolve(options.root ?? dirname(resolve(options.appModulePath)));
}

interface ExportManifestChunk {
  css?: readonly string[];
  file?: string;
}

function exportManifestFromUnknown(value: unknown): Record<string, ExportManifestChunk> {
  if (!isRecord(value)) throw new Error('kovo export --manifest must be a JSON object.');
  const manifest = buildCreateNullRecord<ExportManifestChunk>();
  const keys = buildObjectKeys(value);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex]!;
    const rawChunk = buildOwnDataValue(value, key, 'kovo export --manifest');
    if (!isRecord(rawChunk)) continue;
    const chunk = buildCreateNullRecord<unknown>() as ExportManifestChunk;
    const file = buildOwnDataValue(rawChunk, 'file', `kovo export manifest chunk ${key}`);
    if (typeof file === 'string') chunk.file = file;
    const rawCss = buildOwnDataValue(rawChunk, 'css', `kovo export manifest chunk ${key}`);
    if (buildArrayIsArray(rawCss)) {
      const cssSource = buildSnapshotDenseArray(rawCss, `kovo export manifest chunk ${key}.css`);
      const css: string[] = [];
      for (let cssIndex = 0; cssIndex < cssSource.length; cssIndex += 1) {
        const entry = cssSource[cssIndex];
        if (typeof entry === 'string') {
          buildSecurityArrayAppend(css, entry, 'kovo export manifest stylesheet list');
        }
      }
      chunk.css = css;
    }
    manifest[key] = chunk;
  }
  return manifest;
}

async function addExportManifestAsset(
  assets: Map<string, { path: string; source: string }>,
  file: string | undefined,
  sourceRoot: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  base: string | undefined,
): Promise<{ path: string; source: string } | undefined> {
  if (!file || /^[a-z][a-z0-9+.-]*:/i.test(file) || file.startsWith('//')) return undefined;
  const normalizedFile = normalizedExportManifestFile(file);
  if (assets.has(normalizedFile)) return assets.get(normalizedFile);
  const href = exportManifestAssetHref(normalizedFile, base);
  const bytes = await sourceRoot.fileBytes(normalizedFile);
  if (bytes === undefined) {
    throw new Error(`kovo export --manifest asset must be a regular file within --dist: ${file}`);
  }
  const source = sourceRoot.confinedPath(normalizedFile);
  if (source === undefined) {
    throw new Error(`kovo export --manifest asset must stay within --dist: ${file}`);
  }
  const asset = {
    path: new URL(href, 'https://kovo.local').pathname,
    source,
  };
  assets.set(normalizedFile, asset);
  return asset;
}

function normalizedExportManifestFile(file: string): string {
  const pathname = file.replace(/[?#].*$/, '').replace(/^\/+/, '');
  const segments = pathname.split('/');
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === '' || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment),
    )
  ) {
    throw new Error(`kovo export --manifest asset must stay within --dist: ${file}`);
  }
  return segments.join('/');
}

function exportManifestAssetHref(file: string, base: string | undefined): string {
  const normalizedBase = base === undefined ? '/' : `/${base.replace(/^\/+|\/+$/g, '')}/`;
  return `${normalizedBase}${file}`;
}

function appFromModule(
  module: unknown,
  source: string,
  resolveToken: typeof import('@kovojs/server/internal/build').resolveKovoAppToken,
): KovoApp {
  if (typeof module === 'object' && module !== null) {
    const exports = module as { app?: unknown; default?: unknown };
    const app = exports.default ?? exports.app;
    if (isKovoApp(app)) return app;
    try {
      return resolveToken(app, `${source} app export`);
    } catch {
      // Fall through to the stable configuration diagnostic.
    }
  }

  throw new KovoCommandConfigurationError(
    `kovo expected ${source} to export the opaque Kovo app returned by app.assemble() ` +
      `as default or named 'app'.`,
  );
}

function isKovoApp(value: unknown): value is KovoApp {
  return (
    typeof value === 'object' &&
    value !== null &&
    buildArrayIsArray((value as { routes?: unknown }).routes) &&
    buildArrayIsArray((value as { endpoints?: unknown }).endpoints) &&
    buildArrayIsArray((value as { mutations?: unknown }).mutations) &&
    buildArrayIsArray((value as { queries?: unknown }).queries) &&
    typeof (value as { clientModules?: { resolve?: unknown } }).clientModules?.resolve ===
      'function'
  );
}

/**
 * Cross the bundled SSR realm only through an origin-registry check and a receiving-registry
 * reconstruction. Private WeakSet provenance is deliberately realm-local; structural copying or a
 * shared symbol would turn app-authored lookalikes into framework diagnostics (SPEC §2/§11).
 */
function transferStaticExportResult(
  result: StaticExportResult,
  originIsRegistered: LoadedExportAppModule['isStaticExportDiagnostic'],
): StaticExportResult {
  return {
    ...result,
    diagnostics: transferStaticExportDiagnostics(result.diagnostics, originIsRegistered),
  };
}

function transferStaticExportDiagnosticError(
  error: unknown,
  origin: Pick<LoadedExportAppModule, 'isStaticExportDiagnostic' | 'isStaticExportDiagnosticError'>,
): StaticExportResult['diagnostics'] | undefined {
  if (!origin.isStaticExportDiagnosticError(error)) return undefined;
  const diagnostics = buildOwnDataProperty(
    error as object,
    'diagnostics',
    'Static-export cross-realm error diagnostics',
  );
  if (!diagnostics.present || !buildArrayIsArray(diagnostics.value)) {
    throw new TypeError('Static-export cross-realm diagnostic error has no dense diagnostics.');
  }
  return transferStaticExportDiagnostics(diagnostics.value, origin.isStaticExportDiagnostic);
}

function transferStaticExportDiagnostics(
  diagnostics: readonly unknown[],
  originIsRegistered: LoadedExportAppModule['isStaticExportDiagnostic'],
): StaticExportResult['diagnostics'] {
  const source = buildSnapshotDenseArray(diagnostics, 'Static-export cross-realm diagnostics');
  const transferred: StaticExportResult['diagnostics'][number][] = [];
  for (let index = 0; index < source.length; index += 1) {
    const diagnostic = source[index];
    if (!originIsRegistered(diagnostic)) {
      throw new TypeError(
        `Static-export cross-realm diagnostics[${index}] lacks originating registry provenance.`,
      );
    }
    const label = `Static-export cross-realm diagnostics[${index}]`;
    const code = buildOwnDataProperty(diagnostic as object, 'code', `${label}.code`);
    const concretePath = buildOwnDataProperty(
      diagnostic as object,
      'concretePath',
      `${label}.concretePath`,
    );
    const message = buildOwnDataProperty(diagnostic as object, 'message', `${label}.message`);
    const routePath = buildOwnDataProperty(diagnostic as object, 'routePath', `${label}.routePath`);
    const concretePathValue = concretePath.present ? concretePath.value : undefined;
    if (
      !code.present ||
      !isDiagnosticCode(code.value) ||
      !message.present ||
      typeof message.value !== 'string' ||
      !routePath.present ||
      typeof routePath.value !== 'string' ||
      (concretePath.present && typeof concretePathValue !== 'string')
    ) {
      throw new TypeError(`${label} has an invalid registered wire shape.`);
    }
    buildSecurityArrayAppend(
      transferred,
      rehydrateStaticExportDiagnostic(
        code.value,
        {
          ...(typeof concretePathValue === 'string' ? { concretePath: concretePathValue } : {}),
          routePath: routePath.value,
        },
        { message: message.value },
      ),
      'CLI packages/cli/src/commands/build-export.ts cross-realm diagnostic transfer',
    );
  }
  return transferred;
}

function rehydrateStaticExportDiagnostic(
  code: DiagnosticCode,
  fields: { concretePath?: string; routePath: string },
  options: { message: string },
): StaticExportResult['diagnostics'][number] {
  return createRegisteredDiagnostic(code, fields, options);
}

function kovoExportResult(
  result: StaticExportResult,
  options: KovoExportOptions,
): KovoExportCommandResult {
  const lines = [requireKovoCommandResultProtocol('export')];
  const diagnostics = registeredStaticExportResultDiagnostics(result.diagnostics);

  for (const artifact of result.artifacts) {
    lines.push(
      `HTML ${artifact.path} status=${artifact.status} bytes=${buildByteLength(artifact.body)}`,
    );
  }

  for (const artifact of result.clientModules) {
    lines.push(
      `CLIENT-MODULE ${artifact.path} href=${stringifyBuildValue(artifact.href)} status=${artifact.status} bytes=${buildByteLength(artifact.body)}`,
    );
  }

  for (const artifact of result.assets) {
    lines.push(
      `ASSET ${artifact.path} status=${artifact.status} bytes=${buildByteLength(readFileSync(artifact.source))}`,
    );
  }

  for (const diagnostic of diagnostics) {
    lines.push(
      `WARN ${diagnostic.code} route=${diagnostic.routePath} ${stableText(diagnostic.message)}`,
    );
  }

  lines.push(
    `SUMMARY html=${result.artifacts.length} clientModules=${result.clientModules.length} assets=${result.assets.length} diagnostics=${diagnostics.length} outDir=${stringifyBuildValue(options.outDir)}`,
  );

  return {
    exitCode: exportResultExitCode(diagnostics, options),
    output: `${lines.join('\n')}\n`,
    staticExport: result,
  };
}

function registeredStaticExportResultDiagnostics(
  diagnostics: StaticExportResult['diagnostics'],
): StaticExportResult['diagnostics'][number][] {
  const snapshot = buildSnapshotDenseArray(diagnostics, 'Static-export result diagnostics');
  for (let index = 0; index < snapshot.length; index += 1) {
    assertRegisteredDiagnostic(snapshot[index], `Static-export result diagnostics[${index}]`);
  }
  return snapshot;
}

function exportResultExitCode(
  diagnostics: StaticExportResult['diagnostics'],
  options: KovoExportOptions,
): 0 | 1 {
  if (diagnostics.length === 0) return 0;
  if (
    options.onNonExportable === 'skip' &&
    buildEveryDense(
      diagnostics,
      'Static-export non-exportable diagnostics',
      (diagnostic) => diagnostic.code === 'KV229',
    )
  ) {
    return 0;
  }
  return 1;
}

function kovoBuildResult(options: {
  appModulePath: string;
  neutralOutDir: string;
  outDir: string;
  preset: KovoBuildPresetName;
  presetDiagnostics: readonly KovoBuildPresetDiagnostic[];
  presetLogs: readonly string[];
  serverOutDir: string;
}): KovoCheckResult {
  const lines = [
    buildOutputVersion,
    `APP module=${stringifyBuildValue(options.appModulePath)}`,
    `NEUTRAL outDir=${stringifyBuildValue(options.neutralOutDir)}`,
  ];
  const diagnosticLines = buildMapDense(
    options.presetDiagnostics,
    'Build result preset diagnostics',
    presetDiagnosticOutputLine,
  );
  const presetLogLines = buildMapDense(
    options.presetLogs,
    'Build result preset logs',
    (message) => `PRESET ${stableText(message)}`,
  );
  for (let index = 0; index < diagnosticLines.length; index += 1) {
    buildSecurityArrayAppend(
      lines,
      diagnosticLines[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  for (let index = 0; index < presetLogLines.length; index += 1) {
    buildSecurityArrayAppend(
      lines,
      presetLogLines[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  buildSecurityArrayAppend(
    lines,
    `SUMMARY preset=${options.preset} outDir=${stringifyBuildValue(options.outDir)} serverOutDir=${stringifyBuildValue(options.serverOutDir)}`,
    'CLI packages/cli/src/commands/build-export.ts collection',
  );

  return { exitCode: 0, output: `${buildJoinStrings(lines, '\n', 'Build result lines')}\n` };
}

function kovoBuildCheckResult(options: {
  appModulePath: string;
  neutralOutDir: string;
  preset: KovoBuildPresetName;
  presetDiagnostics: readonly KovoBuildPresetDiagnostic[];
  presetLogs: readonly string[];
}): KovoCheckResult {
  const lines = [
    buildOutputVersion,
    `APP module=${stringifyBuildValue(options.appModulePath)}`,
    `NEUTRAL outDir=${stringifyBuildValue(options.neutralOutDir)}`,
  ];
  const diagnosticLines = buildMapDense(
    options.presetDiagnostics,
    'Build-check result preset diagnostics',
    presetDiagnosticOutputLine,
  );
  const presetLogLines = buildMapDense(
    options.presetLogs,
    'Build-check result preset logs',
    (message) => `PRESET ${stableText(message)}`,
  );
  for (let index = 0; index < diagnosticLines.length; index += 1) {
    buildSecurityArrayAppend(
      lines,
      diagnosticLines[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  for (let index = 0; index < presetLogLines.length; index += 1) {
    buildSecurityArrayAppend(
      lines,
      presetLogLines[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  buildSecurityArrayAppend(
    lines,
    `CHECK ok preset=${options.preset} (validate-only; deployable output not emitted)`,
    'CLI packages/cli/src/commands/build-export.ts collection',
  );

  return {
    exitCode: 0,
    output: `${buildJoinStrings(lines, '\n', 'Build-check result lines')}\n`,
  };
}

class KovoBuildPresetDiagnosticError extends Error {
  readonly diagnostics: readonly KovoBuildPresetDiagnostic[];

  constructor(diagnostics: readonly KovoBuildPresetDiagnostic[]) {
    super(
      buildJoinStrings(
        appendDense(
          ['kovo build preset inspection failed:'],
          buildMapDense(diagnostics, 'Build preset error diagnostics', presetDiagnosticOutputLine),
          'Build preset error lines',
        ),
        '\n',
        'Build preset error lines',
      ),
    );
    this.diagnostics = diagnostics;
  }
}

class KovoBuildCheckDiagnosticError extends Error {
  readonly diagnostics: readonly KovoDiagnosticRecord[] | undefined;

  constructor(message: string, diagnostics: readonly KovoDiagnosticRecord[] | undefined) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

function presetDiagnosticOutputLine(diagnostic: KovoBuildPresetDiagnostic): string {
  const label = diagnostic.severity === 'warning' ? 'WARN' : 'ERROR';
  return `${label} ${diagnostic.code} ${stableText(diagnostic.message)}`;
}

function stringifyBuildValue(value: unknown, space?: number): string {
  const serialized = buildJsonStringify(value, space);
  if (serialized === undefined) throw new TypeError('Kovo build value is not JSON serializable.');
  return serialized;
}

function buildErrorResult(error: unknown): CliCommandResult {
  const result: CliCommandResult = {
    error: `${buildOutputVersion}\nERROR ${error instanceof Error ? error.message : String(error)}`,
    exitCode: error instanceof KovoCommandConfigurationError ? 2 : 1,
  };
  if (error instanceof KovoBuildCheckDiagnosticError && error.diagnostics !== undefined) {
    Object.defineProperty(result, 'diagnostics', {
      configurable: false,
      enumerable: false,
      value: error.diagnostics,
      writable: false,
    });
  }
  return result;
}

function sourceCheckErrorResult(error: unknown): CliCommandResult {
  const result: CliCommandResult = {
    error: `${requireKovoCommandResultProtocol('check')}\nERROR ${
      error instanceof Error ? error.message : String(error)
    }`,
    exitCode: error instanceof KovoCommandConfigurationError ? 2 : 1,
  };
  if (error instanceof KovoBuildCheckDiagnosticError && error.diagnostics !== undefined) {
    Object.defineProperty(result, 'diagnostics', {
      configurable: false,
      enumerable: false,
      value: error.diagnostics,
      writable: false,
    });
  }
  return result;
}

function exportErrorResult(
  error: unknown,
  transferredDiagnostics?: StaticExportResult['diagnostics'],
): CliCommandResult {
  if (transferredDiagnostics !== undefined) {
    const diagnosticLines = buildMapDense(
      transferredDiagnostics,
      'Static-export error diagnostics',
      (diagnostic) =>
        `ERROR ${diagnostic.code} route=${diagnostic.routePath} ${stableText(diagnostic.message)}`,
    );
    return {
      error: buildJoinStrings(
        appendDense(
          [requireKovoCommandResultProtocol('export')],
          diagnosticLines,
          'Static-export error lines',
        ),
        '\n',
        'Static-export error lines',
      ),
      exitCode: 1,
    };
  }

  return {
    error: `kovo: export failed: ${error instanceof Error ? error.message : String(error)}`,
    exitCode: error instanceof KovoCommandConfigurationError ? 2 : 1,
  };
}
