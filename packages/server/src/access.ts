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
 * Declare that a surface is intentionally public, with the audit reason attached.
 */
export function publicAccess(reason: string): PublicAccess {
  return { kind: 'public', reason };
}

/**
 * Declare that a machine endpoint is covered by its verifier/auth scheme.
 */
export const verifiedAccess: VerifiedMachineAccess = { kind: 'verified-machine-auth' };
