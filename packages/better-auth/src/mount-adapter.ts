import {
  betterAuthApply,
  betterAuthCaptureOwnMethod,
  betterAuthCharacterCodeAt,
  betterAuthCreateRedirectResponse,
  betterAuthCreateMap,
  betterAuthCreateNullRecord,
  betterAuthFreezeOwn,
  betterAuthHeadersGet,
  betterAuthIncludes,
  betterAuthMapGet,
  betterAuthMapHas,
  betterAuthMapSet,
  betterAuthResponseHeaders,
  betterAuthResponseStatus,
  betterAuthStartsWith,
  betterAuthTrim,
  betterAuthUrlSnapshot,
} from './internal/intrinsics.js';
import { assertBetterAuthRequestSecretPath } from './internal/non-egress-proof.js';
import {
  assertBetterAuthCanonicalRequestOrigin,
  pinBetterAuthCanonicalOrigin,
  pinFixedBetterAuthCanonicalOrigin,
  type PinnedBetterAuthCanonicalOrigin,
} from './internal/request-origin.js';
import { assertBetterAuthRuntimeRealmLocked } from './internal/runtime-lock.js';
import { getBetterAuthSetCookie } from './internal/trusted-plaintext.js';

const NativeError = globalThis.Error;
const NativeTypeError = globalThis.TypeError;
const betterAuthMountBoundaryFailureMessage =
  'Better Auth mounted handler failed inside the trusted plaintext boundary.';

declare const betterAuthMountAdapterBrand: unique symbol;

/**
 * Opaque handle for the Better Auth router privately constructed by Kovo's fixed database
 * bindings. It exposes no handler or auth object; {@link mount} is its only app-facing consumer
 * (SPEC §6.6/§9.1).
 */
export interface BetterAuthMountAdapter {
  readonly [betterAuthMountAdapterBrand]: 'kovo-better-auth-mount-adapter';
}

interface CapturedBetterAuthMountAdapter {
  readonly declaredOrigin: PinnedBetterAuthCanonicalOrigin;
  readonly handler: Function;
  readonly registeredOrigin: PinnedBetterAuthCanonicalOrigin;
  readonly receiver: object;
}

interface BetterAuthMountSource {
  handler(request: Request): Promise<Response> | Response;
}

const capturedBetterAuthMountAdapters = betterAuthCreateMap<
  object,
  CapturedBetterAuthMountAdapter
>();

/** Package-private mint called only after Kovo itself constructs the upstream Better Auth object. */
export function createBetterAuthMountAdapter(
  auth: BetterAuthMountSource,
  baseURL: string,
): BetterAuthMountAdapter {
  assertBetterAuthRuntimeRealmLocked();
  if (typeof auth !== 'object' || auth === null) {
    throw new NativeTypeError('Kovo Better Auth mount adapter source must be an object.');
  }
  const captured = betterAuthCaptureOwnMethod(auth, 'handler', 'Kovo Better Auth construction');
  const token = betterAuthFreezeOwn(
    betterAuthCreateNullRecord<never>(),
    'Kovo Better Auth mount adapter',
  );
  betterAuthMapSet(capturedBetterAuthMountAdapters, token, {
    declaredOrigin: pinFixedBetterAuthCanonicalOrigin(baseURL, 'Kovo Better Auth mount'),
    handler: captured.method,
    registeredOrigin: pinBetterAuthCanonicalOrigin(auth, 'Kovo Better Auth mount'),
    receiver: captured.receiver,
  });
  return token as unknown as BetterAuthMountAdapter;
}

/** @internal Fail closed unless `adapter` is an exact package-private construction token. */
export function assertBetterAuthMountAdapter(
  adapter: unknown,
): asserts adapter is BetterAuthMountAdapter {
  assertBetterAuthRuntimeRealmLocked();
  if (
    typeof adapter !== 'object' ||
    adapter === null ||
    !betterAuthMapHas(capturedBetterAuthMountAdapters, adapter)
  ) {
    throw new NativeTypeError(
      'Better Auth mount requires the opaque mountAdapter returned by Kovo-owned Better Auth bindings (SPEC §6.6/§9.1).',
    );
  }
}

/**
 * @internal Invoke only the handler captured behind an exact opaque adapter. This entry never
 * accepts a handler callback and redacts failures before they can carry browser credentials out.
 */
export async function invokeBetterAuthMountAdapter(
  adapter: BetterAuthMountAdapter,
  request: Request,
): Promise<Response> {
  assertBetterAuthMountAdapter(adapter);
  const captured = betterAuthMapGet(capturedBetterAuthMountAdapters, adapter as object);
  if (captured === undefined) {
    throw new NativeTypeError('Better Auth mount adapter authority is unavailable.');
  }
  try {
    await assertBetterAuthCanonicalRequestOrigin(
      captured.registeredOrigin,
      request,
      'Kovo Better Auth mount',
    );
    await assertBetterAuthCanonicalRequestOrigin(
      captured.declaredOrigin,
      request,
      'Kovo Better Auth mount',
    );
    assertBetterAuthRequestSecretPath('better-auth.mount.handler-delegation');
    const upstream = await betterAuthApply<Promise<Response> | Response>(
      captured.handler,
      captured.receiver,
      [request],
    );
    if (typeof upstream !== 'object' || upstream === null) {
      throw new NativeTypeError('Better Auth mount returned no response.');
    }
    const status = redirectStatus(betterAuthResponseStatus(upstream));
    const headers = betterAuthResponseHeaders(upstream);
    if (status === undefined || headers === undefined) {
      throw new NativeTypeError('Better Auth mount returned a non-redirect response.');
    }
    const location = betterAuthHeadersGet(headers, 'location');
    const declaredOrigin = await captured.declaredOrigin;
    if (!declaredOrigin.valid) {
      throw new NativeTypeError('Better Auth mount origin authority is unavailable.');
    }
    const canonicalLocation = canonicalSameOriginRedirect(location, declaredOrigin.origin);
    // Exact private registration means these values came from the fixed Better Auth instance whose
    // constructor owns the `__Host-better-auth`/loopback cookie prefix. The server endpoint's raw
    // Set-Cookie sink then independently applies Kovo's credential-cookie floor before emission.
    return betterAuthCreateRedirectResponse(
      status,
      canonicalLocation,
      getBetterAuthSetCookie(headers),
    );
  } catch {
    throw new NativeError(betterAuthMountBoundaryFailureMessage);
  }
}

function redirectStatus(value: number | undefined): 301 | 302 | 303 | 307 | 308 | undefined {
  switch (value) {
    case 301:
    case 302:
    case 303:
    case 307:
    case 308:
      return value;
    default:
      return undefined;
  }
}

function canonicalSameOriginRedirect(location: string | null, origin: string): string {
  if (location === null) {
    throw new NativeTypeError('Better Auth mount redirect requires Location.');
  }
  const normalized = betterAuthTrim(location);
  if (
    normalized === '' ||
    betterAuthIncludes(normalized, ',') ||
    betterAuthIncludes(normalized, '\\') ||
    betterAuthStartsWith(normalized, '//')
  ) {
    throw new NativeTypeError('Better Auth mount redirect Location is ambiguous.');
  }
  for (let index = 0; index < normalized.length; index += 1) {
    const code = betterAuthCharacterCodeAt(normalized, index);
    if (code <= 0x1f || code === 0x7f) {
      throw new NativeTypeError('Better Auth mount redirect Location contains control text.');
    }
  }
  const snapshot = betterAuthUrlSnapshot(normalized, `${origin}/`);
  if (
    (snapshot.protocol !== 'http:' && snapshot.protocol !== 'https:') ||
    snapshot.origin !== origin ||
    snapshot.username !== '' ||
    snapshot.password !== ''
  ) {
    throw new NativeTypeError('Better Auth mount redirect must remain on the pinned origin.');
  }
  return `${snapshot.pathname}${snapshot.search}${snapshot.hash}`;
}
