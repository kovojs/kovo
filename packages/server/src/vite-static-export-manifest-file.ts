import type {
  StaticExportInventoryItem,
  StaticExportManifest,
  StaticExportResult,
} from './static-export-types.js';
import {
  createKovoAppShellViteStaticExportBuildFromManifestFile,
  kovoAppShellViteManifestFileDryRunStaticExportOptions,
  kovoAppShellViteManifestFileWriteStaticExportOptions,
  type KovoAppShellViteManifestFileBuildStaticExportInventoryOptions,
  type KovoAppShellViteManifestFileBuildStaticExportOptions,
} from './vite-static-export-options.js';
import type { KovoAppShellViteStaticExportWithManifestResult } from './vite-static-export-result.js';
import {
  exportKovoAppShellViteBuild,
  exportKovoAppShellViteBuildWithManifest,
  staticExportInventoryForKovoAppShellViteBuild,
  staticExportManifestForKovoAppShellViteBuild,
} from './vite-static-export-build.js';
import type { KovoAppShellBuild } from './vite-build.js';

export async function exportKovoAppShellViteBuildFromManifestFile(
  options: KovoAppShellViteManifestFileBuildStaticExportOptions,
): Promise<StaticExportResult> {
  return replayKovoAppShellViteManifestFileBuild(options, (build) =>
    exportKovoAppShellViteBuild(
      build,
      kovoAppShellViteManifestFileWriteStaticExportOptions(options),
    ),
  );
}

export async function exportKovoAppShellViteBuildWithManifestFromManifestFile(
  options: KovoAppShellViteManifestFileBuildStaticExportOptions,
): Promise<KovoAppShellViteStaticExportWithManifestResult> {
  return replayKovoAppShellViteManifestFileBuild(options, (build) =>
    exportKovoAppShellViteBuildWithManifest(
      build,
      kovoAppShellViteManifestFileWriteStaticExportOptions(options),
    ),
  );
}

export async function staticExportInventoryForKovoAppShellViteBuildFromManifestFile(
  options: KovoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): Promise<StaticExportInventoryItem[]> {
  return replayKovoAppShellViteManifestFileBuild(options, (build) =>
    staticExportInventoryForKovoAppShellViteBuild(
      build,
      kovoAppShellViteManifestFileDryRunStaticExportOptions(options),
    ),
  );
}

export async function staticExportManifestForKovoAppShellViteBuildFromManifestFile(
  options: KovoAppShellViteManifestFileBuildStaticExportInventoryOptions,
): Promise<StaticExportManifest> {
  return replayKovoAppShellViteManifestFileBuild(options, (build) =>
    staticExportManifestForKovoAppShellViteBuild(
      build,
      kovoAppShellViteManifestFileDryRunStaticExportOptions(options),
    ),
  );
}

async function replayKovoAppShellViteManifestFileBuild<T>(
  options:
    | KovoAppShellViteManifestFileBuildStaticExportOptions
    | KovoAppShellViteManifestFileBuildStaticExportInventoryOptions,
  replay: (build: KovoAppShellBuild) => Promise<T>,
): Promise<T> {
  // SPEC §9.5: manifest-file export tasks first close over one built app shell,
  // then run write or dry-run replay through the same Vite build boundary.
  const build = await createKovoAppShellViteStaticExportBuildFromManifestFile(options);

  return replay(build);
}
