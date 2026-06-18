import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { KovoApp } from './app-types.js';
import type { StylesheetAsset } from './hints.js';
import { exportStaticApp } from './static-export.js';
import type { StaticExportAssetInput } from './static-export-types.js';
import type { StaticExportDiagnostic } from './static-export-diagnostics.js';
import { staticExportRoutePlan, type StaticExportRouteTarget } from './static-export-route-plan.js';
import { resolvedFileSystemPath, viteDistSourcePath } from './vite-build-assets.js';
import {
  createKovoAppShellViteBuild,
  createKovoAppShellViteBuildFromManifestFile,
  type KovoAppShellBuiltClientModule,
  type KovoAppShellCompiledClientModule,
  type KovoAppShellRouteBuildHints,
} from './vite-build.js';
import { writeKovoAppShellViteBuildOutput } from './vite-build-output.js';
import type { KovoAppShellRouteEntryMap } from './vite-manifest.js';

const neutralBuildVersion = 'kovo-neutral-build/v1';
const immutableCacheControl = 'public, max-age=31536000, immutable';

/** Build-time preset descriptor consumed by `kovo build` and deployment tooling. */
export interface KovoPreset {
  /** Emit platform-native output from an already-written neutral build. */
  emit?(build: KovoNeutralBuild, context: PresetContext): Promise<void> | void;
  /** Return target-specific diagnostics before output is emitted. */
  inspect?(
    build: KovoNeutralBuild,
    context: PresetInspectContext,
  ): Promise<readonly PresetDiagnostic[]> | readonly PresetDiagnostic[];
  /** Stable preset name, such as `node`, `vercel`, or `cloudflare`. */
  name: string;
}

/** Context passed to a preset while it validates target-specific constraints. */
export interface PresetInspectContext {
  /** Environment variables the app declares or the build inferred, such as `DATABASE_URL`. */
  declaredEnv: readonly string[];
  /** Read the bundled request handler source when a preset needs target-specific inspection. */
  readServerHandlerSource?(): Promise<string | undefined> | string | undefined;
}

/** Context passed to a preset while it transforms the neutral build output. */
export interface PresetContext extends PresetInspectContext {
  /** Build log sink supplied by the CLI or host integration. */
  log(message: string): void;
  /** Platform output directory for the preset. */
  outDir: string;
  /** Read the neutral build facts the preset is transforming. */
  readNeutral(): KovoNeutralBuild;
}

/** A preset validation diagnostic reported before platform output is emitted. */
export interface PresetDiagnostic {
  /** Stable diagnostic code owned by the preset. */
  code: string;
  /** Human-readable diagnostic message. */
  message: string;
  /** Whether the diagnostic blocks the build. */
  severity: 'error' | 'warning';
}

/** Options for the built-in Node/VPS preset. */
export interface NodePresetOptions {
  /** Whether the node preset emits a minimal Dockerfile next to `server.mjs`; defaults to true. */
  dockerfile?: boolean;
}

/** Built-in Node/VPS preset descriptor returned by `node()`. */
export interface NodePreset extends KovoPreset {
  /** Emit a standalone Node output from Kovo's neutral build artifact. */
  emit(build: KovoNeutralBuild, context: PresetContext): Promise<void>;
  /** Return blocking diagnostics when the neutral build lacks a request handler. */
  inspect(build: KovoNeutralBuild, context: PresetInspectContext): readonly PresetDiagnostic[];
  /** Options captured by `node()`. */
  options: NodePresetOptions;
}

/** Options for the built-in Vercel preset. */
export interface VercelPresetOptions {
  /** Maximum Vercel Function duration in seconds. */
  maxDuration?: number;
  /** Vercel Function memory in MB. */
  memory?: number;
  /** Vercel regions for the Node function. */
  regions?: readonly string[];
}

/** Built-in Vercel Build Output API v3 preset descriptor returned by `vercel()`. */
export interface VercelPreset extends KovoPreset {
  /** Emit `.vercel/output` from Kovo's neutral build artifact. */
  emit(build: KovoNeutralBuild, context: PresetContext): Promise<void>;
  /** Return blocking diagnostics when the neutral build lacks a request handler. */
  inspect(build: KovoNeutralBuild, context: PresetInspectContext): readonly PresetDiagnostic[];
  /** Options captured by `vercel()`. */
  options: VercelPresetOptions;
}

/** Options for the built-in Cloudflare Workers preset. */
export interface CloudflarePresetOptions {
  /** Worker compatibility date; defaults to the first date that supports `nodejs_compat` v2. */
  compatibilityDate?: string;
  /** Generated Worker name in `wrangler.toml`; defaults to `kovo-app`. */
  name?: string;
}

/** Built-in Cloudflare Workers preset descriptor returned by `cloudflare()`. */
export interface CloudflarePreset extends KovoPreset {
  /** Emit a Wrangler project from Kovo's neutral build artifact. */
  emit(build: KovoNeutralBuild, context: PresetContext): Promise<void>;
  /** Return diagnostics for Cloudflare Worker runtime constraints. */
  inspect(
    build: KovoNeutralBuild,
    context: PresetInspectContext,
  ): Promise<readonly PresetDiagnostic[]>;
  /** Options captured by `cloudflare()`. */
  options: CloudflarePresetOptions;
}

/** Build-time project configuration loaded from `kovo.config.ts`. */
export interface KovoConfig {
  /** Platform preset used by `kovo build` when CLI/env overrides are absent. */
  preset?: KovoPreset;
}

/** Type helper for authoring `kovo.config.ts` without changing runtime behavior. */
export function defineConfig(config: KovoConfig): KovoConfig {
  return config;
}

/**
 * Create the built-in Node/VPS preset descriptor.
 *
 * The emitted output wraps the neutral `server/handler.mjs` Request-to-Response
 * contract in a Node `http` server and serves immutable `/c/*` and `/assets/*`
 * client files without Vite at request time.
 */
export function node(options: NodePresetOptions = {}): NodePreset {
  return {
    emit(build, context) {
      return emitNodePreset(build, context, options);
    },
    inspect(build, _context) {
      const diagnostics = clientModuleRetentionDiagnostics(build, 'node');
      if (build.serverHandlerPath === undefined && build.staticOutput === undefined) {
        diagnostics.push({
          code: 'node-missing-handler',
          message: 'The node preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        });
      }
      return diagnostics;
    },
    name: 'node',
    options,
  };
}

/**
 * Create the built-in Vercel preset descriptor.
 *
 * The emitted output follows Vercel Build Output API v3: static client files
 * land under `.vercel/output/static`, and the request handler is wrapped as a
 * Node.js Vercel Function under `.vercel/output/functions/kovo.func`.
 */
export function vercel(options: VercelPresetOptions = {}): VercelPreset {
  return {
    emit(build, context) {
      return emitVercelPreset(build, context, options);
    },
    inspect(build, _context) {
      const diagnostics = clientModuleRetentionDiagnostics(build, 'vercel');
      if (build.serverHandlerPath === undefined && build.staticOutput === undefined) {
        diagnostics.push({
          code: 'vercel-missing-handler',
          message: 'The vercel preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        });
      }
      return diagnostics;
    },
    name: 'vercel',
    options,
  };
}

/**
 * Create the built-in Cloudflare Workers preset descriptor.
 *
 * The emitted output is a Wrangler project with a module Worker, static assets
 * binding, and `nodejs_compat` enabled for the current Node-first request path.
 */
export function cloudflare(options: CloudflarePresetOptions = {}): CloudflarePreset {
  return {
    emit(build, context) {
      return emitCloudflarePreset(build, context, options);
    },
    async inspect(build, context) {
      const diagnostics = clientModuleRetentionDiagnostics(build, 'cloudflare');
      if (build.serverHandlerPath === undefined && build.staticOutput === undefined) {
        diagnostics.push({
          code: 'cloudflare-missing-handler',
          message: 'The cloudflare preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        });
      }
      if (build.serverHandlerPath === undefined) return diagnostics;

      diagnostics.push(...(await cloudflareRuntimeDiagnostics(build, context)));
      return diagnostics;
    },
    name: 'cloudflare',
    options,
  };
}

/** Inputs for writing Kovo's platform-neutral deployment artifact. */
export interface WriteKovoNeutralBuildOptions {
  /** App aggregate produced by `createApp()`. */
  app: KovoApp;
  /** Optional public base path used to resolve manifest asset hrefs. */
  base?: string;
  /**
   * Build-owned CSS fragments to materialize into declared stylesheet assets, such as
   * first-party package component CSS extracted by `kovo build` (SPEC.md §13.1).
   */
  buildStylesheetCss?: readonly {
    /** CSS text to merge into the stylesheet asset. */
    css: string;
    /** Public stylesheet href that receives this CSS. */
    href: string;
  }[];
  /** Compiler-produced client modules that should be emitted under `client/c/`. */
  clientModules?: readonly KovoAppShellCompiledClientModule[];
  /** Vite manifest file used to derive asset inventory and per-route hints. */
  manifestFile?: string | URL;
  /** Target neutral artifact directory, conventionally `dist/.kovo`. */
  outDir: string | URL;
  /** Route path to Vite entry mapping used for route hints. */
  routeEntryMap?: KovoAppShellRouteEntryMap;
  /** Optional pre-bundled handler source to write to `server/handler.mjs`. */
  serverHandlerSource?: string;
}

/** Facts returned after writing the platform-neutral deployment artifact. */
export interface KovoNeutralBuild {
  /** Absolute path to the neutral client directory. */
  clientDir: string;
  /** Versioned client modules emitted under `client/c/`. */
  clientModules: readonly KovoAppShellBuiltClientModule[];
  /** Absolute path to the neutral manifest JSON file. */
  manifestPath: string;
  /** Absolute path to the neutral meta JSON file. */
  metaPath: string;
  /** Absolute path to the neutral build root. */
  outDir: string;
  /** Per-route Vite hints merged into the built app shell. */
  routeHints: readonly KovoAppShellRouteBuildHints[];
  /** Absolute path to the neutral routes JSON file. */
  routesPath: string;
  /** Absolute path to the neutral server directory. */
  serverDir: string;
  /** Absolute path to `server/handler.mjs` when a handler source was supplied. */
  serverHandlerPath?: string;
  /** Static assets discovered from the Vite manifest. */
  staticAssets: readonly {
    file: string;
    href: string;
    path: string;
  }[];
  /** Fully static output when every route was proven exportable. */
  staticOutput?: {
    /** Absolute path to the neutral static export directory. */
    dir: string;
    /** Whether every route was exported without route-level diagnostics. */
    complete: boolean;
    /** Route-level diagnostics produced while exporting the static subtree. */
    diagnostics: readonly StaticExportDiagnostic[];
    /** Absolute path to the static export manifest JSON file. */
    manifestPath: string;
    /** Concrete route documents written into the static subtree. */
    routeDocuments: readonly StaticExportRouteTarget[];
  };
  /** Whether this build can be deployed without a server/function fallback. */
  staticOnly: boolean;
  /** Neutral artifact schema version. */
  version: typeof neutralBuildVersion;
}

/**
 * Write Kovo's platform-neutral deployment artifact.
 *
 * This Phase 0 API reuses the existing app-shell Vite manifest/client-module pipeline
 * and creates the `dist/.kovo`-style metadata layout. The server bundle step is still
 * supplied by callers as `serverHandlerSource` until `kovo build` owns bundling.
 */
export async function writeKovoNeutralBuild(
  options: WriteKovoNeutralBuildOptions,
): Promise<KovoNeutralBuild> {
  const outDir = resolvedFileSystemPath(options.outDir);
  const clientDir = path.join(outDir, 'client');
  const serverDir = path.join(outDir, 'server');
  const manifestFilePath =
    options.manifestFile === undefined ? undefined : resolvedFileSystemPath(options.manifestFile);
  const manifestDistDir =
    manifestFilePath === undefined ? undefined : path.dirname(path.dirname(manifestFilePath));
  const clientModules = options.clientModules ?? options.app.clientModules.entries();
  const appShellBuild =
    manifestFilePath === undefined
      ? createKovoAppShellViteBuild({
          app: options.app,
          ...(options.base === undefined ? {} : { base: options.base }),
          clientModules,
          ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
        })
      : await createKovoAppShellViteBuildFromManifestFile({
          app: options.app,
          ...(options.base === undefined ? {} : { base: options.base }),
          clientModules,
          manifestFile: manifestFilePath,
          ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
        });

  await mkdir(clientDir, { recursive: true });
  await writeKovoAppShellViteBuildOutput(appShellBuild, {
    outDir: clientDir,
    staticExport: false,
  });
  const serverHandlerSource = options.serverHandlerSource;
  const serverHandlerPath =
    serverHandlerSource === undefined ? undefined : path.join(serverDir, 'handler.mjs');
  if (serverHandlerSource !== undefined && serverHandlerPath !== undefined) {
    await mkdir(serverDir, { recursive: true });
    await writeFile(serverHandlerPath, serverHandlerSource, 'utf8');
  }
  await copyNeutralStaticAssets(appShellBuild.assets, clientDir, manifestDistDir);
  await materializeNeutralStylesheetAssets({
    app: appShellBuild.app,
    assets: appShellBuild.assets,
    buildStylesheetCss: options.buildStylesheetCss ?? [],
    rootDir: clientDir,
  });

  const manifestPath = path.join(outDir, 'manifest.json');
  const routesPath = path.join(outDir, 'routes.json');
  const metaPath = path.join(outDir, 'meta.json');
  const staticOutput = await writeNeutralStaticOutput({
    app: appShellBuild.app,
    assets: appShellBuild.assets,
    manifestDistDir,
    outDir,
  });
  if (staticOutput !== undefined) {
    await materializeNeutralStylesheetAssets({
      app: appShellBuild.app,
      assets: appShellBuild.assets,
      buildStylesheetCss: options.buildStylesheetCss ?? [],
      rootDir: staticOutput.dir,
    });
  }
  const neutral: KovoNeutralBuild = {
    clientDir,
    clientModules: appShellBuild.clientModules,
    manifestPath,
    metaPath,
    outDir,
    routeHints: appShellBuild.routeHints,
    routesPath,
    serverDir,
    ...(serverHandlerPath === undefined ? {} : { serverHandlerPath }),
    staticAssets: appShellBuild.assets,
    ...(staticOutput === undefined ? {} : { staticOutput }),
    staticOnly: neutralBuildIsStaticOnly(appShellBuild.app, staticOutput),
    version: neutralBuildVersion,
  };

  await writeJson(manifestPath, {
    assets: appShellBuild.assets,
    clientModules: appShellBuild.clientModules.map(({ source: _source, ...module }) => module),
    routeHints: appShellBuild.routeHints,
    version: neutralBuildVersion,
  });
  await writeJson(routesPath, {
    routes: neutralBuildRouteEntries(appShellBuild.app, staticOutput),
    version: neutralBuildVersion,
  });
  await writeJson(metaPath, {
    hasServerHandler: serverHandlerPath !== undefined,
    staticOnly: neutral.staticOnly,
    version: neutralBuildVersion,
  });

  return neutral;
}

async function emitNodePreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: NodePresetOptions,
): Promise<void> {
  if (build.serverHandlerPath === undefined) {
    throw new Error('The node preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  await mkdir(outDir, { recursive: true });
  await cp(build.clientDir, path.join(outDir, 'client'), { recursive: true });
  if (build.staticOutput !== undefined) {
    await cp(build.staticOutput.dir, path.join(outDir, 'static'), { recursive: true });
  }
  await cp(build.serverDir, path.join(outDir, 'server'), { recursive: true });
  await writeFile(path.join(outDir, 'server.mjs'), nodeServerSource(), 'utf8');

  if (options.dockerfile !== false) {
    await writeFile(path.join(outDir, 'Dockerfile'), nodeDockerfileSource(), 'utf8');
  }

  context.log(`Emitted Kovo node preset output to ${outDir}`);
}

async function emitVercelPreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: VercelPresetOptions,
): Promise<void> {
  if (build.staticOnly && build.staticOutput !== undefined) {
    const outDir = resolvedFileSystemPath(context.outDir);
    await mkdir(outDir, { recursive: true });
    await cp(build.staticOutput.dir, path.join(outDir, 'static'), { recursive: true });
    await writeJson(path.join(outDir, 'config.json'), { version: 3 });
    context.log(`Emitted Kovo vercel static preset output to ${outDir}`);
    return;
  }

  if (build.serverHandlerPath === undefined) {
    throw new Error('The vercel preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  const functionDir = path.join(outDir, 'functions/kovo.func');
  await mkdir(outDir, { recursive: true });
  await copyPresetStaticFiles(build, path.join(outDir, 'static'));
  await mkdir(functionDir, { recursive: true });
  await copyFile(build.serverHandlerPath, path.join(functionDir, 'handler.mjs'));
  await writeFile(path.join(functionDir, 'index.cjs'), vercelFunctionSource(), 'utf8');
  await writeJson(path.join(functionDir, '.vc-config.json'), {
    handler: 'index.cjs',
    launcherType: 'Nodejs',
    ...(options.maxDuration === undefined ? {} : { maxDuration: options.maxDuration }),
    ...(options.memory === undefined ? {} : { memory: options.memory }),
    ...(options.regions === undefined ? {} : { regions: options.regions }),
    runtime: 'nodejs22.x',
    shouldAddHelpers: true,
  });
  await writeJson(path.join(outDir, 'config.json'), vercelBuildOutputConfig());

  context.log(`Emitted Kovo vercel preset output to ${outDir}`);
}

async function emitCloudflarePreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: CloudflarePresetOptions,
): Promise<void> {
  if (build.staticOnly && build.staticOutput !== undefined) {
    const outDir = resolvedFileSystemPath(context.outDir);
    await mkdir(outDir, { recursive: true });
    await cp(build.staticOutput.dir, path.join(outDir, 'client'), { recursive: true });
    await writeFile(path.join(outDir, 'wrangler.toml'), wranglerTomlSource(options), 'utf8');
    context.log(`Emitted Kovo cloudflare static preset output to ${outDir}`);
    return;
  }

  if (build.serverHandlerPath === undefined) {
    throw new Error('The cloudflare preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  await mkdir(outDir, { recursive: true });
  await copyPresetStaticFiles(build, path.join(outDir, 'client'));
  await mkdir(path.join(outDir, 'server'), { recursive: true });
  await copyFile(build.serverHandlerPath, path.join(outDir, 'server/handler.mjs'));
  await writeFile(path.join(outDir, 'worker.mjs'), cloudflareWorkerSource(), 'utf8');
  await writeFile(path.join(outDir, 'wrangler.toml'), wranglerTomlSource(options), 'utf8');

  context.log(`Emitted Kovo cloudflare preset output to ${outDir}`);
}

interface NeutralStaticOutputOptions {
  app: KovoApp;
  assets: readonly KovoNeutralBuild['staticAssets'][number][];
  manifestDistDir: string | undefined;
  outDir: string;
}

async function writeNeutralStaticOutput({
  app,
  assets,
  manifestDistDir,
  outDir,
}: NeutralStaticOutputOptions): Promise<KovoNeutralBuild['staticOutput'] | undefined> {
  if (app.mutations.length > 0 || app.queries.length > 0) {
    return undefined;
  }

  const staticDir = path.join(outDir, 'static');
  const routePlan = staticExportRoutePlan(app);

  try {
    const result = await exportStaticApp(app, {
      ...(manifestDistDir === undefined
        ? {}
        : { assets: neutralStaticExportAssets(assets, manifestDistDir) }),
      onNonExportable: 'skip',
      outDir: staticDir,
    });
    if (result.artifacts.length === 0) {
      await rmNeutralStaticOutput(staticDir);
      return undefined;
    }

    const diagnosticRoutePaths = new Set(
      result.diagnostics.map((diagnostic) => diagnostic.routePath),
    );
    const manifestPath = path.join(staticDir, 'kovo-static-manifest.json');
    await writeJson(manifestPath, {
      version: neutralBuildVersion,
    });
    return {
      complete: result.diagnostics.length === 0,
      diagnostics: result.diagnostics,
      dir: staticDir,
      manifestPath,
      routeDocuments: routePlan.targets.filter(
        (target) => !diagnosticRoutePaths.has(target.routePath),
      ),
    };
  } catch {
    await rmNeutralStaticOutput(staticDir);
    return undefined;
  }
}

function neutralBuildIsStaticOnly(
  app: KovoApp,
  staticOutput: KovoNeutralBuild['staticOutput'] | undefined,
): boolean {
  return (
    staticOutput?.complete === true &&
    app.endpoints.length === 0 &&
    app.mutations.length === 0 &&
    app.queries.length === 0
  );
}

function neutralBuildRouteEntries(
  app: KovoApp,
  staticOutput: KovoNeutralBuild['staticOutput'] | undefined,
): unknown[] {
  return app.routes.map((route) => {
    const diagnostics =
      staticOutput?.diagnostics.filter((diagnostic) => diagnostic.routePath === route.path) ?? [];
    const staticPaths =
      staticOutput?.routeDocuments
        .filter((document) => document.routePath === route.path)
        .map((document) => document.path) ?? [];
    const policy =
      staticPaths.length === 0 ? 'dynamic' : diagnostics.length === 0 ? 'static' : 'mixed';

    return {
      export: {
        ...(diagnostics.length === 0 ? {} : { diagnostics }),
        policy,
        ...(staticPaths.length === 0 ? {} : { paths: staticPaths }),
      },
      path: route.path,
    };
  });
}

async function copyPresetStaticFiles(build: KovoNeutralBuild, outDir: string): Promise<void> {
  if (build.staticOutput !== undefined) {
    await cp(build.staticOutput.dir, outDir, { recursive: true });
  }
  await cp(build.clientDir, outDir, { recursive: true });
}

function neutralStaticExportAssets(
  assets: readonly KovoNeutralBuild['staticAssets'][number][],
  manifestDistDir: string,
): StaticExportAssetInput[] {
  return assets.map((asset) => ({
    path: asset.path,
    source: viteDistSourcePath(manifestDistDir, asset.file),
  }));
}

async function rmNeutralStaticOutput(staticDir: string): Promise<void> {
  await rm(staticDir, { force: true, recursive: true });
}

function clientModuleRetentionDiagnostics(
  build: KovoNeutralBuild,
  presetName: string,
): PresetDiagnostic[] {
  if (build.clientModules.length === 0) return [];

  return [
    {
      code: 'client-module-retention',
      message: `The ${presetName} preset emits immutable /c/* client modules. Keep old versioned /c/ artifacts published until documents that reference them expire; never purge or rewrite them during deploys.`,
      severity: 'warning',
    },
  ];
}

async function copyNeutralStaticAssets(
  assets: readonly KovoNeutralBuild['staticAssets'][number][],
  clientDir: string,
  manifestDistDir: string | undefined,
): Promise<void> {
  if (manifestDistDir === undefined) return;

  for (const asset of assets) {
    const outputPath = neutralClientOutputPath(clientDir, asset.path);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await copyFile(viteDistSourcePath(manifestDistDir, asset.file), outputPath);
  }
}

interface MaterializeNeutralStylesheetAssetsOptions {
  app: KovoApp;
  assets: readonly KovoNeutralBuild['staticAssets'][number][];
  buildStylesheetCss: readonly { css: string; href: string }[];
  rootDir: string;
}

async function materializeNeutralStylesheetAssets({
  app,
  assets,
  buildStylesheetCss,
  rootDir,
}: MaterializeNeutralStylesheetAssetsOptions): Promise<void> {
  const cssByPath = stylesheetCssByPath(app, assets, buildStylesheetCss);

  for (const [assetPath, cssChunks] of cssByPath) {
    const outputPath = neutralClientOutputPath(rootDir, assetPath);
    const existingCss = await readExistingStylesheet(outputPath);
    const mergedCss = dedupeCssChunks([...cssChunks, existingCss]).join('\n');
    if (!mergedCss) continue;

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${mergedCss}${mergedCss.endsWith('\n') ? '' : '\n'}`, 'utf8');
  }
}

function stylesheetCssByPath(
  app: KovoApp,
  assets: readonly KovoNeutralBuild['staticAssets'][number][],
  buildStylesheetCss: readonly { css: string; href: string }[],
): Map<string, string[]> {
  const cssByPath = new Map<string, string[]>();

  for (const asset of app.stylesheets) {
    addStylesheetCriticalCss(cssByPath, asset);
  }
  for (const route of app.routes) {
    for (const asset of route.stylesheets ?? []) addStylesheetCriticalCss(cssByPath, asset);
  }
  const cssAssetPaths = assets
    .map((asset) => asset.path)
    .filter((assetPath) => assetPath.endsWith('.css'));
  for (const asset of buildStylesheetCss) {
    addStylesheetCss(
      cssByPath,
      buildStylesheetCssHref(asset.href, cssByPath, cssAssetPaths),
      asset.css,
    );
  }

  return cssByPath;
}

function buildStylesheetCssHref(
  href: string,
  cssByPath: Map<string, string[]>,
  cssAssetPaths: readonly string[],
): string {
  const assetPath = localStylesheetAssetPath(href);
  if (assetPath && cssByPath.has(assetPath)) return href;
  if (cssAssetPaths.length === 1) return cssAssetPaths[0];
  return href;
}

function addStylesheetCriticalCss(
  cssByPath: Map<string, string[]>,
  asset: string | StylesheetAsset,
): void {
  if (typeof asset === 'string') return;
  addStylesheetCss(cssByPath, asset.href, asset.criticalCss);
}

function addStylesheetCss(
  cssByPath: Map<string, string[]>,
  href: string,
  css: string | undefined,
): void {
  if (!css) return;

  const assetPath = localStylesheetAssetPath(href);
  if (!assetPath) return;

  const chunks = cssByPath.get(assetPath);
  if (chunks) {
    chunks.push(css);
  } else {
    cssByPath.set(assetPath, [css]);
  }
}

function localStylesheetAssetPath(href: string): string | null {
  try {
    const url = new URL(href, 'https://kovo.local');
    if (url.origin !== 'https://kovo.local') return null;
    return url.pathname;
  } catch {
    return null;
  }
}

async function readExistingStylesheet(fileName: string): Promise<string> {
  try {
    return await readFile(fileName, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return '';
    throw error;
  }
}

function dedupeCssChunks(chunks: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const chunk of chunks) {
    const css = chunk.trim();
    if (!css || seen.has(css)) continue;
    seen.add(css);
    deduped.push(css);
  }

  return deduped;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function neutralClientOutputPath(clientDir: string, urlPath: string): string {
  const relativePath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
  const outputPath = path.resolve(clientDir, relativePath);
  const relativeToClient = path.relative(clientDir, outputPath);

  if (
    relativeToClient === '' ||
    relativeToClient.startsWith('..') ||
    path.isAbsolute(relativeToClient)
  ) {
    throw new Error(`Neutral build asset must stay within the client directory: ${urlPath}`);
  }

  return outputPath;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function vercelBuildOutputConfig(): unknown {
  return {
    routes: [
      {
        continue: true,
        headers: { 'cache-control': immutableCacheControl },
        src: '/(?:assets|c)/(.*)',
      },
      { handle: 'filesystem' },
      { dest: '/kovo', src: '/(.*)' },
    ],
    version: 3,
  };
}

function vercelFunctionSource(): string {
  return `const { Readable } = require('node:stream');

let handlerPromise;

module.exports = async function kovoVercelFunction(nodeRequest, nodeResponse) {
  try {
    const handler = await loadHandler();
    const request = nodeRequestToWebRequest(nodeRequest);
    const response = await handler(request);
    await writeWebResponseToNode(response, nodeResponse, request.method);
  } catch {
    if (!nodeResponse.headersSent) {
      nodeResponse.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    nodeResponse.end('Internal Server Error');
  }
};

async function loadHandler() {
  handlerPromise ||= import('./handler.mjs').then((module) => module.default);
  return handlerPromise;
}

function nodeRequestToWebRequest(nodeRequest) {
  const method = nodeRequest.method ?? 'GET';
  const init = {
    headers: nodeHeadersToWebHeaders(nodeRequest),
    method,
    ...(method === 'GET' || method === 'HEAD'
      ? {}
      : {
          body: Readable.toWeb(nodeRequest),
          duplex: 'half',
        }),
  };

  return new Request(nodeRequestUrl(nodeRequest), init);
}

function nodeRequestUrl(nodeRequest) {
  const rawUrl = nodeRequest.url ?? '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl)) return rawUrl;

  const host = nodeRequest.headers.host ?? '127.0.0.1';
  const proto = firstHeaderValue(nodeRequest.headers['x-forwarded-proto']) ?? 'https';
  return new URL(rawUrl, proto + '://' + host).href;
}

async function writeWebResponseToNode(response, nodeResponse, method = 'GET') {
  const headers = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });

  nodeResponse.writeHead(response.status, response.statusText, headers);
  if (method === 'HEAD' || response.body === null) {
    nodeResponse.end();
    return;
  }

  await new Promise((resolvePromise, reject) => {
    Readable.fromWeb(response.body)
      .once('error', reject)
      .pipe(nodeResponse)
      .once('error', reject)
      .once('finish', resolvePromise);
  });
}

function nodeHeadersToWebHeaders(nodeRequest) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeRequest.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
`;
}

function cloudflareWorkerSource(): string {
  return `import handler from './server/handler.mjs';

const immutableCacheControl = ${JSON.stringify(immutableCacheControl)};
const bodylessMethods = new Set(['GET', 'HEAD']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (bodylessMethods.has(request.method) && env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        const headers = new Headers(assetResponse.headers);
        if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/c/')) {
          headers.set('cache-control', immutableCacheControl);
        }
        return new Response(assetResponse.body, {
          headers,
          status: assetResponse.status,
          statusText: assetResponse.statusText,
        });
      }
    }

    return handler(request);
  },
};
`;
}

async function cloudflareRuntimeDiagnostics(
  build: KovoNeutralBuild,
  context: PresetInspectContext,
): Promise<readonly PresetDiagnostic[]> {
  const source = await serverHandlerSourceForInspection(build, context);
  if (source === undefined) return [];

  const diagnostics: PresetDiagnostic[] = [];
  if (context.declaredEnv.includes('DATABASE_URL') || source.includes('DATABASE_URL')) {
    diagnostics.push({
      code: 'cloudflare-tcp-database',
      message:
        'The cloudflare preset emits a Worker with nodejs_compat. TCP database drivers behind DATABASE_URL need Hyperdrive, Cloudflare Containers, or an HTTP database driver before deploy.',
      severity: 'warning',
    });
  }

  for (const moduleName of cloudflareBlockedNodeModules) {
    if (serverHandlerImportsModule(source, moduleName)) {
      diagnostics.push({
        code: 'cloudflare-unsupported-node-api',
        message: `The cloudflare preset cannot run ${moduleName}; Cloudflare exposes this Node API as a non-functional compatibility stub. Move that code off the request path or deploy with the node preset/Containers.`,
        severity: 'error',
      });
    }
  }

  return diagnostics;
}

const cloudflareBlockedNodeModules = [
  'child_process',
  'cluster',
  'dgram',
  'node:child_process',
  'node:cluster',
  'node:dgram',
] as const;

async function serverHandlerSourceForInspection(
  build: KovoNeutralBuild,
  context: PresetInspectContext,
): Promise<string | undefined> {
  const contextSource = await context.readServerHandlerSource?.();
  if (contextSource !== undefined) return contextSource;
  if (build.serverHandlerPath === undefined) return undefined;
  return readFile(build.serverHandlerPath, 'utf8');
}

function serverHandlerImportsModule(source: string, moduleName: string): boolean {
  const quotedModule = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const modulePattern = new RegExp(
    [
      `\\bfrom\\s*['"]${quotedModule}['"]`,
      `\\bimport\\s*\\(\\s*['"]${quotedModule}['"]\\s*\\)`,
      `\\brequire\\s*\\(\\s*['"]${quotedModule}['"]\\s*\\)`,
    ].join('|'),
  );
  return modulePattern.test(source);
}

function wranglerTomlSource(options: CloudflarePresetOptions): string {
  const name = options.name ?? 'kovo-app';
  const compatibilityDate = options.compatibilityDate ?? '2024-09-23';
  return [
    `name = ${tomlString(name)}`,
    'main = "./worker.mjs"',
    `compatibility_date = ${tomlString(compatibilityDate)}`,
    'compatibility_flags = ["nodejs_compat"]',
    '',
    '[assets]',
    'directory = "./client"',
    'binding = "ASSETS"',
    'run_worker_first = true',
    '',
  ].join('\n');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function nodeServerSource(): string {
  return `import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import handler from './server/handler.mjs';

const clientRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), 'client');
const staticRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), 'static');
const immutableCacheControl = 'public, max-age=31536000, immutable';
const bodylessMethods = new Set(['GET', 'HEAD']);

export function createKovoNodeServer(options = {}) {
  return createServer(async (nodeRequest, nodeResponse) => {
    try {
      if (await maybeServeStatic(nodeRequest, nodeResponse)) return;

      const request = nodeRequestToWebRequest(nodeRequest, options);
      const response = await handler(request);
      await writeWebResponseToNode(response, nodeResponse, request.method);
    } catch {
      if (!nodeResponse.headersSent) {
        nodeResponse.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      }
      nodeResponse.end('Internal Server Error');
    }
  });
}

async function maybeServeStatic(nodeRequest, nodeResponse) {
  const method = nodeRequest.method ?? 'GET';
  if (!bodylessMethods.has(method)) return false;

  const pathname = staticPathname(nodeRequest);
  if (pathname === undefined) return false;
  const immutableAsset = pathname.startsWith('/c/') || pathname.startsWith('/assets/');
  const filePath = immutableAsset ? staticFilePath(clientRoot, pathname) : routeDocumentPath(pathname);

  if (filePath === undefined) {
    if (!immutableAsset) return false;
    nodeResponse.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    nodeResponse.end('Forbidden');
    return true;
  }

  const fileStat = await stat(filePath).catch(() => undefined);
  if (fileStat === undefined || !fileStat.isFile()) {
    if (!immutableAsset) return false;
    nodeResponse.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    nodeResponse.end('Not Found');
    return true;
  }

  nodeResponse.writeHead(200, {
    ...(immutableAsset ? { 'cache-control': immutableCacheControl } : {}),
    'content-length': String(fileStat.size),
    'content-type': contentType(filePath),
  });
  if (method === 'HEAD') {
    nodeResponse.end();
    return true;
  }

  await new Promise((resolvePromise, reject) => {
    createReadStream(filePath)
      .once('error', reject)
      .pipe(nodeResponse)
      .once('error', reject)
      .once('finish', resolvePromise);
  });
  return true;
}

function staticPathname(nodeRequest) {
  try {
    return new URL(nodeRequest.url ?? '/', 'http://kovo.local').pathname;
  } catch {
    return undefined;
  }
}

function routeDocumentPath(pathname) {
  const cleanPathname = pathname.endsWith('/') ? pathname : pathname + '/';
  return staticFilePath(staticRoot, cleanPathname + 'index.html');
}

function staticFilePath(root, pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice(1));
  } catch {
    return undefined;
  }
  if (relativePath.includes('\\0')) return undefined;

  const filePath = resolve(root, relativePath);
  const relativePathFromRoot = relative(root, filePath);
  if (
    relativePathFromRoot === '' ||
    relativePathFromRoot.startsWith('..') ||
    isAbsolute(relativePathFromRoot)
  ) {
    return undefined;
  }

  return filePath;
}

function nodeRequestToWebRequest(nodeRequest, options) {
  const method = nodeRequest.method ?? 'GET';
  const init = {
    headers: nodeHeadersToWebHeaders(nodeRequest),
    method,
    ...(bodylessMethods.has(method)
      ? {}
      : {
          body: Readable.toWeb(nodeRequest),
          duplex: 'half',
        }),
  };

  return new Request(nodeRequestUrl(nodeRequest, options), init);
}

function nodeRequestUrl(nodeRequest, options) {
  const rawUrl = nodeRequest.url ?? '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl)) return rawUrl;

  const origin =
    typeof options.origin === 'function'
      ? options.origin(nodeRequest)
      : (options.origin ?? defaultOrigin(nodeRequest));

  return new URL(rawUrl, origin).href;
}

function defaultOrigin(nodeRequest) {
  const host = nodeRequest.headers.host ?? '127.0.0.1';
  const forwardedProto = firstHeaderValue(nodeRequest.headers['x-forwarded-proto']);
  const proto =
    forwardedProto ?? (nodeRequest.socket && nodeRequest.socket.encrypted ? 'https' : 'http');

  return proto + '://' + host;
}

async function writeWebResponseToNode(response, nodeResponse, method = 'GET') {
  const headers = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });

  nodeResponse.writeHead(response.status, response.statusText, headers);
  if (method === 'HEAD' || response.body === null) {
    nodeResponse.end();
    return;
  }

  await new Promise((resolvePromise, reject) => {
    Readable.fromWeb(response.body)
      .once('error', reject)
      .pipe(nodeResponse)
      .once('error', reject)
      .once('finish', resolvePromise);
  });
}

function nodeHeadersToWebHeaders(nodeRequest) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeRequest.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

function contentType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  createKovoNodeServer().listen(port, host, () => {
    console.log('Kovo node server listening on http://' + host + ':' + port);
  });
}
`;
}

function nodeDockerfileSource(): string {
  return `FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["node", "server.mjs"]
`;
}
