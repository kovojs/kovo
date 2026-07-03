import { securityClassifier } from '@kovojs/core/internal/security-markers';

export type PrincipalPosture =
  | { kind: 'anonymous' }
  | { kind: 'proven'; principal: string }
  | { kind: 'unresolved' };

const unresolvedPrincipalSentinels = new Set(['anonymous', 'unknown', 'unresolved']);

/** @internal SPEC §6.5/§6.6: auth decisions must only key on a positively resolved principal. */
export const isProvenPrincipal = securityClassifier(
  'server.auth.proven-principal',
  function (value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed === '' || trimmed !== value) return false;
    return !unresolvedPrincipalSentinels.has(trimmed.toLowerCase());
  },
);

/** @internal */
export const principalPostureFromRequest = securityClassifier(
  'server.auth.request-principal-posture',
  function (request: unknown): PrincipalPosture {
    if ((typeof request !== 'object' && typeof request !== 'function') || request === null) {
      return { kind: 'anonymous' };
    }

    const record = request as Record<PropertyKey, unknown>;
    const candidates: unknown[] = [];
    let hasUnresolvedCarrier = false;

    if ('session' in record) {
      const sessionValue = record.session;
      if (sessionValue === null || sessionValue === undefined) {
        // Explicit null/undefined is the documented anonymous session-provider outcome.
      } else if (typeof sessionValue === 'object' || typeof sessionValue === 'function') {
        hasUnresolvedCarrier = true;
        const session = sessionValue as Record<PropertyKey, unknown>;
        const user = session.user;
        if (typeof user === 'object' || typeof user === 'function') {
          candidates.push((user as Record<PropertyKey, unknown>).id);
        } else if (user !== null && user !== undefined) {
          candidates.push(user);
        }
      } else {
        hasUnresolvedCarrier = true;
        candidates.push(sessionValue);
      }
    }

    if ('sessionId' in record && record.sessionId !== null && record.sessionId !== undefined) {
      hasUnresolvedCarrier = true;
    }

    for (const candidate of candidates) {
      if (isProvenPrincipal(candidate)) return { kind: 'proven', principal: candidate };
    }

    return hasUnresolvedCarrier ? { kind: 'unresolved' } : { kind: 'anonymous' };
  },
);

/** @internal */
export function provenPrincipalFromRequest(request: unknown): string | undefined {
  const posture = principalPostureFromRequest(request);
  return posture.kind === 'proven' ? posture.principal : undefined;
}
