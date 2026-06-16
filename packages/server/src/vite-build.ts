import { createHash } from 'node:crypto';
import type { VersionedClientModuleInput } from './client-modules.js';
import { assertNoBlockingAppDiagnostics } from './app-diagnostics.js';
import { isKovoApp } from './app-guards.js';
import type { KovoApp } from './app-types.js';
import type { PageHintOptions } from './hints.js';
import type { KovoAppShellViteBuildOutput } from './vite-build-output.js';
import type { KovoAppShellVitePluginStaticExportOptions } from './vite-static-export-options.js';
import {
  kovoAppShellViteManifestAssets,
  kovoAppShellViteManifestFromBundle,
  kovoAppShellViteManifestFromFile,
  kovoAppShellViteManifestHints,
  kovoAppShellViteRouteEntries,
  normalizedDistFile,
  type KovoAppShellBuildAsset,
  type KovoAppShellRouteBuildEntry,
  type KovoAppShellRouteEntryMap,
  type KovoAppShellViteManifest,
  type KovoAppShellViteManifestHintOptions,
  type KovoAppShellViteOutputBundle,
} from './vite-manifest.js';

export interface KovoAppShellCompiledClientModule extends Omit<
  VersionedClientModuleInput,
  'version'
> {
  version?: string;
}

export interface KovoAppShellBuildOptions {
  app: KovoApp;
  base?: string;
  clientModules?: readonly KovoAppShellCompiledClientModule[];
  manifest?: KovoAppShellViteManifest;
  routeEntries?: readonly KovoAppShellRouteBuildEntry[];
}

export interface KovoAppShellViteBuildOptions extends Omit<
  KovoAppShellBuildOptions,
  'routeEntries'
> {
  routeEntries?: never;
  routeEntryMap?: KovoAppShellRouteEntryMap;
}

export interface KovoAppShellViteBundleBuildOptions extends Omit<
  KovoAppShellViteBuildOptions,
  'manifest'
> {
  bundle: KovoAppShellViteOutputBundle;
  manifest?: never;
}

export interface KovoAppShellViteManifestFileBuildOptions extends Omit<
  KovoAppShellViteBuildOptions,
  'manifest'
> {
  manifest?: never;
  manifestFile: string | URL;
}

export interface KovoAppShellVitePluginBuildOptions extends Omit<
  KovoAppShellViteBundleBuildOptions,
  'app' | 'bundle' | 'manifest'
> {
  onBuild?(build: KovoAppShellBuild, output: KovoAppShellViteBuildOutput): void | Promise<void>;
  outDir?: string | URL;
  staticExport?: KovoAppShellVitePluginStaticExportOptions | false;
}

export interface KovoAppShellBuiltClientModule {
  contentType?: string;
  file: string;
  href: string;
  path: string;
  source: string;
  version: string;
}

export interface KovoAppShellRouteBuildHints {
  hints: PageHintOptions;
  routePath: string;
}

export interface KovoAppShellBuild {
  app: KovoApp;
  assets: readonly KovoAppShellBuildAsset[];
  clientModules: readonly KovoAppShellBuiltClientModule[];
  routeHints: readonly KovoAppShellRouteBuildHints[];
}

export function createKovoAppShellBuild(options: KovoAppShellBuildOptions): KovoAppShellBuild {
  assertKovoAppShellBuildApp(options.app);
  assertNoBlockingAppDiagnostics(options.app);
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
    ? kovoAppShellViteManifestAssets(options.manifest, manifestOptions)
    : [];

  return { app, assets, clientModules, routeHints };
}

function assertKovoAppShellBuildApp(app: KovoApp): void {
  if (isKovoApp(app)) return;

  throw new TypeError(
    'createKovoAppShellViteBuild() requires a Kovo app aggregate. SPEC §9.5 Vite build/export replay must start from createApp(), not a raw request handler or compatibility shell.',
  );
}

export function createKovoAppShellViteBuild(
  options: KovoAppShellViteBuildOptions,
): KovoAppShellBuild {
  const routeEntries =
    options.routeEntryMap === undefined
      ? undefined
      : kovoAppShellViteRouteEntries(options.routeEntryMap, {
          ...(options.manifest === undefined ? {} : { manifest: options.manifest }),
          routes: options.app.routes,
        });

  return createKovoAppShellBuild({
    app: options.app,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
    ...(options.manifest === undefined ? {} : { manifest: options.manifest }),
    ...(routeEntries === undefined ? {} : { routeEntries }),
  });
}

export function createKovoAppShellViteBuildFromBundle(
  options: KovoAppShellViteBundleBuildOptions,
): KovoAppShellBuild {
  return createKovoAppShellViteBuild({
    app: options.app,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
    manifest: kovoAppShellViteManifestFromBundle(options.bundle),
    ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
  });
}

export async function createKovoAppShellViteBuildFromManifestFile(
  options: KovoAppShellViteManifestFileBuildOptions,
): Promise<KovoAppShellBuild> {
  return createKovoAppShellViteBuild({
    app: options.app,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
    manifest: await kovoAppShellViteManifestFromFile(options.manifestFile),
    ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
  });
}

function buildRouteHints(
  manifest: KovoAppShellViteManifest | undefined,
  routeEntries: readonly KovoAppShellRouteBuildEntry[] | undefined,
  options: KovoAppShellViteManifestHintOptions,
): KovoAppShellRouteBuildHints[] {
  if (!manifest || !routeEntries || routeEntries.length === 0) return [];

  return routeEntries.map((entry) => ({
    hints: kovoAppShellViteManifestHints(manifest, entry.entries, options),
    routePath: entry.routePath,
  }));
}

function registerCompiledClientModules(
  app: KovoApp,
  modules: readonly KovoAppShellCompiledClientModule[],
): KovoAppShellBuiltClientModule[] {
  return modules.map((module) => {
    // SPEC §6.6: production client module URLs are immutable and versioned.
    const version = module.version ?? sourceVersion(module.source);
    const href = app.clientModules.put({
      ...module,
      version,
    });
    const url = new URL(href, 'https://kovo.local');

    const built: KovoAppShellBuiltClientModule = {
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

function viteManifestOptions(base: string | undefined): KovoAppShellViteManifestHintOptions {
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
