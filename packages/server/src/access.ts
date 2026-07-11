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
  if (!Array.isArray(access) || access.length === 0) return false;

  for (let index = 0; index < access.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(access, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'function'
    ) {
      return false;
    }
  }

  return true;
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
): AccessDecision | undefined {
  if (!Array.isArray(access)) return access;

  const snapshot: unknown[] = new Array(access.length);
  for (let index = 0; index < access.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(access, index);
    snapshot[index] =
      descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  }
  return Object.freeze(snapshot) as AccessDecision;
}

/**
 * Declare that a surface is intentionally public, with the audit reason attached.
 */
export function publicAccess(reason: string): PublicAccess {
  return Object.freeze({ kind: 'public', reason });
}

/**
 * Declare that a machine endpoint is covered by its verifier/auth scheme.
 */
export const verifiedAccess: VerifiedMachineAccess = Object.freeze({
  kind: 'verified-machine-auth',
});
