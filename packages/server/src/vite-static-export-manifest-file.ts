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

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Replays a build from a
 * manifest file and writes a static export, returning only the result.
 * Exported only for in-repo build/host config, not app authors.
 */
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

/**
 * Builds and writes a Kovo app shell static export from a Vite manifest file. App authors
 * call this in scripts/export-static.mjs (via ssrLoadModule) to replay the built shell
 * against the on-disk Vite manifest, emit the immutable static-host files, and get back
 * both the dry-run manifest and the written result so the two can be proven to match. See
 * SPEC.md §9.5 Vite dev/build/export replay.
 */
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

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Dry-run inventory for a
 * build replayed from a manifest file.
 * Exported only for in-repo build/host config, not app authors.
 */
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

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Dry-run static export
 * manifest for a build replayed from a manifest file.
 * Exported only for in-repo build/host config, not app authors.
 */
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
