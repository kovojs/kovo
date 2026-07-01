import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type { DiagnosticCode } from '@kovojs/core';
import { isDiagnosticCode } from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import type { CompileResult, CompileRouteModuleResult } from '@kovojs/compiler';
import type {
  lowerStandaloneSourceDerivedRegistryDeclarations,
  QueryShapeFact,
} from '@kovojs/compiler/internal';
import type {
  KovoApp,
  StaticExportCompileDiagnostic,
  StaticExportResult,
  StylesheetAsset,
} from '@kovojs/server';
import type { KovoConfig, KovoPreset, PresetContext, PresetDiagnostic } from '@kovojs/server/build';
import type { KovoNeutralBuild } from '@kovojs/server/internal/build';
import { withKovoBuildContext } from '@kovojs/server/internal/build-context';
import type { KovoAppShellCompiledClientModule } from '@kovojs/server/internal/app-shell-vite';
import type {
  DataPlaneSourceFile as BuildCheckSourceFile,
  QueryReadFactLike,
  StaticDataPlaneBuildFacts,
} from '@kovojs/server/internal/data-plane-static-analysis';
import {
  runtimeRegistryWireFactsFromGraph,
  serializeRuntimeRegistryWireModule,
  type RuntimeRegistryWireFacts,
} from '@kovojs/server/internal/runtime-registry-wire';

import {
  BUILD_ARGV_SPEC,
  BUILD_USAGE,
  EXPORT_ARGV_SPEC,
  EXPORT_USAGE,
  parsedBooleanOption,
  parsedStringOption,
  parseCommandArgv,
} from '../commands-manifest.js';
import { kovoCheck } from '../graph-output.js';
import {
  buildOutputVersion,
  type CliCommandResult,
  type KovoCheckResult,
  stableText,
  stableValue,
} from '../shared.js';

const requireFromCli = createRequire(new URL('../index.ts', import.meta.url));

const execFileAsync = promisify(execFile);

function isKovoServerHandlerExternalDependency(id: string): boolean {
  return id === '@node-rs/argon2' || id.startsWith('@node-rs/argon2-');
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
  serverInternalBuildModule: typeof import('@kovojs/server/internal/build');
}

interface LoadedExportAppModule {
  appModule: unknown;
  close?: () => Promise<void>;
  exportStaticApp: ExportStaticApp;
}

export interface KovoExportCommandResult extends KovoCheckResult {
  staticExport: StaticExportResult;
}

type BuildArgParseResult = { ok: true; options: KovoBuildOptions } | { message: string; ok: false };

interface LoadedKovoBuildConfig {
  config?: KovoConfig;
  path?: string;
}

interface SelectedKovoBuildPreset {
  name: KovoBuildPresetName;
  preset?: KovoPreset;
}

export function parseBuildArgs(args: readonly string[]): BuildArgParseResult {
  const parsed = parseCommandArgv(args, BUILD_ARGV_SPEC);
  if (!parsed.ok) return buildArgvError(parsed);

  const [appModulePath, extraPath] = parsed.value.positionals;
  if (extraPath)
    return { message: `kovo: build accepts one app module path.\n${buildUsage()}`, ok: false };
  if (!appModulePath)
    return { message: `kovo: build requires an app module path.\n${buildUsage()}`, ok: false };

  const presetValue = parsedStringOption(parsed.value, '--preset');
  const preset = presetValue === undefined ? undefined : parseKovoBuildPresetName(presetValue);
  if (presetValue !== undefined && preset === undefined) {
    return { message: `kovo: unsupported build preset ${stableValue(presetValue)}.\n`, ok: false };
  }

  return {
    ok: true,
    options: {
      appModulePath,
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
  if (error.error === 'help') return { message: buildUsage(), ok: false };
  if (error.error === 'missing-value') return { message: error.message, ok: false };
  return {
    message: `kovo: unknown build option ${stableValue(error.option)}.\n${buildUsage()}`,
    ok: false,
  };
}

function parseKovoBuildPresetName(value: string): KovoBuildPresetName | undefined {
  return value === 'node' || value === 'vercel' || value === 'cloudflare' ? value : undefined;
}

function buildUsage(): string {
  return [BUILD_USAGE, ''].join('\n');
}

export function parseExportArgs(args: readonly string[]): ExportArgParseResult {
  const parsed = parseCommandArgv(args, EXPORT_ARGV_SPEC);
  if (!parsed.ok) return exportArgvError(parsed);

  const [appModulePath, extraPath] = parsed.value.positionals;
  if (extraPath)
    return { message: `kovo: export accepts one app module path.\n${exportUsage()}`, ok: false };
  if (!appModulePath)
    return { message: `kovo: export requires an app module path.\n${exportUsage()}`, ok: false };

  const assetBase = parsedStringOption(parsed.value, '--asset-base');
  const distDir = parsedStringOption(parsed.value, '--dist');
  const manifestFile = parsedStringOption(parsed.value, '--manifest');
  const origin = parsedStringOption(parsed.value, '--origin');
  const root = parsedStringOption(parsed.value, '--root');
  const stylesheetEnv = parsedStringOption(parsed.value, '--stylesheet-env');
  const vite = parsedBooleanOption(parsed.value, '--vite');
  const onNonExportable = parsedBooleanOption(parsed.value, '--skip-non-exportable')
    ? ('skip' as const)
    : undefined;

  return {
    ok: true,
    options: {
      appModulePath,
      ...(assetBase === undefined ? {} : { assetBase }),
      ...(distDir === undefined ? {} : { distDir }),
      ...(manifestFile === undefined ? {} : { manifestFile }),
      ...(onNonExportable === undefined ? {} : { onNonExportable }),
      ...(origin === undefined ? {} : { origin }),
      outDir: parsedStringOption(parsed.value, '--out') ?? 'dist',
      ...(root === undefined ? {} : { root }),
      ...(stylesheetEnv === undefined ? {} : { stylesheetEnv }),
      ...(vite ? { vite } : {}),
    },
  };
}

function exportArgvError(error: Exclude<ReturnType<typeof parseCommandArgv>, { ok: true }>): {
  message: string;
  ok: false;
} {
  if (error.error === 'help') return { message: exportUsage(), ok: false };
  if (error.error === 'missing-value') return { message: error.message, ok: false };
  return {
    message: `kovo: unknown export option ${stableValue(error.option)}.\n${exportUsage()}`,
    ok: false,
  };
}

function exportUsage(): string {
  return [EXPORT_USAGE, ''].join('\n');
}

export async function runBuildCommand(options: KovoBuildOptions): Promise<CliCommandResult> {
  try {
    const loadedConfig = await loadKovoBuildConfig(process.cwd());
    const selectedPreset = selectedKovoBuildPreset(options, loadedConfig.config);
    const resolvedAppModulePath = resolve(options.appModulePath);
    // plans/fast-kovo-check3.md: start the independent `tsc --noEmit` preflight subprocess here and
    // let it overlap the vite app load below AND the kovo-check security preflight, instead of
    // running it sequentially first (~1.7s cold / ~0.7s warm saved, no correctness change). The
    // no-op `.catch` prevents an unhandled rejection if the load/check throws before we reach the
    // fail-closed join below; we still `await typeScriptPreflight` there, so its error is never
    // swallowed and ZERO artifacts are emitted on any preflight failure.
    const typeScriptPreflight = runTypeScriptBuildPreflight(resolvedAppModulePath);
    typeScriptPreflight.catch(() => {});
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
    const loadAndCheck = await (async () => {
      const [loadedBuildApp, buildStylesheetCss] = await withBuildGraphDerivationContext(() =>
        Promise.all([
          loadBuildAppModule(resolvedAppModulePath, process.cwd()),
          kovoBuildStylesheetCss(resolvedAppModulePath),
        ]),
      );
      const { cloudflare, node, vercel } = loadedBuildApp.serverBuildModule;
      const { writeKovoNeutralBuild } = loadedBuildApp.serverInternalBuildModule;
      const appModule = loadedBuildApp.appModule;
      const app = appFromModule(appModule, options.appModulePath);
      const buildCheck = await runKovoBuildCheckPreflight(app, resolvedAppModulePath, {
        cache: options.cache,
      });
      return {
        app,
        buildStylesheetCss,
        checkGraph: buildCheck.graph,
        cloudflare,
        node,
        queryShapeFacts: buildCheck.queryShapeFacts,
        vercel,
        writeKovoNeutralBuild,
      };
    })().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ error, ok: false as const }),
    );
    // Fail-closed join BEFORE any artifact-emitting step: surface a tsc type error FIRST
    // (tsc-error-first ordering), then re-throw any captured load/check failure. Every
    // artifact-emitting step below (buildKovoClientManifest, writeKovoNeutralBuild, preset.emit,
    // writeKovoBuildGraphArtifact) stays strictly after this join, so any failure emits ZERO artifacts.
    await typeScriptPreflight;
    if (!loadAndCheck.ok) throw loadAndCheck.error;
    const {
      app,
      buildStylesheetCss,
      checkGraph,
      cloudflare,
      node,
      queryShapeFacts,
      vercel,
      writeKovoNeutralBuild,
    } = loadAndCheck.value;
    const outDir = resolve(options.outDir);
    const clientBuild = await withKovoBuildQueryShapeFacts(queryShapeFacts, () =>
      buildKovoClientManifest(
        join(outDir, '.kovo-client'),
        kovoClientBuildRoot(resolvedAppModulePath),
        resolvedAppModulePath,
        { cache: options.cache, queryShapeFacts },
      ),
    );
    const buildCssAssets = mergeKovoBuildStylesheetAssets([
      buildStylesheetCss.assets,
      clientBuild.assets,
    ]);
    const buildApp = appWithBuildStylesheetAssets(app, buildCssAssets);
    const serverHandlerBuild = await withKovoBuildQueryShapeFacts(queryShapeFacts, () =>
      bundleKovoServerHandler(resolvedAppModulePath, {
        queryShapeFacts,
        runtimeRegistry: runtimeRegistryWireFactsFromGraph(checkGraph),
        stylesheetAssets: buildCssAssets,
      }),
    );
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
    writeKovoBuildGraphArtifact(neutralBuild, checkGraph);
    const preset =
      selectedPreset.preset ??
      (selectedPreset.name === 'cloudflare'
        ? cloudflare()
        : selectedPreset.name === 'vercel'
          ? vercel()
          : node());
    const presetOutDir = buildPresetOutDir(outDir, selectedPreset.name);
    const presetLogs: string[] = [];
    if (typeof preset.emit !== 'function') {
      throw new Error(`kovo build preset ${selectedPreset.name} cannot emit build output.`);
    }

    const declaredEnv = inferredKovoBuildDeclaredEnv(serverHandlerBuild.source);
    const presetContext: PresetContext = {
      declaredEnv,
      log(message) {
        presetLogs.push(message);
      },
      outDir: presetOutDir,
      readServerHandlerSource() {
        return serverHandlerBuild.source;
      },
      readNeutral() {
        return neutralBuild;
      },
    };
    const presetDiagnostics = await inspectKovoBuildPreset(preset, neutralBuild, presetContext);
    const blockingDiagnostics = presetDiagnostics.filter(
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

async function runTypeScriptBuildPreflight(appModulePath: string): Promise<void> {
  const tsconfigPath = findBuildTsconfig(appModulePath);
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
  const buildInfoDir = join(projectDir, '.kovo', 'cache');
  const buildInfoFile = join(buildInfoDir, 'tsc-preflight.tsbuildinfo');
  mkdirSync(buildInfoDir, { recursive: true });

  try {
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
        env: process.env,
      },
    );
  } catch (error) {
    throw new Error(`kovo build TypeScript preflight failed:\n${execFileErrorOutput(error)}`);
  }
}

async function runKovoBuildCheckPreflight(
  app: KovoApp,
  appModulePath: string,
  options: { cache: boolean },
): Promise<KovoBuildCheckArtifacts> {
  const artifacts = await buildCheckGraph(app, appModulePath, options);
  const result = kovoCheck(artifacts.graph);
  if (result.exitCode === 0) return artifacts;

  throw new Error(`kovo build check preflight failed:\n${buildCheckFailureOutput(result.output)}`);
}

interface KovoBuildCheckArtifacts {
  components?: readonly SourceComponentGraphFacts[];
  graph: CoreGraph.KovoCheckInput;
  queryShapeFacts: readonly QueryShapeFact[];
  routePages?: readonly SourceRoutePageFacts[];
}

type SourceComponentGraphFacts = Pick<
  CompileResult,
  | 'componentGraphFacts'
  | 'diagnostics'
  | 'handlerWriteSinkFacts'
  | 'publishToClientFacts'
  | 'taskGraphFacts'
>;

type SourceRoutePageFacts = Pick<CompileRouteModuleResult, 'routePageFacts'>;

function writeKovoBuildGraphArtifact(
  neutralBuild: KovoNeutralBuild,
  graph: CoreGraph.KovoCheckInput,
): void {
  // SPEC §5.3: the build-derived graph is a review/debug artifact, not just an
  // in-memory preflight input. Persist it in the neutral build metadata directory
  // so `kovo explain ...` can discover it after an ordinary scaffold build.
  writeFileSync(join(neutralBuild.outDir, 'graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
}

function buildCheckFailureOutput(output: string): string {
  const trimmed = output.trimEnd();
  const fatalWarnings = trimmed.split('\n').flatMap((line) => buildFatalWarningSummaryLine(line));
  if (fatalWarnings.length === 0) return trimmed;
  return `${fatalWarnings.join('\n')}\n${trimmed}`;
}

function buildFatalWarningSummaryLine(line: string): string[] {
  const match = /^WARN (KV(?:310|311)) (.*)$/.exec(line);
  if (!match) return [];
  return [`ERROR BUILD_FATAL ${match[1]} ${match[2]}`];
}

async function buildCheckGraph(
  app: KovoApp,
  appModulePath: string,
  options: { cache: boolean },
): Promise<KovoBuildCheckArtifacts> {
  const [{ accessFactsFromApp }, { deriveAppGraph }] = await Promise.all([
    import('@kovojs/server/internal/execution'),
    import('@kovojs/compiler/graph'),
  ]);
  const staticArtifacts = await staticBuildCheckGraph(app, appModulePath, options);
  const graph = staticArtifacts.graph;
  const result = deriveAppGraph({
    ...(staticArtifacts.components === undefined ? {} : { components: staticArtifacts.components }),
    graph: {
      ...graph,
      access: accessFactsFromApp(app),
    },
    ...(staticArtifacts.routePages === undefined ? {} : { routePages: staticArtifacts.routePages }),
  });
  const diagnostics = [
    ...(graph.diagnostics ?? []),
    ...buildPreflightComponentDiagnostics(staticArtifacts.components ?? []).map(
      staticDiagnosticFact,
    ),
    ...result.diagnostics.map(staticDiagnosticFact),
  ];
  if (diagnostics.length > 0) {
    return {
      graph: {
        ...result.graph,
        diagnostics,
      },
      queryShapeFacts: staticArtifacts.queryShapeFacts,
    };
  }
  return { graph: result.graph, queryShapeFacts: staticArtifacts.queryShapeFacts };
}

function buildPreflightComponentDiagnostics(
  components: NonNullable<KovoBuildCheckArtifacts['components']>,
): CompileResult['diagnostics'] {
  return components.flatMap((component) => component.diagnostics);
}

function staticDiagnosticFact(
  diagnostic: CompileResult['diagnostics'][number],
): CoreGraph.StaticDiagnosticFact {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity ?? 'error',
    site: diagnostic.fileName,
    ...(diagnostic.start === undefined ? {} : { start: diagnostic.start }),
  };
}

async function staticBuildCheckGraph(
  app: KovoApp,
  appModulePath: string,
  options: { cache: boolean },
): Promise<KovoBuildCheckArtifacts> {
  const { buildCheckSourceFiles, buildCompilerQueryShapeFacts, staticDataPlaneBuildFacts } =
    await import('@kovojs/server/internal/data-plane-static-analysis');
  const files = buildCheckSourceFiles(appModulePath);
  const [drizzleFacts, sourceGraphFacts] =
    files.length === 0
      ? [
          emptyStaticDataPlaneBuildFacts(),
          {
            components: [] as SourceComponentGraphFacts[],
            routeOutcomes: new Map<string, 'file' | 'stream'>(),
            routePages: [] as SourceRoutePageFacts[],
          },
        ]
      : await Promise.all([
          staticDataPlaneBuildFacts(files, { cache: options.cache }),
          sourceGraphFactsFromFiles(files, dirname(appModulePath)),
        ]);
  const queryShapeFacts = buildCompilerQueryShapeFacts(
    files,
    drizzleFacts,
  ) as readonly QueryShapeFact[];
  const queryReadSets = app.queries.map((query) => queryCheckFact(query, drizzleFacts.queries));
  const routeOutcomeFacts = routeFileStreamEndpointFacts(
    app.routes,
    sourceGraphFacts.routeOutcomes,
  );

  return {
    components: sourceGraphFacts.components,
    graph: {
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
      endpoints: [...app.endpoints.map(endpointCheckFact), ...routeOutcomeFacts],
      mutations: app.mutations.map((mutation) => mutationCheckFact(mutation, queryReadSets)),
      optimistic: app.mutations.flatMap(mutationOptimisticCheckFacts),
      pages: app.routes.map(routeCheckFact),
      queries: queryReadSets,
    },
    queryShapeFacts,
    routePages: sourceGraphFacts.routePages,
  };
}

interface SourceGraphFacts {
  components: SourceComponentGraphFacts[];
  routeOutcomes: Map<string, 'file' | 'stream'>;
  routePages: SourceRoutePageFacts[];
}

async function sourceGraphFactsFromFiles(
  files: readonly BuildCheckSourceFile[],
  root: string,
): Promise<SourceGraphFacts> {
  const [{ compileComponentModule, compileRouteModule }, { viteFrameworkIdentityFiles }] =
    await Promise.all([import('@kovojs/compiler'), import('@kovojs/compiler/internal')]);
  const components: SourceComponentGraphFacts[] = [];
  const routeOutcomes = new Map<string, 'file' | 'stream'>();
  const routePages: SourceRoutePageFacts[] = [];

  for (const file of files) {
    const extraFiles = viteFrameworkIdentityFiles(root, file.fileName, file.source);
    const componentOptions = {
      ...(extraFiles.length === 0 ? {} : { extraFiles }),
      fileName: file.fileName,
      source: file.source,
      sourceProvenance: 'app',
    } as const;
    const component = compileComponentModule(componentOptions);
    if (
      component.componentGraphFacts.length > 0 ||
      component.diagnostics.length > 0 ||
      component.handlerWriteSinkFacts.length > 0 ||
      component.publishToClientFacts.length > 0 ||
      component.taskGraphFacts.length > 0
    ) {
      components.push(component);
    }

    const routePage = compileRouteModule({ fileName: file.fileName, source: file.source });
    if (routePage.routePageFacts.length > 0) {
      routePages.push(routePage);
      for (const fact of routePage.routePageFacts) {
        if (fact.outcome !== undefined && !routeOutcomes.has(fact.route)) {
          routeOutcomes.set(fact.route, fact.outcome.kind);
        }
      }
    }
  }

  return { components, routeOutcomes, routePages };
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

async function withKovoBuildQueryShapeFacts<T>(
  facts: readonly QueryShapeFact[],
  fn: () => Promise<T>,
): Promise<T> {
  const adapter = await import('@kovojs/server/internal/data-plane-static-analysis');
  return adapter.withKovoBuildQueryShapeFacts(facts, fn);
}

function queryCheckFact(
  query: KovoApp['queries'][number],
  queryFacts: readonly QueryReadFactLike[],
): CoreGraph.QueryReadSet {
  const fact = queryFacts.find((candidate) => candidate.query === query.key);
  const factReads = fact?.reads?.filter(isString) ?? [];
  const declaredReads = (query.reads ?? []) as readonly { key: string }[];
  const readProvenance = fact?.readProvenance;
  return {
    domains: uniqueSorted([...declaredReads.map((read) => read.key), ...factReads]),
    query: query.key,
    ...(readProvenance !== undefined && readProvenance.length > 0 ? { readProvenance } : {}),
    ...((fact?.readOnlyDomains?.length ?? 0) > 0
      ? { readOnlyDomains: uniqueSorted(fact?.readOnlyDomains?.filter(isString) ?? []) }
      : {}),
    ...(query.access === undefined ? {} : { access: query.access }),
    ...(query.guard === undefined ? {} : { guards: ['query.guard'] }),
  };
}

function mutationCheckFact(
  mutation: KovoApp['mutations'][number],
  queryReadSets: readonly CoreGraph.QueryReadSet[],
): CoreGraph.MutationExplain {
  const registry = mutation.registry;
  const touches = (registry?.touches ?? []) as readonly { key: string }[];
  const inferredTouches = (registry?.inferredTouches ?? []) as readonly { domain: string }[];
  const writes = uniqueSorted(touches.map((touch) => touch.key));
  const inferredWrites = uniqueSorted(inferredTouches.map((touch) => touch.domain));
  const fileFields = mutation.fileFields ?? [];
  const invalidates = mutationInvalidatedQueryKeys(mutation, queryReadSets, [
    ...writes,
    ...inferredWrites,
  ]);
  return {
    ...(mutation.access === undefined ? {} : { access: mutation.access }),
    csrf: mutation.csrf === false ? 'exempt' : 'checked',
    ...(mutation.csrf === false ? { csrfJustification: 'csrf:false mutation declaration' } : {}),
    ...(mutation.guard === undefined ? {} : { guards: ['mutation.guard'] }),
    ...(invalidates.length === 0 ? {} : { invalidates }),
    ...(fileFields.length === 0 ? {} : { enctype: 'multipart/form-data' as const, fileFields }),
    key: mutation.key,
    ...(writes.length === 0 && inferredWrites.length === 0
      ? {}
      : { writes: uniqueSorted([...writes, ...inferredWrites]) }),
  };
}

function mutationOptimisticCheckFacts(
  mutation: KovoApp['mutations'][number],
): CoreGraph.OptimisticCoverage[] {
  const optimistic = mutation.optimistic as Record<string, unknown> | undefined;
  if (optimistic === undefined) return [];

  const optimisticQueries = Object.keys(optimistic)
    .filter(isString)
    .map((key) => ({ key }));
  return uniqueQueries(optimisticQueries).flatMap((query) => {
    const entry = optimistic[query.key];
    if (entry === undefined) return [];
    return [
      {
        mutation: mutation.key,
        query: query.key,
        status: entry === 'await-fragment' ? 'await-fragment' : 'hand-written',
      },
    ];
  });
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
    optimistic === undefined ? [] : Object.keys(optimistic).filter(isString);
  const writtenDomains = new Set(writeDomains);
  const intersectingQueries =
    writtenDomains.size === 0
      ? []
      : queryReadSets
          .filter((query) => query.domains.some((domain) => writtenDomains.has(domain)))
          .map((query) => query.query);

  return uniqueSorted([
    ...registryQueries.map((query) => query.key),
    ...intersectingQueries,
    ...optimisticQueryKeys,
  ]);
}

function uniqueQueries(queries: readonly { key: string }[]): { key: string }[] {
  const seen = new Set<string>();
  const unique: { key: string }[] = [];
  for (const query of queries) {
    if (seen.has(query.key)) continue;
    seen.add(query.key);
    unique.push(query);
  }
  return unique.sort((left, right) => left.key.localeCompare(right.key));
}

function routeCheckFact(route: KovoApp['routes'][number]): CoreGraph.PageExplain {
  const layoutQueries = Object.values(route.layout?.queries ?? {}) as readonly { key: string }[];
  return {
    ...(route.access === undefined ? {} : { access: route.access }),
    ...(route.guard === undefined ? {} : { guards: ['route.guard'] }),
    queries: uniqueSorted(layoutQueries.map((query) => query.key)),
    route: route.path,
  };
}

function routeFileStreamEndpointFacts(
  routes: readonly KovoApp['routes'][number][],
  outcomeByPath: ReadonlyMap<string, 'file' | 'stream'>,
): CoreGraph.EndpointExplain[] {
  return routes.flatMap((route) => {
    const outcome = outcomeByPath.get(route.path);
    if (outcome === undefined) return [];
    return [routeFileStreamEndpointFact(route, outcome)];
  });
}

function routeFileStreamEndpointFact(
  route: KovoApp['routes'][number],
  outcome: 'file' | 'stream',
): CoreGraph.EndpointExplain {
  return {
    ...(route.access === undefined ? {} : { access: route.access }),
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

function endpointCheckFact(endpoint: KovoApp['endpoints'][number]): CoreGraph.EndpointExplain {
  const csrf = endpoint.csrf?.exempt === true ? 'exempt' : 'checked';
  const name = endpointWebhookName(endpoint);
  return {
    ...(endpoint.access === undefined ? {} : { access: endpoint.access }),
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

function endpointResponseBodyPosture(
  body: KovoApp['endpoints'][number]['response']['body'],
): string {
  return typeof body === 'string' ? body : body.join(',');
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
  const writes = endpoint.webhookDefinition.writes?.map((domain) => domain.key) ?? [];
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

function findBuildTsconfig(appModulePath: string): string | undefined {
  const relativeAppPath = relative(process.cwd(), appModulePath);
  if (relativeAppPath.split(/[\\/]/).some((part) => part.startsWith('.'))) return undefined;

  return findNearestFileWithin(dirname(appModulePath), 'tsconfig.json', process.cwd());
}

function findNearestFileWithin(
  startDir: string,
  fileName: string,
  stopDir: string,
): string | undefined {
  const absoluteStopDir = resolve(stopDir);
  for (let current = resolve(startDir); ; current = dirname(current)) {
    const relativeToStop = relative(absoluteStopDir, current);
    if (relativeToStop.startsWith('..') || isAbsolute(relativeToStop)) return undefined;
    const candidate = join(current, fileName);
    if (existsSync(candidate)) return candidate;
    if (current === absoluteStopDir) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function execFileErrorOutput(error: unknown): string {
  if (isRecord(error)) {
    const stdout = typeof error.stdout === 'string' ? error.stdout.trimEnd() : '';
    const stderr = typeof error.stderr === 'string' ? error.stderr.trimEnd() : '';
    const output = [stdout, stderr].filter(Boolean).join('\n');
    if (output) return output;
  }
  return error instanceof Error ? error.message : String(error);
}

async function inspectKovoBuildPreset(
  preset: KovoPreset,
  neutralBuild: KovoNeutralBuild,
  context: PresetContext,
): Promise<readonly PresetDiagnostic[]> {
  if (typeof preset.inspect !== 'function') return [];
  return preset.inspect(neutralBuild, context);
}

const kovoBuildEnvConventions = ['DATABASE_URL'] as const;

function inferredKovoBuildDeclaredEnv(serverHandlerSource: string): readonly string[] {
  return kovoBuildEnvConventions.filter((name) => serverHandlerSource.includes(name));
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
  ] = await Promise.all([
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
  const appSplitManifest =
    appResult.cssAssets.length === 0 || appRouteTargets.routeTargets.length === 0
      ? undefined
      : collectCssAssetManifest(
          { cssAssets: appResult.cssAssets },
          { split: { routes: appRouteTargets.routeTargets } },
        );
  if (appSplitManifest)
    assertKovoBuildCssDelivery(
      appSplitManifest,
      appRouteTargets.routeTargets,
      cssRouteDeliveryGate,
    );
  const appSplitAssets = stylesheetAssetsFromCssSplitChunks(appSplitManifest?.chunks);

  if (!packageResult.css && !appResult.css)
    return { assets: emptyKovoBuildStylesheetAssets(), stylesheetCss: [] };
  const tokenCss = kovoUiTokenSheetCss.replace(/@theme[^{]*\{[\s\S]*?\n\}/, '').trim();
  const monolithAppCss = appSplitManifest ? null : appResult.css;
  return {
    assets: appSplitAssets,
    stylesheetCss: [
      {
        css: [tokenCss, packageResult.css, monolithAppCss].filter(Boolean).join('\n'),
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
  const diagnostics = routeTargets.flatMap(
    (routeTarget) => cssRouteDeliveryGate(manifest, routeTarget).diagnostics,
  );
  if (diagnostics.length === 0) return;

  const details = diagnostics
    .slice(0, 10)
    .map(
      (diagnostic) =>
        `${diagnostic.route} links ${diagnostic.href} atom ${diagnostic.className} ` +
        `from ${diagnostic.source}`,
    )
    .join('\n');
  const suffix =
    diagnostics.length > 10 ? `\n... ${diagnostics.length - 10} more CSS overship diagnostics` : '';
  throw new Error(`kovo build CSS overship gate failed:\n${details}${suffix}`);
}

function selectedKovoBuildPreset(
  options: KovoBuildOptions,
  config: KovoConfig | undefined,
): SelectedKovoBuildPreset {
  if (options.preset !== undefined) return { name: options.preset };

  const envPreset = process.env.KOVO_PRESET;
  if (envPreset) {
    const parsedPreset = parseKovoBuildPresetName(envPreset);
    if (!parsedPreset) throw new Error(`unsupported KOVO_PRESET ${stableValue(envPreset)}`);
    return { name: parsedPreset };
  }

  if (config?.preset !== undefined) return selectedConfiguredKovoBuildPreset(config.preset);

  if (process.env.VERCEL) return { name: 'vercel' };
  if (process.env.CF_PAGES || process.env.CLOUDFLARE) return { name: 'cloudflare' };
  return { name: 'node' };
}

function selectedConfiguredKovoBuildPreset(preset: KovoPreset): SelectedKovoBuildPreset {
  const name = parseKovoBuildPresetName(preset.name);
  if (!name) throw new Error(`unsupported kovo.config preset ${stableValue(preset.name)}`);
  return { name, preset };
}

async function loadKovoBuildConfig(root: string): Promise<LoadedKovoBuildConfig> {
  const configPath = findKovoBuildConfig(root);
  if (configPath === undefined) return {};

  const { createServer } = await import('vite-plus');
  const server = await createServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'error',
    root,
    server: buildTimeViteServerOptions(),
    ssr: { noExternal: true },
  });
  try {
    const configModule = await server.ssrLoadModule(`/${basename(configPath)}`);
    const config = kovoBuildConfigFromModule(configModule, configPath);
    return { config, path: configPath };
  } finally {
    await server.close();
  }
}

async function withBuildGraphDerivationContext<T>(fn: () => Promise<T>): Promise<T> {
  return await withKovoBuildContext({ graphDerivation: true }, fn);
}

async function loadBuildAppModule(
  appModulePath: string,
  root: string,
): Promise<LoadedBuildAppModule> {
  const [{ lowerStandaloneSourceDerivedRegistryDeclarations }, { createServer }] =
    await Promise.all([import('@kovojs/compiler/internal'), import('vite-plus')]);
  const requireFromApp = createRequire(pathToFileURL(appModulePath));
  const server = await createServer({
    appType: 'custom',
    logLevel: 'error',
    plugins: [
      sourceDerivedRegistryVitePlugin(root, lowerStandaloneSourceDerivedRegistryDeclarations),
    ],
    root,
    server: buildTimeViteServerOptions(),
  });
  try {
    const [appModule, serverBuildModule, serverInternalBuildModule] = await Promise.all([
      server.ssrLoadModule(viteSsrModuleId(appModulePath, root)),
      server.ssrLoadModule(viteSsrModuleId(requireFromApp.resolve('@kovojs/server/build'), root)),
      server.ssrLoadModule(
        viteSsrModuleId(requireFromApp.resolve('@kovojs/server/internal/build'), root),
      ),
    ]);
    return {
      appModule,
      serverBuildModule: serverBuildModule as LoadedBuildAppModule['serverBuildModule'],
      serverInternalBuildModule:
        serverInternalBuildModule as LoadedBuildAppModule['serverInternalBuildModule'],
    };
  } finally {
    await server.close();
  }
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
  root: string,
  lowerRegistryDeclarations: typeof lowerStandaloneSourceDerivedRegistryDeclarations,
): {
  enforce: 'pre';
  name: string;
  transform(source: string, id: string): null | { code: string; map: null };
} {
  return {
    enforce: 'pre',
    name: 'kovo-source-derived-registry',
    transform(source, id) {
      const fileName = viteSourceFileName(id, root);
      if (!/\.[cm]?[jt]sx?$/.test(fileName)) return null;
      if (source.startsWith('// @kovojs-ui-copy\n')) return null;
      if (isKovoBuildEmittedCompilerSource(source)) return null;
      const code = lowerRegistryDeclarations({ fileName, source });
      return code === null ? null : { code, map: null };
    },
  };
}

const KOVO_BUILD_EMITTED_ABI_IMPORT_PATTERN = /@kovojs\/[^"'\s/]+\/(?:internal|generated)\//;

function isKovoBuildEmittedCompilerSource(source: string): boolean {
  return (
    KOVO_BUILD_EMITTED_ABI_IMPORT_PATTERN.test(source) ||
    source.includes('componentLiveTargetRenderer') ||
    source.includes('registerGeneratedLiveTargetRenderer')
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

function kovoBuildConfigFromModule(module: unknown, configPath: string): KovoConfig {
  const value =
    typeof module === 'object' && module !== null
      ? ((module as { default?: unknown }).default ?? module)
      : module;
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error(`${configPath} must export a config object.`);

  const config: KovoConfig = {};
  if ('preset' in value) {
    const preset = value.preset;
    if (!isKovoPreset(preset)) {
      throw new Error(`${configPath} preset must be a Kovo preset value such as node().`);
    }
    config.preset = preset;
  }
  return config;
}

function isKovoPreset(value: unknown): value is KovoPreset {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    (value.emit === undefined || typeof value.emit === 'function') &&
    (value.inspect === undefined || typeof value.inspect === 'function')
  );
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
  options: { cache: boolean; queryShapeFacts: readonly QueryShapeFact[] },
): Promise<KovoClientManifestBuild> {
  const [
    { kovoVitePlugin },
    { cssRouteDeliveryGate, dedupeCss },
    { extractAppRouteCssTargets },
    { build },
  ] = await Promise.all([
    import('@kovojs/compiler'),
    import('@kovojs/compiler/internal'),
    import('@kovojs/compiler/package-styles'),
    import('vite-plus'),
  ]);
  const viteAssetPlugin = kovoVitePlugin({
    cache: options.cache,
    queryShapeFacts: options.queryShapeFacts,
  });
  const routeTargets = extractAppRouteCssTargets({
    fileName: appModulePath,
    packagePrefixDiscoveryRoot: dirname(appModulePath),
    source: existsSync(appModulePath) ? readFileSync(appModulePath, 'utf8') : '',
  }).routeTargets;

  await build({
    appType: 'custom',
    build: {
      emptyOutDir: true,
      manifest: true,
      outDir,
    },
    logLevel: 'silent',
    plugins: [viteAssetPlugin],
    root,
  });

  const componentBuild = await buildKovoComponentClientModules(appModulePath, root, options);
  const cssAssetManifestOptions =
    routeTargets.length === 0 ? undefined : { split: { routes: routeTargets } };
  const cssAssetManifests = [
    viteAssetPlugin.getCssAssetManifest?.(cssAssetManifestOptions),
    componentBuild.getCssAssetManifest?.(cssAssetManifestOptions),
  ].filter((manifest) => manifest !== undefined);
  for (const cssAssetManifest of cssAssetManifests) {
    if (cssAssetManifest.chunks)
      assertKovoBuildCssDelivery(cssAssetManifest, routeTargets, cssRouteDeliveryGate);
  }
  const appCss = dedupeCss(
    cssAssetManifests.flatMap((manifest) =>
      (manifest.stylesheets ?? []).flatMap((asset) =>
        asset.criticalCss ? [asset.criticalCss] : [],
      ),
    ),
  );
  const splitStylesheetAssets = mergeKovoBuildStylesheetAssets(
    cssAssetManifests.map((manifest) => stylesheetAssetsFromCssSplitChunks(manifest.chunks)),
  );
  const monolithAppCss = cssAssetManifests.some((manifest) => manifest.chunks) ? null : appCss;

  return {
    assets: splitStylesheetAssets,
    clientModules: componentBuild.getClientModules?.() ?? [],
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
  options: { cache: boolean; queryShapeFacts: readonly QueryShapeFact[] },
): Promise<{
  getClientModules?: () => readonly KovoAppShellCompiledClientModule[];
  getCssAssetManifest?: ReturnType<
    typeof import('@kovojs/compiler').kovoVitePlugin
  >['getCssAssetManifest'];
}> {
  const [{ kovoVitePlugin }, { build }] = await Promise.all([
    import('@kovojs/compiler'),
    import('vite-plus'),
  ]);
  const kovoPlugin = kovoVitePlugin({
    cache: options.cache,
    include: [kovoBuildAppSourceFilter(appModulePath, root)],
    queryShapeFacts: options.queryShapeFacts,
  });
  const tempDir = mkdtempSync(join(tmpdir(), 'kovo-client-modules-'));
  const entryPath = join(tempDir, 'entry.ts');
  const outDir = join(tempDir, 'out');

  try {
    writeFileSync(
      entryPath,
      [
        '// Compiler scan entry generated by kovo build.',
        `import ${JSON.stringify(pathToFileURL(appModulePath).href)};`,
        '',
      ].join('\n'),
      'utf8',
    );
    await build({
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
      plugins: [kovoBuildLoweringVitePlugin(kovoPlugin), bundledUndiciRuntimeVitePlugin()],
      resolve: {
        alias: [
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
      ssr: { external: ['@node-rs/argon2'], noExternal: [/^@kovojs\//] },
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

  return {
    app: buildStylesheetAssets(chunks.base),
    fragments: Object.fromEntries(
      Object.entries(chunks.fragments).map(([fragment, assets]) => [
        fragment,
        buildStylesheetAssets(assets),
      ]),
    ),
    routes: Object.fromEntries(
      Object.entries(chunks.routes).map(([route, assets]) => [
        route,
        buildStylesheetAssets(assets),
      ]),
    ),
  };
}

function emptyKovoBuildStylesheetAssets(): KovoBuildStylesheetAssets {
  return { app: [], fragments: {}, routes: {} };
}

function buildStylesheetAssets(
  assets: readonly KovoBuildCssSplitChunk[],
): readonly StylesheetAsset[] {
  return assets.flatMap((asset) =>
    asset.criticalCss ? [{ criticalCss: asset.criticalCss, href: asset.href }] : [],
  );
}

function stylesheetCssFromBuildStylesheetAssets(
  assets: KovoBuildStylesheetAssets,
): KovoBuildStylesheetCss[] {
  return [
    ...assets.app,
    ...Object.values(assets.routes).flat(),
    ...Object.values(assets.fragments).flat(),
  ].flatMap((asset) => (asset.criticalCss ? [{ css: asset.criticalCss, href: asset.href }] : []));
}

function mergeKovoBuildStylesheetAssets(
  assetSets: readonly KovoBuildStylesheetAssets[],
): KovoBuildStylesheetAssets {
  const routes: Record<string, StylesheetAsset[]> = {};
  const fragments: Record<string, StylesheetAsset[]> = {};

  for (const assets of assetSets) {
    mergeStylesheetAssetsInto(routes, assets.routes);
    mergeStylesheetAssetsInto(fragments, assets.fragments);
  }

  return {
    app: mergeStylesheetAssets(assetSets.flatMap((assets) => assets.app)),
    fragments,
    routes,
  };
}

function mergeStylesheetAssetsInto(
  target: Record<string, StylesheetAsset[]>,
  source: Readonly<Record<string, readonly StylesheetAsset[]>>,
): void {
  for (const [key, assets] of Object.entries(source)) {
    target[key] = mergeStylesheetAssets([...(target[key] ?? []), ...assets]);
  }
}

function mergeStylesheetAssets(assets: readonly (string | StylesheetAsset)[]): StylesheetAsset[] {
  const byHref = new Map<string, string[]>();
  const hrefOrder: string[] = [];
  for (const asset of assets) {
    const href = typeof asset === 'string' ? asset : asset.href;
    if (!byHref.has(href)) hrefOrder.push(href);
    const chunks = byHref.get(href) ?? [];
    if (typeof asset !== 'string' && asset.criticalCss) chunks.push(asset.criticalCss);
    byHref.set(href, chunks);
  }

  return hrefOrder.map((href) => {
    const criticalCss = (byHref.get(href) ?? [])
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .join('\n');
    return {
      ...(criticalCss ? { criticalCss } : {}),
      href,
    };
  });
}

function appWithBuildStylesheetAssets(app: KovoApp, assets: KovoBuildStylesheetAssets): KovoApp {
  if (
    assets.app.length === 0 &&
    Object.keys(assets.fragments).length === 0 &&
    Object.keys(assets.routes).length === 0
  )
    return app;

  return {
    ...app,
    liveTargetRenderers: app.liveTargetRenderers.map((renderer) => {
      const fragmentAssets = assets.fragments[renderer.component] ?? [];
      if (fragmentAssets.length === 0) return renderer;

      return {
        ...renderer,
        stylesheets: mergeStylesheetAssets([...(renderer.stylesheets ?? []), ...fragmentAssets]),
      };
    }),
    stylesheets: mergeStylesheetAssets([...app.stylesheets, ...assets.app]),
    routes: app.routes.map((route) => {
      const routeAssets = assets.routes[route.path] ?? [];
      if (routeAssets.length === 0) return route;

      route.stylesheets = mergeStylesheetAssets([...(route.stylesheets ?? []), ...routeAssets]);
      return route;
    }),
  };
}

function kovoClientBuildRoot(appModulePath: string): string {
  for (let current = dirname(appModulePath); ; current = dirname(current)) {
    if (existsSync(join(current, 'index.html'))) return current;
    const parent = dirname(current);
    if (parent === current) return process.cwd();
  }
}

async function bundleKovoServerHandler(
  appModulePath: string,
  options: {
    queryShapeFacts: readonly QueryShapeFact[];
    runtimeRegistry: RuntimeRegistryWireFacts;
    stylesheetAssets?: KovoBuildStylesheetAssets;
  },
): Promise<{
  clientModules: readonly KovoAppShellCompiledClientModule[];
  source: string;
}> {
  const [{ kovoVitePlugin }, { build }] = await Promise.all([
    import('@kovojs/compiler'),
    import('vite-plus'),
  ]);
  const kovoPlugin = kovoVitePlugin({
    include: [kovoBuildAppSourceFilter(appModulePath, process.cwd())],
    queryShapeFacts: options.queryShapeFacts,
  });
  const stylesheetAssets = options.stylesheetAssets ?? emptyKovoBuildStylesheetAssets();
  const tempDir = mkdtempSync(join(tmpdir(), 'kovo-build-'));
  const entryPath = join(tempDir, 'entry.mjs');
  const runtimeRegistryPath = join(tempDir, 'runtime-registry.mjs');
  const outDir = join(tempDir, 'out');

  try {
    writeFileSync(
      runtimeRegistryPath,
      serializeRuntimeRegistryWireModule(options.runtimeRegistry),
      'utf8',
    );
    writeFileSync(entryPath, kovoServerHandlerEntrySource(appModulePath, stylesheetAssets), 'utf8');
    await build({
      appType: 'custom',
      build: {
        emptyOutDir: true,
        minify: false,
        outDir,
        rollupOptions: {
          // SPEC 6.6 keeps Argon2 as the runtime password sink. Do not make apps that import the
          // @kovojs/server barrel evaluate native optional packages during server-handler bundling.
          external: isKovoServerHandlerExternalDependency,
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
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
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
      plugins: [kovoBuildLoweringVitePlugin(kovoPlugin), bundledUndiciRuntimeVitePlugin()],
      resolve: {
        alias: [
          { find: /^@kovojs\/server$/, replacement: requireFromCli.resolve('@kovojs/server') },
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
      root: process.cwd(),
      ssr: { external: ['@node-rs/argon2'], noExternal: [/^@kovojs\//] },
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

function kovoBuildAppSourceFilter(
  appModulePath: string,
  root: string,
): (fileName: string) => boolean {
  const appDir = slashPath(relative(root, dirname(appModulePath))).replace(/\/+$/, '');
  const rootPrefix = `${slashPath(root).replace(/^\/+/, '').replace(/\/+$/, '')}/`;
  return (fileName) => {
    const normalized = slashPath(fileName).replace(/^\/+/, '');
    const projectRelative = normalized.startsWith(rootPrefix)
      ? normalized.slice(rootPrefix.length)
      : normalized;
    if (projectRelative.startsWith('..')) return false;
    if (projectRelative === 'node_modules' || projectRelative.startsWith('node_modules/'))
      return false;
    if (appDir === '' || appDir === '.') return true;
    return projectRelative === appDir || projectRelative.startsWith(`${appDir}/`);
  };
}

const bundledUndiciRuntimeModuleId = '\0kovo-bundled-undici-runtime';

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
      return `export { Agent, getGlobalDispatcher, setGlobalDispatcher } from ${JSON.stringify(
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
        code: `import { Agent, getGlobalDispatcher, setGlobalDispatcher } from ${JSON.stringify(
          pathToFileURL(requireFromCli.resolve('undici')).href,
        )};\n${rewritten}`,
        map: null,
      };
    },
  };
}

function kovoServerHandlerEntrySource(
  appModulePath: string,
  stylesheetAssets: KovoBuildStylesheetAssets,
): string {
  return [
    "import './runtime-registry.mjs';",
    "import { createRequestHandler } from '@kovojs/server';",
    `import * as appModule from ${JSON.stringify(pathToFileURL(appModulePath).href)};`,
    'const app = appModule.default ?? appModule.app;',
    `const stylesheetAssets = ${JSON.stringify(stylesheetAssets)};`,
    'export default createRequestHandler(appWithBuildStylesheetAssets(app, stylesheetAssets));',
    '',
    'function appWithBuildStylesheetAssets(app, assets) {',
    '  if (assets.app.length === 0 && Object.keys(assets.fragments).length === 0 && Object.keys(assets.routes).length === 0) return app;',
    '  return {',
    '    ...app,',
    '    liveTargetRenderers: app.liveTargetRenderers.map((renderer) => {',
    '      const fragmentAssets = assets.fragments[renderer.component] ?? [];',
    '      if (fragmentAssets.length === 0) return renderer;',
    '      return { ...renderer, stylesheets: mergeStylesheetAssets([...(renderer.stylesheets ?? []), ...fragmentAssets]) };',
    '    }),',
    '    stylesheets: mergeStylesheetAssets([...app.stylesheets, ...assets.app]),',
    '    routes: app.routes.map((route) => {',
    '      const routeAssets = assets.routes[route.path] ?? [];',
    '      if (routeAssets.length === 0) return route;',
    '      route.stylesheets = mergeStylesheetAssets([...(route.stylesheets ?? []), ...routeAssets]);',
    '      return route;',
    '    }),',
    '  };',
    '}',
    '',
    'function mergeStylesheetAssets(assets) {',
    '  const byHref = new Map();',
    '  const hrefOrder = [];',
    '  for (const asset of assets) {',
    "    const href = typeof asset === 'string' ? asset : asset.href;",
    '    if (!byHref.has(href)) hrefOrder.push(href);',
    '    const chunks = byHref.get(href) ?? [];',
    "    if (typeof asset !== 'string' && asset.criticalCss) chunks.push(asset.criticalCss);",
    '    byHref.set(href, chunks);',
    '  }',
    '  return hrefOrder.map((href) => {',
    '    const criticalCss = (byHref.get(href) ?? []).map((chunk) => chunk.trim()).filter(Boolean).join("\\n");',
    '    return { ...(criticalCss ? { criticalCss } : {}), href };',
    '  });',
    '}',
    '',
  ].join('\n');
}

export async function runExportCommand(options: KovoExportOptions): Promise<CliCommandResult> {
  const result = await runExportCommandStructured(options);
  if ('error' in result) return result;

  return {
    exitCode: result.exitCode,
    output: result.output,
  };
}

export async function runExportCommandStructured(
  options: KovoExportOptions,
): Promise<CliCommandResult | KovoExportCommandResult> {
  let loadedExport: LoadedExportAppModule | undefined;
  try {
    const manifestPlan = await staticExportManifestPlan(options);
    const staticExport = await withStylesheetEnvOverlay(manifestPlan.stylesheetEnv, async () => {
      loadedExport = await loadExportAppModule(options);
      const app = appFromModule(loadedExport.appModule, options.appModulePath);
      return await loadedExport.exportStaticApp(app, {
        ...(manifestPlan.assets.length === 0 ? {} : { assets: manifestPlan.assets }),
        ...(options.onNonExportable === undefined
          ? {}
          : { onNonExportable: options.onNonExportable }),
        diagnostics: staticExportDiagnosticsFromModule(loadedExport.appModule),
        ...(options.origin === undefined ? {} : { origin: options.origin }),
        outDir: options.outDir,
        ...(options.assetBase === undefined ? {} : { publicAssetBase: options.assetBase }),
        publicAssetRoot:
          manifestPlan.publicAssetRoot ?? staticExportDefaultPublicAssetRoot(options),
      });
    });

    return kovoExportResult(staticExport, options);
  } catch (error) {
    return exportErrorResult(error);
  } finally {
    await loadedExport?.close?.();
  }
}

async function loadExportAppModule(options: KovoExportOptions): Promise<LoadedExportAppModule> {
  if (!options.vite && !exportAppModuleNeedsVite(options.appModulePath)) {
    const { exportStaticApp } = await import('@kovojs/server');
    return {
      appModule: await import(pathToFileURL(resolve(options.appModulePath)).href),
      exportStaticApp,
    };
  }

  const { createServer } = await import('vite-plus');
  const root = resolve(options.root ?? process.cwd());
  const server = await createServer({
    appType: 'custom',
    logLevel: 'error',
    root,
    server: buildTimeViteServerOptions(),
  });
  try {
    const [appModule, serverModule] = await Promise.all([
      server.ssrLoadModule(options.appModulePath),
      server.ssrLoadModule(viteSsrModuleId(requireFromCli.resolve('@kovojs/server'), root)),
    ]);
    return {
      appModule,
      close: () => server.close(),
      exportStaticApp: exportStaticAppFromModule(serverModule),
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}

function exportStaticAppFromModule(moduleValue: unknown): ExportStaticApp {
  if (isRecord(moduleValue) && typeof moduleValue.exportStaticApp === 'function') {
    return moduleValue.exportStaticApp as ExportStaticApp;
  }
  throw new Error('@kovojs/server must export exportStaticApp for kovo export.');
}

function exportAppModuleNeedsVite(appModulePath: string): boolean {
  return ['.ts', '.tsx', '.jsx'].includes(extname(appModulePath));
}

interface ExportManifestPlan {
  assets: readonly {
    path: string;
    source: string;
  }[];
  publicAssetRoot?: string;
  stylesheetHref?: string;
  stylesheetEnv?: {
    name: string;
    value: string;
  };
}

function buildTimeViteServerOptions(): { hmr: false } {
  return { hmr: false };
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
  }

  return {
    assets: [...assets.values()],
    publicAssetRoot: distDir,
    ...(options.stylesheetEnv === undefined || stylesheetHref === undefined
      ? {}
      : { stylesheetEnv: { name: options.stylesheetEnv, value: stylesheetHref } }),
    ...(stylesheetHref === undefined ? {} : { stylesheetHref }),
  };
}

async function withStylesheetEnvOverlay<T>(
  overlay: ExportManifestPlan['stylesheetEnv'],
  fn: () => Promise<T>,
): Promise<T> {
  if (overlay === undefined) return await fn();
  const previous = process.env[overlay.name];
  process.env[overlay.name] = overlay.value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[overlay.name];
    else process.env[overlay.name] = previous;
  }
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
  const source = resolve(distDir, normalizedFile);
  const relativeSource = relative(distDir, source);
  if (relativeSource === '' || relativeSource.startsWith('..') || isAbsolute(relativeSource)) {
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
  result: StaticExportResult,
  options: KovoExportOptions,
): KovoExportCommandResult {
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

  return {
    exitCode: exportResultExitCode(result, options),
    output: `${lines.join('\n')}\n`,
    staticExport: result,
  };
}

function exportResultExitCode(result: StaticExportResult, options: KovoExportOptions): 0 | 1 {
  if (result.diagnostics.length === 0) return 0;
  if (
    options.onNonExportable === 'skip' &&
    result.diagnostics.every((diagnostic) => diagnostic.code === 'KV229')
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
  presetDiagnostics: readonly PresetDiagnostic[];
  presetLogs: readonly string[];
  serverOutDir: string;
}): KovoCheckResult {
  const lines = [
    buildOutputVersion,
    `APP module=${JSON.stringify(options.appModulePath)}`,
    `NEUTRAL outDir=${JSON.stringify(options.neutralOutDir)}`,
    ...options.presetDiagnostics.map(presetDiagnosticOutputLine),
    ...options.presetLogs.map((message) => `PRESET ${stableText(message)}`),
    `SUMMARY preset=${options.preset} outDir=${JSON.stringify(options.outDir)} serverOutDir=${JSON.stringify(options.serverOutDir)}`,
  ];

  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

function kovoBuildCheckResult(options: {
  appModulePath: string;
  neutralOutDir: string;
  preset: KovoBuildPresetName;
  presetDiagnostics: readonly PresetDiagnostic[];
  presetLogs: readonly string[];
}): KovoCheckResult {
  const lines = [
    buildOutputVersion,
    `APP module=${JSON.stringify(options.appModulePath)}`,
    `NEUTRAL outDir=${JSON.stringify(options.neutralOutDir)}`,
    ...options.presetDiagnostics.map(presetDiagnosticOutputLine),
    ...options.presetLogs.map((message) => `PRESET ${stableText(message)}`),
    `CHECK ok preset=${options.preset} (validate-only; deployable output not emitted)`,
  ];

  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

class KovoBuildPresetDiagnosticError extends Error {
  readonly diagnostics: readonly PresetDiagnostic[];

  constructor(diagnostics: readonly PresetDiagnostic[]) {
    super(
      ['kovo build preset inspection failed:', ...diagnostics.map(presetDiagnosticOutputLine)].join(
        '\n',
      ),
    );
    this.diagnostics = diagnostics;
  }
}

function presetDiagnosticOutputLine(diagnostic: PresetDiagnostic): string {
  const label = diagnostic.severity === 'warning' ? 'WARN' : 'ERROR';
  return `${label} ${diagnostic.code} ${stableText(diagnostic.message)}`;
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
