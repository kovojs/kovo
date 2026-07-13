import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { snapshotAuditJustification } from './audit-justification.js';
import type { AppDiagnostic, KovoApp } from './app-types.js';
import { findRouteAmbiguities, type RouteLike } from './match.js';
import {
  createWitnessSet,
  witnessArrayAppend,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectKeys,
  witnessSetAdd,
  witnessSetHas,
} from './security-witness-intrinsics.js';

const blockingAppDiagnosticCodes = createWitnessSet<AppDiagnostic['code']>();
const diagnosticCodes = witnessObjectKeys(diagnosticDefinitions) as AppDiagnostic['code'][];
for (let index = 0; index < diagnosticCodes.length; index += 1) {
  const code = diagnosticCodes[index]!;
  const definition = witnessGetOwnPropertyDescriptor(diagnosticDefinitions, code);
  if (definition === undefined || !('value' in definition)) continue;
  const severity = witnessGetOwnPropertyDescriptor(definition.value, 'severity');
  if (severity !== undefined && 'value' in severity && severity.value === 'error') {
    witnessSetAdd(blockingAppDiagnosticCodes, code);
  }
}

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
  const ambiguities = findRouteAmbiguities(routes);
  const diagnostics: AppDiagnostic[] = [];
  for (let index = 0; index < ambiguities.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(ambiguities, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Route ambiguity results must be a dense own-data array.');
    }
    const ambiguity = descriptor.value;
    const paths = ownDiagnosticDataValue(ambiguity, 'paths', 'Route ambiguity paths');
    const message = ownDiagnosticDataValue(ambiguity, 'message', 'Route ambiguity message');
    if (!witnessIsArray(paths) || paths.length !== 2 || typeof message !== 'string') {
      throw new TypeError('Route ambiguity results require two paths and a message.');
    }
    const left = ownDiagnosticDataValue(paths, 0, 'Route ambiguity left path');
    const right = ownDiagnosticDataValue(paths, 1, 'Route ambiguity right path');
    if (typeof left !== 'string' || typeof right !== 'string') {
      throw new TypeError('Route ambiguity paths must be strings.');
    }
    witnessArrayAppend(
      diagnostics,
      witnessFreeze({
        code: 'KV228',
        fileName: `${left} <-> ${right}`,
        help: diagnosticDefinitions.KV228.help,
        message,
      }),
      'Route table diagnostics',
    );
  }
  return witnessFreeze(diagnostics);
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
  const diagnostics: AppDiagnostic[] = [];
  for (let index = 0; index < routes.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(routes, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Prefetch guard routes must be a dense own-data array.');
    }
    const route = descriptor.value;
    const prefetch = ownDiagnosticDataValue(route, 'prefetch', 'Route prefetch posture');
    if (prefetch !== 'moderate') continue;
    // Session-heuristic: use guard presence as the available proxy for
    // session-dependence. An explicit non-empty justification suppresses the gate.
    const guard = ownDiagnosticDataValue(route, 'guard', 'Route prefetch guard');
    if (guard === undefined) continue;
    const justification = ownDiagnosticDataValue(
      route,
      'prefetchJustification',
      'Route prefetch justification',
    );
    if (justification !== undefined) {
      try {
        snapshotAuditJustification(justification, 'route prefetchJustification (SPEC §8/KV419)');
        continue;
      } catch {
        // Invalid audit text cannot suppress the guarded-prefetch diagnostic.
      }
    }
    const path = ownDiagnosticDataValue(route, 'path', 'Route diagnostic path');
    witnessArrayAppend(
      diagnostics,
      witnessFreeze({
        code: 'KV419' as const,
        fileName: typeof path === 'string' ? path : '(route)',
        help: diagnosticDefinitions.KV419.help,
        message: diagnosticDefinitions.KV419.message,
      }),
      'Route prefetch diagnostics',
    );
  }
  return witnessFreeze(diagnostics);
}

export function blockingAppDiagnostics(
  app: Pick<KovoApp, 'diagnostics'>,
): readonly AppDiagnostic[] {
  // SPEC §11.3: app-shell surfaces use the shared diagnostic registry severity.
  const blocking: AppDiagnostic[] = [];
  for (let index = 0; index < app.diagnostics.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(app.diagnostics, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('App diagnostics must be a dense own-data array.');
    }
    const diagnostic = descriptor.value;
    if (witnessSetHas(blockingAppDiagnosticCodes, diagnostic.code)) {
      witnessArrayAppend(blocking, diagnostic, 'Blocking app diagnostics');
    }
  }
  return witnessFreeze(blocking);
}

function ownDiagnosticDataValue(source: object, property: PropertyKey, label: string): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(source, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`${label} must be an own data property.`);
  }
  return descriptor.value;
}

export function assertNoBlockingAppDiagnostics(app: Pick<KovoApp, 'diagnostics'>): void {
  const diagnostics = blockingAppDiagnostics(app);
  if (diagnostics.length > 0) throw new AppDiagnosticError(diagnostics);
}
