import { diagnosticDefinitions } from '@jiso/core';

import type { JisoApp } from './app.js';
import {
  createStaticExportOutputPlan,
  STATIC_EXPORT_DRY_RUN_ROOT,
  staticExportAssetArtifacts,
  writeStaticExportOutput,
} from './static-export-output.js';
import { replayStaticExportApp } from './static-export-replay.js';
import {
  StaticExportError,
  type StaticExportArtifact,
  type StaticExportAssetArtifact,
  type StaticExportAssetInput,
  type StaticExportClientModuleArtifact,
  type StaticExportCompileDiagnostic,
  type StaticExportDiagnostic,
  type StaticExportHtmlPathStyle,
} from './static-export-types.js';

export {
  StaticExportError,
  formatStaticExportDiagnostic,
  formatStaticExportDiagnostics,
  isStaticExportDiagnostic,
  isStaticExportDiagnosticError,
  staticExportInventory,
  staticExportManifest,
  type StaticExportArtifact,
  type StaticExportAssetArtifact,
  type StaticExportAssetInput,
  type StaticExportClientModuleArtifact,
  type StaticExportCompileDiagnostic,
  type StaticExportDiagnostic,
  type StaticExportDiagnosticSeverity,
  type StaticExportHtmlPathStyle,
  type StaticExportInventoryItem,
  type StaticExportManifest,
  type StaticExportManifestAsset,
  type StaticExportManifestClientModule,
  type StaticExportManifestRouteDocument,
} from './static-export-types.js';
export { staticExportOutputPlan } from './static-export-output.js';
export type {
  StaticExportOutputPlanItem,
  StaticExportOutputPlanItemKind,
  StaticExportOutputPlanOptions,
} from './static-export-output.js';

export interface StaticExportOptions {
  assets?: readonly StaticExportAssetInput[];
  diagnostics?: readonly StaticExportCompileDiagnostic[];
  htmlPathStyle?: StaticExportHtmlPathStyle;
  onNonExportable?: 'error' | 'skip';
  origin?: string;
  outDir?: string | URL;
}

export interface StaticExportResult {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
  diagnostics: readonly StaticExportDiagnostic[];
}

export async function exportStaticApp(
  app: JisoApp,
  options: StaticExportOptions = {},
): Promise<StaticExportResult> {
  const blockingDiagnostics = blockingStaticExportDiagnostics(options.diagnostics ?? []);
  if (blockingDiagnostics.length > 0) {
    throw new StaticExportError(blockingDiagnostics);
  }

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

function blockingStaticExportDiagnostics(
  diagnostics: readonly StaticExportCompileDiagnostic[],
): StaticExportDiagnostic[] {
  return diagnostics
    .filter((diagnostic) => diagnosticDefinitions[diagnostic.code].severity === 'error')
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: staticExportCompileDiagnosticMessage(diagnostic),
      routePath: diagnostic.fileName,
    }));
}

function staticExportCompileDiagnosticMessage(diagnostic: StaticExportCompileDiagnostic): string {
  const site = diagnostic.start
    ? `${diagnostic.fileName}:${diagnostic.start.line}:${diagnostic.start.column}`
    : diagnostic.fileName;
  const help = diagnostic.help?.trim();
  const message = `Static export refused error diagnostic ${diagnostic.code} at ${site}. ${diagnostic.message}`;

  return help ? `${message}\n${help}` : message;
}
