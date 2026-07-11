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
//   serverValue(value, reason)  — assert a NON-input value is server-derived. The
//                                 analyzer still rejects `serverValue(input.x, …)`.
//   trustedAssign(value, reason)  — the louder, audited path for a deliberate privileged
//                                 write of a request value to a governed column. Recorded
//                                 for `kovo explain --writes`.

import { createBoundedRuntimeAuditCollector } from '@kovojs/core/internal/security-markers';

import { markPrivilegedRequestInputAssignment } from './request-input-provenance.js';

/** A recorded `trustedAssign` audit fact for `kovo explain --writes` (SPEC §6.6, audit-grade). */
export interface TrustedAssignFact {
  actor?: string;
  callsite?: string;
  columns?: readonly string[];
  producer?: string;
  reason: string;
  session?: string;
  sourceProvenance?: string;
  table?: string;
}

/** Additional audit context for the `trustedAssign` privileged-write escape. */
export interface TrustedAssignOptions {
  actor?: string;
  callsite?: string;
  columns?: readonly string[];
  producer?: string;
  reason: string;
  session?: string;
  sourceProvenance?: string;
  table?: string;
}

const trustedAssignFacts = createBoundedRuntimeAuditCollector<TrustedAssignFact>();

/**
 * Assert that `value` is a server-derived (non-request-input) value flowing into a
 * governed column (SPEC §11.1, KV438). Runtime-transparent: returns `value` unchanged.
 * The analyzer discharges KV438 for this call ONLY when `value` is not request input —
 * `serverValue(input.role, …)` still fails the gate (the assertion cannot launder input).
 *
 * @param value - The server-derived value being written.
 * @param reason - A short justification, surfaced in review.
 * @returns `value`, unchanged.
 * @example
 * await db.insert(orders).values({ id: serverValue(generatedId, 'server-generated key'), ... });
 */
export function serverValue<T>(value: T, reason: string): T {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error('serverValue requires a non-empty reason (KV438).');
  }
  return value;
}

/**
 * The audited privileged-write escape (SPEC §11.1, KV438): deliberately write a value —
 * even a request-input value — to a governed column (e.g. an admin setting another user's
 * role). Runtime-transparent: returns `value` unchanged, and records an audit fact for
 * `kovo explain --writes`. Louder than {@link serverValue} because it admits input.
 *
 * @param value - The value being written to the governed column.
 * @param reason - A required non-empty justification, recorded for audit.
 * @returns `value`, unchanged.
 * @example
 * await db.update(users).set({ role: trustedAssign(input.role, 'admin role grant') })...;
 */
export function trustedAssign<T>(value: T, reason: string | TrustedAssignOptions): T {
  const fact = typeof reason === 'string' ? { reason } : reason;
  if (typeof fact.reason !== 'string' || fact.reason.trim() === '') {
    throw new Error('trustedAssign requires a non-empty reason (KV438).');
  }
  markPrivilegedRequestInputAssignment(value);
  trustedAssignFacts.record({
    ...fact,
    ...(fact.columns ? { columns: [...fact.columns] } : {}),
  });
  return value;
}

/**
 * Drain the recorded {@link trustedAssign} audit facts (SPEC §6.6, audit-grade), for
 * `kovo explain --writes`. Returns and clears the retained bounded window.
 *
 * @returns The newest 256 retained observations since the last drain. Static trustedAssign
 * call-site facts remain the authoritative audit inventory.
 */
export function drainTrustedAssignFacts(): TrustedAssignFact[] {
  return trustedAssignFacts.drain();
}
