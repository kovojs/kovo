import type { Guard } from './guards.js';

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

const snapshottedGuardAccessDecisions = new WeakSet<object>();
const snapshottedStructuredAccessDecisions = new WeakSet<object>();
const pinnedAccessDecisions = new WeakMap<object, { decision: AccessDecision | undefined }>();
const MAX_ACCESS_GUARD_CHAIN_LENGTH = 256;

const invalidAccessDecision = Object.freeze([undefined]) as unknown as AccessDecision;
snapshottedGuardAccessDecisions.add(invalidAccessDecision as object);

/** @internal Test whether an access decision is an executable guard array. */
export function isGuardAccessDecision(
  access: AccessDecision | undefined,
): access is readonly Guard<any, any>[] {
  return Array.isArray(access);
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
  if (!Array.isArray(access)) return undefined;
  const snapshot = snapshotAccessDecision(access);
  if (!Array.isArray(snapshot) || snapshot.length === 0) return undefined;

  for (let index = 0; index < snapshot.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(snapshot, index);
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
  if (Array.isArray(access)) return snapshotGuardAccessDecision(access);
  if (typeof access !== 'object' || access === null) return invalidAccessDecision;
  if (snapshottedStructuredAccessDecisions.has(access)) return access;

  try {
    const kind = Object.getOwnPropertyDescriptor(access, 'kind');
    if (kind === undefined || !('value' in kind)) return invalidAccessDecision;
    if (kind.value === 'public') {
      const reason = Object.getOwnPropertyDescriptor(access, 'reason');
      if (reason === undefined || !('value' in reason) || typeof reason.value !== 'string') {
        return invalidAccessDecision;
      }
      return markStructuredAccessDecision(Object.freeze({ kind: 'public', reason: reason.value }));
    }
    if (kind.value === 'verified-machine-auth') {
      return markStructuredAccessDecision(Object.freeze({ kind: 'verified-machine-auth' }));
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
  if (pinnedAccessDecisions.has(declaration)) return declaration;
  const decision = snapshotAccessDecision(access);
  return pinSnapshottedAccessDecision(declaration, decision, access !== undefined);
}

/** @internal Resolve (and, for structural/internal declarations, pin) the authoritative decision. */
export function accessDecisionFor(
  declaration: object & { access?: AccessDecision },
): AccessDecision | undefined {
  const pinned = pinnedAccessDecisions.get(declaration);
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
    pinnedAccessDecisions.set(declaration, { decision });
  }
  return decision;
}

function pinSnapshottedAccessDecision<Declaration extends object>(
  declaration: Declaration,
  decision: AccessDecision | undefined,
  authored: boolean,
): Declaration {
  if (pinnedAccessDecisions.has(declaration)) return declaration;

  const existing = ownAccessDescriptor(declaration);
  Object.defineProperty(declaration, 'access', {
    configurable: false,
    enumerable: existing?.enumerable ?? authored,
    value: decision,
    writable: false,
  });
  pinnedAccessDecisions.set(declaration, { decision });
  return declaration;
}

function snapshotGuardAccessDecision(access: readonly unknown[]): AccessDecision {
  if (snapshottedGuardAccessDecisions.has(access as object)) {
    return access as AccessDecision;
  }

  try {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(access, 'length');
    if (
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_ACCESS_GUARD_CHAIN_LENGTH
    ) {
      return invalidAccessDecision;
    }

    const snapshot: unknown[] = Array.from({ length: lengthDescriptor.value as number });
    for (let index = 0; index < snapshot.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(access, index);
      snapshot[index] =
        descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
    }
    const frozen = Object.freeze(snapshot);
    snapshottedGuardAccessDecisions.add(frozen);
    return frozen as AccessDecision;
  } catch {
    return invalidAccessDecision;
  }
}

function markStructuredAccessDecision<Decision extends PublicAccess | VerifiedMachineAccess>(
  decision: Decision,
): Decision {
  snapshottedStructuredAccessDecisions.add(decision);
  return decision;
}

function ownAccessDescriptor(declaration: object): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(declaration, 'access');
  } catch {
    throw new TypeError('Access declaration must expose a stable own data property.');
  }
}

/**
 * Declare that a surface is intentionally public, with the audit reason attached.
 */
export function publicAccess(reason: string): PublicAccess {
  return markStructuredAccessDecision(Object.freeze({ kind: 'public', reason }));
}

/**
 * Declare that a machine endpoint is covered by its verifier/auth scheme.
 */
export const verifiedAccess: VerifiedMachineAccess = markStructuredAccessDecision(
  Object.freeze({
    kind: 'verified-machine-auth',
  }),
);
