import type { JisoApp } from './app-types.js';
import { matchRoute, normalizePathname } from './match.js';
import {
  staticExportDiagnostic,
  type StaticExportDiagnostic,
} from './static-export-diagnostics.js';

export interface StaticExportRouteTarget {
  path: string;
  routePath: string;
}

export interface StaticExportRoutePlan {
  diagnostics: readonly StaticExportDiagnostic[];
  targets: readonly StaticExportRouteTarget[];
}

export function staticExportRoutePlan(app: JisoApp): StaticExportRoutePlan {
  const diagnostics: StaticExportDiagnostic[] = [];
  const targets: StaticExportRouteTarget[] = [];
  const targetPaths = new Map<string, StaticExportRouteTarget>();

  for (const route of app.routes) {
    if (app.sessionProvider) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `FW229 static export cannot prove '${route.path}' is session-independent while the app has a sessionProvider. Exported sites have no server-side sessions; split this route into an explicitly public app shell or wait for compiler-backed session-dependence metadata.`,
        ),
      );
      continue;
    }

    if (route.guard) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `FW229 static export cannot export guarded route '${route.path}'. Exported sites have no server-side guard/session pass; serve this route dynamically or remove the guard from the exported surface.`,
        ),
      );
      continue;
    }

    if (routeHasParams(route.path)) {
      const planned = staticExportParamRouteTargets(route, targetPaths);
      diagnostics.push(...planned.diagnostics);
      targets.push(...planned.targets);
      continue;
    }

    addStaticExportRouteTarget(targets, targetPaths, diagnostics, {
      path: normalizePathname(route.path).pathname,
      routePath: route.path,
    });
  }

  return { diagnostics, targets };
}

function staticExportParamRouteTargets(
  route: JisoApp['routes'][number],
  targetPaths: Map<string, StaticExportRouteTarget>,
): StaticExportRoutePlan {
  const staticPaths = route.staticPaths;
  if (!staticPaths) {
    return {
      diagnostics: [
        staticExportDiagnostic(
          route.path,
          `FW229 static export cannot enumerate param route '${route.path}' without staticPaths metadata. Add explicit staticPaths for every exported concrete URL, or exclude the route from export.`,
        ),
      ],
      targets: [],
    };
  }

  if (staticPaths.length === 0) {
    return {
      diagnostics: [
        staticExportDiagnostic(
          route.path,
          `FW229 static export cannot enumerate param route '${route.path}' because staticPaths is empty. Add at least one concrete exported URL, or exclude the route from export.`,
        ),
      ],
      targets: [],
    };
  }

  const diagnostics: StaticExportDiagnostic[] = [];
  const targets: StaticExportRouteTarget[] = [];
  for (const staticPath of staticPaths) {
    const normalized = normalizePathname(staticPath);
    if (!staticPath.startsWith('/') || staticPath.includes('?') || staticPath.includes('#')) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `FW229 static export staticPath '${staticPath}' for param route '${route.path}' must be an absolute pathname without search or hash.`,
        ),
      );
      continue;
    }

    if (routeHasParams(normalized.pathname)) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `FW229 static export staticPath '${staticPath}' for param route '${route.path}' must be a concrete URL, not a route pattern.`,
        ),
      );
      continue;
    }

    if (!matchRoute([route], normalized.pathname)) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `FW229 static export staticPath '${staticPath}' does not match param route '${route.path}'.`,
        ),
      );
      continue;
    }

    addStaticExportRouteTarget(targets, targetPaths, diagnostics, {
      path: normalized.pathname,
      routePath: route.path,
    });
  }

  return { diagnostics, targets };
}

function addStaticExportRouteTarget(
  targets: StaticExportRouteTarget[],
  targetPaths: Map<string, StaticExportRouteTarget>,
  diagnostics: StaticExportDiagnostic[],
  target: StaticExportRouteTarget,
): void {
  const existing = targetPaths.get(target.path);
  if (existing) {
    // SPEC §9.5 static export replays a synthetic GET per concrete route document;
    // duplicate concrete URLs are non-exportable because they would race for one HTML artifact.
    diagnostics.push(
      staticExportDiagnostic(
        target.routePath,
        `FW229 static export cannot export '${target.path}' for route '${target.routePath}' because it duplicates the concrete route target from '${existing.routePath}'.`,
      ),
    );
    return;
  }

  targetPaths.set(target.path, target);
  targets.push(target);
}

function routeHasParams(path: string): boolean {
  return normalizePathname(path)
    .pathname.split('/')
    .some((segment) => segment.startsWith(':') && segment.length > 1);
}
