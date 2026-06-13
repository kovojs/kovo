import { createRequestHandler } from './app.js';
import type { JisoApp } from './app-types.js';
import {
  replayStaticExportClientModuleArtifacts,
  replayStaticExportRouteDocumentArtifact,
} from './static-export-document.js';
import { staticExportRoutePlan } from './static-export-route-plan.js';
import { StaticExportError, type StaticExportDiagnostic } from './static-export-diagnostics.js';
import { normalizeStaticExportHtmlPathStyle } from './static-export-options.js';
import {
  type StaticExportArtifact,
  type StaticExportClientModuleArtifact,
  type StaticExportHtmlPathStyle,
  type StaticExportNonExportablePolicy,
} from './static-export-types.js';

export interface StaticExportAppReplayOptions {
  app: JisoApp;
  htmlPathStyle?: StaticExportHtmlPathStyle;
  onNonExportable?: StaticExportNonExportablePolicy;
  origin?: string;
}

export interface StaticExportReplayResult {
  artifacts: readonly StaticExportArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
  diagnostics: readonly StaticExportDiagnostic[];
}

export async function replayStaticExportApp({
  app,
  htmlPathStyle: htmlPathStyleOption,
  onNonExportable,
  origin: originOption,
}: StaticExportAppReplayOptions): Promise<StaticExportReplayResult> {
  const routePlan = staticExportRoutePlan(app);
  const diagnostics = [...routePlan.diagnostics];
  if (diagnostics.length > 0 && onNonExportable !== 'skip') {
    throw new StaticExportError(diagnostics);
  }

  const handler = createRequestHandler(app);
  const origin = originOption ?? 'https://jiso.local';
  const htmlPathStyle = normalizeStaticExportHtmlPathStyle(htmlPathStyleOption);
  const artifacts: StaticExportArtifact[] = [];

  for (const routeTarget of routePlan.targets) {
    if (diagnostics.some((diagnostic) => diagnostic.routePath === routeTarget.routePath)) {
      continue;
    }

    try {
      artifacts.push(
        await replayStaticExportRouteDocumentArtifact({
          handler,
          htmlPathStyle,
          origin,
          routePath: routeTarget.path,
        }),
      );
    } catch (error) {
      if (!(error instanceof StaticExportError) || onNonExportable !== 'skip') {
        throw error;
      }

      diagnostics.push(...error.diagnostics);
    }
  }

  return {
    artifacts,
    clientModules: await replayStaticExportClientModuleArtifacts({
      handler,
      origin,
      routeArtifacts: artifacts,
    }),
    diagnostics,
  };
}
