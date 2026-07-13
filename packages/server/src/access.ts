import type { Guard } from './guards.js';
import {
  securityStringCharCodeAt,
  securityStringTrim,
} from './response-security-intrinsics.js';
import {
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessWeakMapGet,
  witnessWeakMapHas,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

/** A human-justified public access decision. */
export interface PublicAccess {
  kind: 'public';
  reason: string;
}

/** A structured access decision backed by verified machine authentication. */
export interface VerifiedMachineAccess {
  kind: 'verified-machine-auth';
}

/**
 * Optional structured access decision for SPEC §10 default-deny surfaces.
 *
 * A guard-chain decision is the executable readonly guard array itself: the same
 * guards run at request time and project their private names into access audits.
 * `publicAccess(reason)` and `verifiedAccess` are the explicit no-guard sentinels.
 */
export type AccessDecision = readonly Guard<any, any>[] | PublicAccess | VerifiedMachineAccess;

const snapshottedGuardAccessDecisions = createWitnessWeakSet<object>();
const snapshottedStructuredAccessDecisions = createWitnessWeakSet<object>();
const pinnedAccessDecisions = createWitnessWeakMap<
  object,
  { decision: AccessDecision | undefined }
>();
const nativeArrayIsArray = Array.isArray;
const nativeNumberIsSafeInteger = Number.isSafeInteger;
const MAX_ACCESS_GUARD_CHAIN_LENGTH = 256;

const invalidAccessDecision = witnessFreeze([undefined]) as unknown as AccessDecision;
witnessWeakSetAdd(snapshottedGuardAccessDecisions, invalidAccessDecision as object);

/** @internal Test whether an access decision is an executable guard array. */
export function isGuardAccessDecision(
  access: AccessDecision | undefined,
): access is readonly Guard<any, any>[] {
  return nativeArrayIsArray(access);
}

/**
 * @internal Validate the executable guard carrier itself, not only its array shape.
 *
 * SPEC §2/§10.2 requires one or more actual guards. Sparse arrays, accessor-backed slots, and
 * non-functions are not access decisions: audit must report them as missing and runtime must deny.
 */
export function isExecutableGuardAccessDecision(
  access: AccessDecision | undefined,
): access is readonly Guard<any, any>[] {
  return executableGuardAccessDecision(access) !== undefined;
}

/**
 * @internal Return the plain immutable guard list that enforcement may execute.
 *
 * Callers must consume this returned list rather than validate one carrier and then iterate the
 * caller-owned value. A Proxy can make `getOwnPropertyDescriptor(0)` expose a guard while `get(0)`
 * returns `undefined`; reconstructing once closes that validation/use gap (SPEC §6.6 C9/§10.2).
 */
export function executableGuardAccessDecision(
  access: AccessDecision | undefined,
): readonly Guard<any, any>[] | undefined {
  if (!nativeArrayIsArray(access)) return undefined;
  const snapshot = snapshotAccessDecision(access);
  if (!nativeArrayIsArray(snapshot) || snapshot.length === 0) return undefined;

  for (let index = 0; index < snapshot.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(snapshot, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'function'
    ) {
      return undefined;
    }
  }

  return snapshot as readonly Guard<any, any>[];
}

/**
 * @internal Reconstruct a guard-array decision at declaration time (SPEC §6.6 C9).
 *
 * The frozen dense snapshot pins the exact functions later consumed by both audit and enforcement.
 * An invalid source slot is retained as `undefined` in the internal snapshot so both consumers fail
 * closed instead of re-reading a caller-owned getter or observing later array mutation.
 */
export function snapshotAccessDecision(access: AccessDecision): AccessDecision;
export function snapshotAccessDecision(access: undefined): undefined;
export function snapshotAccessDecision(
  access: AccessDecision | undefined,
): AccessDecision | undefined;
export function snapshotAccessDecision(
  access: AccessDecision | undefined,
): AccessDecision | undefined {
  if (access === undefined) return undefined;
  if (nativeArrayIsArray(access)) return snapshotGuardAccessDecision(access);
  if (typeof access !== 'object' || access === null) return invalidAccessDecision;
  if (witnessWeakSetHas(snapshottedStructuredAccessDecisions, access)) return access;

  try {
    const kind = witnessGetOwnPropertyDescriptor(access, 'kind');
    if (kind === undefined || !('value' in kind)) return invalidAccessDecision;
    if (kind.value === 'public') {
      const reason = witnessGetOwnPropertyDescriptor(access, 'reason');
      if (
        reason === undefined ||
        !('value' in reason) ||
        typeof reason.value !== 'string' ||
        !isPrintablePublicAuditReason(reason.value)
      ) {
        return invalidAccessDecision;
      }
      return markStructuredAccessDecision(witnessFreeze({ kind: 'public', reason: reason.value }));
    }
    if (kind.value === 'verified-machine-auth') {
      return markStructuredAccessDecision(witnessFreeze({ kind: 'verified-machine-auth' }));
    }
  } catch {
    return invalidAccessDecision;
  }

  return invalidAccessDecision;
}

/**
 * @internal Attach the exact snapshotted decision to a declaration as an immutable property.
 *
 * The property remains enumerable when authored, preserving registry serialization, but cannot be
 * assigned, deleted, or redefined after audit. Absent access is pinned non-enumerably so legacy
 * `guard:` fallback keeps its existing object shape while later code cannot add an allow decision.
 */
export function pinAccessDecision<Declaration extends object>(
  declaration: Declaration,
  access: AccessDecision | undefined,
): Declaration {
  if (witnessWeakMapHas(pinnedAccessDecisions, declaration)) return declaration;
  const decision = snapshotAccessDecision(access);
  return pinSnapshottedAccessDecision(declaration, decision, access !== undefined);
}

/** @internal Resolve (and, for structural/internal declarations, pin) the authoritative decision. */
export function accessDecisionFor(
  declaration: object & { access?: AccessDecision },
): AccessDecision | undefined {
  const pinned = witnessWeakMapGet(pinnedAccessDecisions, declaration);
  if (pinned !== undefined) return pinned.decision;

  const descriptor = ownAccessDescriptor(declaration);
  const access =
    descriptor === undefined
      ? undefined
      : 'value' in descriptor
        ? (descriptor.value as AccessDecision | undefined)
        : invalidAccessDecision;
  const decision = snapshotAccessDecision(access);
  try {
    pinSnapshottedAccessDecision(declaration, decision, descriptor !== undefined);
  } catch {
    // A frozen/sealed structural declaration may already bind `access` non-configurably. The
    // private snapshot is still authoritative for every audit/runtime consumer, while the stable
    // property cannot be replaced. Constructor-created declarations take the physical path above.
    witnessWeakMapSet(pinnedAccessDecisions, declaration, { decision });
  }
  return decision;
}

function pinSnapshottedAccessDecision<Declaration extends object>(
  declaration: Declaration,
  decision: AccessDecision | undefined,
  authored: boolean,
): Declaration {
  if (witnessWeakMapHas(pinnedAccessDecisions, declaration)) return declaration;

  const existing = ownAccessDescriptor(declaration);
  witnessDefineProperty(declaration, 'access', {
    configurable: false,
    enumerable: existing?.enumerable ?? authored,
    value: decision,
    writable: false,
  });
  witnessWeakMapSet(pinnedAccessDecisions, declaration, { decision });
  return declaration;
}

function snapshotGuardAccessDecision(access: readonly unknown[]): AccessDecision {
  if (witnessWeakSetHas(snapshottedGuardAccessDecisions, access as object)) {
    return access as AccessDecision;
  }

  try {
    const lengthDescriptor = witnessGetOwnPropertyDescriptor(access, 'length');
    if (
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor) ||
      !nativeNumberIsSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_ACCESS_GUARD_CHAIN_LENGTH
    ) {
      return invalidAccessDecision;
    }

    const snapshot: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(access, index);
      witnessDefineProperty(snapshot, index, {
        configurable: true,
        enumerable: true,
        value: descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined,
        writable: true,
      });
    }
    const frozen = witnessFreeze(snapshot);
    witnessWeakSetAdd(snapshottedGuardAccessDecisions, frozen);
    return frozen as AccessDecision;
  } catch {
    return invalidAccessDecision;
  }
}

function markStructuredAccessDecision<Decision extends PublicAccess | VerifiedMachineAccess>(
  decision: Decision,
): Decision {
  witnessWeakSetAdd(snapshottedStructuredAccessDecisions, decision);
  return decision;
}

function ownAccessDescriptor(declaration: object): PropertyDescriptor | undefined {
  try {
    return witnessGetOwnPropertyDescriptor(declaration, 'access');
  } catch {
    throw new TypeError('Access declaration must expose a stable own data property.');
  }
}

/**
 * Declare that a surface is intentionally public, with the audit reason attached.
 */
export function publicAccess(reason: string): PublicAccess {
  if (typeof reason !== 'string' || !isPrintablePublicAuditReason(reason)) {
    throw new TypeError(
      'publicAccess(reason) requires a non-empty printable audit reason without control characters.',
    );
  }
  return markStructuredAccessDecision(witnessFreeze({ kind: 'public', reason }));
}

function isPrintablePublicAuditReason(reason: string): boolean {
  if (securityStringTrim(reason) === '') return false;
  for (let index = 0; index < reason.length; index += 1) {
    const code = securityStringCharCodeAt(reason, index);
    // SPEC §10.2/§11.4: the public-access reason is audit output, not an opaque payload.
    // C0/DEL and JavaScript line separators can forge rows or issue terminal controls when the
    // reason is printed by `kovo explain --endpoints`, so they fail closed at the shared decision.
    if (code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029) return false;
  }
  return true;
}

/**
 * Declare that a machine endpoint is covered by its verifier/auth scheme.
 */
export const verifiedAccess: VerifiedMachineAccess = markStructuredAccessDecision(
  witnessFreeze({
    kind: 'verified-machine-auth',
  }),
);
