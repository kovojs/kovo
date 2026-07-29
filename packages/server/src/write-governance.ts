// SPEC §10.3/§11.1 — the §11.1 mass-assignment write-provenance gate's runtime escapes.
//
// The KV438 gate is a static, by-construction check: a governed column (owner/principal
// columns, the primary key, and `kovo({ governed: true })` columns) may only receive a
// server-derived, literal, or explicitly-asserted value — never raw request input.
//
// These two helpers are the author-assertion escapes (SPEC §6.6: audit-grade, NOT a
// proof). They are runtime-transparent — they return the value unchanged — and exist so
// the analyzer can recognize a deliberate, justified write at the call site:
//
//   serverValue(value, reason)  — document a value already proven non-input. The
//                                 analyzer rejects input and opaque/unknown values.
//   trustedAssign(value, obligation) — the louder, audited path for a deliberate privileged
//                                      write of a request value to a governed column. Recorded
//                                      for `kovo explain --capabilities`.

import { createBoundedRuntimeAuditCollector } from '@kovojs/core/internal/security-markers';

import {
  snapshotAuditReason,
  snapshotTrustedAssignObligation,
  type TrustedAssignObligation,
} from './audit-justification.js';
import { markPrivilegedRequestInputAssignment } from './request-input-provenance.js';
import { witnessCreateNullRecord, witnessFreeze } from './security-witness-intrinsics.js';

export type {
  TrustedAssignEvidence,
  TrustedAssignInvariant,
  TrustedAssignObligation,
  TrustedAssignWhy,
} from './audit-justification.js';

/** A recorded `trustedAssign` audit fact for `kovo explain --capabilities` (audit-grade). */
export interface TrustedAssignFact {
  obligation: Readonly<TrustedAssignObligation>;
}

const trustedAssignFacts = createBoundedRuntimeAuditCollector<TrustedAssignFact>();

/**
 * Assert that `value` is a server-derived (non-request-input) value flowing into a
 * governed column (SPEC §11.1, KV438). Runtime-transparent: returns `value` unchanged.
 * The analyzer discharges KV438 only when it independently proves `value` literal or
 * private/server-derived. Request input and opaque computations both fail closed:
 * neither `serverValue(input.role, …)` nor `serverValue(helper(input.role), …)` can
 * launder provenance. Use {@link trustedAssign} for a deliberately reviewed opaque
 * server computation.
 *
 * @param value - The server-derived value being written.
 * @param reason - A short justification, surfaced in review.
 * @returns `value`, unchanged.
 * @example
 * import { serverValue } from '@kovojs/server';
 *
 * declare const db: any;
 * declare const input: { userId: string };
 * declare const users: any;
 *
 * await db.insert(users).values({ id: input.userId, role: serverValue('member', 'default role') });
 */
export function serverValue<T>(value: T, reason: string): T {
  snapshotAuditReason(reason, 'serverValue() (KV438)');
  return value;
}

/**
 * The audited privileged-write escape (SPEC §11.1, KV438): deliberately write a value —
 * even a request-input value — to a governed column (e.g. an admin setting another user's
 * role). Runtime-transparent: returns `value` unchanged, and records an audit fact for
 * `kovo explain --capabilities`. Louder than {@link serverValue} because it admits input.
 *
 * @param value - The value being written to the governed column.
 * @param obligation - A required structured invariant/basis/evidence record, recorded for audit.
 * @returns `value`, unchanged.
 * @example
 * import { trustedAssign } from '@kovojs/server';
 *
 * declare const db: any;
 * declare const input: { role: string };
 * declare const users: any;
 *
 * await db.update(users).set({
 *   role: trustedAssign(input.role, {
 *     evidence: {
 *       digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
 *       kind: 'test',
 *       reference: 'tests/authz/admin-role-grant',
 *     },
 *     invariant: 'governed-write.authorized-principal',
 *     why: { guard: 'guards.role:admin', kind: 'guard-chain' },
 *   }),
 * });
 */
export function trustedAssign<T>(value: T, obligation: TrustedAssignObligation): T {
  const carrier = witnessCreateNullRecord<unknown>();
  carrier.obligation = snapshotTrustedAssignObligation(obligation, 'trustedAssign() (KV438)');
  const fact = witnessFreeze(carrier) as unknown as TrustedAssignFact;
  markPrivilegedRequestInputAssignment(value);
  trustedAssignFacts.record(fact);
  return value;
}

/**
 * Drain the recorded {@link trustedAssign} audit facts (SPEC §6.6, audit-grade), for
 * `kovo explain --capabilities`. Returns and clears the retained bounded window.
 *
 * @returns The newest 256 retained observations since the last drain. Static trustedAssign
 * call-site facts remain the authoritative audit inventory.
 */
export function drainTrustedAssignFacts(): TrustedAssignFact[] {
  return trustedAssignFacts.drain();
}
