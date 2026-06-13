import { exportStaticApp } from './static-export.js';
import { staticExportInventory, staticExportManifest } from './static-export-result.js';
import type {
  StaticExportInventoryItem,
  StaticExportManifest,
  StaticExportResult,
} from './static-export-types.js';
import {
  jisoAppShellViteStaticExportWithManifest,
  type JisoAppShellViteStaticExportWithManifestResult,
} from './vite-static-export-result.js';
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
export type { JisoAppShellViteStaticExportWithManifestResult } from './vite-static-export-result.js';

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
  return await jisoAppShellViteStaticExportWithManifest({
    dryRun() {
      return staticExportDryRunResultForJisoAppShellViteBuild(
        build,
        jisoAppShellViteBuildStaticExportManifestOptions(options),
      );
    },
    write() {
      return exportJisoAppShellViteBuild(build, options);
    },
  });
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
