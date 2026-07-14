import { accessDecisionFor, isGuardAccessDecision, type AccessDecision } from './access.js';
import type { KovoApp } from './app-types.js';
import {
  buildSecurityDecodeURIComponent,
  snapshotBuildArray,
} from './build-security-intrinsics.js';
import { matchRoute, normalizePathname, parseRoutePattern } from './match.js';
import {
  createSecurityMap,
  securityMapGet,
  securityMapSet,
  securityStringIncludes,
  securityStringSplit,
  securityStringStartsWith,
} from './response-security-intrinsics.js';
import {
  staticExportDiagnostic,
  type StaticExportDiagnostic,
} from './static-export-diagnostics.js';
import { matchShellDispatch } from './shell.js';
import { witnessArrayAppend, witnessObjectIs } from './security-witness-intrinsics.js';

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
  const targetPaths = createSecurityMap<string, StaticExportRouteTarget>();
  const routes = snapshotBuildArray(app.routes, 'static-export routes');

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]!;
    const access = accessDecisionFor(route);
    if (app.sessionProvider && !isPublicAccessDecision(access)) {
      witnessArrayAppend(
        diagnostics,
        staticExportDiagnostic(
          route.path,
          `KV229 static export cannot prove '${route.path}' is session-independent while the app has a sessionProvider. Exported sites have no server-side sessions; declare publicAccess(...) on explicitly public routes, split this route into an explicitly public app shell, or wait for compiler-backed session-dependence metadata.`,
        ),
        'Server packages/server/src/static-export-route-plan.ts collection',
      );
      continue;
    }

    if (route.guard || isGuardAccessDecision(access)) {
      witnessArrayAppend(
        diagnostics,
        staticExportDiagnostic(
          route.path,
          `KV229 static export cannot export guarded route '${route.path}'. Exported sites have no server-side guard/session pass; serve this route dynamically or remove the guard from the exported surface.`,
        ),
        'Server packages/server/src/static-export-route-plan.ts collection',
      );
      continue;
    }

    if (isPublicAccessDecision(access) && appRouteMayEmitAnonymousCsrfCookie(app)) {
      witnessArrayAppend(
        diagnostics,
        staticExportDiagnostic(
          route.path,
          `KV229 static export cannot export publicAccess route '${route.path}' because this app has default-on per-form CSRF for browser mutations. Rendering a mutation form can mint the anonymous CSRF Set-Cookie required by SPEC §9.1, but SPEC §9.5 static files have no response-specific cookie channel. Serve this route dynamically, split the form out of the exported surface, or make the targeted non-browser mutation explicitly csrf:false with a justification.`,
        ),
        'Server packages/server/src/static-export-route-plan.ts collection',
      );
      continue;
    }

    if (routeHasParams(route.path)) {
      const planned = staticExportParamRouteTargets(app, route, targetPaths);
      appendStaticExportPlanItems(diagnostics, planned.diagnostics);
      appendStaticExportPlanItems(targets, planned.targets);
      continue;
    }

    addStaticExportRouteTarget(
      targets,
      targetPaths,
      diagnostics,
      {
        path: normalizePathname(route.path).pathname,
        routePath: route.path,
      },
      app,
      route,
    );
  }

  return { diagnostics, targets };
}

function isPublicAccessDecision(access: AccessDecision | undefined): boolean {
  return !isGuardAccessDecision(access) && access?.kind === 'public';
}

function appRouteMayEmitAnonymousCsrfCookie(app: KovoApp): boolean {
  // SPEC §9.1 anonymous CSRF mints a framework-owned Set-Cookie when a server-rendered mutation
  // form has no session binding. SPEC §9.5 static export must reject that cookie channel up front.
  if (app.csrf === undefined) return false;
  const mutations = snapshotBuildArray(app.mutations, 'static-export mutations');
  for (let index = 0; index < mutations.length; index += 1) {
    if (mutations[index]!.csrf !== false) return true;
  }
  return false;
}

function staticExportParamRouteTargets(
  app: KovoApp,
  route: KovoApp['routes'][number],
  targetPaths: Map<string, StaticExportRouteTarget>,
): StaticExportRoutePlan {
  const rawStaticPaths = route.staticPaths;
  if (!rawStaticPaths) {
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

  const staticPaths = snapshotBuildArray(rawStaticPaths, `staticPaths for '${route.path}'`);
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
  for (let index = 0; index < staticPaths.length; index += 1) {
    const staticPath = staticPaths[index]!;
    const normalized = normalizePathname(staticPath);
    // SPEC §9.5 `skip` policy publishes the exportable subset of a param route. Every per-staticPath
    // diagnostic carries the offending concrete URL so skip suppresses only that exact target and not
    // its valid siblings (all of which share `routePath = route.path`).
    if (
      !securityStringStartsWith(staticPath, '/') ||
      securityStringIncludes(staticPath, '?') ||
      securityStringIncludes(staticPath, '#')
    ) {
      witnessArrayAppend(
        diagnostics,
        staticExportDiagnostic(
          route.path,
          `KV229 static export staticPath '${staticPath}' for param route '${route.path}' must be an absolute pathname without search or hash.`,
          staticPath,
        ),
        'Server packages/server/src/static-export-route-plan.ts collection',
      );
      continue;
    }

    if (routeHasParams(normalized.pathname)) {
      witnessArrayAppend(
        diagnostics,
        staticExportDiagnostic(
          route.path,
          `KV229 static export staticPath '${staticPath}' for param route '${route.path}' must be a concrete URL, not a route pattern.`,
          normalized.pathname,
        ),
        'Server packages/server/src/static-export-route-plan.ts collection',
      );
      continue;
    }

    // Check segment safety BEFORE matching: a malformed-encoding segment (e.g. an incomplete
    // percent-escape) now fails route matching (matchRoute decodeURIComponent-throws per I2), so the
    // specific "unsafe URL path segment" diagnostic must be raised here rather than being preempted
    // by the generic "does not match" message (SPEC §9.5).
    if (!staticExportRouteTargetPathIsSafe(normalized.pathname)) {
      witnessArrayAppend(
        diagnostics,
        unsafeStaticExportRouteTargetDiagnostic(route.path, normalized.pathname),
        'Server packages/server/src/static-export-route-plan.ts collection',
      );
      continue;
    }

    if (!matchRoute([route], normalized.pathname)) {
      witnessArrayAppend(
        diagnostics,
        staticExportDiagnostic(
          route.path,
          `KV229 static export staticPath '${staticPath}' does not match param route '${route.path}'.`,
          normalized.pathname,
        ),
        'Server packages/server/src/static-export-route-plan.ts collection',
      );
      continue;
    }

    addStaticExportRouteTarget(
      targets,
      targetPaths,
      diagnostics,
      {
        path: normalized.pathname,
        routePath: route.path,
      },
      app,
      route,
    );
  }

  return { diagnostics, targets };
}

function addStaticExportRouteTarget(
  targets: StaticExportRouteTarget[],
  targetPaths: Map<string, StaticExportRouteTarget>,
  diagnostics: StaticExportDiagnostic[],
  target: StaticExportRouteTarget,
  app: KovoApp,
  intendedRoute: KovoApp['routes'][number],
): void {
  if (!staticExportRouteTargetPathIsSafe(target.path)) {
    witnessArrayAppend(
      diagnostics,
      unsafeStaticExportRouteTargetDiagnostic(target.routePath, target.path),
      'Server packages/server/src/static-export-route-plan.ts collection',
    );
    return;
  }

  const existing = securityMapGet(targetPaths, target.path);
  if (existing) {
    // SPEC §9.5 static export replays a synthetic GET per concrete route document;
    // duplicate concrete URLs are non-exportable because they would race for one HTML artifact.
    witnessArrayAppend(
      diagnostics,
      staticExportDiagnostic(
        target.routePath,
        `KV229 static export cannot export '${target.path}' for route '${target.routePath}' because it duplicates the concrete route target from '${existing.routePath}'.`,
        target.path,
      ),
      'Server packages/server/src/static-export-route-plan.ts collection',
    );
    return;
  }

  const dispatchDiagnostic = staticExportRouteDispatchDiagnostic(app, intendedRoute, target);
  if (dispatchDiagnostic !== undefined) {
    witnessArrayAppend(
      diagnostics,
      dispatchDiagnostic,
      'Server packages/server/src/static-export-route-plan.ts collection',
    );
    return;
  }

  securityMapSet(targetPaths, target.path, target);
  witnessArrayAppend(
    targets,
    target,
    'Server packages/server/src/static-export-route-plan.ts collection',
  );
}

function staticExportRouteDispatchDiagnostic(
  app: KovoApp,
  intendedRoute: KovoApp['routes'][number],
  target: StaticExportRouteTarget,
): StaticExportDiagnostic | undefined {
  // SPEC §6.6/§9.5: static export must prove route ownership from the same normative GET shell
  // dispatch used by production before any app code runs. A path-shaped plan alone is not proof:
  // reserved surfaces and exact/prefix endpoints dispatch before routes and could otherwise have
  // their arbitrary response bytes published as the intended route document.
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    method: 'GET',
    pathname: target.path,
    routes: app.routes,
  });
  if (match.kind === 'route' && witnessObjectIs(match.route, intendedRoute)) return undefined;

  let owner: string;
  if (match.kind === 'endpoint') {
    owner = `${match.endpoint.mount} GET endpoint '${match.endpoint.path}'`;
  } else if (
    match.kind === 'mutation' ||
    match.kind === 'query' ||
    match.kind === 'client-module'
  ) {
    owner = `reserved ${match.kind} dispatch '${match.entry.prefix}'`;
  } else if (match.kind === 'route') {
    owner = `route '${match.route.path}'`;
  } else {
    owner = 'the not-found shell';
  }

  return staticExportDiagnostic(
    target.routePath,
    `KV229 static export cannot export concrete route target '${target.path}' for route '${target.routePath}' because SPEC §9.5 GET shell dispatch resolves it to ${owner} instead of the intended route. Static export replays only targets whose normative shell owner is that exact route.`,
    target.path,
  );
}

function staticExportRouteTargetPathIsSafe(pathname: string): boolean {
  // SPEC §9.5 publishes route documents as static-host directory-index files; keep each
  // concrete URL segment representable as one filesystem/static-host segment before replay.
  const segments = securityStringSplit(pathname, '/');
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment !== '' && !staticExportRouteTargetPathSegmentIsSafe(segment)) return false;
  }
  return true;
}

function staticExportRouteTargetPathSegmentIsSafe(segment: string): boolean {
  let decoded: string;
  try {
    decoded = buildSecurityDecodeURIComponent(segment);
  } catch {
    return false;
  }

  return (
    decoded !== '.' &&
    decoded !== '..' &&
    !securityStringIncludes(decoded, '/') &&
    !securityStringIncludes(decoded, '\\')
  );
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
  return parseRoutePattern(path).hasParams;
}

function appendStaticExportPlanItems<Value>(target: Value[], source: readonly Value[]): void {
  const pinned = snapshotBuildArray(source, 'static-export plan items');
  for (let index = 0; index < pinned.length; index += 1) {
    witnessArrayAppend(
      target,
      pinned[index]!,
      'Server packages/server/src/static-export-route-plan.ts collection',
    );
  }
}
