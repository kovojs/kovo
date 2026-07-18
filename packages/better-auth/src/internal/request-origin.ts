/* oxlint-disable typescript/unbound-method -- Native Request getter is boot-captured and invoked through pinned Reflect.apply. */

import type { BetterAuthBindingRequest } from './contracts.js';
import {
  betterAuthApply,
  betterAuthCreateMap,
  betterAuthFreezeOwn,
  betterAuthGetOwnPropertyDescriptor,
  betterAuthMapGet,
  betterAuthMapSet,
  betterAuthUrlSnapshot,
} from './intrinsics.js';

const NativeRequest = globalThis.Request;
const NativeTypeError = globalThis.TypeError;
const nativeRequestUrl = betterAuthGetOwnPropertyDescriptor(NativeRequest.prototype, 'url')?.get;
const fixedBetterAuthCanonicalOrigins = betterAuthCreateMap<
  object,
  PinnedBetterAuthCanonicalOrigin
>();

type BetterAuthCanonicalOriginState =
  | { readonly origin: string; readonly valid: true }
  | { readonly valid: false };

/** Privately registered, boot-pinned canonical origin for a Kovo-owned Better Auth instance. */
export type PinnedBetterAuthCanonicalOrigin = Promise<Readonly<BetterAuthCanonicalOriginState>>;

const invalidRealBetterAuthOrigin = betterAuthFreezeOwn(
  { valid: false as const },
  'invalid real Better Auth origin',
);

/**
 * Resolve only an exact Better Auth object privately registered by a Kovo fixed binding. A real or
 * structural Better Auth object is deliberately insufficient: dependency context and cookie
 * configuration are caller-controlled data, not proof that Kovo constructed the complete security
 * posture. Identity registration keeps the authority private and fail-closed.
 *
 * SPEC §6.5/§6.6 and C13: origin matching is a superset floor over the existing CSRF, cookie, and
 * provider-state checks. It runs before any session cookie is parsed or minted.
 *
 * @internal
 */
export function pinBetterAuthCanonicalOrigin(
  auth: object,
  _label: string,
): PinnedBetterAuthCanonicalOrigin {
  const fixedOrigin = betterAuthMapGet(fixedBetterAuthCanonicalOrigins, auth);
  if (fixedOrigin !== undefined) return fixedOrigin;
  return Promise.resolve(invalidRealBetterAuthOrigin);
}

/** Register the validated origin owned by a fixed Kovo binding before helpers are constructed. */
export function registerFixedBetterAuthCanonicalOrigin(
  auth: object,
  baseURL: string,
  label: string,
): void {
  betterAuthMapSet(
    fixedBetterAuthCanonicalOrigins,
    auth,
    pinFixedBetterAuthCanonicalOrigin(baseURL, label),
  );
}

/** Pin an already validated fixed-binding origin without consulting dependency state. @internal */
export function pinFixedBetterAuthCanonicalOrigin(
  baseURL: string,
  label: string,
): PinnedBetterAuthCanonicalOrigin {
  return Promise.resolve(
    betterAuthFreezeOwn(
      { origin: canonicalBetterAuthOrigin(baseURL, label), valid: true },
      `${label} fixed canonical origin`,
    ),
  );
}

/**
 * Fail closed when a request is not addressed to the exact configured Better Auth origin.
 * URL parsing supplies the normalized tuple: scheme, punycoded/lower-cased hostname, and effective
 * port (including default-port elision). Paths never affect the authority comparison.
 *
 * @internal
 */
export async function assertBetterAuthCanonicalRequestOrigin(
  pinnedOrigin: PinnedBetterAuthCanonicalOrigin,
  request: BetterAuthBindingRequest | Request,
  label: string,
): Promise<void> {
  const state = await pinnedOrigin;
  if (!state.valid) {
    throw new NativeTypeError(
      `${label} requires the exact Better Auth instance returned by a Kovo fixed binding constructor.`,
    );
  }
  const expectedOrigin = state.origin;
  const requestUrl = readBetterAuthRequestUrl(request);
  if (requestUrl === undefined) {
    throw new NativeTypeError(`${label} requires a native or stable absolute request URL.`);
  }
  let actualOrigin: string;
  try {
    actualOrigin = canonicalBetterAuthOrigin(requestUrl, `${label} request URL`);
  } catch {
    throw new NativeTypeError(`${label} requires a native or stable absolute request URL.`);
  }
  if (actualOrigin !== expectedOrigin) {
    throw new NativeTypeError(
      `${label} request origin must exactly match the configured Better Auth origin.`,
    );
  }
}

function canonicalBetterAuthOrigin(value: string, label: string): string {
  let snapshot: ReturnType<typeof betterAuthUrlSnapshot>;
  try {
    snapshot = betterAuthUrlSnapshot(value);
  } catch {
    throw new NativeTypeError(`${label} must be an absolute HTTP(S) URL.`);
  }
  if (
    (snapshot.protocol !== 'http:' && snapshot.protocol !== 'https:') ||
    snapshot.origin === 'null' ||
    snapshot.username !== '' ||
    snapshot.password !== ''
  ) {
    throw new NativeTypeError(`${label} must be an absolute HTTP(S) URL.`);
  }
  return snapshot.origin;
}

function readBetterAuthRequestUrl(request: BetterAuthBindingRequest | Request): string | undefined {
  if (typeof nativeRequestUrl === 'function') {
    try {
      return betterAuthApply<string>(nativeRequestUrl, request, []);
    } catch {
      // A structural request used by the public helpers may carry an own stable URL below.
    }
  }
  const descriptor = betterAuthGetOwnPropertyDescriptor(request, 'url');
  if (descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string') {
    return descriptor.value;
  }
  // Kovo lifecycle requests are immutable framework-owned carriers whose inherited Request
  // properties were snapshotted before guards ran. Their prototype intentionally carries no Web
  // Request internal slots, so the native getter above rejects even though this stable value is
  // the adapter-proven URL. Read it twice and require identity; a mutable structural accessor fails
  // closed instead of selecting cookie authority (SPEC §9.5, C13).
  try {
    const first = request.url;
    const second = request.url;
    return typeof first === 'string' && first === second ? first : undefined;
  } catch {
    return undefined;
  }
}
