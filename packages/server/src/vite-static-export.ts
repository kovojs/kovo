import { exportStaticApp } from './static-export.js';
import {
  assertStaticExportManifestMatchesResult,
  staticExportInventory,
  staticExportManifest,
} from './static-export-result.js';
import type {
  StaticExportInventoryItem,
  StaticExportManifest,
  StaticExportResult,
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

export interface JisoAppShellViteStaticExportWithManifestResult {
  manifest: StaticExportManifest;
  result: StaticExportResult;
}

export async function exportJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportOptions,
): Promise<StaticExportResult> {
  const build = await createJisoAppShellViteStaticExportBuildFromManifestFile(options);

  return exportJisoAppShellViteBuild(
    build,
    jisoAppShellViteManifestFileWriteStaticExportOptions(options),
  );
}

export async function exportJisoAppShellViteBuildWithManifestFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportOptions,
): Promise<JisoAppShellViteStaticExportWithManifestResult> {
  const build = await createJisoAppShellViteStaticExportBuildFromManifestFile(options);

  return exportJisoAppShellViteBuildWithManifest(
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

export async function exportJisoAppShellViteBuildWithManifest(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportOptions,
): Promise<JisoAppShellViteStaticExportWithManifestResult> {
  // SPEC §9.5: consumer export tasks need one public bridge that proves the
  // dry-run manifest and written static host bytes describe the same replay.
  const manifest = await staticExportManifestForJisoAppShellViteBuild(
    build,
    jisoAppShellViteBuildStaticExportManifestOptions(options),
  );
  const result = await exportJisoAppShellViteBuild(build, options);
  assertStaticExportManifestMatchesResult(result, manifest);

  return { manifest, result };
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

function jisoAppShellViteBuildStaticExportManifestOptions(
  options: JisoAppShellViteBuildStaticExportOptions,
): JisoAppShellViteBuildStaticExportInventoryOptions {
  const { outDir: _outDir, ...manifestOptions } = options;

  return manifestOptions;
}
