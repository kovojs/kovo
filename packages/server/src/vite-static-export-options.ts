import type { JisoApp } from './app.js';
import type { StaticExportAssetInput, StaticExportOptions } from './static-export.js';
import {
  createJisoAppShellViteBuildFromManifestFile,
  type JisoAppShellBuild,
  type JisoAppShellCompiledClientModule,
} from './vite-build.js';
import {
  jisoAppShellViteBuildStaticExportAssets,
  jisoAppShellViteManifestFile,
} from './vite-build-assets.js';
import type { JisoAppShellRouteEntryMap } from './vite-manifest.js';

export interface JisoAppShellVitePluginStaticExportOptions extends Omit<
  JisoAppShellViteBuildStaticExportOptions,
  'distDir'
> {
  distDir?: never;
}

export interface JisoAppShellViteBuildStaticExportOptions extends Omit<
  StaticExportOptions,
  'assets'
> {
  assets?: readonly StaticExportAssetInput[];
  distDir: string | URL;
}

export interface JisoAppShellViteBuildStaticExportInventoryOptions extends Omit<
  JisoAppShellViteBuildStaticExportOptions,
  'outDir'
> {
  outDir?: never;
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

export interface JisoAppShellViteManifestFileBuildStaticExportInventoryOptions extends Omit<
  JisoAppShellViteManifestFileBuildStaticExportOptions,
  'outDir'
> {
  outDir?: never;
}

export async function createJisoAppShellViteStaticExportBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportOptions,
): Promise<JisoAppShellBuild> {
  return await createJisoAppShellViteBuildFromManifestFile({
    app: options.app,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
    manifestFile: options.manifestFile ?? jisoAppShellViteManifestFile(options.distDir),
    ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
  });
}

export function jisoAppShellViteBuildWriteStaticExportOptions(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportOptions,
): StaticExportOptions {
  const { assets, distDir, ...exportOptions } = options;

  return {
    ...exportOptions,
    // SPEC §9.5: Vite-backed export replays the built app shell and publishes
    // the immutable manifest assets referenced by the generated document.
    assets: jisoAppShellViteBuildStaticExportAssets(build, {
      ...(assets === undefined ? {} : { assets }),
      distDir,
    }),
  };
}

export function jisoAppShellViteBuildDryRunStaticExportOptions(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportInventoryOptions,
): StaticExportOptions {
  const {
    assets,
    distDir,
    outDir: _outDir,
    ...exportOptions
  } = options as JisoAppShellViteBuildStaticExportInventoryOptions & { outDir?: unknown };

  return {
    ...exportOptions,
    // SPEC §9.5: inventory/manifest queries inspect the same replay plan as a
    // write export while intentionally leaving output path selection unset.
    assets: jisoAppShellViteBuildStaticExportAssets(build, {
      ...(assets === undefined ? {} : { assets }),
      distDir,
    }),
  };
}

export function jisoAppShellViteManifestFileWriteStaticExportOptions(
  options: JisoAppShellViteManifestFileBuildStaticExportOptions,
): JisoAppShellViteBuildStaticExportOptions {
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

export function jisoAppShellViteManifestFileDryRunStaticExportOptions(
  options: JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): JisoAppShellViteBuildStaticExportInventoryOptions {
  const {
    app: _app,
    base: _base,
    clientModules: _clientModules,
    manifestFile: _manifestFile,
    outDir: _outDir,
    routeEntryMap: _routeEntryMap,
    ...exportOptions
  } = options as JisoAppShellViteManifestFileBuildStaticExportInventoryOptions & {
    outDir?: unknown;
  };

  return exportOptions;
}
