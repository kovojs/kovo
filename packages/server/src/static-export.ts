import { diagnosticDefinitions } from '@jiso/core';

import { createRequestHandler, type JisoApp } from './app.js';
import { replayStaticExportClientModuleArtifacts } from './static-export-client-modules.js';
import {
  createStaticExportOutputPlan,
  STATIC_EXPORT_DRY_RUN_ROOT,
  staticExportAssetArtifacts,
  writeStaticExportOutput,
} from './static-export-output.js';
import { replayStaticExportRouteArtifact } from './static-replay.js';
import { staticExportRoutePlan } from './static-export-route-plan.js';
import {
  StaticExportError,
  staticExportDiagnostic,
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

  const routePlan = staticExportRoutePlan(app);
  const diagnostics = [...routePlan.diagnostics];
  if (diagnostics.length > 0 && options.onNonExportable !== 'skip') {
    throw new StaticExportError(diagnostics);
  }

  const handler = createRequestHandler(app);
  const origin = options.origin ?? 'https://jiso.local';
  const htmlPathStyle = staticExportHtmlPathStyle(options.htmlPathStyle);
  const artifacts: StaticExportArtifact[] = [];

  for (const routeTarget of routePlan.targets) {
    if (diagnostics.some((diagnostic) => diagnostic.routePath === routeTarget.routePath)) continue;

    try {
      artifacts.push(
        await replayStaticExportRouteArtifact({
          handler,
          htmlPathStyle,
          origin,
          routePath: routeTarget.path,
        }),
      );
    } catch (error) {
      if (!(error instanceof StaticExportError) || options.onNonExportable !== 'skip') {
        throw error;
      }

      diagnostics.push(...error.diagnostics);
    }
  }

  const clientModules = await replayStaticExportClientModuleArtifacts({
    handler,
    origin,
    routeArtifacts: artifacts,
  });
  const assets = staticExportAssetArtifacts(options.assets ?? []);
  const outputPlan = createStaticExportOutputPlan({
    artifacts,
    assets,
    clientModules,
    outDir: options.outDir ?? STATIC_EXPORT_DRY_RUN_ROOT,
  });

  if (options.outDir !== undefined) {
    await writeStaticExportOutput(outputPlan);
  }

  return { artifacts, assets, clientModules, diagnostics };
}

function staticExportHtmlPathStyle(
  style: StaticExportHtmlPathStyle | undefined,
): StaticExportHtmlPathStyle {
  if (style === undefined) return 'directory';
  if (style === 'flat' || style === 'directory') return style;

  throw new StaticExportError([
    staticExportDiagnostic(
      'htmlPathStyle',
      `FW229 static export refused htmlPathStyle '${String(
        style,
      )}'. Expected 'flat' or 'directory'.`,
    ),
  ]);
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
