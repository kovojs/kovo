import type { KovoApp } from './app-types.js';
import { commitBuildArrayValue, snapshotBuildArray } from './build-security-intrinsics.js';
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
  const diagnostics = copyStaticExportDiagnostics(routePlan.diagnostics);
  if (diagnostics.length > 0 && onNonExportable !== 'skip') {
    throw new StaticExportError(diagnostics);
  }

  const context = createStaticExportReplayContext({
    app,
    ...(originOption === undefined ? {} : { origin: originOption }),
  });
  const artifacts: StaticExportArtifact[] = [];

  // Pin the complete route target set before the first synthetic request executes app code. A
  // route cannot replace Array iteration and smuggle an unplanned guarded/session route into replay.
  const routeTargets = snapshotBuildArray(routePlan.targets, 'static-export replay targets');
  for (let routeIndex = 0; routeIndex < routeTargets.length; routeIndex += 1) {
    const routeTarget = routeTargets[routeIndex]!;
    // SPEC §9.5: `skip` policy publishes the exportable subset. Suppress a target only when a
    // diagnostic names this exact concrete URL (`concretePath`), or — for a route-level diagnostic
    // with no single concrete target — when it shares the route pattern. Matching every staticPath
    // sibling by `routePath` (all param targets share `route.path`) would drop valid pages whenever
    // one staticPath is non-exportable; see C1.
    if (staticExportDiagnosticsSuppressTarget(diagnostics, routeTarget)) {
      continue;
    }

    try {
      const approvedArtifact = await replayStaticExportRouteDocumentArtifact({
        context,
        routePath: routeTarget.path,
      });
      // SPEC §6.6/§9.5: commit the exact post-KV229 bytes through a boot-pinned own-data write.
      // Earlier app routes may have replaced Array methods or installed numeric prototype setters.
      commitBuildArrayValue(artifacts, approvedArtifact, 'approved static-export route artifact');
    } catch (error) {
      if (!(error instanceof StaticExportError) || onNonExportable !== 'skip') {
        throw error;
      }

      const errorDiagnostics = snapshotBuildArray(
        error.diagnostics,
        'static-export replay error diagnostics',
      );
      for (let index = 0; index < errorDiagnostics.length; index += 1) {
        diagnostics[diagnostics.length] = errorDiagnostics[index]!;
      }
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

function copyStaticExportDiagnostics(
  source: readonly StaticExportDiagnostic[],
): StaticExportDiagnostic[] {
  const pinned = snapshotBuildArray(source, 'static-export diagnostics');
  const diagnostics: StaticExportDiagnostic[] = [];
  for (let index = 0; index < pinned.length; index += 1) {
    diagnostics[diagnostics.length] = pinned[index]!;
  }
  return diagnostics;
}

function staticExportDiagnosticsSuppressTarget(
  diagnostics: readonly StaticExportDiagnostic[],
  routeTarget: StaticExportRouteTarget,
): boolean {
  for (let index = 0; index < diagnostics.length; index += 1) {
    if (staticExportDiagnosticSuppresses(diagnostics[index]!, routeTarget)) return true;
  }
  return false;
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
