import { createHash } from 'node:crypto';
import type { VersionedClientModuleInput } from './client-modules.js';
import type { JisoApp } from './app-types.js';
import type { PageHintOptions } from './hints.js';
import type { JisoAppShellViteBuildOutput } from './vite-build-output.js';
import type { JisoAppShellVitePluginStaticExportOptions } from './vite-static-export-options.js';
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
  staticExport?: JisoAppShellVitePluginStaticExportOptions | false;
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
