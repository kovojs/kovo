import type { Guard } from './guards.js';

/**
 * A named guard step in a structured access audit chain. The optional executable
 * `guard` is metadata only here; runtime enforcement still uses each definition's
 * existing `guard`/`auth`/`verify` fields (SPEC §6.5 and §9.1).
 */
export interface GuardAccessStep {
  guard?: Guard<any, any>;
  name: string;
}

/** A human-justified public access decision. */
export interface PublicAccess {
  kind: 'public';
  reason: string;
}

/** A structured access decision backed by verified machine authentication. */
export interface VerifiedMachineAccess {
  kind: 'verified-machine-auth';
}

/** A structured access decision backed by a named guard chain. */
export interface GuardChainAccess {
  guards: readonly GuardAccessStep[];
  kind: 'guard-chain';
}

/**
 * Optional structured access metadata for audits. This is intentionally not an
 * executable policy engine: existing runtime `guard`, `auth`, and `verify` behavior
 * remains the enforcement surface for this phase.
 */
export type AccessDecision = GuardChainAccess | PublicAccess | VerifiedMachineAccess;

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

/**
 * Declare that a surface is intentionally protected by the named runtime guard
 * chain. The optional executable guard references are audit metadata only;
 * runtime enforcement remains the declaration's `guard` field.
 */
export function guardAccess(guards: readonly GuardAccessStep[]): GuardChainAccess {
  return { guards, kind: 'guard-chain' };
}
