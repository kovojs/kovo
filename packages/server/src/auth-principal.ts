import { securityClassifier } from '@kovojs/core/internal/security-markers';
import {
  createWitnessSet,
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessFreeze,
  witnessReflectApply,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

export type PrincipalPosture =
  | { kind: 'anonymous' }
  | { kind: 'proven'; principal: string }
  | { kind: 'unresolved' };

declare const nonRequestPrincipalPostureBrand: unique symbol;

export type NonRequestIngressKind = 'endpoint' | 'task' | 'webhook';
export type PrincipalAccessOperation = 'read' | 'write';

interface NonRequestPrincipalAudit {
  readonly ingress: NonRequestIngressKind;
  readonly operation: PrincipalAccessOperation;
  readonly surface: string;
}

export type NonRequestPrincipalPosture =
  | {
      readonly [nonRequestPrincipalPostureBrand]: {
        readonly scope: 'framework-owned-non-request-principal-posture';
      };
      readonly audit: NonRequestPrincipalAudit;
      readonly kind: 'act-as';
      readonly principal: string;
    }
  | {
      readonly [nonRequestPrincipalPostureBrand]: {
        readonly scope: 'framework-owned-non-request-principal-posture';
      };
      readonly audit: NonRequestPrincipalAudit;
      readonly kind: 'system';
      readonly reason: string;
    };

type NonRequestPrincipalPostureInput =
  | {
      readonly audit: NonRequestPrincipalAudit;
      readonly kind: 'act-as';
      readonly principal: string;
    }
  | {
      readonly audit: NonRequestPrincipalAudit;
      readonly kind: 'system';
      readonly reason: string;
    };

const nativeStringToLowerCase = String.prototype.toLowerCase;
const nativeStringTrim = String.prototype.trim;
const unresolvedPrincipalSentinels = createWitnessSet<string>();
witnessSetAdd(unresolvedPrincipalSentinels, 'anonymous');
witnessSetAdd(unresolvedPrincipalSentinels, 'unknown');
witnessSetAdd(unresolvedPrincipalSentinels, 'unresolved');
const nonRequestPrincipalPostures = createWitnessWeakSet<object>();

/** @internal SPEC §6.5/§6.6: auth decisions must only key on a positively resolved principal. */
export const isProvenPrincipal = securityClassifier(
  'server.auth.proven-principal',
  function (value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const trimmed = witnessReflectApply<string>(nativeStringTrim, value, []);
    if (trimmed === '' || trimmed !== value) return false;
    return !witnessSetHas(
      unresolvedPrincipalSentinels,
      witnessReflectApply(nativeStringToLowerCase, trimmed, []),
    );
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
          witnessDefineProperty(candidates, candidates.length, {
            configurable: true,
            enumerable: true,
            value: (user as Record<PropertyKey, unknown>).id,
            writable: true,
          });
        } else if (user !== null && user !== undefined) {
          witnessDefineProperty(candidates, candidates.length, {
            configurable: true,
            enumerable: true,
            value: user,
            writable: true,
          });
        }
      } else {
        hasUnresolvedCarrier = true;
        witnessDefineProperty(candidates, candidates.length, {
          configurable: true,
          enumerable: true,
          value: sessionValue,
          writable: true,
        });
      }
    }

    if ('sessionId' in record && record.sessionId !== null && record.sessionId !== undefined) {
      hasUnresolvedCarrier = true;
    }

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
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

/** @internal SPEC §10.3 DEC-G: mint an audited non-request principal for task/webhook work. */
export function actAsNonRequestPrincipal(
  principal: unknown,
  audit: NonRequestPrincipalAudit,
): NonRequestPrincipalPosture {
  if (!isProvenPrincipal(principal)) {
    throw new TypeError('actAs(id) requires a proven non-empty principal id (SPEC §10.3 DEC-G).');
  }
  return mintNonRequestPrincipalPosture({
    audit,
    kind: 'act-as',
    principal,
  });
}

/** @internal SPEC §10.3 DEC-G: mint an audited system read/write declaration. */
export function declareSystemPrincipal(
  reason: unknown,
  audit: NonRequestPrincipalAudit,
): NonRequestPrincipalPosture {
  const trimmedReason =
    typeof reason === 'string' ? witnessReflectApply<string>(nativeStringTrim, reason, []) : '';
  if (typeof reason !== 'string' || trimmedReason === '' || reason !== trimmedReason) {
    throw new TypeError(
      'declareSystemRead/Write(reason) requires a non-empty audited reason (SPEC §10.3 DEC-G).',
    );
  }
  return mintNonRequestPrincipalPosture({
    audit,
    kind: 'system',
    reason,
  });
}

/**
 * @internal Runtime brand check for framework-owned DB/runtime adapters. This is the seam managed
 * DB workers should consume before setting `kovo.principal` or a system bypass posture.
 */
export function assertNonRequestPrincipalPosture(
  value: unknown,
): asserts value is NonRequestPrincipalPosture {
  if (
    typeof value === 'object' &&
    value !== null &&
    witnessWeakSetHas(nonRequestPrincipalPostures, value)
  ) {
    return;
  }
  throw new Error(
    'Non-request owner-table access requires a framework-minted actAs(id) or declareSystemRead/Write(reason) posture (SPEC §10.3 DEC-G).',
  );
}

/** @internal SPEC §10.3 DEC-G/C7: the brand check is the only door to DB principal elevation. */
export function principalFromNonRequestPrincipalPosture(value: unknown): string | undefined {
  assertNonRequestPrincipalPosture(value);
  return value.kind === 'act-as' ? value.principal : undefined;
}

/** @internal */
export function nonRequestPrincipalPostureDiagnostic(value: NonRequestPrincipalPosture): string {
  if (value.kind === 'act-as') {
    return `${value.audit.ingress}:${value.audit.surface}:${value.audit.operation}:actAs(${value.principal})`;
  }
  return `${value.audit.ingress}:${value.audit.surface}:${value.audit.operation}:system(${value.reason})`;
}

function mintNonRequestPrincipalPosture(
  value: NonRequestPrincipalPostureInput,
): NonRequestPrincipalPosture {
  const minted = witnessFreeze(value) as NonRequestPrincipalPosture;
  witnessWeakSetAdd(nonRequestPrincipalPostures, minted);
  return minted;
}
