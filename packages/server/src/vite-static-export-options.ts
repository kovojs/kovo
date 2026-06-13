import type { JisoApp } from './app-types.js';
import type { StaticExportAssetInput, StaticExportOptions } from './static-export-types.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
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

export interface JisoAppShellViteBuildOutputStaticExportOptions extends Omit<
  JisoAppShellViteBuildStaticExportOptions,
  'distDir'
> {
  distDir?: never;
}

export interface JisoAppShellViteBuildOutputStaticExportPlan {
  assets: StaticExportAssetInput[];
  options: StaticExportOptions;
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
  assertViteStaticExportInventoryOptions(options);
  const { assets, distDir, ...exportOptions } = options;

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

export function jisoAppShellViteBuildOutputStaticExportPlan(
  build: Pick<JisoAppShellBuild, 'assets'>,
  options: JisoAppShellViteBuildOutputStaticExportOptions,
  distDir: string | URL,
): JisoAppShellViteBuildOutputStaticExportPlan {
  assertViteBuildOutputStaticExportOptions(options);
  const { assets, ...exportOptions } = options;
  const staticExportAssets = jisoAppShellViteBuildStaticExportAssets(build, {
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
        'Use exportJisoAppShellViteBuild() or exportJisoAppShellViteBuildFromManifestFile() to write files.',
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
