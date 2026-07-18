import {
  betterAuthApply,
  betterAuthCaptureOwnMethod,
  betterAuthCreateMap,
  betterAuthCreateNullRecord,
  betterAuthFreezeOwn,
  betterAuthMapGet,
  betterAuthMapHas,
  betterAuthMapSet,
} from './internal/intrinsics.js';
import { assertBetterAuthRequestSecretPath } from './internal/non-egress-proof.js';
import {
  assertBetterAuthCanonicalRequestOrigin,
  pinFixedBetterAuthCanonicalOrigin,
  type PinnedBetterAuthCanonicalOrigin,
} from './internal/request-origin.js';
import { assertBetterAuthRuntimeRealmLocked } from './internal/runtime-lock.js';

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
  readonly canonicalOrigin: PinnedBetterAuthCanonicalOrigin;
  readonly handler: Function;
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
    canonicalOrigin: pinFixedBetterAuthCanonicalOrigin(baseURL, 'Kovo Better Auth mount'),
    handler: captured.method,
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
      captured.canonicalOrigin,
      request,
      'Kovo Better Auth mount',
    );
    assertBetterAuthRequestSecretPath('better-auth.mount.handler-delegation');
    return await betterAuthApply<Promise<Response> | Response>(
      captured.handler,
      captured.receiver,
      [request],
    );
  } catch {
    throw new NativeError(betterAuthMountBoundaryFailureMessage);
  }
}
