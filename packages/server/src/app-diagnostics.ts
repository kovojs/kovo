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
}

/**
 * bugs-1 F36 / SPEC §8: prefetch "moderate" prerenders a route — executing its render
 * (and any per-user side effects) with the user's credentials on hover/pointerdown, for
 * a navigation that may be discarded. On a guarded (session-dependent) route that is
 * unsafe, so it is **KV419**. Restrict "moderate" to public, idempotent routes.
 */
export function routePrefetchGuardDiagnostics(
  routes: readonly PrefetchGuardRouteLike[],
): readonly AppDiagnostic[] {
  return routes
    .filter((route) => route.prefetch === 'moderate' && route.guard !== undefined)
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
