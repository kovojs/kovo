import type { KovoApp } from './app-types.js';
import { isKovoApp } from './app-guards.js';
import {
  createStaticExportOutputPlan,
  STATIC_EXPORT_DRY_RUN_ROOT,
  staticExportAssetArtifacts,
  staticExportOutputRoot,
  writeStaticExportOutput,
} from './static-export-output.js';
import { replayStaticExportApp } from './static-export-replay.js';
import { applyStaticExportSubresourceIntegrity } from './static-export-sri.js';
import {
  assertStaticExportCompileDiagnostics,
  StaticExportError,
  staticExportDiagnostic,
} from './static-export-diagnostics.js';
import { type StaticExportOptions, type StaticExportResult } from './static-export-types.js';

/**
 * Pre-render an app's static routes to files on disk for static hosting,
 * verifying the app aggregate and compile diagnostics before emitting
 * (SPEC §9.5).
 *
 * @param app - An app aggregate from `createApp`.
 * @param options - Output directory and static-export options.
 * @returns A `StaticExportResult` describing the emitted files.
 */
export async function exportStaticApp(
  app: KovoApp,
  options: StaticExportOptions = {},
): Promise<StaticExportResult> {
  assertStaticExportAppAggregate(app);
  assertStaticExportCompileDiagnostics([...app.diagnostics, ...(options.diagnostics ?? [])]);
  assertNoStaticExportHtmlPathStyleOption(options);
  if (options.outDir !== undefined) staticExportOutputRoot(options.outDir);

  const assets = staticExportAssetArtifacts(options.assets ?? []);
  const replay = await replayStaticExportApp({
    app,
    ...(options.onNonExportable === undefined ? {} : { onNonExportable: options.onNonExportable }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  });
  const artifacts = await applyStaticExportSubresourceIntegrity({
    artifacts: replay.artifacts,
    assets,
    clientModules: replay.clientModules,
    origin: options.origin ?? 'https://kovo.local',
  });
  const outputPlan = createStaticExportOutputPlan({
    artifacts,
    assets,
    clientModules: replay.clientModules,
    outDir: options.outDir ?? STATIC_EXPORT_DRY_RUN_ROOT,
  });

  if (options.outDir !== undefined) {
    await writeStaticExportOutput(outputPlan);
  }

  return {
    artifacts,
    assets,
    clientModules: replay.clientModules,
    diagnostics: replay.diagnostics,
  };
}

function assertStaticExportAppAggregate(app: KovoApp): void {
  if (isKovoApp(app)) return;

  throw new StaticExportError([
    staticExportDiagnostic(
      'app',
      'KV229 static export requires a closed Kovo app aggregate. SPEC §9.5 export replay must start from createApp(), not a raw request handler or compatibility shell.',
    ),
  ]);
}

function assertNoStaticExportHtmlPathStyleOption(options: object): void {
  if (!Object.prototype.hasOwnProperty.call(options, 'htmlPathStyle')) return;

  throw new StaticExportError([
    staticExportDiagnostic(
      'htmlPathStyle',
      'KV229 static export refused htmlPathStyle. SPEC §9.5 exports route documents as directory-index HTML; remove this option.',
    ),
  ]);
}
