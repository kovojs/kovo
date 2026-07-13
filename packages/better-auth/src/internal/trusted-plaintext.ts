import type {
  BetterAuthGetSessionWithHeadersResult,
  BetterAuthLike,
  BetterAuthResponseLike,
  BetterAuthSignInEmailBody,
  BetterAuthSignInEmailLike,
  BetterAuthSignOutLike,
  BetterAuthSignUpEmailBody,
  BetterAuthSignUpEmailLike,
} from './contracts.js';
import {
  betterAuthArrayAppend,
  betterAuthApply,
  betterAuthCaptureOwnApiMethod,
  betterAuthCharacterCodeAt,
  betterAuthGetOwnPropertyDescriptor,
  betterAuthIsSafeInteger,
  betterAuthSlice,
  betterAuthTrim,
} from './intrinsics.js';
import { assertBetterAuthRequestSecretPath } from './non-egress-proof.js';

const NativeHeaders = globalThis.Headers;
const nativeHeadersGet = betterAuthGetOwnPropertyDescriptor(NativeHeaders.prototype, 'get')?.value;
const nativeHeadersGetSetCookie = betterAuthGetOwnPropertyDescriptor(
  NativeHeaders.prototype,
  'getSetCookie',
)?.value;

type BetterAuthBareSessionPayload<Session, User> = {
  session: Session;
  user: User;
};

/** @internal Pin the exact Better Auth sign-in sink and its API receiver at declaration time. */
export function pinBetterAuthSignInEmail(
  auth: BetterAuthSignInEmailLike,
): BetterAuthSignInEmailLike {
  const { method, receiver } = betterAuthCaptureOwnApiMethod(
    auth,
    'signInEmail',
    'Better Auth sign-in',
  );
  return {
    api: {
      signInEmail(options) {
        return betterAuthApply(method, receiver, [options]);
      },
    },
  };
}

/** @internal Pin the exact Better Auth sign-up sink and its API receiver at declaration time. */
export function pinBetterAuthSignUpEmail(
  auth: BetterAuthSignUpEmailLike,
): BetterAuthSignUpEmailLike {
  const { method, receiver } = betterAuthCaptureOwnApiMethod(
    auth,
    'signUpEmail',
    'Better Auth sign-up',
  );
  return {
    api: {
      signUpEmail(options) {
        return betterAuthApply(method, receiver, [options]);
      },
    },
  };
}

/** @internal Pin the exact Better Auth sign-out sink and its API receiver at declaration time. */
export function pinBetterAuthSignOut(auth: BetterAuthSignOutLike): BetterAuthSignOutLike {
  const { method, receiver } = betterAuthCaptureOwnApiMethod(
    auth,
    'signOut',
    'Better Auth sign-out',
  );
  return {
    api: {
      signOut(options) {
        return betterAuthApply(method, receiver, [options]);
      },
    },
  };
}

/** @internal Pin the exact Better Auth session sink and its API receiver at declaration time. */
export function pinBetterAuthGetSession<AuthSession, AuthUser>(
  auth: BetterAuthLike<AuthSession, AuthUser>,
): BetterAuthLike<AuthSession, AuthUser> {
  const { method, receiver } = betterAuthCaptureOwnApiMethod(
    auth,
    'getSession',
    'Better Auth session',
  );
  return {
    api: {
      getSession(options) {
        return betterAuthApply(method, receiver, [options]);
      },
    },
  };
}

/**
 * Minimal Better Auth trusted-plaintext zone.
 *
 * SPEC §6.6/§10.3: Better Auth's server API consumes password/cookie material as
 * ordinary strings, so Kovo confines the plaintext contact points to this module
 * and permits only Better Auth API calls plus the framework's session-cookie sink.
 */

/** @internal Pass an email/password sign-in secret only to Better Auth's comparison sink. */
export function callBetterAuthSignInEmail(
  auth: BetterAuthSignInEmailLike,
  body: BetterAuthSignInEmailBody,
  headers: Headers,
): Promise<BetterAuthResponseLike> | BetterAuthResponseLike {
  assertBetterAuthRequestSecretPath('better-auth.sign-in.submitted-password');
  assertBetterAuthRequestSecretPath('better-auth.adapter.sign-in.account-password');
  return auth.api.signInEmail({
    asResponse: true,
    body,
    headers,
  });
}

/** @internal Pass an email/password sign-up secret only to Better Auth's write/comparison sink. */
export function callBetterAuthSignUpEmail(
  auth: BetterAuthSignUpEmailLike,
  body: BetterAuthSignUpEmailBody,
  headers: Headers,
): Promise<BetterAuthResponseLike> | BetterAuthResponseLike {
  assertBetterAuthRequestSecretPath('better-auth.sign-up.submitted-password');
  return auth.api.signUpEmail({
    asResponse: true,
    body,
    headers,
  });
}

/** @internal Pass the request cookie material only to Better Auth's revocation sink. */
export function callBetterAuthSignOut(
  auth: BetterAuthSignOutLike,
  headers: Headers,
): Promise<BetterAuthResponseLike> | BetterAuthResponseLike {
  assertBetterAuthRequestSecretPath('better-auth.sign-out.request-cookie');
  return auth.api.signOut({
    asResponse: true,
    headers,
  });
}

/** @internal Pass request cookies only to Better Auth's session lookup sink. */
export function callBetterAuthGetSession<AuthSession, AuthUser>(
  auth: BetterAuthLike<AuthSession, AuthUser>,
  headers: Headers,
):
  | Promise<
      | BetterAuthGetSessionWithHeadersResult<AuthSession, AuthUser>
      | BetterAuthBareSessionPayload<AuthSession, AuthUser>
      | null
      | undefined
    >
  | BetterAuthGetSessionWithHeadersResult<AuthSession, AuthUser>
  | BetterAuthBareSessionPayload<AuthSession, AuthUser>
  | null
  | undefined {
  assertBetterAuthRequestSecretPath('better-auth.get-session.request-cookie');
  assertBetterAuthRequestSecretPath('better-auth.adapter.session-token-lookup');
  return auth.api.getSession({
    headers,
    returnHeaders: true,
  });
}

/** @internal Read all Better Auth `Set-Cookie` values for the session-cookie sink. */
export function getBetterAuthSetCookie(headers: Headers | null | undefined): string[] {
  assertBetterAuthRequestSecretPath('better-auth.set-cookie.forwarding');
  assertBetterAuthRequestSecretPath('better-auth.session-refresh.set-cookie');
  if (headers === null || headers === undefined) return [];

  // A native Headers instance is positive platform evidence. Read it through the boot-pinned
  // brand-checked methods before considering structural extension methods: an app can otherwise
  // add an own `getSetCookie` shadow that forges session establishment without changing the real
  // header bag (SPEC §6.5/§9.1 C9).
  if (typeof nativeHeadersGet === 'function') {
    try {
      if (typeof nativeHeadersGetSetCookie === 'function') {
        return copySetCookieValues(betterAuthApply(nativeHeadersGetSetCookie, headers, []));
      }
      const nativeCookie = betterAuthApply<unknown>(nativeHeadersGet, headers, ['set-cookie']);
      return typeof nativeCookie === 'string' && nativeCookie !== ''
        ? splitFoldedSetCookie(nativeCookie)
        : [];
    } catch {
      // A brand failure identifies a structural compatibility header bag. Inspect only own-data
      // methods below; never inherit ambient prototype authority.
    }
  }

  const ownGetSetCookie = betterAuthGetOwnPropertyDescriptor(headers, 'getSetCookie');
  if (
    ownGetSetCookie !== undefined &&
    'value' in ownGetSetCookie &&
    typeof ownGetSetCookie.value === 'function'
  ) {
    return copySetCookieValues(betterAuthApply(ownGetSetCookie.value, headers, []));
  }

  const cookie = readStructuralSetCookie(headers);
  if (!cookie) return [];

  return splitFoldedSetCookie(cookie);
}

function splitFoldedSetCookie(folded: string): string[] {
  const cookies: string[] = [];
  let lastIndex = 0;
  for (let index = 0; index < folded.length; index += 1) {
    if (betterAuthCharacterCodeAt(folded, index) !== 0x2c) continue;
    let next = index + 1;
    while (next < folded.length && isCookieWhitespace(betterAuthCharacterCodeAt(folded, next))) {
      next += 1;
    }
    const nameStart = next;
    while (next < folded.length && isCookieTokenCode(betterAuthCharacterCodeAt(folded, next))) {
      next += 1;
    }
    if (next === nameStart || betterAuthCharacterCodeAt(folded, next) !== 0x3d) continue;
    const cookie = betterAuthTrim(betterAuthSlice(folded, lastIndex, index));
    if (cookie !== '') betterAuthArrayAppend(cookies, cookie, 'Better Auth Set-Cookie values');
    lastIndex = index + 1;
  }
  const tail = betterAuthTrim(betterAuthSlice(folded, lastIndex));
  if (tail !== '') betterAuthArrayAppend(cookies, tail, 'Better Auth Set-Cookie values');
  return cookies;
}

function copySetCookieValues(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  const lengthDescriptor = betterAuthGetOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !betterAuthIsSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value >= 100_000
  ) {
    return [];
  }
  const result: string[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = betterAuthGetOwnPropertyDescriptor(value, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      return [];
    }
    betterAuthArrayAppend(result, descriptor.value, 'Better Auth Set-Cookie snapshot');
  }
  return result;
}

function readStructuralSetCookie(headers: Headers): string | null {
  const get = betterAuthGetOwnPropertyDescriptor(headers, 'get');
  if (get === undefined || !('value' in get) || typeof get.value !== 'function') return null;
  const value = betterAuthApply<unknown>(get.value, headers, ['set-cookie']);
  return typeof value === 'string' ? value : null;
}

function isCookieWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x20;
}

function isCookieTokenCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x21 ||
    code === 0x23 ||
    code === 0x24 ||
    code === 0x25 ||
    code === 0x26 ||
    code === 0x27 ||
    code === 0x2a ||
    code === 0x2b ||
    code === 0x2d ||
    code === 0x2e ||
    code === 0x5e ||
    code === 0x5f ||
    code === 0x60 ||
    code === 0x7c ||
    code === 0x7e
  );
}
