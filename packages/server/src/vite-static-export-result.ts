import {
  assertStaticExportManifestMatchesResult,
  staticExportManifest,
} from './static-export-result.js';
import type { StaticExportManifest, StaticExportResult } from './static-export-types.js';

export interface KovoAppShellViteStaticExportWithManifestResult {
  manifest: StaticExportManifest;
  result: StaticExportResult;
}

export interface KovoAppShellViteStaticExportWithManifestReplay {
  dryRun(): Promise<StaticExportResult>;
  write(): Promise<StaticExportResult>;
}

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
