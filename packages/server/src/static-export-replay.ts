import type { KovoApp } from './app-types.js';
import { replayStaticExportClientModuleArtifacts } from './static-export-client-modules.js';
import { replayStaticExportRouteDocumentArtifact } from './static-export-document.js';
import { staticExportRoutePlan, type StaticExportRouteTarget } from './static-export-route-plan.js';
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
    // SPEC §9.5: `skip` policy publishes the exportable subset. Suppress a target only when a
    // diagnostic names this exact concrete URL (`concretePath`), or — for a route-level diagnostic
    // with no single concrete target — when it shares the route pattern. Matching every staticPath
    // sibling by `routePath` (all param targets share `route.path`) would drop valid pages whenever
    // one staticPath is non-exportable; see C1.
    if (
      diagnostics.some((diagnostic) => staticExportDiagnosticSuppresses(diagnostic, routeTarget))
    ) {
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

/**
 * SPEC §9.5 `skip` suppression test for one concrete replay target. A diagnostic that names a
 * single concrete URL (`concretePath`) suppresses only that exact target; a route-level diagnostic
 * with no concrete target suppresses every target sharing its route pattern.
 */
function staticExportDiagnosticSuppresses(
  diagnostic: StaticExportDiagnostic,
  routeTarget: StaticExportRouteTarget,
): boolean {
  return diagnostic.concretePath === undefined
    ? diagnostic.routePath === routeTarget.routePath
    : diagnostic.concretePath === routeTarget.path;
}
