import type { KovoApp } from './app-types.js';
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

export interface KovoAppShellVitePluginStaticExportOptions extends Omit<
  KovoAppShellViteBuildStaticExportOptions,
  'distDir'
> {
  distDir?: never;
}

export interface KovoAppShellViteBuildOutputStaticExportOptions extends Omit<
  KovoAppShellViteBuildStaticExportOptions,
  'distDir'
> {
  distDir?: never;
}

export interface KovoAppShellViteBuildOutputStaticExportPlan {
  assets: StaticExportAssetInput[];
  options: StaticExportOptions;
}

export interface KovoAppShellViteBuildStaticExportOptions extends Omit<
  StaticExportOptions,
  'assets'
> {
  assets?: readonly StaticExportAssetInput[];
  distDir: string | URL;
}

export interface KovoAppShellViteBuildStaticExportInventoryOptions extends Omit<
  KovoAppShellViteBuildStaticExportOptions,
  'outDir'
> {
  outDir?: never;
}

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

export interface KovoAppShellViteManifestFileBuildStaticExportInventoryOptions extends Omit<
  KovoAppShellViteManifestFileBuildStaticExportOptions,
  'outDir'
> {
  outDir?: never;
}

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
  };
}

export function kovoAppShellViteBuildDryRunStaticExportOptions(
  build: KovoAppShellBuild,
  options: KovoAppShellViteBuildStaticExportInventoryOptions,
): StaticExportOptions {
  assertViteStaticExportInventoryOptions(options);
  const { assets, distDir, ...exportOptions } = options;

  return {
    ...exportOptions,
    // SPEC §9.5: inventory/manifest queries inspect the same replay plan as a
    // write export while intentionally leaving output path selection unset.
    assets: kovoAppShellViteBuildStaticExportAssets(build, {
      ...(assets === undefined ? {} : { assets }),
      distDir,
    }),
  };
}

export function kovoAppShellViteBuildOutputStaticExportPlan(
  build: Pick<KovoAppShellBuild, 'assets'>,
  options: KovoAppShellViteBuildOutputStaticExportOptions,
  distDir: string | URL,
): KovoAppShellViteBuildOutputStaticExportPlan {
  assertViteBuildOutputStaticExportOptions(options);
  const { assets, ...exportOptions } = options;
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
    },
  };
}

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

export function kovoAppShellViteManifestFileDryRunStaticExportOptions(
  options: KovoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): KovoAppShellViteBuildStaticExportInventoryOptions {
  assertViteStaticExportInventoryOptions(options);
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

function assertViteStaticExportInventoryOptions(options: object): void {
  if (!Object.prototype.hasOwnProperty.call(options, 'outDir')) return;

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

function assertViteBuildOutputStaticExportOptions(options: object): void {
  if (!Object.prototype.hasOwnProperty.call(options, 'distDir')) return;

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
