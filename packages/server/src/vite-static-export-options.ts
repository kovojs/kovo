import type { KovoApp } from './app-types.js';
import { buildOwnDataProperty, type BuildOwnDataProperty } from './build-security-intrinsics.js';
import type { StaticExportAssetInput, StaticExportOptions } from './static-export-types.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import {
  createKovoAppShellViteBuildFromManifestFile,
  type KovoAppShellBuild,
  type KovoAppShellCompiledClientModule,
} from './vite-build.js';
import {
  kovoAppShellViteBuildStaticExportAssets,
  kovoAppShellViteManifestFile,
} from './vite-build-assets.js';
import type { KovoAppShellRouteEntryMap } from './vite-manifest.js';

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Plugin-time static
 * export options that take the Vite output dir as their asset root.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellVitePluginStaticExportOptions extends Omit<
  KovoAppShellViteBuildStaticExportOptions,
  'distDir'
> {
  distDir?: never;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Build-output static
 * export options that take the Vite output dir as their asset root.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteBuildOutputStaticExportOptions extends Omit<
  KovoAppShellViteBuildStaticExportOptions,
  'distDir'
> {
  distDir?: never;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Resolved asset list
 * plus export options computed for a build-output static export.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteBuildOutputStaticExportPlan {
  assets: StaticExportAssetInput[];
  options: StaticExportOptions;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Static export options
 * for an already-built app shell, rooted at an explicit distDir.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteBuildStaticExportOptions extends Omit<
  StaticExportOptions,
  'assets'
> {
  assets?: readonly StaticExportAssetInput[];
  distDir: string | URL;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Dry-run inventory/
 * manifest options for a built app shell (no outDir).
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteBuildStaticExportInventoryOptions extends Omit<
  KovoAppShellViteBuildStaticExportOptions,
  'outDir'
> {
  outDir?: never;
}

/**
 * Options for the manifest-file static export entry points such as
 * exportKovoAppShellViteBuildWithManifestFromManifestFile. App authors pass the app,
 * output distDir, and optional base/manifestFile/client modules/route entries; the helper
 * replays the built shell against the on-disk Vite manifest (SPEC.md §9.5 Vite
 * dev/build/export replay).
 */
export interface KovoAppShellViteManifestFileBuildStaticExportOptions extends Omit<
  KovoAppShellViteBuildStaticExportOptions,
  'distDir'
> {
  app: KovoApp;
  base?: string;
  clientModules?: readonly KovoAppShellCompiledClientModule[];
  distDir: string | URL;
  manifestFile?: string | URL;
  routeEntryMap?: KovoAppShellRouteEntryMap;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Dry-run inventory/
 * manifest options for a manifest-file replay (no outDir).
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteManifestFileBuildStaticExportInventoryOptions extends Omit<
  KovoAppShellViteManifestFileBuildStaticExportOptions,
  'outDir'
> {
  outDir?: never;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Builds an app shell
 * from a manifest file for a static export replay.
 * Exported only for in-repo build/host config, not app authors.
 */
export async function createKovoAppShellViteStaticExportBuildFromManifestFile(
  options: KovoAppShellViteManifestFileBuildStaticExportOptions,
): Promise<KovoAppShellBuild> {
  return await createKovoAppShellViteBuildFromManifestFile({
    app: options.app,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
    manifestFile: options.manifestFile ?? kovoAppShellViteManifestFile(options.distDir),
    ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
  });
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Derives write-export
 * StaticExportOptions (with manifest assets) for a built app shell.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteBuildWriteStaticExportOptions(
  build: KovoAppShellBuild,
  options: KovoAppShellViteBuildStaticExportOptions,
): StaticExportOptions {
  const { assets, distDir, ...exportOptions } = options;

  return {
    ...exportOptions,
    // SPEC §9.5: Vite-backed export replays the built app shell and publishes
    // the immutable manifest assets referenced by the generated document.
    assets: kovoAppShellViteBuildStaticExportAssets(build, {
      ...(assets === undefined ? {} : { assets }),
      distDir,
    }),
    publicAssetRoot: distDir,
  };
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Derives dry-run
 * StaticExportOptions (no output paths) for a built app shell.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteBuildDryRunStaticExportOptions(
  build: KovoAppShellBuild,
  options: KovoAppShellViteBuildStaticExportInventoryOptions,
): StaticExportOptions {
  const snapshot = snapshotViteStaticExportOptions(options);
  assertViteStaticExportInventoryOptions(snapshot);
  const assets = optionValue<readonly StaticExportAssetInput[]>(snapshot.assets);
  const distDir = optionValue<string | URL>(snapshot.distDir)!;
  const exportOptions = staticExportOptionsFromSnapshot(snapshot, false);

  return {
    ...exportOptions,
    // SPEC §9.5: inventory/manifest queries inspect the same replay plan as a
    // write export while intentionally leaving output path selection unset.
    assets: kovoAppShellViteBuildStaticExportAssets(build, {
      ...(assets === undefined ? {} : { assets }),
      distDir,
    }),
    publicAssetRoot: distDir,
  };
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Computes the asset +
 * options plan for a plugin/build-output static export.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteBuildOutputStaticExportPlan(
  build: Pick<KovoAppShellBuild, 'assets'>,
  options: KovoAppShellViteBuildOutputStaticExportOptions,
  distDir: string | URL,
): KovoAppShellViteBuildOutputStaticExportPlan {
  const snapshot = snapshotViteStaticExportOptions(options);
  assertViteBuildOutputStaticExportOptions(snapshot);
  const assets = optionValue<readonly StaticExportAssetInput[]>(snapshot.assets);
  const exportOptions = staticExportOptionsFromSnapshot(snapshot, true);
  const staticExportAssets = kovoAppShellViteBuildStaticExportAssets(build, {
    ...(assets === undefined ? {} : { assets }),
    distDir,
  });

  return {
    assets: staticExportAssets,
    options: {
      ...exportOptions,
      // SPEC §9.5: plugin-time build output exports use the same manifest-backed
      // asset plan that the observable Vite build output reports.
      assets: staticExportAssets,
      publicAssetRoot: distDir,
    },
  };
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Strips manifest-file
 * replay inputs to the write-export options for a built app shell.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteManifestFileWriteStaticExportOptions(
  options: KovoAppShellViteManifestFileBuildStaticExportOptions,
): KovoAppShellViteBuildStaticExportOptions {
  const {
    app: _app,
    base: _base,
    clientModules: _clientModules,
    manifestFile: _manifestFile,
    routeEntryMap: _routeEntryMap,
    ...exportOptions
  } = options;

  return exportOptions;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Strips manifest-file
 * replay inputs to the dry-run inventory options for a built app shell.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteManifestFileDryRunStaticExportOptions(
  options: KovoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): KovoAppShellViteBuildStaticExportInventoryOptions {
  const snapshot = snapshotViteStaticExportOptions(options);
  assertViteStaticExportInventoryOptions(snapshot);
  return {
    ...staticExportOptionsFromSnapshot(snapshot, false),
    distDir: optionValue<string | URL>(snapshot.distDir)!,
  };
}

interface ViteStaticExportOptionsSnapshot {
  readonly assets: BuildOwnDataProperty;
  readonly diagnostics: BuildOwnDataProperty;
  readonly distDir: BuildOwnDataProperty;
  readonly onNonExportable: BuildOwnDataProperty;
  readonly origin: BuildOwnDataProperty;
  readonly outDir: BuildOwnDataProperty;
  readonly publicAssetBase: BuildOwnDataProperty;
  readonly publicAssetRoot: BuildOwnDataProperty;
}

function snapshotViteStaticExportOptions(options: object): ViteStaticExportOptionsSnapshot {
  return {
    assets: buildOwnDataProperty(options, 'assets', 'Vite static-export assets'),
    diagnostics: buildOwnDataProperty(options, 'diagnostics', 'Vite static-export diagnostics'),
    distDir: buildOwnDataProperty(options, 'distDir', 'Vite static-export distDir'),
    onNonExportable: buildOwnDataProperty(
      options,
      'onNonExportable',
      'Vite static-export onNonExportable',
    ),
    origin: buildOwnDataProperty(options, 'origin', 'Vite static-export origin'),
    outDir: buildOwnDataProperty(options, 'outDir', 'Vite static-export outDir'),
    publicAssetBase: buildOwnDataProperty(
      options,
      'publicAssetBase',
      'Vite static-export publicAssetBase',
    ),
    publicAssetRoot: buildOwnDataProperty(
      options,
      'publicAssetRoot',
      'Vite static-export publicAssetRoot',
    ),
  };
}

function staticExportOptionsFromSnapshot(
  snapshot: ViteStaticExportOptionsSnapshot,
  includeOutDir: false,
): Omit<StaticExportOptions, 'outDir'>;
function staticExportOptionsFromSnapshot(
  snapshot: ViteStaticExportOptionsSnapshot,
  includeOutDir: true,
): StaticExportOptions;
function staticExportOptionsFromSnapshot(
  snapshot: ViteStaticExportOptionsSnapshot,
  includeOutDir: boolean,
): StaticExportOptions {
  return {
    ...(snapshot.assets.present && snapshot.assets.value !== undefined
      ? { assets: snapshot.assets.value as NonNullable<StaticExportOptions['assets']> }
      : {}),
    ...(snapshot.diagnostics.present && snapshot.diagnostics.value !== undefined
      ? {
          diagnostics: snapshot.diagnostics.value as NonNullable<
            StaticExportOptions['diagnostics']
          >,
        }
      : {}),
    ...(snapshot.onNonExportable.present && snapshot.onNonExportable.value !== undefined
      ? {
          onNonExportable: snapshot.onNonExportable.value as NonNullable<
            StaticExportOptions['onNonExportable']
          >,
        }
      : {}),
    ...(snapshot.origin.present && snapshot.origin.value !== undefined
      ? { origin: snapshot.origin.value as NonNullable<StaticExportOptions['origin']> }
      : {}),
    ...(includeOutDir && snapshot.outDir.present && snapshot.outDir.value !== undefined
      ? { outDir: snapshot.outDir.value as NonNullable<StaticExportOptions['outDir']> }
      : {}),
    ...(snapshot.publicAssetBase.present && snapshot.publicAssetBase.value !== undefined
      ? {
          publicAssetBase: snapshot.publicAssetBase.value as NonNullable<
            StaticExportOptions['publicAssetBase']
          >,
        }
      : {}),
    ...(snapshot.publicAssetRoot.present && snapshot.publicAssetRoot.value !== undefined
      ? {
          publicAssetRoot: snapshot.publicAssetRoot.value as NonNullable<
            StaticExportOptions['publicAssetRoot']
          >,
        }
      : {}),
  };
}

function optionValue<Value>(property: BuildOwnDataProperty): Value | undefined {
  return property.present ? (property.value as Value) : undefined;
}

function assertViteStaticExportInventoryOptions(snapshot: ViteStaticExportOptionsSnapshot): void {
  if (!snapshot.outDir.present) return;

  throw new StaticExportError([
    staticExportDiagnostic(
      'vite-static-export',
      [
        'Vite app-shell static export inventory/manifest tasks are dry runs and must not receive outDir.',
        'Use exportKovoAppShellViteBuild() or exportKovoAppShellViteBuildFromManifestFile() to write files.',
      ].join(' '),
    ),
  ]);
}

function assertViteBuildOutputStaticExportOptions(snapshot: ViteStaticExportOptionsSnapshot): void {
  if (!snapshot.distDir.present) return;

  throw new StaticExportError([
    staticExportDiagnostic(
      'vite-static-export',
      [
        'Vite app-shell plugin/build-output static export uses the Vite output directory as its asset root and must not receive distDir.',
        'Configure plugin build.outDir or Vite output.dir instead.',
      ].join(' '),
    ),
  ]);
}
