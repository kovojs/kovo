import type {
  StaticExportInventoryItem,
  StaticExportManifest,
  StaticExportResult,
} from './static-export-types.js';
import {
  createJisoAppShellViteStaticExportBuildFromManifestFile,
  jisoAppShellViteManifestFileDryRunStaticExportOptions,
  jisoAppShellViteManifestFileWriteStaticExportOptions,
  type JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
  type JisoAppShellViteManifestFileBuildStaticExportOptions,
} from './vite-static-export-options.js';
import type { JisoAppShellViteStaticExportWithManifestResult } from './vite-static-export-result.js';
import {
  exportJisoAppShellViteBuild,
  exportJisoAppShellViteBuildWithManifest,
  staticExportInventoryForJisoAppShellViteBuild,
  staticExportManifestForJisoAppShellViteBuild,
} from './vite-static-export-build.js';

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
