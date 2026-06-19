import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

/**
 * Inputs for writing Kovo's platform-neutral deployment artifact.
 *
 * @internal
 */
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

/**
 * Facts returned after writing the platform-neutral deployment artifact.
 *
 * @internal
 */
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
 *
 * @internal
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

  for (const asset of app.stylesheets) addStylesheetDeclarationCss(cssByPath, asset);
  for (const route of app.routes) {
    for (const asset of route.stylesheets ?? []) addStylesheetDeclarationCss(cssByPath, asset);
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
  if (assetPath && assetPath !== '/assets/styles.css') return href;
  if (cssAssetPaths.length === 1 && cssAssetPaths[0] !== undefined) return cssAssetPaths[0];
  return href;
}

function addStylesheetDeclarationCss(
  cssByPath: Map<string, string[]>,
  asset: string | StylesheetAsset,
): void {
  if (typeof asset === 'string') return;
  const assetPath = localStylesheetAssetPath(asset.href);
  if (assetPath && !cssByPath.has(assetPath)) cssByPath.set(assetPath, []);
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
