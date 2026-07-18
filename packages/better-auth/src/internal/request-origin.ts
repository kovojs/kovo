import type { BetterAuthRequestLike } from './contracts.js';
import {
  betterAuthApply,
  betterAuthCreateMap,
  betterAuthGetOwnPropertyDescriptor,
  betterAuthMapGet,
  betterAuthMapSet,
  betterAuthOwnDataOption,
  betterAuthUrlSnapshot,
} from './intrinsics.js';

const NativeRequest = globalThis.Request;
const NativeTypeError = globalThis.TypeError;
const nativeRequestUrl = betterAuthGetOwnPropertyDescriptor(NativeRequest.prototype, 'url')?.get;
const fixedBetterAuthCanonicalOrigins = betterAuthCreateMap<
  object,
  PinnedBetterAuthCanonicalOrigin
>();

/** Boot-pinned canonical origin read from a real Better Auth `$context`. @internal */
export type PinnedBetterAuthCanonicalOrigin = Promise<string | undefined>;

/**
 * Snapshot the canonical origin that controls Better Auth's cookie name and security attributes.
 * Structural test doubles without a `$context` have no configured cookie authority to bind; real
 * Better Auth instances and Kovo's fixed bindings always expose the boot-owned context.
 *
 * SPEC §6.5/§6.6 and C13: origin matching is a superset floor over the existing CSRF, cookie, and
 * provider-state checks. It runs before any session cookie is parsed or minted.
 *
 * @internal
 */
export function pinBetterAuthCanonicalOrigin(
  auth: object,
  label: string,
): PinnedBetterAuthCanonicalOrigin {
  const fixedOrigin = betterAuthMapGet(fixedBetterAuthCanonicalOrigins, auth);
  if (fixedOrigin !== undefined) return fixedOrigin;
  const context = betterAuthGetOwnPropertyDescriptor(auth, '$context');
  if (context === undefined) return Promise.resolve(undefined);
  if (
    !('value' in context) ||
    (typeof context.value !== 'object' && typeof context.value !== 'function') ||
    context.value === null
  ) {
    throw new NativeTypeError(`${label}.$context must be a stable own-data PromiseLike.`);
  }
  return snapshotBetterAuthCanonicalOrigin(context.value as PromiseLike<unknown>, label);
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
  return Promise.resolve(canonicalBetterAuthOrigin(baseURL, label));
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
  request: BetterAuthRequestLike | Request,
  label: string,
): Promise<void> {
  const expectedOrigin = await pinnedOrigin;
  if (expectedOrigin === undefined) return;
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

async function snapshotBetterAuthCanonicalOrigin(
  contextPromise: PromiseLike<unknown>,
  label: string,
): Promise<string | undefined> {
  const context = await contextPromise;
  if (typeof context !== 'object' || context === null) {
    throw new NativeTypeError(`${label}.$context must resolve to an object.`);
  }
  const baseURL = betterAuthOwnDataOption<string>(context, 'baseURL', `${label} context baseURL`);
  if (baseURL === undefined || baseURL === '') return undefined;
  if (typeof baseURL !== 'string') {
    throw new NativeTypeError(`${label} context baseURL must be a string when present.`);
  }
  return canonicalBetterAuthOrigin(baseURL, `${label} context baseURL`);
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

function readBetterAuthRequestUrl(request: BetterAuthRequestLike | Request): string | undefined {
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
