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
import type { JisoAppShellBuild } from './vite-build.js';

export async function exportJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportOptions,
): Promise<StaticExportResult> {
  return replayJisoAppShellViteManifestFileBuild(options, (build) =>
    exportJisoAppShellViteBuild(
      build,
      jisoAppShellViteManifestFileWriteStaticExportOptions(options),
    ),
  );
}

export async function exportJisoAppShellViteBuildWithManifestFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportOptions,
): Promise<JisoAppShellViteStaticExportWithManifestResult> {
  return replayJisoAppShellViteManifestFileBuild(options, (build) =>
    exportJisoAppShellViteBuildWithManifest(
      build,
      jisoAppShellViteManifestFileWriteStaticExportOptions(options),
    ),
  );
}

export async function staticExportInventoryForJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): Promise<StaticExportInventoryItem[]> {
  return replayJisoAppShellViteManifestFileBuild(options, (build) =>
    staticExportInventoryForJisoAppShellViteBuild(
      build,
      jisoAppShellViteManifestFileDryRunStaticExportOptions(options),
    ),
  );
}

export async function staticExportManifestForJisoAppShellViteBuildFromManifestFile(
  options: JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): Promise<StaticExportManifest> {
  return replayJisoAppShellViteManifestFileBuild(options, (build) =>
    staticExportManifestForJisoAppShellViteBuild(
      build,
      jisoAppShellViteManifestFileDryRunStaticExportOptions(options),
    ),
  );
}

async function replayJisoAppShellViteManifestFileBuild<T>(
  options:
    | JisoAppShellViteManifestFileBuildStaticExportOptions
    | JisoAppShellViteManifestFileBuildStaticExportInventoryOptions,
  replay: (build: JisoAppShellBuild) => Promise<T>,
): Promise<T> {
  // SPEC §9.5: manifest-file export tasks first close over one built app shell,
  // then run write or dry-run replay through the same Vite build boundary.
  const build = await createJisoAppShellViteStaticExportBuildFromManifestFile(options);

  return replay(build);
}
