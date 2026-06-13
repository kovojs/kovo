import { exportStaticApp } from './static-export.js';
import {
  staticExportInventory,
  staticExportManifest,
  type StaticExportInventoryItem,
  type StaticExportManifest,
  type StaticExportResult,
} from './static-export-types.js';
import type { JisoAppShellBuild } from './vite-build.js';
import {
  createJisoAppShellViteStaticExportBuildFromManifestFile,
  jisoAppShellViteBuildDryRunStaticExportOptions,
  jisoAppShellViteBuildWriteStaticExportOptions,
  jisoAppShellViteManifestFileDryRunStaticExportOptions,
  jisoAppShellViteManifestFileWriteStaticExportOptions,
  type JisoAppShellViteBuildStaticExportInventoryOptions,
  type JisoAppShellViteBuildStaticExportOptions,
  type JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
  type JisoAppShellViteManifestFileBuildStaticExportOptions,
} from './vite-static-export-options.js';

export type {
  JisoAppShellViteBuildStaticExportInventoryOptions,
  JisoAppShellViteBuildStaticExportOptions,
  JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
  JisoAppShellViteManifestFileBuildStaticExportOptions,
  JisoAppShellVitePluginStaticExportOptions,
} from './vite-static-export-options.js';

export async function exportJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportOptions,
): Promise<StaticExportResult> {
  const build = await createJisoAppShellViteStaticExportBuildFromManifestFile(options);

  return exportJisoAppShellViteBuild(
    build,
    jisoAppShellViteManifestFileWriteStaticExportOptions(options),
  );
}

export async function staticExportInventoryForJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): Promise<StaticExportInventoryItem[]> {
  const build = await createJisoAppShellViteStaticExportBuildFromManifestFile(options);

  return staticExportInventoryForJisoAppShellViteBuild(
    build,
    jisoAppShellViteManifestFileDryRunStaticExportOptions(options),
  );
}

export async function staticExportManifestForJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): Promise<StaticExportManifest> {
  const build = await createJisoAppShellViteStaticExportBuildFromManifestFile(options);

  return staticExportManifestForJisoAppShellViteBuild(
    build,
    jisoAppShellViteManifestFileDryRunStaticExportOptions(options),
  );
}

export async function exportJisoAppShellViteBuild(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportOptions,
): Promise<StaticExportResult> {
  return exportStaticApp(build.app, jisoAppShellViteBuildWriteStaticExportOptions(build, options));
}

export async function staticExportInventoryForJisoAppShellViteBuild(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportInventoryOptions,
): Promise<StaticExportInventoryItem[]> {
  const result = await staticExportDryRunResultForJisoAppShellViteBuild(build, options);

  return staticExportInventory(result);
}

export async function staticExportManifestForJisoAppShellViteBuild(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportInventoryOptions,
): Promise<StaticExportManifest> {
  const result = await staticExportDryRunResultForJisoAppShellViteBuild(build, options);

  return staticExportManifest(result);
}

async function staticExportDryRunResultForJisoAppShellViteBuild(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportInventoryOptions,
): Promise<StaticExportResult> {
  return await exportStaticApp(
    build.app,
    jisoAppShellViteBuildDryRunStaticExportOptions(build, options),
  );
}
