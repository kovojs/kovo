import { types as nodeUtilTypes } from 'node:util';

import {
  createWitnessSet,
  createWitnessWeakMap,
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
  witnessReflectApply,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakMapGet,
  witnessWeakMapHas,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import {
  securityBufferFrom,
  securityIsUint8Array,
  securityNumberIsInteger,
  securityRegExpTest,
  securityUint8ArrayLength,
} from './response-security-intrinsics.js';

/** Minimum root-secret bytes accepted by framework cryptographic authority (SPEC §6.6). */
export const SIGNING_SECRET_MIN_BYTES = 32;

/** Lifecycle state for one framework root in a {@link SigningKeyRing}. */
export type SigningKeyState = 'active' | 'previous' | 'revoked';

/** A key that may create new outputs. Exactly one ring entry is active. */
export interface ActiveSigningKey {
  readonly id: string;
  readonly secret: string | Uint8Array;
  readonly state: 'active';
  readonly acceptUntil?: never;
}

/** A key accepted only until a finite overlap deadline. */
export interface PreviousSigningKey {
  readonly acceptUntil: number;
  readonly id: string;
  readonly secret: string | Uint8Array;
  readonly state: 'previous';
}

/** A revoked key retains only its public identifier, never secret bytes. */
export interface RevokedSigningKey {
  readonly acceptUntil?: never;
  readonly id: string;
  readonly secret?: never;
  readonly state: 'revoked';
}

/** One root-key lifecycle declaration. */
export type SigningKey = ActiveSigningKey | PreviousSigningKey | RevokedSigningKey;

declare const signingKeyRingBrand: unique symbol;

/**
 * Opaque root-key configuration carrier.
 *
 * The ring deliberately has no generic sign, verify, derive, seal, or open method. Framework
 * sinks exchange it for a fixed-purpose handle inside `crypto-authority.ts` (SPEC §6.6 C9/C13).
 */
export interface SigningKeyRing {
  readonly currentKeyId: string;
  readonly [signingKeyRingBrand]: 'kovo-signing-key-ring';
}

/** Declarative configuration for constructing an opaque {@link SigningKeyRing}. */
export interface SigningKeyRingOptions {
  /** Complete bounded rotation set; exactly one key must be `active`. */
  readonly keys: readonly SigningKey[];
}

declare const frameworkCsrfSigningSecretBrand: unique symbol;

/** Opaque first-party CSRF/live-target authority carrier. */
export interface FrameworkCsrfSigningSecret {
  readonly [frameworkCsrfSigningSecretBrand]: 'framework-csrf-signing-secret';
}

/** Accepted root configuration for fixed framework cryptographic sinks. */
export type SigningSecret =
  | string
  | Uint8Array
  | SigningKeyRing
  | SigningKeyRingOptions
  | FrameworkCsrfSigningSecret;

/** @internal Private state consumed only by the purpose-closed crypto authority. */
export interface AuthoritySigningKey {
  readonly id: string;
  state: SigningKeyState;
  secret?: Buffer;
  readonly acceptUntil?: number;
}

/** @internal Private state consumed only by the purpose-closed crypto authority. */
export interface AuthoritySigningKeyRing {
  readonly active: AuthoritySigningKey;
  readonly keys: readonly AuthoritySigningKey[];
}

const nativeSigningIsProxy = nodeUtilTypes.isProxy;
const signingKeyRings = createWitnessWeakMap<object, AuthoritySigningKeyRing>();
const frameworkCsrfSigningSources = createWitnessWeakMap<object, SigningKeyRing>();

/** Create an opaque root-key ring with exactly one active key. */
export function createSigningKeyRing(options: SigningKeyRingOptions): SigningKeyRing {
  const sourceKeys = stableDenseSigningKeys(stableOwnValue(options, 'keys', 'SigningKeyRing'));
  const keys: AuthoritySigningKey[] = [];
  let active: AuthoritySigningKey | undefined;
  let activeCount = 0;
  const ids = createWitnessSet<string>();

  for (let index = 0; index < sourceKeys.length; index += 1) {
    const key = normalizeSigningKey(sourceKeys[index]!, index);
    if (witnessSetHas(ids, key.id)) {
      throw new Error(`SigningKeyRing key id "${key.id}" is duplicated`);
    }
    witnessSetAdd(ids, key.id);
    witnessArrayAppend(keys, key, 'SigningKeyRing normalized keys');
    if (key.state === 'active') {
      active = key;
      activeCount += 1;
    }
  }
  if (activeCount !== 1 || active === undefined) {
    throw new Error('SigningKeyRing requires exactly one active key');
  }

  const token = witnessCreateNullRecord<unknown>();
  witnessDefineProperty(token, 'currentKeyId', {
    configurable: false,
    enumerable: true,
    value: active.id,
    writable: false,
  });
  const ring = witnessFreeze(token) as unknown as SigningKeyRing;
  witnessWeakMapSet(signingKeyRings, ring, witnessFreeze({ active, keys: witnessFreeze(keys) }));
  return ring;
}

/** Mint a zero-property first-party CSRF/live-target carrier backed by an exact ring identity. */
export function createFrameworkCsrfSigningSecret(
  source: SigningKeyRing,
): FrameworkCsrfSigningSecret {
  requireSigningKeyRingState(source);
  const token = witnessFreeze(witnessCreateNullRecord());
  witnessWeakMapSet(frameworkCsrfSigningSources, token, source);
  return token as unknown as FrameworkCsrfSigningSecret;
}

/** Return whether a value is an exact framework-minted CSRF authority carrier. */
export function isFrameworkCsrfSigningSecret(value: unknown): value is FrameworkCsrfSigningSecret {
  return (
    typeof value === 'object' &&
    value !== null &&
    witnessWeakMapHas(frameworkCsrfSigningSources, value)
  );
}

/** Return whether a value is an exact framework-minted root-key ring. */
export function isSigningKeyRing(value: unknown): value is SigningKeyRing {
  return typeof value === 'object' && value !== null && witnessWeakMapHas(signingKeyRings, value);
}

export function isSigningKeyRingOptions(value: unknown): value is SigningKeyRingOptions {
  if (typeof value !== 'object' || value === null) return false;
  try {
    return witnessIsArray(stableOwnValue(value, 'keys', 'SigningKeyRing'));
  } catch {
    return false;
  }
}

/**
 * Normalize public root configuration into an opaque ring.
 *
 * @internal This does not grant an operation. A caller must still enter a fixed-purpose factory.
 */
export function signingKeyRingFromSecret(secret: SigningSecret): SigningKeyRing {
  if (isSigningKeyRing(secret)) return secret;
  if (isSigningKeyRingOptions(secret)) return createSigningKeyRing(secret);
  if (isFrameworkCsrfSigningSecret(secret)) {
    const source = witnessWeakMapGet(frameworkCsrfSigningSources, secret);
    if (source === undefined) throw new TypeError('Framework CSRF authority is unavailable.');
    return source;
  }
  if (typeof secret === 'object' && secret !== null && !securityIsUint8Array(secret)) {
    throw new TypeError(
      'Framework signing capability is invalid; only an exact framework-minted token is accepted (SPEC §6.6 C9).',
    );
  }
  return createSigningKeyRing({
    keys: [{ id: 'current', secret, state: 'active' }],
  });
}

/**
 * Resolve private roots for one fixed authority door, enforcing the narrower first-party CSRF
 * carrier scope before any derivation occurs.
 *
 * @internal Only `crypto-authority.ts` may consume the returned state.
 */
export function authoritySigningKeyRing(
  secret: SigningSecret,
  purpose:
    | 'anonymous-csrf'
    | 'better-auth-rate-limit'
    | 'capability-url'
    | 'confidential-at-rest'
    | 'csrf'
    | 'live-target-attestation'
    | 'rendered-html-coercion'
    | 'runtime-posture-attestation'
    | 'security-event-chain'
    | 'session-fingerprint',
  audience: string,
): AuthoritySigningKeyRing {
  if (isFrameworkCsrfSigningSecret(secret)) {
    const allowed =
      purpose === 'csrf' ||
      purpose === 'anonymous-csrf' ||
      purpose === 'session-fingerprint' ||
      (purpose === 'live-target-attestation' && audience === 'mutation-live-target');
    if (!allowed) {
      throw new TypeError(
        'Framework CSRF signing capability only permits csrf, anonymous-csrf, session-fingerprint, and the mutation-live-target attestation audience (SPEC §6.6 C9).',
      );
    }
  }
  return requireSigningKeyRingState(signingKeyRingFromSecret(secret));
}

function requireSigningKeyRingState(ring: SigningKeyRing): AuthoritySigningKeyRing {
  const state = witnessWeakMapGet(signingKeyRings, ring);
  if (state === undefined) {
    throw new TypeError('Crypto authority requires an exact framework signing key ring.');
  }
  return state;
}

function normalizeSigningKey(key: SigningKey, index: number): AuthoritySigningKey {
  if (typeof key !== 'object' || key === null) {
    throw new TypeError(`SigningKeyRing keys[${index}] must be an object.`);
  }
  if (witnessReflectApply<boolean>(nativeSigningIsProxy, nodeUtilTypes, [key])) {
    throw new TypeError(`SigningKeyRing keys[${index}] must not be a Proxy.`);
  }
  const id = stableOwnValue(key, 'id', `SigningKeyRing keys[${index}]`);
  const state = stableOwnValue(key, 'state', `SigningKeyRing keys[${index}]`);
  if (typeof id !== 'string' || !securityRegExpTest(/^[A-Za-z0-9_-]+$/u, id)) {
    throw new Error('SigningKeyRing key id must be non-empty base64url-safe text');
  }
  if (state === 'revoked') {
    if (stableOptionalOwnValue(key, 'secret', `SigningKeyRing key "${id}"`) !== undefined) {
      throw new Error(`SigningKeyRing revoked key "${id}" must not retain signing material`);
    }
    if (stableOptionalOwnValue(key, 'acceptUntil', `SigningKeyRing key "${id}"`) !== undefined) {
      throw new Error(`SigningKeyRing revoked key "${id}" must not declare acceptUntil`);
    }
    return { id, state };
  }
  if (state !== 'active' && state !== 'previous') {
    throw new Error(`SigningKeyRing key "${id}" has invalid state`);
  }
  const sourceSecret = stableOwnValue(key, 'secret', `SigningKeyRing key "${id}"`);
  if (typeof sourceSecret !== 'string' && !securityIsUint8Array(sourceSecret)) {
    throw new Error(`SigningKeyRing key "${id}" has invalid signing material at index ${index}`);
  }
  const secret = securityBufferFrom(sourceSecret);
  const length = securityUint8ArrayLength(secret);
  if (length < SIGNING_SECRET_MIN_BYTES) {
    throw new Error(
      `SigningKeyRing key "${id}" signing material is ${length} bytes; minimum is ${SIGNING_SECRET_MIN_BYTES} bytes (SPEC §6.6).`,
    );
  }
  if (state === 'active') {
    if (stableOptionalOwnValue(key, 'acceptUntil', `SigningKeyRing key "${id}"`) !== undefined) {
      throw new Error(`SigningKeyRing active key "${id}" must not declare acceptUntil`);
    }
    return { id, secret, state };
  }
  const acceptUntil = stableOwnValue(key, 'acceptUntil', `SigningKeyRing key "${id}"`);
  if (
    typeof acceptUntil !== 'number' ||
    !securityNumberIsInteger(acceptUntil) ||
    acceptUntil > Number.MAX_SAFE_INTEGER ||
    acceptUntil < 0
  ) {
    throw new Error(`SigningKeyRing previous key "${id}" requires a finite acceptUntil deadline`);
  }
  return { acceptUntil, id, secret, state };
}

function stableDenseSigningKeys(value: unknown): readonly SigningKey[] {
  if (!witnessIsArray(value)) throw new TypeError('SigningKeyRing keys must be a dense array.');
  const length = witnessGetOwnPropertyDescriptor(value, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    !securityNumberIsInteger(length.value) ||
    length.value < 0 ||
    length.value > 10_000
  ) {
    throw new TypeError('SigningKeyRing keys must have a bounded stable length.');
  }
  const snapshot: SigningKey[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`SigningKeyRing keys[${index}] must be a stable own data property.`);
    }
    witnessArrayAppend(snapshot, descriptor.value as SigningKey, 'SigningKeyRing key snapshot');
  }
  return witnessFreeze(snapshot);
}

function stableOwnValue(source: object, property: PropertyKey, label: string): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (!sameDataDescriptor(before, after) || before === undefined || !('value' in before)) {
    throw new TypeError(`${label}.${String(property)} must be a stable own data property.`);
  }
  return before.value;
}

function stableOptionalOwnValue(source: object, property: PropertyKey, label: string): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (!sameDataDescriptor(before, after)) {
    throw new TypeError(`${label}.${String(property)} changed while it was inspected.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new TypeError(`${label}.${String(property)} must be a stable own data property.`);
  }
  return before.value;
}

function sameDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    witnessObjectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}
