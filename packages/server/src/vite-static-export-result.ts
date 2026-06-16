import {
  assertStaticExportManifestMatchesResult,
  staticExportManifest,
} from './static-export-result.js';
import type { StaticExportManifest, StaticExportResult } from './static-export-types.js';

/**
 * Result returned by the manifest-producing app-shell static export helpers such as
 * exportKovoAppShellViteBuildWithManifestFromManifestFile. It pairs the dry-run static
 * export manifest with the written export result, which the helper proves describe the
 * same replay (SPEC.md §9.5 Vite dev/build/export replay).
 */
export interface KovoAppShellViteStaticExportWithManifestResult {
  manifest: StaticExportManifest;
  result: StaticExportResult;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Dry-run/write replay
 * pair consumed by kovoAppShellViteStaticExportWithManifest.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteStaticExportWithManifestReplay {
  dryRun(): Promise<StaticExportResult>;
  write(): Promise<StaticExportResult>;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Runs dry-run then write
 * and asserts the manifest matches the written result.
 * Exported only for in-repo build/host config, not app authors.
 */
export async function kovoAppShellViteStaticExportWithManifest(
  replay: KovoAppShellViteStaticExportWithManifestReplay,
): Promise<KovoAppShellViteStaticExportWithManifestResult> {
  // SPEC §9.5: Vite export tasks that publish files must prove the dry-run
  // manifest and written static-host bytes describe the same replay.
  const manifest = staticExportManifest(await replay.dryRun());
  const result = await replay.write();
  assertStaticExportManifestMatchesResult(result, manifest);

  return { manifest, result };
}
