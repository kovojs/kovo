import type { KovoApp } from './app-types.js';
import { replayStaticExportClientModuleArtifacts } from './static-export-client-modules.js';
import { replayStaticExportRouteDocumentArtifact } from './static-export-document.js';
import { staticExportRoutePlan } from './static-export-route-plan.js';
import {
  blockingStaticExportDiagnostics,
  StaticExportError,
  type StaticExportDiagnostic,
} from './static-export-diagnostics.js';
import { createStaticExportReplayContext } from './static-export-replay-context.js';
import {
  type StaticExportArtifact,
  type StaticExportClientModuleArtifact,
  type StaticExportNonExportablePolicy,
} from './static-export-types.js';

export interface StaticExportAppReplayOptions {
  app: KovoApp;
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
  onNonExportable,
  origin: originOption,
}: StaticExportAppReplayOptions): Promise<StaticExportReplayResult> {
  const appDiagnostics = blockingStaticExportDiagnostics(app.diagnostics);
  if (appDiagnostics.length > 0) throw new StaticExportError(appDiagnostics);

  const routePlan = staticExportRoutePlan(app);
  const diagnostics = [...routePlan.diagnostics];
  if (diagnostics.length > 0 && onNonExportable !== 'skip') {
    throw new StaticExportError(diagnostics);
  }

  const context = createStaticExportReplayContext({
    app,
    ...(originOption === undefined ? {} : { origin: originOption }),
  });
  const artifacts: StaticExportArtifact[] = [];

  for (const routeTarget of routePlan.targets) {
    if (diagnostics.some((diagnostic) => diagnostic.routePath === routeTarget.routePath)) {
      continue;
    }

    try {
      artifacts.push(
        await replayStaticExportRouteDocumentArtifact({
          context,
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
      context,
      routeArtifacts: artifacts,
    }),
    diagnostics,
  };
}
