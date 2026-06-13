import type { JisoApp } from './app.js';
import {
  exportStaticApp,
  staticExportInventory,
  staticExportManifest,
  type StaticExportAssetInput,
  type StaticExportInventoryItem,
  type StaticExportManifest,
  type StaticExportOptions,
  type StaticExportResult,
} from './static-export.js';
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

export async function exportJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportOptions,
): Promise<StaticExportResult> {
  const build = await buildFromStaticExportManifestFileOptions(options);

  return exportJisoAppShellViteBuild(build, writeStaticExportOptions(options));
}

export async function staticExportInventoryForJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): Promise<StaticExportInventoryItem[]> {
  const build = await buildFromStaticExportManifestFileOptions(options);

  return staticExportInventoryForJisoAppShellViteBuild(build, dryRunStaticExportOptions(options));
}

export async function staticExportManifestForJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): Promise<StaticExportManifest> {
  const build = await buildFromStaticExportManifestFileOptions(options);

  return staticExportManifestForJisoAppShellViteBuild(build, dryRunStaticExportOptions(options));
}

export async function exportJisoAppShellViteBuild(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportOptions,
): Promise<StaticExportResult> {
  const { assets, distDir, ...exportOptions } = options;

  return exportStaticApp(build.app, {
    ...exportOptions,
    // SPEC §9.5: static export replays the built app shell, then copies the
    // immutable asset files referenced by the Vite manifest.
    assets: jisoAppShellViteBuildStaticExportAssets(build, {
      ...(assets === undefined ? {} : { assets }),
      distDir,
    }),
  });
}

export async function staticExportInventoryForJisoAppShellViteBuild(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportInventoryOptions,
): Promise<StaticExportInventoryItem[]> {
  const { assets, distDir, outDir: _outDir, ...exportOptions } = options;
  const result = await exportStaticApp(build.app, {
    ...exportOptions,
    // SPEC §9.5: dry-run task wiring inspects the exact built app shell,
    // manifest assets, and /c/ modules without selecting an output directory.
    assets: jisoAppShellViteBuildStaticExportAssets(build, {
      ...(assets === undefined ? {} : { assets }),
      distDir,
    }),
  });

  return staticExportInventory(result);
}

export async function staticExportManifestForJisoAppShellViteBuild(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportInventoryOptions,
): Promise<StaticExportManifest> {
  const { assets, distDir, outDir: _outDir, ...exportOptions } = options;
  const result = await exportStaticApp(build.app, {
    ...exportOptions,
    // SPEC §9.5: dry-run task wiring exposes the same manifest-backed
    // documents, /c/ modules, and copied static assets as write export.
    assets: jisoAppShellViteBuildStaticExportAssets(build, {
      ...(assets === undefined ? {} : { assets }),
      distDir,
    }),
  });

  return staticExportManifest(result);
}

async function buildFromStaticExportManifestFileOptions(
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

function writeStaticExportOptions(
  options: JisoAppShellViteManifestFileBuildStaticExportOptions,
): JisoAppShellViteBuildStaticExportOptions {
  return {
    ...(options.assets === undefined ? {} : { assets: options.assets }),
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
    distDir: options.distDir,
    ...(options.htmlPathStyle === undefined ? {} : { htmlPathStyle: options.htmlPathStyle }),
    ...(options.onNonExportable === undefined ? {} : { onNonExportable: options.onNonExportable }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.outDir === undefined ? {} : { outDir: options.outDir }),
  };
}

function dryRunStaticExportOptions(
  options: JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): JisoAppShellViteBuildStaticExportInventoryOptions {
  return {
    ...(options.assets === undefined ? {} : { assets: options.assets }),
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
    distDir: options.distDir,
    ...(options.htmlPathStyle === undefined ? {} : { htmlPathStyle: options.htmlPathStyle }),
    ...(options.onNonExportable === undefined ? {} : { onNonExportable: options.onNonExportable }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  };
}
