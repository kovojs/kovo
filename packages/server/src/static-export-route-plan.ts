import type { KovoApp } from './app-types.js';
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

export function staticExportRoutePlan(app: KovoApp): StaticExportRoutePlan {
  const diagnostics: StaticExportDiagnostic[] = [];
  const targets: StaticExportRouteTarget[] = [];
  const targetPaths = new Map<string, StaticExportRouteTarget>();

  for (const route of app.routes) {
    if (app.sessionProvider) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `KV229 static export cannot prove '${route.path}' is session-independent while the app has a sessionProvider. Exported sites have no server-side sessions; split this route into an explicitly public app shell or wait for compiler-backed session-dependence metadata.`,
        ),
      );
      continue;
    }

    if (route.guard) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `KV229 static export cannot export guarded route '${route.path}'. Exported sites have no server-side guard/session pass; serve this route dynamically or remove the guard from the exported surface.`,
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
  route: KovoApp['routes'][number],
  targetPaths: Map<string, StaticExportRouteTarget>,
): StaticExportRoutePlan {
  const staticPaths = route.staticPaths;
  if (!staticPaths) {
    return {
      diagnostics: [
        staticExportDiagnostic(
          route.path,
          `KV229 static export cannot enumerate param route '${route.path}' without staticPaths metadata. Add explicit staticPaths for every exported concrete URL, or exclude the route from export.`,
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
          `KV229 static export cannot enumerate param route '${route.path}' because staticPaths is empty. Add at least one concrete exported URL, or exclude the route from export.`,
        ),
      ],
      targets: [],
    };
  }

  const diagnostics: StaticExportDiagnostic[] = [];
  const targets: StaticExportRouteTarget[] = [];
  for (const staticPath of staticPaths) {
    const normalized = normalizePathname(staticPath);
    // SPEC §9.5 `skip` policy publishes the exportable subset of a param route. Every per-staticPath
    // diagnostic carries the offending concrete URL so skip suppresses only that exact target and not
    // its valid siblings (all of which share `routePath = route.path`).
    if (!staticPath.startsWith('/') || staticPath.includes('?') || staticPath.includes('#')) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `KV229 static export staticPath '${staticPath}' for param route '${route.path}' must be an absolute pathname without search or hash.`,
          staticPath,
        ),
      );
      continue;
    }

    if (routeHasParams(normalized.pathname)) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `KV229 static export staticPath '${staticPath}' for param route '${route.path}' must be a concrete URL, not a route pattern.`,
          normalized.pathname,
        ),
      );
      continue;
    }

    // Check segment safety BEFORE matching: a malformed-encoding segment (e.g. an incomplete
    // percent-escape) now fails route matching (matchRoute decodeURIComponent-throws per I2), so the
    // specific "unsafe URL path segment" diagnostic must be raised here rather than being preempted
    // by the generic "does not match" message (SPEC §9.5).
    if (!staticExportRouteTargetPathIsSafe(normalized.pathname)) {
      diagnostics.push(unsafeStaticExportRouteTargetDiagnostic(route.path, normalized.pathname));
      continue;
    }

    if (!matchRoute([route], normalized.pathname)) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `KV229 static export staticPath '${staticPath}' does not match param route '${route.path}'.`,
          normalized.pathname,
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
  if (!staticExportRouteTargetPathIsSafe(target.path)) {
    diagnostics.push(unsafeStaticExportRouteTargetDiagnostic(target.routePath, target.path));
    return;
  }

  const existing = targetPaths.get(target.path);
  if (existing) {
    // SPEC §9.5 static export replays a synthetic GET per concrete route document;
    // duplicate concrete URLs are non-exportable because they would race for one HTML artifact.
    diagnostics.push(
      staticExportDiagnostic(
        target.routePath,
        `KV229 static export cannot export '${target.path}' for route '${target.routePath}' because it duplicates the concrete route target from '${existing.routePath}'.`,
        target.path,
      ),
    );
    return;
  }

  targetPaths.set(target.path, target);
  targets.push(target);
}

function staticExportRouteTargetPathIsSafe(pathname: string): boolean {
  // SPEC §9.5 publishes route documents as static-host directory-index files; keep each
  // concrete URL segment representable as one filesystem/static-host segment before replay.
  return pathname
    .split('/')
    .filter(Boolean)
    .every((segment) => staticExportRouteTargetPathSegmentIsSafe(segment));
}

function staticExportRouteTargetPathSegmentIsSafe(segment: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }

  return decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\');
}

function unsafeStaticExportRouteTargetDiagnostic(
  routePath: string,
  targetPath: string,
): StaticExportDiagnostic {
  return staticExportDiagnostic(
    routePath,
    `KV229 static export cannot export concrete route target '${targetPath}' for route '${routePath}' because it contains an unsafe URL path segment. Encoded separators, encoded dot segments, and invalid URL encoding cannot be published as SPEC §9.5 directory-index route documents.`,
    targetPath,
  );
}

function routeHasParams(path: string): boolean {
  return normalizePathname(path)
    .pathname.split('/')
    .some((segment) => segment.startsWith(':') && segment.length > 1);
}
