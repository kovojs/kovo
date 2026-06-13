import type { JisoApp } from './app-types.js';
import {
  createStaticExportOutputPlan,
  STATIC_EXPORT_DRY_RUN_ROOT,
  staticExportAssetArtifacts,
  writeStaticExportOutput,
} from './static-export-output.js';
import { replayStaticExportApp } from './static-export-replay.js';
import { assertStaticExportCompileDiagnostics } from './static-export-diagnostics.js';
import { type StaticExportOptions, type StaticExportResult } from './static-export-types.js';

export async function exportStaticApp(
  app: JisoApp,
  options: StaticExportOptions = {},
): Promise<StaticExportResult> {
  assertStaticExportCompileDiagnostics(options.diagnostics ?? []);

  const replay = await replayStaticExportApp({
    app,
    ...(options.htmlPathStyle === undefined ? {} : { htmlPathStyle: options.htmlPathStyle }),
    ...(options.onNonExportable === undefined ? {} : { onNonExportable: options.onNonExportable }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  });
  const assets = staticExportAssetArtifacts(options.assets ?? []);
  const outputPlan = createStaticExportOutputPlan({
    artifacts: replay.artifacts,
    assets,
    clientModules: replay.clientModules,
    outDir: options.outDir ?? STATIC_EXPORT_DRY_RUN_ROOT,
  });

  if (options.outDir !== undefined) {
    await writeStaticExportOutput(outputPlan);
  }

  return {
    artifacts: replay.artifacts,
    assets,
    clientModules: replay.clientModules,
    diagnostics: replay.diagnostics,
  };
}
