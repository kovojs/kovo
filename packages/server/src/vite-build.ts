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

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Compiled client module
 * input with an optional precomputed version for the build.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellCompiledClientModule extends Omit<
  VersionedClientModuleInput,
  'version'
> {
  /**
   * @internal Compiler render-plan fingerprint. Required for compiled modules so
   * SPEC §5.2.1 shape-only render-plan changes move the registry build token.
   */
  renderPlanFingerprint?: string;
  version?: string;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Low-level options for
 * createKovoAppShellBuild (app plus resolved manifest/route entries).
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellBuildOptions {
  app: KovoApp;
  base?: string;
  clientModules?: readonly KovoAppShellCompiledClientModule[];
  manifest?: KovoAppShellViteManifest;
  routeEntries?: readonly KovoAppShellRouteBuildEntry[];
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Options for
 * createKovoAppShellViteBuild from an in-memory manifest and route entry map.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteBuildOptions extends Omit<
  KovoAppShellBuildOptions,
  'routeEntries'
> {
  routeEntries?: never;
  routeEntryMap?: KovoAppShellRouteEntryMap;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Options for building
 * an app shell from a Rollup/Vite output bundle.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteBundleBuildOptions extends Omit<
  KovoAppShellViteBuildOptions,
  'manifest'
> {
  bundle: KovoAppShellViteOutputBundle;
  manifest?: never;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Options for building
 * an app shell from a manifest file on disk.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteManifestFileBuildOptions extends Omit<
  KovoAppShellViteBuildOptions,
  'manifest'
> {
  manifest?: never;
  manifestFile: string | URL;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Build/output options
 * carried by kovoAppShellVitePlugin's writeBundle hook.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellVitePluginBuildOptions extends Omit<
  KovoAppShellViteBundleBuildOptions,
  'app' | 'bundle' | 'manifest'
> {
  onBuild?(build: KovoAppShellBuild, output: KovoAppShellViteBuildOutput): void | Promise<void>;
  outDir?: string | URL;
  staticExport?: KovoAppShellVitePluginStaticExportOptions | false;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). A built, versioned
 * client module with its emitted dist file/href.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellBuiltClientModule {
  contentType?: string;
  file: string;
  href: string;
  path: string;
  source: string;
  version: string;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Resolved page hints
 * for a single route in a built app shell.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellRouteBuildHints {
  hints: PageHintOptions;
  routePath: string;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). The built app shell
 * (app, assets, client modules, route hints) consumed by the export pipeline.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellBuild {
  app: KovoApp;
  assets: readonly KovoAppShellBuildAsset[];
  clientModules: readonly KovoAppShellBuiltClientModule[];
  routeHints: readonly KovoAppShellRouteBuildHints[];
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Builds an app shell
 * from low-level resolved options.
 * Exported only for in-repo build/host config, not app authors.
 */
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

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Builds an app shell
 * from an in-memory manifest and route entry map.
 * Exported only for in-repo build/host config, not app authors.
 */
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

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Builds an app shell
 * from a Rollup/Vite output bundle.
 * Exported only for in-repo build/host config, not app authors.
 */
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

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Builds an app shell
 * from a manifest file read off disk.
 * Exported only for in-repo build/host config, not app authors.
 */
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
  const renderPlanFingerprint = compiledClientModulesRenderPlanFingerprint(modules);
  if (renderPlanFingerprint !== undefined) {
    if (!app.clientModules.setRenderPlanFingerprint) {
      throw new TypeError(
        'createKovoAppShellBuild() requires app.clientModules.setRenderPlanFingerprint() when compiled client modules are registered. SPEC §5.2.1 requires the build token to include the compiler render-plan fingerprint.',
      );
    }
    app.clientModules.setRenderPlanFingerprint(renderPlanFingerprint);
  }

  return modules.map((module) => {
    const { renderPlanFingerprint: _renderPlanFingerprint, ...registryModule } = module;
    // SPEC §6.6: production client module URLs are immutable and versioned.
    // SPEC §5.2.1: the default version also carries the render-plan fingerprint
    // so a shape-only render-plan change moves the client href as well as the token.
    const version =
      module.version ?? `${module.renderPlanFingerprint}-${sourceVersion(module.source)}`;
    const href = app.clientModules.put({
      ...registryModule,
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

function compiledClientModulesRenderPlanFingerprint(
  modules: readonly KovoAppShellCompiledClientModule[],
): string | undefined {
  if (modules.length === 0) return undefined;

  let fingerprint: string | undefined;
  for (const module of modules) {
    if (!module.renderPlanFingerprint) {
      throw new TypeError(
        `Compiled client module ${module.path} is missing renderPlanFingerprint. SPEC §5.2.1 requires the build token to include the compiler render-plan fingerprint.`,
      );
    }
    if (fingerprint === undefined) {
      fingerprint = module.renderPlanFingerprint;
    } else if (fingerprint !== module.renderPlanFingerprint) {
      throw new TypeError(
        'Compiled client modules in one app-shell build must share one renderPlanFingerprint. SPEC §5.2.1 requires one coherent build token per render plan.',
      );
    }
  }

  return fingerprint;
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
