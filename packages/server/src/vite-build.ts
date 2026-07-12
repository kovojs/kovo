import { clientModulePath } from '@kovojs/core/internal/client-module-url';

import { assertNoBlockingAppDiagnostics } from './app-diagnostics.js';
import { isKovoApp } from './app-guards.js';
import { deriveClosedKovoApp } from './app-snapshot.js';
import type { AppRouteDeclaration, KovoApp } from './app-types.js';
import {
  buildOwnDataProperty,
  buildSecuritySha256Hex,
  snapshotBuildArray,
} from './build-security-intrinsics.js';
import type { VersionedClientModuleInput } from './client-modules.js';
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
  const source = buildOptionsObject(options, 'app-shell build options');
  const sourceApp = requiredBuildOption(source, 'app', 'app-shell build options.app') as KovoApp;
  const base = optionalBuildOption(source, 'base', 'app-shell build options.base') as
    | string
    | undefined;
  const clientModules = optionalBuildOption(
    source,
    'clientModules',
    'app-shell build options.clientModules',
  ) as readonly KovoAppShellCompiledClientModule[] | undefined;
  const manifest = optionalBuildOption(source, 'manifest', 'app-shell build options.manifest') as
    | KovoAppShellViteManifest
    | undefined;
  const routeEntries = optionalBuildOption(
    source,
    'routeEntries',
    'app-shell build options.routeEntries',
  ) as readonly KovoAppShellRouteBuildEntry[] | undefined;

  assertKovoAppShellBuildApp(sourceApp);
  assertNoBlockingAppDiagnostics(sourceApp);
  const sourceRoutes = snapshotBuildArray(sourceApp.routes, 'app-shell build routes');
  const manifestOptions = viteManifestOptions(base);
  const routeHints = buildRouteHints(manifest, routeEntries, manifestOptions);
  const derivedRoutes = buildRoutesWithHints(sourceRoutes, routeHints);
  const builtApp =
    routeHints.length === 0
      ? sourceApp
      : deriveClosedKovoApp(sourceApp, { routes: derivedRoutes } as Partial<KovoApp>);
  const builtClientModules = registerCompiledClientModules(sourceApp, clientModules ?? []);
  const assets = manifest ? kovoAppShellViteManifestAssets(manifest, manifestOptions) : [];

  return { app: builtApp, assets, clientModules: builtClientModules, routeHints };
}

function assertKovoAppShellBuildApp(app: KovoApp): void {
  if (isKovoApp(app)) return;

  throw new TypeError(
    'createKovoAppShellViteBuild() requires a Kovo app aggregate. SPEC §9.5 Vite build/export replay must start from createApp(), not a raw request handler or compatibility shell.',
  );
}

function buildOptionsObject(value: unknown, label: string): object {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${label} must be an own-data object.`);
  }
  return value;
}

function requiredBuildOption(options: object, property: PropertyKey, label: string): unknown {
  const field = buildOwnDataProperty(options, property, label);
  if (!field.present || field.value === undefined) {
    throw new TypeError(`${label} is required.`);
  }
  return field.value;
}

function optionalBuildOption(options: object, property: PropertyKey, label: string): unknown {
  const field = buildOwnDataProperty(options, property, label);
  return field.present ? field.value : undefined;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Builds an app shell
 * from an in-memory manifest and route entry map.
 * Exported only for in-repo build/host config, not app authors.
 */
export function createKovoAppShellViteBuild(
  options: KovoAppShellViteBuildOptions,
): KovoAppShellBuild {
  const source = buildOptionsObject(options, 'app-shell Vite build options');
  const app = requiredBuildOption(source, 'app', 'app-shell Vite build options.app') as KovoApp;
  assertKovoAppShellBuildApp(app);
  const base = optionalBuildOption(source, 'base', 'app-shell Vite build options.base') as
    | string
    | undefined;
  const clientModules = optionalBuildOption(
    source,
    'clientModules',
    'app-shell Vite build options.clientModules',
  ) as readonly KovoAppShellCompiledClientModule[] | undefined;
  const manifest = optionalBuildOption(
    source,
    'manifest',
    'app-shell Vite build options.manifest',
  ) as KovoAppShellViteManifest | undefined;
  const routeEntryMap = optionalBuildOption(
    source,
    'routeEntryMap',
    'app-shell Vite build options.routeEntryMap',
  ) as KovoAppShellRouteEntryMap | undefined;
  const routes = snapshotBuildArray(app.routes, 'app-shell Vite route declarations');
  const routeEntries =
    routeEntryMap === undefined
      ? undefined
      : kovoAppShellViteRouteEntries(routeEntryMap, {
          ...(manifest === undefined ? {} : { manifest }),
          routes,
        });

  return createKovoAppShellBuild({
    app,
    ...(base === undefined ? {} : { base }),
    ...(clientModules === undefined ? {} : { clientModules }),
    ...(manifest === undefined ? {} : { manifest }),
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
  const source = buildOptionsObject(options, 'app-shell Vite bundle build options');
  const app = requiredBuildOption(
    source,
    'app',
    'app-shell Vite bundle build options.app',
  ) as KovoApp;
  const bundle = requiredBuildOption(
    source,
    'bundle',
    'app-shell Vite bundle build options.bundle',
  ) as KovoAppShellViteOutputBundle;
  const base = optionalBuildOption(source, 'base', 'app-shell Vite bundle build options.base') as
    | string
    | undefined;
  const clientModules = optionalBuildOption(
    source,
    'clientModules',
    'app-shell Vite bundle build options.clientModules',
  ) as readonly KovoAppShellCompiledClientModule[] | undefined;
  const routeEntryMap = optionalBuildOption(
    source,
    'routeEntryMap',
    'app-shell Vite bundle build options.routeEntryMap',
  ) as KovoAppShellRouteEntryMap | undefined;
  return createKovoAppShellViteBuild({
    app,
    ...(base === undefined ? {} : { base }),
    ...(clientModules === undefined ? {} : { clientModules }),
    manifest: kovoAppShellViteManifestFromBundle(bundle),
    ...(routeEntryMap === undefined ? {} : { routeEntryMap }),
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
  const source = buildOptionsObject(options, 'app-shell Vite manifest build options');
  const app = requiredBuildOption(
    source,
    'app',
    'app-shell Vite manifest build options.app',
  ) as KovoApp;
  const manifestFile = requiredBuildOption(
    source,
    'manifestFile',
    'app-shell Vite manifest build options.manifestFile',
  ) as string | URL;
  const base = optionalBuildOption(source, 'base', 'app-shell Vite manifest build options.base') as
    | string
    | undefined;
  const clientModules = optionalBuildOption(
    source,
    'clientModules',
    'app-shell Vite manifest build options.clientModules',
  ) as readonly KovoAppShellCompiledClientModule[] | undefined;
  const routeEntryMap = optionalBuildOption(
    source,
    'routeEntryMap',
    'app-shell Vite manifest build options.routeEntryMap',
  ) as KovoAppShellRouteEntryMap | undefined;
  assertKovoAppShellBuildApp(app);
  const routes = snapshotBuildArray(app.routes, 'app-shell Vite manifest route declarations');
  const routeEntries =
    routeEntryMap === undefined
      ? undefined
      : kovoAppShellViteRouteEntries(routeEntryMap, { routes });
  const pinnedClientModules =
    clientModules === undefined ? undefined : snapshotCompiledClientModules(clientModules);
  const manifest = await kovoAppShellViteManifestFromFile(manifestFile);
  return createKovoAppShellBuild({
    app,
    ...(base === undefined ? {} : { base }),
    ...(pinnedClientModules === undefined ? {} : { clientModules: pinnedClientModules }),
    manifest,
    ...(routeEntries === undefined ? {} : { routeEntries }),
  });
}

function buildRouteHints(
  manifest: KovoAppShellViteManifest | undefined,
  routeEntries: readonly KovoAppShellRouteBuildEntry[] | undefined,
  options: KovoAppShellViteManifestHintOptions,
): readonly KovoAppShellRouteBuildHints[] {
  if (!manifest || !routeEntries) return [];
  const entries = snapshotBuildArray(routeEntries, 'app-shell route hint entries');
  const hints: KovoAppShellRouteBuildHints[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (typeof entry !== 'object' || entry === null) {
      throw new TypeError(`App-shell route hint entry ${index} must be an object.`);
    }
    const routePath = buildOwnDataProperty(
      entry,
      'routePath',
      `app-shell route hint entry ${index}.routePath`,
    );
    const routeManifestEntries = buildOwnDataProperty(
      entry,
      'entries',
      `app-shell route hint entry ${index}.entries`,
    );
    if (!routePath.present || typeof routePath.value !== 'string') {
      throw new TypeError(`App-shell route hint entry ${index}.routePath must be a string.`);
    }
    if (!routeManifestEntries.present) {
      throw new TypeError(`App-shell route hint entry ${index}.entries must be an array.`);
    }
    const pinnedManifestEntries = snapshotBuildArray(
      routeManifestEntries.value as readonly string[],
      `app-shell route hint entry ${index}.entries`,
    );
    hints[hints.length] = {
      hints: kovoAppShellViteManifestHints(manifest, pinnedManifestEntries, options),
      routePath: routePath.value,
    };
  }

  return snapshotBuildArray(hints, 'built app-shell route hints');
}

function buildRoutesWithHints(
  routes: readonly AppRouteDeclaration[],
  routeHints: readonly KovoAppShellRouteBuildHints[],
): readonly AppRouteDeclaration[] {
  if (routeHints.length === 0) return routes;

  const pinnedRoutes = snapshotBuildArray(routes, 'app-shell build routes');
  const pinnedHints = snapshotBuildArray(routeHints, 'app-shell build route hints');
  const derived: AppRouteDeclaration[] = [];
  for (let routeIndex = 0; routeIndex < pinnedRoutes.length; routeIndex += 1) {
    const routeDeclaration = pinnedRoutes[routeIndex]!;
    let built: KovoAppShellRouteBuildHints | undefined;
    for (let hintIndex = 0; hintIndex < pinnedHints.length; hintIndex += 1) {
      const candidate = pinnedHints[hintIndex]!;
      if (candidate.routePath === routeDeclaration.path) {
        built = candidate;
        break;
      }
    }
    derived[derived.length] =
      built === undefined
        ? routeDeclaration
        : {
            ...routeDeclaration,
            ...mergePageHints(routeDeclaration, built.hints),
          };
  }
  return snapshotBuildArray(derived, 'derived app-shell build routes');
}

function registerCompiledClientModules(
  app: KovoApp,
  modules: readonly KovoAppShellCompiledClientModule[],
): KovoAppShellBuiltClientModule[] {
  const pinnedModules = snapshotCompiledClientModules(modules);
  const renderPlanFingerprint = compiledClientModulesRenderPlanFingerprint(pinnedModules);
  if (renderPlanFingerprint !== undefined) {
    if (!app.clientModules.setRenderPlanFingerprint) {
      throw new TypeError(
        'createKovoAppShellBuild() requires app.clientModules.setRenderPlanFingerprint() when compiled client modules are registered. SPEC §5.2.1 requires the build token to include the compiler render-plan fingerprint.',
      );
    }
    app.clientModules.setRenderPlanFingerprint(renderPlanFingerprint);
  }

  const builtModules: KovoAppShellBuiltClientModule[] = [];
  for (let index = 0; index < pinnedModules.length; index += 1) {
    const module = pinnedModules[index]!;
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
    const pathname = clientModulePath(href);

    const built: KovoAppShellBuiltClientModule = {
      file: normalizedDistFile(pathname),
      href,
      path: pathname,
      source: module.source,
      version,
    };
    builtModules[builtModules.length] =
      module.contentType === undefined ? built : { ...built, contentType: module.contentType };
  }

  return builtModules;
}

function snapshotCompiledClientModules(
  modules: readonly KovoAppShellCompiledClientModule[],
): readonly KovoAppShellCompiledClientModule[] {
  const sourceModules = snapshotBuildArray(modules, 'compiled client modules');
  const pinned: KovoAppShellCompiledClientModule[] = [];
  for (let index = 0; index < sourceModules.length; index += 1) {
    const raw = sourceModules[index];
    if (typeof raw !== 'object' || raw === null) {
      throw new TypeError(`Compiled client module ${index} must be an object.`);
    }
    const path = requiredCompiledClientModuleString(raw, 'path', index);
    const source = requiredCompiledClientModuleString(raw, 'source', index);
    const contentType = optionalCompiledClientModuleString(raw, 'contentType', index);
    const renderPlanFingerprint = optionalCompiledClientModuleString(
      raw,
      'renderPlanFingerprint',
      index,
    );
    const version = optionalCompiledClientModuleString(raw, 'version', index);
    pinned[pinned.length] = {
      path,
      source,
      ...(contentType === undefined ? {} : { contentType }),
      ...(renderPlanFingerprint === undefined ? {} : { renderPlanFingerprint }),
      ...(version === undefined ? {} : { version }),
    };
  }
  return snapshotBuildArray(pinned, 'pinned compiled client modules');
}

function requiredCompiledClientModuleString(
  module: object,
  field: 'path' | 'source',
  index: number,
): string {
  const property = buildOwnDataProperty(module, field, `compiled client module ${index}.${field}`);
  if (!property.present || typeof property.value !== 'string') {
    throw new TypeError(`Compiled client module ${index}.${field} must be a string.`);
  }
  return property.value;
}

function optionalCompiledClientModuleString(
  module: object,
  field: 'contentType' | 'renderPlanFingerprint' | 'version',
  index: number,
): string | undefined {
  const property = buildOwnDataProperty(module, field, `compiled client module ${index}.${field}`);
  if (!property.present || property.value === undefined) return undefined;
  if (typeof property.value !== 'string') {
    throw new TypeError(`Compiled client module ${index}.${field} must be a string.`);
  }
  return property.value;
}

function compiledClientModulesRenderPlanFingerprint(
  modules: readonly KovoAppShellCompiledClientModule[],
): string | undefined {
  if (modules.length === 0) return undefined;

  let fingerprint: string | undefined;
  for (let index = 0; index < modules.length; index += 1) {
    const module = modules[index]!;
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

function mergePageHints<MetaContext>(
  base: PageHintOptions<MetaContext>,
  extra: PageHintOptions,
): PageHintOptions<MetaContext> {
  const merged: PageHintOptions<MetaContext> = { ...base };
  const modulepreloads = [...(base.modulepreloads ?? []), ...(extra.modulepreloads ?? [])];
  const stylesheets = [...(base.stylesheets ?? []), ...(extra.stylesheets ?? [])];

  if (modulepreloads.length > 0) merged.modulepreloads = modulepreloads;
  if (stylesheets.length > 0) merged.stylesheets = stylesheets;

  if (extra.bootstrapScript !== undefined) merged.bootstrapScript = extra.bootstrapScript;
  if (extra.i18n !== undefined) merged.i18n = extra.i18n;
  if (extra.meta !== undefined)
    merged.meta = extra.meta as NonNullable<PageHintOptions<MetaContext>['meta']>;
  if (extra.prefetch !== undefined) merged.prefetch = extra.prefetch;
  if (extra.prerenderUrls !== undefined) merged.prerenderUrls = extra.prerenderUrls;

  return merged;
}

function sourceVersion(source: string): string {
  // SPEC §6.6/§14: immutable executable URLs use the complete collision-resistant source
  // identity. Truncated cache-busting hashes silently alias distinct deploys.
  return buildSecuritySha256Hex(source);
}
