/* oxlint-disable typescript/unbound-method -- Buffer.from is a static intrinsic and does not use this. */
import { execFile as builtinExecFile } from 'node:child_process';
import { Buffer as builtinBuffer } from 'node:buffer';
import { hash as builtinHash } from 'node:crypto';
import {
  existsSync as builtinExistsSync,
  lstatSync as builtinLstatSync,
  mkdtempSync as builtinMkdtempSync,
  readFileSync as builtinReadFileSync,
  readdirSync as builtinReaddirSync,
  realpathSync as builtinRealpathSync,
  rmSync as builtinRmSync,
  statSync as builtinStatSync,
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
import {
  fileURLToPath as builtinFileURLToPath,
  pathToFileURL as builtinPathToFileURL,
} from 'node:url';
import { promisify as builtinPromisify } from 'node:util';

import type { DiagnosticCode } from '@kovojs/core';
import {
  assertRegisteredDiagnostic,
  createRegisteredDiagnostic,
  isDiagnosticCode,
} from '@kovojs/core/internal/diagnostics';
import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';
import { canonicalJsonStringify } from '@kovojs/core/internal/json';
import { ESCAPE_CENSUS_DOORS } from '@kovojs/core/internal/graph';
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
  componentTaskBSourceOperationFacts,
  compilerGeneratedCapabilityDependencies,
  createFrameworkKovoCssCollectorVitePlugin,
  cssRouteDeliveryGate,
  dedupeCss,
  deriveRegistryIdentity,
  lowerStandaloneSourceDerivedRegistryDeclarations,
  mutationHandlerFingerprintFromRuntimeSource,
  mutationSessionAuthorityFacts,
  parseComponentModule,
  projectMutationRegistryFactsFromFiles,
  type AppDependencyCapabilityManifest,
  type CompilerGeneratedCapabilityDependency,
  type ProjectMutationRegistryFacts,
  type QueryShapeFact,
  type AnalyzeCapabilityClosureResult,
  viteFrameworkIdentityFiles,
} from '@kovojs/compiler/internal';
import { createCompilerSourceFileSystem } from '@kovojs/compiler/internal/source-filesystem';
import { extractAppRouteCssTargets } from '@kovojs/compiler/package-styles';
import {
  collectStaticBuildTrustFactsFromProject,
  snapshotCompilerTaskBFiniteVerdict,
  type CompilerSecuritySemanticSource,
  type CompilerTaskBFiniteVerdict,
} from '@kovojs/drizzle/internal/static';
import type {
  AccessDecision,
  AppEgressOptions,
  Guard,
  KovoApp,
  StaticExportCompileDiagnostic,
  StaticExportResult,
  StylesheetAsset,
} from '@kovojs/server';
import type { KovoNeutralBuild } from '@kovojs/server/internal/build';
import type {
  KovoBuildPreset,
  KovoBuildPresetContext,
  KovoBuildPresetDiagnostic,
} from '@kovojs/server/internal/build-preset';
import { type EscapeObligationReviewSubject } from '@kovojs/server/internal/execution';
import { withKovoBuildContext } from '@kovojs/server/internal/build-context';
import { assertDocumentCspConfigMatchesBrowserPosture } from '@kovojs/server/internal/csp';
import type { KovoAppShellCompiledClientModule } from '@kovojs/server/internal/app-shell-vite';
import {
  buildCheckSourceGraphFiles,
  buildCompilerQueryShapeFacts,
  collectRuntimeRegistryFacts,
  dataPlaneSourceFiles,
  type DataPlaneSourceFile as BuildCheckSourceFile,
  type QueryReadFactLike,
  staticDataPlaneBuildFacts,
  type StaticDataPlaneBuildFacts,
} from '@kovojs/server/internal/data-plane-static-analysis';
import {
  runtimePostureFactsFromGraph,
  runtimeRegistryWireFactsFromGraph,
  type RuntimeRegistryWireFacts,
} from '@kovojs/server/internal/runtime-registry-wire';
import { build as viteBuild, createServer as createViteServer, type Plugin } from 'vite-plus';

import {
  BUILD_ARGV_SPEC,
  BUILD_USAGE,
  commandArgvError,
  EXPORT_ARGV_SPEC,
  EXPORT_USAGE,
  parsedBooleanOption,
  parsedStringOption,
  parseCommandArgv,
  requireSinglePositional,
} from '../commands-manifest.js';
import { kovoCheck } from '../graph-output.js';
import { kovoInvocationEnvironmentValue } from '../invocation-environment.js';
import { kovoCertificatePolicyV1Json, kovoCertificateV1Json } from '../certificate.js';
import { escapeCensusReviewManifestForBuild } from '../escape-census-review-subjects.js';
import {
  readCapabilityPackageSummaries,
  resolveCapabilityPackages,
} from '../capability-closure-packages.js';
import { dependencyCapabilityLoaderVitePlugin } from '../dependency-capability-loader.js';
import {
  buildOutputVersion,
  type CliCommandResult,
  type KovoCheckResult,
  stableText,
  stableValue,
} from '../shared.js';
import { resolveKovoArtifactProvenance } from '../artifact-provenance.js';
import { findNearestFile, readJsonRecord } from '../tooling.js';
import {
  kovoCommandBootSecurityDisposition,
  type KovoCommandSecurityDisposition,
} from './security-disposition.js';
import {
  captureBuildTimeViteServerLifetime,
  combineBuildTimeViteFailures,
  type BuildTimeViteServerLifetime,
} from './build-vite-lifetime.js';
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
  buildObservePromise,
  buildOwnDataProperty,
  buildOwnDataValue,
  buildPromiseAll,
  buildRegExpExec,
  buildRegExpReplace,
  buildSetAdd,
  buildSetHas,
  buildSnapshotDenseArray,
  buildStringIncludes,
  buildStringSplit,
  buildStringStartsWith,
  buildStringTrim,
  buildStringTrimEnd,
} from './build-security-intrinsics.js';

const execFile = builtinExecFile;
const bufferFrom = builtinBuffer.from;
const hash = builtinHash;
const existsSync = builtinExistsSync;
const lstatSync = builtinLstatSync;
const mkdtempSync = builtinMkdtempSync;
const readFile = builtinReadFile;
const readFileSync = builtinReadFileSync;
const readdirSync = builtinReaddirSync;
const realpathSync = builtinRealpathSync;
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

const requireFromCli = createRequire(new URL('../index.ts', import.meta.url));

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

// Resolve the framework graph while this bootstrap-first module is initializing. App evaluation
// must not be able to rewrite package manifests and widen the later production-build exemption
// (SPEC §5.2/§6.6).
const trustedKovoFrameworkSourceRoots = resolveKovoFrameworkSourceRoots(
  fileURLToPath(new URL('../index.ts', import.meta.url)),
  requireFromCli,
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
buildSetAdd(
  trustedKovoDirectFrameworkEntrySources,
  realpathSync(requireFromCli.resolve('@kovojs/server/jsx-runtime')),
);

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
  // These modules' top-level work only prepares their exported runtime primitives. Let Rollup
  // remove them when an app does not use those primitives, so an unused native Argon2 sink is not
  // loaded by Cloudflare/non-password handlers merely because the server barrel re-exports it.
  // The Node SQL parser bootstrap is retained through explicit readiness calls in the SQLite and
  // Postgres constructors; only a bundle that drops those constructors may drop node:fs/node:vm.
  return /(?:^|[/\\])packages[/\\]server[/\\]src[/\\](?:managed-db-public|password|postgres-runtime|sqlite-runtime|sql-parser-authority|sql-parser-authority-bootstrap)\.ts$/.test(
    id,
  );
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
type ExportStaticApp = (typeof import('@kovojs/server'))['exportStaticApp'];

interface KovoBuildOptions {
  appModulePath: string;
  cache: boolean;
  check: boolean;
  outDir: string;
  preset?: KovoBuildPresetName;
}

interface LoadedBuildAppModule {
  appModule: unknown;
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
}

export interface KovoExportCommandResult extends KovoCheckResult {
  staticExport: StaticExportResult;
}

type BuildArgParseResult = { ok: true; options: KovoBuildOptions } | { message: string; ok: false };

interface LoadedKovoBuildConfig {
  path?: string;
  preset?: KovoBuildPreset;
}

interface SelectedKovoBuildPreset {
  name: KovoBuildPresetName;
  preset?: KovoBuildPreset;
}

export function parseBuildArgs(args: readonly string[]): BuildArgParseResult {
  const parsed = parseCommandArgv(args, BUILD_ARGV_SPEC);
  if (!parsed.ok) return buildArgvError(parsed);

  const appModule = requireSinglePositional(parsed.value, {
    label: 'app module path',
    name: 'build',
    usage: buildUsage(),
  });
  if (!appModule.ok) return appModule;

  const presetValue = parsedStringOption(parsed.value, '--preset');
  const preset = presetValue === undefined ? undefined : parseKovoBuildPresetName(presetValue);
  if (presetValue !== undefined && preset === undefined) {
    return { message: `kovo: unsupported build preset ${stableValue(presetValue)}.\n`, ok: false };
  }

  return {
    ok: true,
    options: {
      appModulePath: appModule.value,
      cache: !parsedBooleanOption(parsed.value, '--no-cache'),
      check: parsedBooleanOption(parsed.value, '--check'),
      outDir: parsedStringOption(parsed.value, '--out') ?? 'dist',
      ...(preset === undefined ? {} : { preset }),
    },
  };
}

function buildArgvError(error: Exclude<ReturnType<typeof parseCommandArgv>, { ok: true }>): {
  message: string;
  ok: false;
} {
  return commandArgvError('build', error, buildUsage());
}

function parseKovoBuildPresetName(value: string): KovoBuildPresetName | undefined {
  return value === 'node' || value === 'vercel' || value === 'cloudflare' ? value : undefined;
}

function buildUsage(): string {
  return buildJoinStrings([BUILD_USAGE, ''], '\n', 'Build usage lines');
}

export function parseExportArgs(args: readonly string[]): ExportArgParseResult {
  const parsed = parseCommandArgv(args, EXPORT_ARGV_SPEC);
  if (!parsed.ok) return exportArgvError(parsed);

  const appModule = requireSinglePositional(parsed.value, {
    label: 'app module path',
    name: 'export',
    usage: exportUsage(),
  });
  if (!appModule.ok) return appModule;

  const assetBase = parsedStringOption(parsed.value, '--asset-base');
  const distDir = parsedStringOption(parsed.value, '--dist');
  const manifestFile = parsedStringOption(parsed.value, '--manifest');
  const origin = parsedStringOption(parsed.value, '--origin');
  const root = parsedStringOption(parsed.value, '--root');
  const vite = parsedBooleanOption(parsed.value, '--vite');
  const onNonExportable = parsedBooleanOption(parsed.value, '--skip-non-exportable')
    ? ('skip' as const)
    : undefined;

  return {
    ok: true,
    options: {
      appModulePath: appModule.value,
      ...(assetBase === undefined ? {} : { assetBase }),
      ...(distDir === undefined ? {} : { distDir }),
      ...(manifestFile === undefined ? {} : { manifestFile }),
      ...(onNonExportable === undefined ? {} : { onNonExportable }),
      ...(origin === undefined ? {} : { origin }),
      outDir: parsedStringOption(parsed.value, '--out') ?? 'dist',
      ...(root === undefined ? {} : { root }),
      ...(vite ? { vite } : {}),
    },
  };
}

function exportArgvError(error: Exclude<ReturnType<typeof parseCommandArgv>, { ok: true }>): {
  message: string;
  ok: false;
} {
  return commandArgvError('export', error, exportUsage());
}

function exportUsage(): string {
  return buildJoinStrings([EXPORT_USAGE, ''], '\n', 'Export usage lines');
}

export async function runBuildCommand(
  options: KovoBuildOptions,
  security: KovoCommandSecurityDisposition = kovoCommandBootSecurityDisposition,
): Promise<CliCommandResult> {
  try {
    options = snapshotKovoBuildOptions(options);
    const invocationRoot = security.invocationCwd;
    const resolvedAppModulePath = resolve(invocationRoot, options.appModulePath);
    // SPEC §5.2.3: capture path-free artifact identity inputs before config or app evaluation.
    // The resulting stamp identifies the exact lock bytes, shipped guarantee register, graph
    // schema, and resolved Kovo package versions that were in force for this build.
    const artifactProvenance = resolveKovoArtifactProvenance({
      appModulePath: resolvedAppModulePath,
    });
    // SPEC §6.6 rule 6: classify app-authored authority before config, plugins, or app evaluation
    // can mutate shared-realm prototypes. Runtime handler identity is joined after evaluation.
    const reachableSessionAuthorityFacts =
      await sessionAuthorityFactsFromEntry(resolvedAppModulePath);
    const configPath = findKovoBuildConfig(invocationRoot);
    const approvedConfig =
      configPath === undefined
        ? undefined
        : runPreEvaluationBuildConfigTrustPreflight(
            configPath,
            invocationRoot,
            security.paranoidStaticAdvisory,
          );
    const loadedConfig = await loadKovoBuildConfig(
      invocationRoot,
      resolvedAppModulePath,
      approvedConfig,
    );
    const selectedPreset = selectedKovoBuildPreset(
      options,
      loadedConfig.preset,
      security.invocationEnv,
    );
    // plans/fast-kovo-check3.md: start the independent `tsc --noEmit` preflight subprocess here and
    // let it overlap the vite app load below AND the kovo-check security preflight, instead of
    // running it sequentially first (~1.7s cold / ~0.7s warm saved, no correctness change). The
    // no-op `.catch` prevents an unhandled rejection if the load/check throws before we reach the
    // fail-closed join below; we still `await typeScriptPreflight` there, so its error is never
    // swallowed and ZERO artifacts are emitted on any preflight failure.
    const typeScriptPreflight = runTypeScriptBuildPreflight(
      resolvedAppModulePath,
      invocationRoot,
      security.invocationEnv,
    );
    buildObservePromise(
      typeScriptPreflight,
      () => {},
      () => {},
    );
    // plans/fast-kovo-check2.md (#A dedup): the module/css loads below spin up throwaway vite dev
    // servers purely to evaluate app source so we can derive the build graph and collect CSS. The
    // app's `@kovojs/server` vite plugin would otherwise re-run the whole-project drizzle data-plane
    // analysis in each — the SAME analysis runKovoBuildCheckPreflight runs authoritatively just
    // below — costing ~9s of duplicate ts-morph work cold. Flag the entire (concurrent) load span so
    // the plugin skips it; the production client/server build passes run with the flag cleared, so
    // their fail-closed gate still fires.
    // plans/fast-kovo-check3.md: capture the ENTIRE load + appFromModule + kovo-check span (not just
    // the check) so the fail-closed join below can surface a tsc type error FIRST — exactly as the old
    // sequential order did — before re-throwing ANY of these failures (a load error, a not-a-KovoApp
    // export, or a security-gate failure). The tsc preflight started above runs concurrently with all
    // of it; deferring these errors past the `await typeScriptPreflight` preserves tsc-error-first.
    let loadAndCheck:
      | {
          ok: true;
          value: Awaited<ReturnType<typeof loadAndCheckBuildApp>>;
        }
      | { error: unknown; ok: false };
    try {
      loadAndCheck = {
        ok: true,
        value: await loadAndCheckBuildApp(
          resolvedAppModulePath,
          options,
          reachableSessionAuthorityFacts,
          security,
          invocationRoot,
        ),
      };
    } catch (error) {
      loadAndCheck = { error, ok: false };
    }
    // Fail-closed join BEFORE any artifact-emitting step: surface a tsc type error FIRST
    // (tsc-error-first ordering), then re-throw any captured load/check failure. Every
    // artifact-emitting step below (buildKovoClientManifest, writeKovoNeutralBuild, preset.emit,
    // writeKovoBuildGraphArtifact) stays strictly after this join, so any failure emits ZERO artifacts.
    await typeScriptPreflight;
    if (!loadAndCheck.ok) throw loadAndCheck.error;
    const {
      app,
      approvedClientEntry,
      approvedSourceFiles,
      buildStylesheetCss,
      checkGraph,
      cloudflare,
      dependencyCapabilities,
      deriveClosedKovoApp,
      node,
      queryShapeFacts,
      resolveKovoBuildPreset,
      vercel,
      writeKovoNeutralBuild,
    } = loadAndCheck.value;
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
    const runtimePosture = runtimePostureManifestForBuild(graphWithProvenance);
    const attestedCheckGraph: CoreGraph.KovoCheckInput = {
      ...graphWithProvenance,
      runtimePosture,
    };
    // Validate every trustedAssign review subject before any client/server artifact is emitted.
    const escapeObligationManifest = escapeObligationManifestForBuild(attestedCheckGraph);
    // Metric E signatures are a separate domain-separated subject family under the same anchor.
    const escapeCensusReviewManifest = escapeCensusReviewManifestForBuild(attestedCheckGraph);
    const outDir = resolve(invocationRoot, options.outDir);
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
    const staticRuntimeRegistry = await collectRuntimeRegistryFacts({
      appSourceDir: dirname(resolvedAppModulePath),
      root: invocationRoot,
    });
    if (app.document.csp !== undefined) {
      assertDocumentCspConfigMatchesBrowserPosture(
        app.document.csp,
        staticRuntimeRegistry.browserPosture,
      );
    }
    const clientBuild = await buildKovoClientManifest(
      join(outDir, '.kovo-client'),
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
    const serverHandlerBuild = await bundleKovoServerHandler(resolvedAppModulePath, {
      approvedSourceFiles,
      buildRoot: invocationRoot,
      dependencyCapabilities,
      projectMutationFacts: serverProjectMutationFacts,
      queryShapeFacts,
      runtimeTarget: selectedPreset.name,
      runtimeRegistry: {
        ...runtimeRegistryWireFactsFromGraph(attestedCheckGraph),
        ...(staticRuntimeRegistry.browserPosture === undefined
          ? {}
          : { browserPosture: staticRuntimeRegistry.browserPosture }),
        ...(staticRuntimeRegistry.tableSecurity === undefined
          ? {}
          : { tableSecurity: staticRuntimeRegistry.tableSecurity }),
      },
      stylesheetAssets: buildCssAssets,
    });
    const clientModules = uniqueKovoCompiledClientModules([
      ...clientBuild.clientModules,
      ...serverHandlerBuild.clientModules,
    ]);
    const neutralBuild = await writeKovoNeutralBuild({
      app: buildApp,
      buildStylesheetCss: [...buildStylesheetCss.stylesheetCss, ...clientBuild.stylesheetCss],
      clientModules,
      manifestFile: clientBuild.manifestFile,
      outDir: join(outDir, '.kovo'),
      serverHandlerSource: serverHandlerBuild.source,
      stylesheetSourceRoot: dirname(resolvedAppModulePath),
    });
    writeKovoBuildGraphArtifact(
      neutralBuild,
      attestedCheckGraph,
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
    const presetOutDir = buildPresetOutDir(outDir, selectedPreset.name);
    const presetLogs: string[] = [];
    const declaredEnv = inferredKovoBuildDeclaredEnv(serverHandlerBuild.source);
    const presetContext: KovoBuildPresetContext = {
      declaredEnv,
      log(message) {
        presetLogs.push(message);
      },
      outDir: presetOutDir,
      projectRoot: invocationRoot,
      readServerHandlerSource() {
        return serverHandlerBuild.source;
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
      // plans/fast-kovo-check2.md #6: validate-only. Every diagnostic-producing phase has
      // already run by this point — the tsc preflight, the kovo-check security gate
      // (which throws fail-closed on KV407/KV414/etc.), the client/server compiler transform
      // that raises KV235, and the preset inspection above. `--check` skips ONLY the
      // deployable `preset.emit`, so it is a strict subset of a full build and cannot pass
      // where a full build would fail.
      return kovoBuildCheckResult({
        appModulePath: resolvedAppModulePath,
        neutralOutDir: neutralBuild.outDir,
        preset: selectedPreset.name,
        presetDiagnostics,
        presetLogs,
      });
    }

    await preset.emit(neutralBuild, presetContext);

    return kovoBuildResult({
      appModulePath: resolvedAppModulePath,
      neutralOutDir: neutralBuild.outDir,
      outDir,
      preset: selectedPreset.name,
      presetDiagnostics,
      presetLogs,
      serverOutDir: presetOutDir,
    });
  } catch (error) {
    return buildErrorResult(error);
  }
}

async function loadAndCheckBuildApp(
  resolvedAppModulePath: string,
  options: KovoBuildOptions,
  reachableSessionAuthorityFacts: readonly CoreGraph.SessionAuthorityFact[],
  security: KovoCommandSecurityDisposition,
  invocationRoot: string,
) {
  const preEvaluationStaticTrust = runPreEvaluationStaticTrustPreflight(
    resolvedAppModulePath,
    invocationRoot,
    security.paranoidStaticAdvisory,
  );
  // SPEC §6.6 rule 6: the exact app-resolved SSR graph must finish its trust-root transition
  // before any other build lane is allowed to evaluate authored modules. In particular, do not
  // race CSS discovery against the server/compiler/data-plane preload.
  const loadedBuildApp = await withBuildGraphDerivationContext(() =>
    loadBuildAppModule(
      resolvedAppModulePath,
      invocationRoot,
      preEvaluationStaticTrust.approvedSourceFiles,
      preEvaluationStaticTrust.capabilityClosure.dependencyManifest,
    ),
  );
  const buildStylesheetCss = await withBuildGraphDerivationContext(() =>
    kovoBuildStylesheetCss(resolvedAppModulePath),
  );
  const { cloudflare, node, vercel } = loadedBuildApp.serverBuildModule;
  const { resolveKovoBuildPreset } = loadedBuildApp.serverBuildPresetModule;
  const execution = loadedBuildApp.serverExecutionModule;
  const { deriveClosedKovoApp, writeKovoNeutralBuild } = loadedBuildApp.serverInternalBuildModule;
  const appModule = loadedBuildApp.appModule;
  const app = appFromModule(appModule, options.appModulePath);
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
    dependencyCapabilities: preEvaluationStaticTrust.capabilityClosure.dependencyManifest,
    deriveClosedKovoApp,
    node,
    queryShapeFacts: buildCheck.queryShapeFacts,
    resolveKovoBuildPreset,
    vercel,
    writeKovoNeutralBuild,
  };
}

interface PreEvaluationStaticTrust {
  readonly approvedSourceFiles: readonly BuildCheckSourceFile[];
  readonly capabilityClosure: AnalyzeCapabilityClosureResult;
  readonly clientEntry?: BuildCheckSourceFile;
  readonly facts: ReturnType<typeof collectStaticBuildTrustFactsFromProject>;
  readonly files: readonly BuildCheckSourceFile[];
  readonly sourceGraphFacts: SourceGraphFacts;
}

interface PreEvaluationBuildConfigTrust {
  readonly facts: ReturnType<typeof collectStaticBuildTrustFactsFromProject>;
  readonly files: readonly BuildCheckSourceFile[];
  readonly path: string;
}

function runPreEvaluationBuildConfigTrustPreflight(
  configPath: string,
  root: string,
  paranoidStaticAdvisory: boolean,
): PreEvaluationBuildConfigTrust {
  // SPEC §6.6 rule 6: kovo.config is authored authority-bearing code. Snapshot its exact entry and
  // relative-import closure through the descriptor-bound source capability, classify both eager
  // module execution and deferred preset methods, and only then permit Vite to evaluate those same
  // bytes. Config discovery is intentionally performed once by the caller so an extension swap
  // cannot select a different file after approval.
  const configRoot = dirname(configPath);
  const files = buildMapDense(
    buildCheckSourceGraphFiles(configPath, root),
    'Project-root-relative pre-evaluation config sources',
    (file) => ({
      fileName: slashPath(relative(root, resolve(configRoot, file.fileName))),
      source: file.source,
    }),
  );
  const entryFileName = relative(root, configPath) || basename(configPath);
  const facts = collectStaticBuildTrustFactsFromProject({
    buildConfigEntryFileName: slashPath(entryFileName),
    files,
  });
  const { diagnostics, unregisteredSinks } = facts;
  if (diagnostics.length === 0 && unregisteredSinks.length === 0) {
    return { facts, files, path: configPath };
  }

  const result = kovoCheck(
    {
      ...(diagnostics.length === 0 ? {} : { diagnostics }),
      ...(unregisteredSinks.length === 0 ? {} : { unregisteredSinks }),
    },
    { paranoidStaticAdvisory },
  );
  if (result.exitCode === 0) return { facts, files, path: configPath };
  if (paranoidStaticAdvisory && paranoidBuildCheckMayProceed(result.output)) {
    return { facts, files, path: configPath };
  }
  throw new Error(`kovo build config preflight failed:\n${buildCheckFailureOutput(result.output)}`);
}

function runPreEvaluationStaticTrustPreflight(
  appModulePath: string,
  root: string,
  paranoidStaticAdvisory: boolean,
): PreEvaluationStaticTrust {
  // SPEC §5.2 rule 9 / §6.6: the pre-evaluation authority gate owns the selected app entry and
  // its exact relative-import closure, plus the conventional src/ client tree that the disabled-
  // config Vite build can transform. A project-root census would incorrectly promote unrelated
  // authored tooling such as vite.config.ts into app runtime authority.
  const files = preEvaluationAppSourceFiles(appModulePath, root);
  const approvedSourceFiles = preEvaluationApprovedBuildFiles(appModulePath, root, files);
  const clientEntry = preEvaluationClientEntryFile(appModulePath, root);
  // Parse and lower this exact snapshot before deriving the loader manifest. Private ABI rows are
  // admitted only when the reviewed compiler added their exact names; authored spellings remain
  // ordinary closed package edges (SPEC §5.2 rule 10 / §6.6).
  const sourceGraphFacts = sourceGraphFactsFromFiles(files);
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
  const compilerSecurityDiagnostics = buildMapDense(
    buildFilterDense(
      compilerDiagnostics,
      'Pre-evaluation compiler security diagnostics',
      (diagnostic) =>
        diagnostic.code === 'KV235' ||
        diagnostic.code === 'KV449' ||
        diagnostic.code === 'KV450' ||
        diagnostic.code === 'KV452',
    ),
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
      : collectStaticBuildTrustFactsFromProject({
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
  const accessGuardDiagnostics = buildMapDense(
    buildFilterDense(
      compilerDiagnostics,
      'Pre-evaluation compiler access/guard diagnostics',
      (diagnostic) => diagnostic.code === 'KV436',
    ),
    'Pre-evaluation compiler access/guard diagnostic facts',
    staticDiagnosticFact,
  );
  const capabilityClosureDiagnostics = buildMapDense(
    capabilityClosure.diagnostics,
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

  throw new Error(`kovo build check preflight failed:\n${buildCheckFailureOutput(result.output)}`);
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

function preEvaluationAppSourceFiles(appModulePath: string, root: string): BuildCheckSourceFile[] {
  const sourceRoot = dirname(appModulePath);
  const graphFiles = buildCheckSourceGraphFiles(appModulePath, root);
  const files = buildMapDense(
    graphFiles,
    'Project-root-relative pre-evaluation app sources',
    (file) => ({
      fileName: slashPath(relative(root, resolve(sourceRoot, file.fileName))),
      source: file.source,
    }),
  );
  const clientRoot = kovoClientBuildRoot(appModulePath, root);
  const clientFiles = dataPlaneSourceFiles(resolve(clientRoot, 'src'), root);
  for (let index = 0; index < clientFiles.length; index += 1) {
    const clientFile = clientFiles[index]!;
    const fileName = slashPath(relative(root, resolve(root, clientFile.fileName)));
    let existing: BuildCheckSourceFile | undefined;
    for (let candidateIndex = 0; candidateIndex < files.length; candidateIndex += 1) {
      if (files[candidateIndex]!.fileName === fileName) {
        existing = files[candidateIndex];
        break;
      }
    }
    if (existing !== undefined) {
      if (existing.source !== clientFile.source) {
        throw new TypeError(`Kovo app source snapshot conflicts for ${fileName}.`);
      }
      continue;
    }
    buildSecurityArrayAppend(
      files,
      { fileName, source: clientFile.source },
      'Pre-evaluation app and client source snapshot',
    );
  }
  return files;
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
): Promise<void> {
  const tsconfigPath = findBuildTsconfig(appModulePath, invocationRoot);
  if (tsconfigPath === undefined) return;

  const projectDir = dirname(tsconfigPath);
  let tscBin: string;
  try {
    tscBin = createRequire(`${projectDir}/package.json`).resolve('typescript/bin/tsc');
  } catch (error) {
    throw new Error(
      `kovo build TypeScript preflight could not resolve typescript from ${projectDir}. Install typescript or remove ${tsconfigPath}.\n${
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
  } catch (error) {
    throw new Error(`kovo build TypeScript preflight failed:\n${execFileErrorOutput(error)}`);
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
  const result = kovoCheck(artifacts.graph, {
    paranoidStaticAdvisory: options.paranoidStaticAdvisory,
  });
  if (result.exitCode === 0) return artifacts;
  if (options.paranoidStaticAdvisory && paranoidBuildCheckMayProceed(result.output)) {
    return artifacts;
  }

  throw new Error(`kovo build check preflight failed:\n${buildCheckFailureOutput(result.output)}`);
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
  graph: CoreGraph.KovoCheckInput;
  queryShapeFacts: readonly QueryShapeFact[];
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
  // attestation key; `kovo explain --attest --escape-reviews` verifies the detached envelopes.
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

function runtimePostureManifestForBuild(
  graph: CoreGraph.KovoCheckInput,
): CoreGraph.RuntimePostureManifest {
  const facts = runtimePostureFactsFromGraph(graph);
  return {
    artifactSubject: `sha256:${hash('sha256', canonicalJsonStringify(graph), 'hex')}`,
    facts,
    postureDigest: `sha256:${hash('sha256', canonicalJsonStringify(facts), 'hex')}`,
    schema: 'kovo-runtime-posture/v1',
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
    preEvaluationStaticTrust: PreEvaluationStaticTrust;
    reachableSessionAuthorityFacts: readonly CoreGraph.SessionAuthorityFact[];
    root: string;
  },
): Promise<KovoBuildCheckArtifacts> {
  const staticArtifacts = await staticBuildCheckGraph(app, options);
  const graph = staticArtifacts.graph;
  const result = deriveAppGraph({
    ...(staticArtifacts.components === undefined ? {} : { components: staticArtifacts.components }),
    graph: {
      ...graph,
      access: options.execution.accessFactsFromApp(app),
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
  if (diagnostics.length > 0) {
    return {
      graph: {
        ...result.graph,
        diagnostics,
      },
      queryShapeFacts: staticArtifacts.queryShapeFacts,
      sourceFiles: staticArtifacts.sourceFiles,
    };
  }
  return {
    graph: result.graph,
    queryShapeFacts: staticArtifacts.queryShapeFacts,
    sourceFiles: staticArtifacts.sourceFiles,
  };
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
    ...(diagnostic.start === undefined ? {} : { start: diagnostic.start }),
  };
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
  const drizzleFacts =
    files.length === 0
      ? emptyStaticDataPlaneBuildFacts()
      : await staticDataPlaneBuildFacts(files, { cache: options.cache });
  // SPEC §5.2 rule 9 / §6.6: graph assembly consumes the compiler facts that already authorized
  // evaluation. Recompiling or re-reading identity files here would create a second carrier whose
  // verdict could disagree with the exact bytes admitted by the pre-evaluation gate.
  const sourceGraphFacts = options.preEvaluationStaticTrust.sourceGraphFacts;
  // SPEC §6.6/§9.1 (audit-only, threat-matrix M3): surface every app-authored escape-hatch call site
  // (`kovo explain --capabilities`) and credential-cookie downgrade (`--cookies`) in the REAL build
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
  const queryShapeFacts = buildCompilerQueryShapeFacts(
    files,
    drizzleFacts,
  ) as readonly QueryShapeFact[];
  const revealed = mergeBuildRevealFacts(drizzleFacts.revealed ?? [], runtimeReveals);
  const queryReadSets = buildMapDense(app.queries, 'Build app queries', (query) =>
    queryCheckFact(query, drizzleFacts.queries),
  );
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
        status: fact.status,
      })),
  );
  const endpoints = buildMapDense(app.endpoints, 'Build app endpoints', endpointCheckFact);
  for (let index = 0; index < routeOutcomeFacts.length; index += 1) {
    buildSecurityArrayAppend(
      endpoints,
      routeOutcomeFacts[index]!,
      'CLI packages/cli/src/commands/build-export.ts collection',
    );
  }
  const mutations = buildMapDense(app.mutations, 'Build app mutations', (mutation) =>
    mutationCheckFact(mutation, queryReadSets, options.execution),
  );
  const trustEscapes = completeBuildTrustEscapes(staticTrustEscapes, mutations);
  const optimistic = buildFlatMapDense(
    app.mutations,
    'Build app mutations for optimistic coverage',
    mutationOptimisticCheckFacts,
  );
  const pages = buildMapDense(app.routes, 'Build app routes', routeCheckFact);
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
  compilerDependencies: CompilerGeneratedCapabilityDependency[];
  compilerSecuritySemanticSources: CompilerSecuritySemanticSource[];
  compilerTaskBFiniteVerdict: CompilerTaskBFiniteVerdict;
  components: SourceComponentGraphFacts[];
  routeOutcomes: Map<string, 'file' | 'stream'>;
  routePages: SourceRoutePageFacts[];
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

  const result: CoreGraph.SessionAuthorityFact[] = [];
  for (let index = 0; index < reachable.length; index += 1) {
    const file = reachable[index]!;
    const extraFiles = buildSnapshotDenseArray(
      viteFrameworkIdentityFiles(root, file.fileName, file.source),
      `Framework-identity files for ${file.fileName}`,
    );
    const facts = buildSnapshotDenseArray(
      mutationSessionAuthorityFacts(
        parseComponentModule(
          file.fileName,
          file.source,
          extraFiles.length === 0 ? {} : { frameworkIdentityFiles: extraFiles },
        ),
      ),
      `Session-authority facts for ${file.fileName}`,
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

function sourceGraphFactsFromFiles(files: readonly BuildCheckSourceFile[]): SourceGraphFacts {
  const compilerDependencies: CompilerGeneratedCapabilityDependency[] = [];
  const compilerSecuritySemanticSources: CompilerSecuritySemanticSource[] = [];
  const compilerTaskBBlockingDiagnostics: CoreGraph.StaticDiagnosticFact[] = [];
  const components: SourceComponentGraphFacts[] = [];
  const routeOutcomes = buildCreateMap<string, 'file' | 'stream'>();
  const routePages: SourceRoutePageFacts[] = [];

  const sourceFiles = buildSnapshotDenseArray(files, 'Build-check source files');
  // SPEC §5.2 rule 10 / §6.3: derive imported mutation-form ownership once from the same immutable
  // source snapshot used by build/check. Lowering receives only typed, path-scoped facts and never
  // infers authority from a bare identifier or a post-evaluation runtime object.
  const projectMutationFacts = projectMutationRegistryFactsFromFiles(sourceFiles);
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
    const component = compileComponentModule(componentOptions);
    appendBuildTaskBFiniteDiagnostics(
      compilerTaskBBlockingDiagnostics,
      component.diagnostics,
      'TASK B component compiler finite diagnostics',
    );
    const standaloneRegistrySource = lowerStandaloneSourceDerivedRegistryDeclarations({
      fileName: file.fileName,
      source: file.source,
    });
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
    buildSecurityArrayAppend(
      compilerSecuritySemanticSources,
      {
        fileName: file.fileName,
        graphs: semanticGraphs,
        operations: componentTaskBSourceOperationFacts(
          parseComponentModule(
            file.fileName,
            file.source,
            extraFiles.length === 0 ? {} : { frameworkIdentityFiles: extraFiles },
          ),
        ),
        source: file.source,
      },
      'CLI compiler semantic source carriers',
    );
    const routePage = compileRouteModule({ fileName: file.fileName, source: file.source });
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
        if (fact.outcome !== undefined && !buildMapHas(routeOutcomes, fact.route)) {
          buildMapSet(routeOutcomes, fact.route, fact.outcome.kind);
        }
      }
    }
  }

  return {
    compilerDependencies,
    compilerSecuritySemanticSources,
    compilerTaskBFiniteVerdict: snapshotCompilerTaskBFiniteVerdict({
      blockingDiagnostics: compilerTaskBBlockingDiagnostics,
      semanticSources: compilerSecuritySemanticSources,
    }),
    components,
    routeOutcomes,
    routePages,
  };
}

/** Internal executable seam for the TASK B caller-carrier mutation gate (SPEC §6.6). */
export function snapshotBuildCompilerTaskBFiniteVerdictForTests(
  files: readonly { readonly fileName: string; readonly source: string }[],
): CompilerTaskBFiniteVerdict {
  return sourceGraphFactsFromFiles(files).compilerTaskBFiniteVerdict;
}

/** Internal executable seam proving ordinary build diagnostics retain the route compiler census. */
export function snapshotBuildCompilerDiagnosticsForTests(
  files: readonly { readonly fileName: string; readonly source: string }[],
): CoreGraph.StaticDiagnosticFact[] {
  return buildMapDense(
    buildPreflightComponentDiagnostics(sourceGraphFactsFromFiles(files).components),
    'Build compiler diagnostic test seam',
    staticDiagnosticFact,
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
): CoreGraph.QueryReadSet {
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
    domains: uniqueSorted(
      appendDense(declaredReadKeys, factReads, `Read domains for ${query.key}`),
    ),
    query: query.key,
    ...(readProvenance !== undefined && readProvenance.length > 0 ? { readProvenance } : {}),
    ...(readOnlyDomains.length > 0 ? { readOnlyDomains: uniqueSorted(readOnlyDomains) } : {}),
    ...(query.guard === undefined ? {} : { guards: ['query.guard'] }),
  };
}

function mutationCheckFact(
  mutation: KovoApp['mutations'][number],
  queryReadSets: readonly CoreGraph.QueryReadSet[],
  execution: BuildExecutionModule,
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

function routeCheckFact(route: KovoApp['routes'][number]): CoreGraph.PageExplain {
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
    ...(route.guard === undefined ? {} : { guards: ['route.guard'] }),
    queries: uniqueSorted(
      buildMapDense(layoutQueries, `Layout query values for ${route.path}`, (query) => query.key),
    ),
    route: route.path,
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

  if (access.kind === 'public') return { kind: 'public', reason: access.reason };
  if (access.kind === 'verified-machine-auth') return { kind: 'verified-machine-auth' };
  return undefined;
}

function isGuardAccessDecisionValue(access: AccessDecision): access is readonly Guard<any, any>[] {
  return buildArrayIsArray(access);
}

function endpointCheckFact(endpoint: KovoApp['endpoints'][number]): CoreGraph.EndpointExplain {
  const csrf = endpointSafeMethod(endpoint.method)
    ? 'safe:read-only'
    : endpoint.csrf?.exempt === true
      ? 'exempt'
      : 'checked';
  const name = endpointWebhookName(endpoint);
  return {
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
    if (!parsedPreset) throw new Error(`unsupported KOVO_PRESET ${stableValue(envPreset)}`);
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
  if (!name) throw new Error(`unsupported kovo.config preset ${stableValue(preset.name)}`);
  return { name, preset };
}

async function loadKovoBuildConfig(
  root: string,
  appModulePath: string,
  approvedConfig: PreEvaluationBuildConfigTrust | undefined,
): Promise<LoadedKovoBuildConfig> {
  if (approvedConfig === undefined) return {};
  const configPath = approvedConfig.path;
  const requireFromApp = createRequire(pathToFileURL(appModulePath));

  const lifetime = await createBuildTimeViteServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'error',
    plugins: [approvedBuildSourcesVitePlugin(configPath, root, approvedConfig.files, 'config')],
    root,
    server: buildTimeViteServerOptions(),
    ssr: { noExternal: [/^@kovojs\//] },
  });
  const { server } = lifetime;
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
    await closeBuildTimeViteServerLifetime(lifetime, hasPrimaryError, primaryError);
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
): Promise<LoadedBuildAppModule> {
  const requireFromApp = createRequire(pathToFileURL(appModulePath));
  const lifetime = await createBuildTimeViteServer({
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
      sourceDerivedRegistryVitePlugin(
        appModulePath,
        root,
        lowerStandaloneSourceDerivedRegistryDeclarations,
      ),
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
  const { server } = lifetime;
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
    const appModule = await trustedInternalBuild.runWithUnavailableBuildAppEnvironment(() =>
      server.ssrLoadModule(viteSsrModuleId(appModulePath, root)),
    );
    return {
      appModule,
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
    await closeBuildTimeViteServerLifetime(lifetime, hasPrimaryError, primaryError);
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

  await server.ssrLoadModule(
    viteSsrModuleId(
      requireFromServer.resolve('@kovojs/compiler/internal/security-bootstrap'),
      root,
    ),
  );
  await server.ssrLoadModule(viteSsrModuleId(requireFromServer.resolve('@kovojs/compiler'), root));
  await server.ssrLoadModule(
    viteSsrModuleId(
      requireFromApp.resolve('@kovojs/server/internal/data-plane-static-analysis'),
      root,
    ),
  );
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
  lowerRegistryDeclarations: typeof lowerStandaloneSourceDerivedRegistryDeclarations,
): Plugin {
  const authoredSourcePaths = buildCreateSet<string>();
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
      const code = lowerRegistryDeclarations({ fileName, source });
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
  if (!isRecord(value)) throw new Error(`${configPath} must export a config object.`);

  const token = buildOwnDataValue(value, 'preset', `${configPath} config`);
  if (token === undefined) return undefined;
  const preset = resolveKovoBuildPreset(token);
  if (preset === undefined) {
    throw new Error(
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
      componentBuild.getCssAssetManifest?.(cssAssetManifestOptions),
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
    assets: splitStylesheetAssets,
    // The inert CSS-enrollment transform must not discard compiler-emitted handlers for a
    // component reached through the client entry. Merge its metadata with the app-graph pass.
    clientModules: uniqueKovoCompiledClientModules([
      ...(viteAssetPlugin.getClientModules?.() ?? []),
      ...(componentBuild.getClientModules?.() ?? []),
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
  getClientModules?: () => readonly KovoAppShellCompiledClientModule[];
  getCssAssetManifest?: ReturnType<
    typeof import('@kovojs/compiler').kovoVitePlugin
  >['getCssAssetManifest'];
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

    return kovoPlugin;
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
    writeFileSync(entryPath, kovoServerHandlerEntrySource(appModulePath, stylesheetAssets), 'utf8');
    await viteBuild({
      appType: 'custom',
      build: {
        emptyOutDir: true,
        minify: false,
        outDir,
        rollupOptions: {
          // SPEC 6.6/§10.3 keeps native and Postgres drivers as runtime sinks; unused
          // @kovojs/server barrel re-exports must not make every app load those drivers.
          external: isKovoServerHandlerExternalDependency,
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
          ? [cloudflareUnavailableDgramFloorVitePlugin()]
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
            allowRuntimeExternal: isKovoServerHandlerExternalDependency,
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
            find: /^@kovojs\/server\/internal\/app-shell-vite$/,
            replacement: requireFromCli.resolve('@kovojs/server/internal/app-shell-vite'),
          },
          {
            find: /^@kovojs\/server\/internal\/execution$/,
            replacement: requireFromCli.resolve('@kovojs/server/internal/execution'),
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
  const byPath = new Map<string, KovoAppShellCompiledClientModule>();
  for (const module of modules) {
    byPath.set(`${module.path}\0${module.version ?? ''}`, module);
  }
  return [...byPath.values()];
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

function projectMutationRegistryFactsForBuild(
  appModulePath: string,
  buildRoot: string,
  sourceFiles: readonly BuildCheckSourceFile[],
  sourceIdentityRoot: string = buildRoot,
): ProjectMutationRegistryFacts {
  const files = buildSnapshotDenseArray(sourceFiles, 'Project mutation build source files');
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
  return projectMutationRegistryFactsFromFiles(viteFiles);
}

function kovoBuildFilterFileName(fileName: string, root: string): string {
  const rootPrefix = `${slashPath(root).replace(/^\/+/, '').replace(/\/+$/, '')}/`;
  const normalized = slashPath(fileName).replace(/^\/+/, '');
  return normalized.startsWith(rootPrefix) ? normalized.slice(rootPrefix.length) : normalized;
}

const bundledUndiciRuntimeModuleId = '\0kovo-bundled-undici-runtime';

const cloudflareUnavailableDgramFloorModuleId = '\0kovo-cloudflare-unavailable-dgram-floor';

/**
 * Cloudflare exposes node:dgram only as a non-functional compatibility stub. The framework's
 * Node process floor is therefore vacuously satisfied in that runtime and must not make every
 * Cloudflare build fail its own unsupported-API inspection. Restrict this substitution to the
 * framework-owned relative import from egress-bootstrap; an app-authored node:dgram import stays
 * external in the server bundle and remains a blocking cloudflare-unsupported-node-api finding.
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
      const normalizedImporter = importer ? slashPath(importer) : '';
      if (
        source === './egress-dgram.js' &&
        buildRegExpExec(/\/egress-bootstrap\.(?:js|ts)$/u, normalizedImporter) !== null
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
): string {
  return buildJoinStrings(
    [
      "import { createRequestHandler, deriveClosedKovoApp, runWithGeneratedLiveTargetRegistry } from '@kovojs/server/internal/app-shell-vite';",
      "import './runtime-registry.mjs';",
      "import { appendFrameworkRuntimeArrayValue } from '@kovojs/server/internal/execution';",
      `const appModule = await runWithGeneratedLiveTargetRegistry(() => import(${stringifyBuildValue(pathToFileURL(appModulePath).href)}));`,
      'const app = appModule.default ?? appModule.app;',
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
    options = snapshotKovoExportOptions(options);
    const resolvedOptions = resolveKovoExportOptions(options, security.invocationCwd);
    const exportRoot = resolvedOptions.root ?? dirname(resolvedOptions.appModulePath);
    const preEvaluationStaticTrust = runPreEvaluationStaticTrustPreflight(
      resolvedOptions.appModulePath,
      exportRoot,
      security.paranoidStaticAdvisory,
    );
    const currentManifestPlan = await staticExportManifestPlan(resolvedOptions);
    manifestPlan = currentManifestPlan;
    const staticExport = await (async () => {
      loadedExport = await loadExportAppModule(
        resolvedOptions,
        preEvaluationStaticTrust.approvedSourceFiles,
        preEvaluationStaticTrust.capabilityClosure.dependencyManifest,
      );
      const app = appFromModule(loadedExport.appModule, resolvedOptions.appModulePath);
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

function snapshotKovoBuildOptions(value: KovoBuildOptions): KovoBuildOptions {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Kovo build options must be an object.');
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

function snapshotKovoExportOptions(value: KovoExportOptions): KovoExportOptions {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Kovo export options must be an object.');
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
  command: 'build' | 'export',
): string {
  const option = buildOwnDataValue(value, name, `Kovo ${command} options`);
  return requiredString(option, `${command} ${name}`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`Kovo ${label} must be an own string.`);
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
): Promise<LoadedExportAppModule> {
  const resolvedAppModulePath = options.appModulePath;
  const root = options.root ?? dirname(resolvedAppModulePath);
  const requireFromApp = createRequire(pathToFileURL(resolvedAppModulePath));

  const lifetime = await createBuildTimeViteServer({
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
  const { server } = lifetime;
  try {
    await preloadKovoSsrSecurityProfile(server, resolvedAppModulePath, root);
    const serverModule = (await server.ssrLoadModule(
      viteSsrModuleId(requireFromApp.resolve('@kovojs/server/internal/static-export'), root),
    )) as typeof import('@kovojs/server/internal/static-export');
    const serverInternalBuildModule = (await server.ssrLoadModule(
      viteSsrModuleId(requireFromApp.resolve('@kovojs/server/internal/build'), root),
    )) as typeof import('@kovojs/server/internal/build');
    const appModule = await serverInternalBuildModule.runWithGeneratedLiveTargetRegistry(() =>
      server.ssrLoadModule(resolvedAppModulePath),
    );
    return {
      appModule,
      close: () => lifetime.close(),
      exportStaticApp: exportStaticAppFromModule(serverModule),
      isStaticExportDiagnostic: serverModule.isStaticExportDiagnostic,
      isStaticExportDiagnosticError: serverModule.isStaticExportDiagnosticError,
      staticExportCompileDiagnosticsFromModule:
        serverModule.staticExportCompileDiagnosticsFromModule,
    };
  } catch (error) {
    await closeBuildTimeViteServerLifetime(lifetime, true, error);
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

async function createBuildTimeViteServer(
  config: Parameters<typeof createViteServer>[0],
): Promise<BuildTimeViteServerLifetime> {
  const server = await createViteServer(config);
  try {
    // Capture every owner before config/app evaluation. The lifetime enforces the exact Vite Plus
    // graph shape and clears only these command-private environments after their runners close.
    // SPEC §6.6 rule 6: authored code cannot replace the controls used for trust-root teardown.
    return captureBuildTimeViteServerLifetime(server);
  } catch (error) {
    try {
      await server.close();
    } catch (teardownError) {
      throw combineBuildTimeViteFailures(error, teardownError);
    }
    throw error;
  }
}

async function closeBuildTimeViteServerLifetime(
  lifetime: BuildTimeViteServerLifetime,
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
  const lines = ['kovo-export/v1'];
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
  return {
    error: `${buildOutputVersion}\nERROR ${error instanceof Error ? error.message : String(error)}`,
    exitCode: 1,
  };
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
        appendDense(['kovo-export/v1'], diagnosticLines, 'Static-export error lines'),
        '\n',
        'Static-export error lines',
      ),
      exitCode: 1,
    };
  }

  return {
    error: `kovo: export failed: ${error instanceof Error ? error.message : String(error)}`,
    exitCode: 1,
  };
}
