import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { DiagnosticCode } from '@kovojs/core';
import { isDiagnosticCode } from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import type { KovoApp, StaticExportCompileDiagnostic, StylesheetAsset } from '@kovojs/server';
import type { KovoConfig, KovoPreset, PresetContext, PresetDiagnostic } from '@kovojs/server/build';
import type { KovoNeutralBuild } from '@kovojs/server/internal/build';

import { BUILD_USAGE, EXPORT_USAGE } from '../commands-manifest.js';
import { kovoCheck } from '../graph-output.js';
import {
  buildOutputVersion,
  type CliCommandResult,
  type KovoCheckResult,
  stableText,
  stableValue,
} from '../shared.js';

const requireFromCli = createRequire(new URL('../index.ts', import.meta.url));

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

interface KovoBuildOptions {
  appModulePath: string;
  cache: boolean;
  outDir: string;
  preset?: KovoBuildPresetName;
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
  let appModulePath: string | undefined;
  let cache = true;
  let outDir = 'dist';
  let preset: KovoBuildPresetName | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      return { message: buildUsage(), ok: false };
    }
    if (arg === '--no-cache') {
      cache = false;
      continue;
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
      cache,
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

export function parseExportArgs(args: readonly string[]): ExportArgParseResult {
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
      if (!manifestFile)
        return { message: 'kovo: export --manifest requires a file.\n', ok: false };
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

export async function runBuildCommand(options: KovoBuildOptions): Promise<CliCommandResult> {
  try {
    const loadedConfig = await loadKovoBuildConfig(process.cwd());
    const selectedPreset = selectedKovoBuildPreset(options, loadedConfig.config);
    const resolvedAppModulePath = resolve(options.appModulePath);
    runTypeScriptBuildPreflight(resolvedAppModulePath);
    const [{ cloudflare, node, vercel }, { writeKovoNeutralBuild }, appModule, buildStylesheetCss] =
      await Promise.all([
        import('@kovojs/server/build'),
        import('@kovojs/server/internal/build'),
        loadBuildAppModule(resolvedAppModulePath, process.cwd()),
        kovoBuildStylesheetCss(resolvedAppModulePath),
      ]);
    const app = appFromModule(appModule, options.appModulePath);
    await runKovoBuildCheckPreflight(app, resolvedAppModulePath);
    const outDir = resolve(options.outDir);
    const clientBuild = await buildKovoClientManifest(
      join(outDir, '.kovo-client'),
      kovoClientBuildRoot(resolvedAppModulePath),
      resolvedAppModulePath,
      { cache: options.cache },
    );
    const buildCssAssets = mergeKovoBuildStylesheetAssets([
      buildStylesheetCss.assets,
      clientBuild.assets,
    ]);
    const buildApp = appWithBuildStylesheetAssets(app, buildCssAssets);
    const serverHandlerSource = await bundleKovoServerHandler(
      resolvedAppModulePath,
      buildCssAssets,
    );
    const neutralBuild = await writeKovoNeutralBuild({
      app: buildApp,
      buildStylesheetCss: [...buildStylesheetCss.stylesheetCss, ...clientBuild.stylesheetCss],
      manifestFile: clientBuild.manifestFile,
      outDir: join(outDir, '.kovo'),
      serverHandlerSource,
    });
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

    const declaredEnv = inferredKovoBuildDeclaredEnv(serverHandlerSource);
    const presetContext: PresetContext = {
      declaredEnv,
      log(message) {
        presetLogs.push(message);
      },
      outDir: presetOutDir,
      readServerHandlerSource() {
        return serverHandlerSource;
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

function runTypeScriptBuildPreflight(appModulePath: string): void {
  const tsconfigPath = findBuildTsconfig(appModulePath);
  if (tsconfigPath === undefined) return;

  let tscBin: string;
  try {
    tscBin = createRequire(`${dirname(tsconfigPath)}/package.json`).resolve('typescript/bin/tsc');
  } catch (error) {
    throw new Error(
      `kovo build TypeScript preflight could not resolve typescript from ${dirname(
        tsconfigPath,
      )}. Install typescript or remove ${tsconfigPath}.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    execFileSync(process.execPath, [tscBin, '--noEmit', '--project', tsconfigPath], {
      cwd: dirname(tsconfigPath),
      encoding: 'utf8',
      env: process.env,
      stdio: 'pipe',
    });
  } catch (error) {
    throw new Error(`kovo build TypeScript preflight failed:\n${execFileErrorOutput(error)}`);
  }
}

async function runKovoBuildCheckPreflight(app: KovoApp, appModulePath: string): Promise<void> {
  const graph = await buildCheckGraph(app, appModulePath);
  const result = kovoCheck(graph);
  if (result.exitCode === 0) return;

  throw new Error(`kovo build check preflight failed:\n${result.output.trimEnd()}`);
}

async function buildCheckGraph(
  app: KovoApp,
  appModulePath: string,
): Promise<CoreGraph.KovoCheckInput> {
  const [{ accessFactsFromApp }, { deriveAppGraph }] = await Promise.all([
    import('@kovojs/server/internal/execution'),
    import('@kovojs/compiler/graph'),
  ]);
  const graph = await staticBuildCheckGraph(app, appModulePath);
  const result = deriveAppGraph({
    graph: {
      ...graph,
      access: accessFactsFromApp(app),
    },
  });
  if (result.diagnostics.length > 0) {
    return {
      ...result.graph,
      diagnostics: [
        ...(graph.diagnostics ?? []),
        ...result.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          message: diagnostic.message,
          severity: diagnostic.severity ?? 'error',
          site: diagnostic.fileName,
          ...(diagnostic.start === undefined ? {} : { start: diagnostic.start }),
        })),
      ],
    };
  }
  return result.graph;
}

async function staticBuildCheckGraph(
  app: KovoApp,
  appModulePath: string,
): Promise<CoreGraph.KovoCheckInput> {
  const files = buildCheckSourceFiles(appModulePath);
  const [queries, touchGraphDiagnostics, touchGraph] =
    files.length === 0 ? [[], [], undefined] : await staticDrizzleBuildFacts(files);
  const liveTargetQueries = liveTargetQueryDefinitions(app);

  return {
    ...(touchGraph === undefined ? {} : { touchGraph }),
    ...(touchGraphDiagnostics.length === 0 ? {} : { sqlSafetyDiagnostics: touchGraphDiagnostics }),
    endpoints: app.endpoints.map(endpointCheckFact),
    mutations: app.mutations.map((mutation) => mutationCheckFact(mutation, liveTargetQueries)),
    optimistic: app.mutations.flatMap((mutation) =>
      mutationOptimisticCheckFacts(mutation, liveTargetQueries),
    ),
    pages: app.routes.map(routeCheckFact),
    queries: app.queries.map((query) => queryCheckFact(query, queries)),
  };
}

interface BuildCheckSourceFile {
  fileName: string;
  source: string;
}

interface QueryReadFactLike {
  readOnlyDomains?: readonly string[];
  reads?: readonly string[];
  query?: string;
}

async function staticDrizzleBuildFacts(
  files: readonly BuildCheckSourceFile[],
): Promise<
  [readonly QueryReadFactLike[], readonly CoreGraph.SqlSafetyDiagnosticFact[], CoreGraph.TouchGraph]
> {
  if (!files.some((file) => /from ['"](?:@kovojs\/drizzle|drizzle-orm)/.test(file.source))) {
    return [[], [], {}];
  }

  let drizzle: typeof import('@kovojs/drizzle/internal/static');
  try {
    drizzle = await import('@kovojs/drizzle/internal/static');
  } catch {
    return [[], [], {}];
  }
  const {
    analyzeSqlSafetyFromProject,
    diagnosticsForQueryFacts,
    extractQueryFactsFromProject,
    extractTouchGraphFromProject,
  } = drizzle;
  const queryFacts = extractQueryFactsFromProject({ files });
  const queryReadFacts = queryFacts as readonly QueryReadFactLike[];
  const diagnostics = [
    ...analyzeSqlSafetyFromProject({ files }),
    ...diagnosticsForQueryFacts(queryFacts),
  ].flatMap(sqlSafetyDiagnosticFact);
  const touchGraph = extractTouchGraphFromProject({ files }) as CoreGraph.TouchGraph;
  return [queryReadFacts, diagnostics, touchGraph];
}

function queryCheckFact(
  query: KovoApp['queries'][number],
  queryFacts: readonly QueryReadFactLike[],
): CoreGraph.QueryReadSet {
  const fact = queryFacts.find((candidate) => candidate.query === query.key);
  const factReads = fact?.reads?.filter(isString) ?? [];
  const declaredReads = (query.reads ?? []) as readonly { key: string }[];
  return {
    domains: uniqueSorted([...declaredReads.map((read) => read.key), ...factReads]),
    query: query.key,
    ...((fact?.readOnlyDomains?.length ?? 0) > 0
      ? { readOnlyDomains: uniqueSorted(fact?.readOnlyDomains?.filter(isString) ?? []) }
      : {}),
    ...(query.access === undefined ? {} : { access: query.access }),
    ...(query.guard === undefined ? {} : { guards: ['query.guard'] }),
  };
}

function mutationCheckFact(
  mutation: KovoApp['mutations'][number],
  liveTargetQueries: readonly { key: string }[],
): CoreGraph.MutationExplain {
  const registry = mutation.registry;
  const touches = (registry?.touches ?? []) as readonly { key: string }[];
  const inferredTouches = (registry?.inferredTouches ?? []) as readonly { domain: string }[];
  const registryQueries = (registry?.queries ?? []) as readonly { key: string }[];
  const writes = uniqueSorted(touches.map((touch) => touch.key));
  const inferredWrites = uniqueSorted(inferredTouches.map((touch) => touch.domain));
  const invalidates = uniqueSorted(
    [...registryQueries, ...liveTargetQueries].map((query) => query.key),
  );
  return {
    ...(mutation.access === undefined ? {} : { access: mutation.access }),
    csrf: mutation.csrf === false ? 'exempt' : 'checked',
    ...(mutation.csrf === false ? { csrfJustification: 'csrf:false mutation declaration' } : {}),
    ...(mutation.guard === undefined ? {} : { guards: ['mutation.guard'] }),
    ...(invalidates.length === 0 ? {} : { invalidates }),
    key: mutation.key,
    ...(writes.length === 0 && inferredWrites.length === 0
      ? {}
      : { writes: uniqueSorted([...writes, ...inferredWrites]) }),
  };
}

function mutationOptimisticCheckFacts(
  mutation: KovoApp['mutations'][number],
  liveTargetQueries: readonly { key: string }[],
): CoreGraph.OptimisticCoverage[] {
  const optimistic = mutation.optimistic as Record<string, unknown> | undefined;
  if (optimistic === undefined) return [];

  const registryQueries = (mutation.registry?.queries ?? []) as readonly { key: string }[];
  return uniqueQueries([...registryQueries, ...liveTargetQueries]).flatMap((query) => {
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

function liveTargetQueryDefinitions(app: KovoApp): readonly { key: string }[] {
  return uniqueQueries(
    app.liveTargetRenderers.flatMap(
      (renderer) => (renderer.queryDefinitions ?? []) as readonly { key: string }[],
    ),
  );
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

function endpointCheckFact(endpoint: KovoApp['endpoints'][number]): CoreGraph.EndpointExplain {
  const csrf = endpoint.csrf?.exempt === true ? 'exempt' : 'checked';
  return {
    ...(endpoint.access === undefined ? {} : { access: endpoint.access }),
    appOwnedSafety: endpoint.response.appOwnedSafety,
    ...(endpoint.auth === undefined
      ? {}
      : { auth: endpoint.auth.kind === 'none' ? 'none' : endpoint.auth.name }),
    body: endpoint.response.body,
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
    path: endpoint.path,
    reason: endpoint.reason,
    surface: 'endpoint',
  };
}

function buildCheckSourceFiles(appModulePath: string): BuildCheckSourceFile[] {
  const sourceDir = dirname(appModulePath);
  return sourceFilesUnder(sourceDir, sourceDir);
}

function sourceFilesUnder(dir: string, root: string): BuildCheckSourceFile[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSafe(dir);
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === '.kovo') return [];
    const stat = statSafe(path);
    if (!stat) return [];
    if (stat.isDirectory()) return sourceFilesUnder(path, root);
    if (!/\.[cm]?[jt]sx?$/.test(entry) || entry.endsWith('.d.ts')) return [];
    return [
      {
        fileName: relative(root, path).split(/[\\/]/).join('/'),
        source: readFileSync(path, 'utf8'),
      },
    ];
  });
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

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sqlSafetyDiagnosticFact(value: unknown): CoreGraph.SqlSafetyDiagnosticFact[] {
  if (!isRecord(value)) return [];
  if (
    isDiagnosticCode(value.code) &&
    typeof value.message === 'string' &&
    typeof value.site === 'string' &&
    (value.severity === undefined ||
      value.severity === 'error' ||
      value.severity === 'warn' ||
      value.severity === 'lint' ||
      value.severity === 'notice')
  ) {
    return [
      {
        code: value.code,
        message: value.message,
        severity: value.severity ?? 'error',
        site: value.site,
      },
    ];
  }
  return [];
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
    server: { middlewareMode: true },
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

async function loadBuildAppModule(appModulePath: string, root: string): Promise<unknown> {
  const { createServer } = await import('vite-plus');
  const server = await createServer({
    appType: 'custom',
    logLevel: 'error',
    root,
    server: { hmr: false, middlewareMode: true },
  });
  try {
    return await server.ssrLoadModule(viteSsrModuleId(appModulePath, root));
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
  options: { cache: boolean },
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
  const kovoPlugin = kovoVitePlugin({ cache: options.cache });
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
    plugins: [kovoPlugin],
    root,
  });

  const cssAssetManifest = kovoPlugin.getCssAssetManifest?.(
    routeTargets.length === 0 ? undefined : { split: { routes: routeTargets } },
  );
  if (cssAssetManifest?.chunks)
    assertKovoBuildCssDelivery(cssAssetManifest, routeTargets, cssRouteDeliveryGate);
  const appCss = dedupeCss(
    (cssAssetManifest?.stylesheets ?? []).flatMap((asset) =>
      asset.criticalCss ? [asset.criticalCss] : [],
    ),
  );
  const splitStylesheetAssets = stylesheetAssetsFromCssSplitChunks(cssAssetManifest?.chunks);
  const monolithAppCss = cssAssetManifest?.chunks ? null : appCss;

  return {
    assets: splitStylesheetAssets,
    manifestFile: join(outDir, '.vite/manifest.json'),
    stylesheetCss: [
      ...(monolithAppCss ? [{ css: monolithAppCss, href: '/assets/styles.css' }] : []),
      ...stylesheetCssFromBuildStylesheetAssets(splitStylesheetAssets),
    ],
  };
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
  stylesheetAssets: KovoBuildStylesheetAssets = emptyKovoBuildStylesheetAssets(),
): Promise<string> {
  const { build } = await import('vite-plus');
  const tempDir = mkdtempSync(join(tmpdir(), 'kovo-build-'));
  const entryPath = join(tempDir, 'entry.mjs');
  const outDir = join(tempDir, 'out');

  try {
    writeFileSync(entryPath, kovoServerHandlerEntrySource(appModulePath, stylesheetAssets), 'utf8');
    await build({
      appType: 'custom',
      build: {
        commonjsOptions: {
          dynamicRequireTargets: [requireFromCli.resolve('undici')],
        },
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
      logLevel: 'silent',
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
      root: process.cwd(),
      ssr: { external: ['@node-rs/argon2'], noExternal: [/^@kovojs\//] },
    });

    return await readFile(join(outDir, 'handler.mjs'), 'utf8');
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function kovoServerHandlerEntrySource(
  appModulePath: string,
  stylesheetAssets: KovoBuildStylesheetAssets,
): string {
  return [
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

  return {
    assets: [...assets.values()],
    ...(stylesheetHref === undefined ? {} : { stylesheetHref }),
  };
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
