import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type { AppDiagnostic, KovoApp } from './app-types.js';
import { findRouteAmbiguities, type RouteLike } from './match.js';

export class AppDiagnosticError extends Error {
  readonly code: AppDiagnostic['code'];
  readonly diagnostics: readonly AppDiagnostic[];

  constructor(diagnostics: readonly AppDiagnostic[]) {
    const first = diagnostics[0];
    super(
      diagnostics.length === 1 && first
        ? `${first.code} ${first.message}`
        : `Kovo app has ${diagnostics.length} blocking diagnostics.`,
    );
    this.name = 'AppDiagnosticError';
    this.code = first?.code ?? 'KV228';
    this.diagnostics = diagnostics;
  }
}

export function routeTableDiagnostics(routes: readonly RouteLike[]): readonly AppDiagnostic[] {
  return findRouteAmbiguities(routes).map((ambiguity) => ({
    code: 'KV228',
    fileName: ambiguity.paths.join(' <-> '),
    help: diagnosticDefinitions.KV228.help,
    message: ambiguity.message,
  }));
}

interface PrefetchGuardRouteLike {
  guard?: unknown;
  path?: string;
  prefetch?: 'conservative' | 'moderate' | false;
  /**
   * Non-empty string suppresses KV419 when the author deliberately justifies a
   * guarded `prefetch:'moderate'` route (SPEC §8:756 justification hatch).
   */
  prefetchJustification?: string;
}

/**
 * bugs-1 F36 / SPEC §8 / I3 (ROUTING-NAV-3): prefetch "moderate" prerenders a route —
 * executing its render (and any per-user side effects) with the user's credentials on
 * hover/pointerdown, for a navigation that may be discarded. On a session-dependent
 * (guarded) route that is unsafe, so it is **KV419**.
 *
 * A non-empty `prefetchJustification` suppresses the diagnostic when the author has
 * explicitly reviewed the route for credential-safety.
 *
 * Limitation: session-dependence without an explicit guard (e.g. a route that reads
 * session data inside its page handler but declares no guard) is not detectable from
 * the static route definition alone; only guarded routes are currently flagged.
 */
export function routePrefetchGuardDiagnostics(
  routes: readonly PrefetchGuardRouteLike[],
): readonly AppDiagnostic[] {
  return routes
    .filter((route) => {
      if (route.prefetch !== 'moderate') return false;
      // Session-heuristic: use guard presence as the available proxy for
      // session-dependence. An explicit non-empty justification suppresses the gate.
      if (route.guard === undefined) return false;
      return !route.prefetchJustification;
    })
    .map((route) => ({
      code: 'KV419' as const,
      fileName: route.path ?? '(route)',
      help: diagnosticDefinitions.KV419.help,
      message: diagnosticDefinitions.KV419.message,
    }));
}

export function blockingAppDiagnostics(
  app: Pick<KovoApp, 'diagnostics'>,
): readonly AppDiagnostic[] {
  // SPEC §11.3: app-shell surfaces use the shared diagnostic registry severity.
  return app.diagnostics.filter(
    (diagnostic) => diagnosticDefinitions[diagnostic.code].severity === 'error',
  );
}

export function assertNoBlockingAppDiagnostics(app: Pick<KovoApp, 'diagnostics'>): void {
  const diagnostics = blockingAppDiagnostics(app);
  if (diagnostics.length > 0) throw new AppDiagnosticError(diagnostics);
}
