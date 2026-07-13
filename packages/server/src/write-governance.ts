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
import { securityNumberIsInteger, securityStringTrim } from './response-security-intrinsics.js';
import {
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
} from './security-witness-intrinsics.js';

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
  if (typeof reason !== 'string' || securityStringTrim(reason) === '') {
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
  const fact = snapshotTrustedAssignFact(reason);
  markPrivilegedRequestInputAssignment(value);
  trustedAssignFacts.record(fact);
  return value;
}

const TRUSTED_ASSIGN_STRING_KEYS = [
  'actor',
  'callsite',
  'producer',
  'reason',
  'session',
  'sourceProvenance',
  'table',
] as const satisfies readonly (keyof TrustedAssignOptions)[];

function snapshotTrustedAssignFact(source: string | TrustedAssignOptions): TrustedAssignFact {
  if (typeof source === 'string') {
    if (securityStringTrim(source) === '') {
      throw new Error('trustedAssign requires a non-empty reason (KV438).');
    }
    const fact = witnessCreateNullRecord<unknown>();
    fact.reason = source;
    return witnessFreeze(fact) as unknown as TrustedAssignFact;
  }
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('trustedAssign options must be a stable own-data record (KV438).');
  }

  const fact = witnessCreateNullRecord<unknown>();
  for (let index = 0; index < TRUSTED_ASSIGN_STRING_KEYS.length; index += 1) {
    const key = TRUSTED_ASSIGN_STRING_KEYS[index]!;
    const descriptor = stableTrustedAssignDescriptor(source, key);
    if (descriptor === undefined) {
      if (key === 'reason') {
        throw new TypeError('trustedAssign reason must be an own data property (KV438).');
      }
      continue;
    }
    if (typeof descriptor.value !== 'string') {
      throw new TypeError(`trustedAssign ${key} must be a string (KV438).`);
    }
    if (key === 'reason' && securityStringTrim(descriptor.value) === '') {
      throw new Error('trustedAssign requires a non-empty reason (KV438).');
    }
    fact[key] = descriptor.value;
  }

  const columns = stableTrustedAssignDescriptor(source, 'columns');
  if (columns !== undefined) {
    fact.columns = snapshotTrustedAssignColumns(columns.value);
  }
  return witnessFreeze(fact) as unknown as TrustedAssignFact;
}

function snapshotTrustedAssignColumns(source: unknown): readonly string[] {
  if (!witnessIsArray(source)) {
    throw new TypeError('trustedAssign columns must be an array of strings (KV438).');
  }
  const length = stableTrustedAssignDescriptor(source, 'length');
  if (
    length === undefined ||
    typeof length.value !== 'number' ||
    !securityNumberIsInteger(length.value) ||
    length.value < 0 ||
    length.value > 100_000
  ) {
    throw new TypeError('trustedAssign columns must be a dense array of strings (KV438).');
  }
  const columns: string[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const entry = stableTrustedAssignDescriptor(source, index);
    if (entry === undefined || typeof entry.value !== 'string') {
      throw new TypeError('trustedAssign columns must be a dense array of strings (KV438).');
    }
    witnessArrayAppend(columns, entry.value, 'trustedAssign audit columns');
  }
  return witnessFreeze(columns);
}

function stableTrustedAssignDescriptor(
  source: object,
  property: PropertyKey,
): { value: unknown } | undefined {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if ((before === undefined) !== (after === undefined)) {
    throw new TypeError(`trustedAssign ${String(property)} must be stable (KV438).`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || after === undefined || !('value' in after)) {
    throw new TypeError(`trustedAssign ${String(property)} must be an own data property (KV438).`);
  }
  if (!witnessObjectIs(before.value, after.value)) {
    throw new TypeError(`trustedAssign ${String(property)} changed during validation (KV438).`);
  }
  return { value: before.value };
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
