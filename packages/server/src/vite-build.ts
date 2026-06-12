import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VersionedClientModuleInput } from './client-modules.js';
import type { JisoApp } from './app.js';
import type { PageHintOptions } from './hints.js';
import {
  exportStaticApp,
  type StaticExportAssetInput,
  type StaticExportOptions,
  type StaticExportResult,
} from './static-export.js';
import {
  jisoAppShellViteManifestAssets,
  jisoAppShellViteManifestFromBundle,
  jisoAppShellViteManifestFromFile,
  jisoAppShellViteManifestHints,
  jisoAppShellViteRouteEntries,
  normalizedDistFile,
  type JisoAppShellBuildAsset,
  type JisoAppShellRouteBuildEntry,
  type JisoAppShellRouteEntryMap,
  type JisoAppShellViteManifest,
  type JisoAppShellViteManifestHintOptions,
  type JisoAppShellViteOutputBundle,
} from './vite-manifest.js';

export interface JisoAppShellViteOutputOptions {
  dir?: string;
  file?: string;
}

export interface JisoAppShellCompiledClientModule extends Omit<
  VersionedClientModuleInput,
  'version'
> {
  version?: string;
}

export interface JisoAppShellBuildOptions {
  app: JisoApp;
  base?: string;
  clientModules?: readonly JisoAppShellCompiledClientModule[];
  manifest?: JisoAppShellViteManifest;
  routeEntries?: readonly JisoAppShellRouteBuildEntry[];
}

export interface JisoAppShellViteBuildOptions extends Omit<
  JisoAppShellBuildOptions,
  'routeEntries'
> {
  routeEntries?: never;
  routeEntryMap?: JisoAppShellRouteEntryMap;
}

export interface JisoAppShellViteBundleBuildOptions extends Omit<
  JisoAppShellViteBuildOptions,
  'manifest'
> {
  bundle: JisoAppShellViteOutputBundle;
  manifest?: never;
}

export interface JisoAppShellViteManifestFileBuildOptions extends Omit<
  JisoAppShellViteBuildOptions,
  'manifest'
> {
  manifest?: never;
  manifestFile: string | URL;
}

export interface JisoAppShellVitePluginBuildOptions extends Omit<
  JisoAppShellViteBundleBuildOptions,
  'app' | 'bundle' | 'manifest'
> {
  onBuild?(build: JisoAppShellBuild, output: JisoAppShellViteBuildOutput): void | Promise<void>;
  outDir?: string | URL;
}

export interface JisoAppShellBuiltClientModule {
  contentType?: string;
  file: string;
  href: string;
  path: string;
  source: string;
  version: string;
}

export interface JisoAppShellRouteBuildHints {
  hints: PageHintOptions;
  routePath: string;
}

export interface JisoAppShellBuild {
  app: JisoApp;
  assets: readonly JisoAppShellBuildAsset[];
  clientModules: readonly JisoAppShellBuiltClientModule[];
  routeHints: readonly JisoAppShellRouteBuildHints[];
}

export interface JisoAppShellViteStaticExportAssetOptions {
  distDir: string | URL;
}

export interface JisoAppShellViteBuildOutputOptions {
  outDir: string | URL;
}

export interface JisoAppShellViteBuildOutput {
  clientModules: readonly JisoAppShellBuiltClientModule[];
  staticExportAssets: readonly StaticExportAssetInput[];
}

export interface JisoAppShellViteBuildStaticExportOptions extends Omit<
  StaticExportOptions,
  'assets'
> {
  assets?: readonly StaticExportAssetInput[];
  distDir: string | URL;
}

export interface JisoAppShellViteManifestFileBuildStaticExportOptions extends Omit<
  JisoAppShellViteBuildStaticExportOptions,
  'distDir'
> {
  app: JisoApp;
  base?: string;
  clientModules?: readonly JisoAppShellCompiledClientModule[];
  distDir: string | URL;
  manifestFile?: string | URL;
  routeEntryMap?: JisoAppShellRouteEntryMap;
}

export function createJisoAppShellBuild(options: JisoAppShellBuildOptions): JisoAppShellBuild {
  const manifestOptions = viteManifestOptions(options.base);
  const routeHints = buildRouteHints(options.manifest, options.routeEntries, manifestOptions);
  const app =
    routeHints.length === 0
      ? options.app
      : {
          ...options.app,
          routes: options.app.routes.map((route) => {
            const built = routeHints.find((entry) => entry.routePath === route.path);
            return built ? { ...route, ...mergePageHints(route, built.hints) } : route;
          }),
        };
  const clientModules = registerCompiledClientModules(options.app, options.clientModules ?? []);
  const assets = options.manifest
    ? jisoAppShellViteManifestAssets(options.manifest, manifestOptions)
    : [];

  return { app, assets, clientModules, routeHints };
}

export function createJisoAppShellViteBuild(
  options: JisoAppShellViteBuildOptions,
): JisoAppShellBuild {
  const routeEntries =
    options.routeEntryMap === undefined
      ? undefined
      : jisoAppShellViteRouteEntries(options.routeEntryMap, {
          ...(options.manifest === undefined ? {} : { manifest: options.manifest }),
          routes: options.app.routes,
        });

  return createJisoAppShellBuild({
    app: options.app,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
    ...(options.manifest === undefined ? {} : { manifest: options.manifest }),
    ...(routeEntries === undefined ? {} : { routeEntries }),
  });
}

export function createJisoAppShellViteBuildFromBundle(
  options: JisoAppShellViteBundleBuildOptions,
): JisoAppShellBuild {
  return createJisoAppShellViteBuild({
    app: options.app,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
    manifest: jisoAppShellViteManifestFromBundle(options.bundle),
    ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
  });
}

export async function createJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildOptions,
): Promise<JisoAppShellBuild> {
  return createJisoAppShellViteBuild({
    app: options.app,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
    manifest: await jisoAppShellViteManifestFromFile(options.manifestFile),
    ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
  });
}

export function jisoAppShellViteStaticExportAssets(
  assets: readonly JisoAppShellBuildAsset[],
  options: JisoAppShellViteStaticExportAssetOptions,
): StaticExportAssetInput[] {
  return assets.map((asset) => {
    const contentType = viteAssetContentType(asset.file);

    return {
      ...(contentType === undefined ? {} : { contentType }),
      path: asset.path,
      source: viteDistSourcePath(options.distDir, asset.file),
    };
  });
}

export async function exportJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportOptions,
): Promise<StaticExportResult> {
  const build = await createJisoAppShellViteBuildFromManifestFile({
    app: options.app,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
    manifestFile: options.manifestFile ?? jisoAppShellViteManifestFile(options.distDir),
    ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
  });

  return exportJisoAppShellViteBuild(build, {
    ...(options.assets === undefined ? {} : { assets: options.assets }),
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
    distDir: options.distDir,
    ...(options.htmlPathStyle === undefined ? {} : { htmlPathStyle: options.htmlPathStyle }),
    ...(options.onNonExportable === undefined ? {} : { onNonExportable: options.onNonExportable }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.outDir === undefined ? {} : { outDir: options.outDir }),
  });
}

export async function exportJisoAppShellViteBuild(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportOptions,
): Promise<StaticExportResult> {
  const { assets = [], distDir, ...exportOptions } = options;

  return exportStaticApp(build.app, {
    ...exportOptions,
    // SPEC §9.5: static export replays the built app shell, then copies the
    // immutable asset files referenced by the Vite manifest.
    assets: [...jisoAppShellViteStaticExportAssets(build.assets, { distDir }), ...assets],
  });
}

export async function writeJisoAppShellViteBuildOutput(
  build: Pick<JisoAppShellBuild, 'clientModules'> & Partial<Pick<JisoAppShellBuild, 'assets'>>,
  options: JisoAppShellViteBuildOutputOptions,
): Promise<JisoAppShellViteBuildOutput> {
  const root = resolvedFileSystemPath(options.outDir);

  for (const module of build.clientModules) {
    // SPEC §9.5: production app-shell builds publish immutable /c/ client modules
    // as files a static host can retain by versioned URL.
    const targetPath = viteDistSourcePath(root, module.file);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, module.source, 'utf8');
  }

  return {
    clientModules: build.clientModules,
    staticExportAssets: jisoAppShellViteStaticExportAssets(build.assets ?? [], { distDir: root }),
  };
}

export function jisoAppShellViteOutputDir(options: JisoAppShellViteOutputOptions): string {
  if (options.dir) return options.dir;
  if (options.file) return path.dirname(options.file);

  throw new Error('App shell Vite build output requires output.dir or output.file.');
}

function buildRouteHints(
  manifest: JisoAppShellViteManifest | undefined,
  routeEntries: readonly JisoAppShellRouteBuildEntry[] | undefined,
  options: JisoAppShellViteManifestHintOptions,
): JisoAppShellRouteBuildHints[] {
  if (!manifest || !routeEntries || routeEntries.length === 0) return [];

  return routeEntries.map((entry) => ({
    hints: jisoAppShellViteManifestHints(manifest, entry.entries, options),
    routePath: entry.routePath,
  }));
}

function registerCompiledClientModules(
  app: JisoApp,
  modules: readonly JisoAppShellCompiledClientModule[],
): JisoAppShellBuiltClientModule[] {
  return modules.map((module) => {
    // SPEC §6.6: production client module URLs are immutable and versioned.
    const version = module.version ?? sourceVersion(module.source);
    const href = app.clientModules.put({
      ...module,
      version,
    });
    const url = new URL(href, 'https://jiso.local');

    const built: JisoAppShellBuiltClientModule = {
      file: normalizedDistFile(url.pathname),
      href,
      path: url.pathname,
      source: module.source,
      version,
    };
    if (module.contentType !== undefined) return { ...built, contentType: module.contentType };

    return built;
  });
}

function viteManifestOptions(base: string | undefined): JisoAppShellViteManifestHintOptions {
  return base === undefined ? {} : { base };
}

function viteDistSourcePath(distDir: string | URL, file: string): string {
  const root = resolvedFileSystemPath(distDir);
  const targetPath = path.resolve(root, normalizedDistFile(file));
  if (targetPath === root || targetPath.startsWith(`${root}${path.sep}`)) return targetPath;

  throw new Error(`App shell build asset must stay within the Vite output directory: ${file}`);
}

function jisoAppShellViteManifestFile(distDir: string | URL): string {
  return path.join(resolvedFileSystemPath(distDir), '.vite', 'manifest.json');
}

function resolvedFileSystemPath(value: string | URL): string {
  return path.resolve(value instanceof URL ? fileURLToPath(value) : value);
}

function viteAssetContentType(file: string): string | undefined {
  const extension = path.extname(file).toLowerCase();

  switch (extension) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return undefined;
  }
}

function mergePageHints(base: PageHintOptions, extra: PageHintOptions): PageHintOptions {
  const merged: PageHintOptions = { ...base };
  const modulepreloads = [...(base.modulepreloads ?? []), ...(extra.modulepreloads ?? [])];
  const stylesheets = [...(base.stylesheets ?? []), ...(extra.stylesheets ?? [])];

  if (modulepreloads.length > 0) merged.modulepreloads = modulepreloads;
  if (stylesheets.length > 0) merged.stylesheets = stylesheets;

  if (extra.bootstrapScript !== undefined) merged.bootstrapScript = extra.bootstrapScript;
  if (extra.i18n !== undefined) merged.i18n = extra.i18n;
  if (extra.meta !== undefined) merged.meta = extra.meta;
  if (extra.prefetch !== undefined) merged.prefetch = extra.prefetch;
  if (extra.prerenderUrls !== undefined) merged.prerenderUrls = extra.prerenderUrls;

  return merged;
}

function sourceVersion(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 12);
}
