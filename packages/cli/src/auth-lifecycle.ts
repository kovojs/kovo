import boundary from './auth-lifecycle-boundary.json' with { type: 'json' };
import type { KovoCheckResult } from './shared.js';

/** Stable, graph-independent Better Auth lifecycle ownership/non-claim view (SPEC §6.6). */
export function authLifecycleExplainResult(version: string): KovoCheckResult {
  const inherited = boundary.inheritedSession;
  const lines = [
    version,
    `AUTH-LIFECYCLE provider=${boundary.provider} version=${boundary.providerVersion} posture=${boundary.posture}`,
    [
      `INHERITED expiresIn=${inherited.expiresIn}`,
      `updateAge=${inherited.updateAge}`,
      `freshAge=${inherited.freshAge}`,
      `cookieCacheEnabled=${String(inherited.cookieCacheEnabled)}`,
      `cookieCacheMaxAge=${inherited.cookieCacheMaxAge}`,
      `preexistingCookieSignIn=${inherited.preexistingCookieSignIn}`,
    ].join(' '),
  ];
  for (const transition of boundary.kovoOwnedTransitions) {
    lines.push(
      `OWNED ${transition.id} upstream=${transition.upstreamApi} surface=${transition.surface} devOnly=${String(transition.devOnly)}` +
        ('feature' in transition ? ` feature=${transition.feature}` : ''),
    );
  }
  for (const unreachable of boundary.structurallyUnreachable) {
    lines.push(`UNREACHABLE ${unreachable.id} reason=${JSON.stringify(unreachable.reason)}`);
  }
  for (const delegated of boundary.delegatedReachable) {
    lines.push(
      `DELEGATED ${delegated.id} status=${delegated.status} reason=${JSON.stringify(delegated.reason)}`,
    );
  }
  lines.push(
    `NON-CLAIM ${JSON.stringify(boundary.nonClaim)}`,
    [
      `SUMMARY kovoOwned=${boundary.kovoOwnedTransitions.length}`,
      `structurallyUnreachable=${boundary.structurallyUnreachable.length}`,
      `delegatedReachable=${boundary.delegatedReachable.length}`,
    ].join(' '),
  );
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}
