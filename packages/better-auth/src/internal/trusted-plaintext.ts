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

type BetterAuthBareSessionPayload<Session, User> = {
  session: Session;
  user: User;
};

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
  return auth.api.getSession({
    headers,
    returnHeaders: true,
  });
}

/** @internal Read all Better Auth `Set-Cookie` values for the session-cookie sink. */
export function getBetterAuthSetCookie(headers: Headers | null | undefined): string[] {
  if (headers === null || headers === undefined || typeof headers.get !== 'function') return [];
  const platformHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof platformHeaders.getSetCookie === 'function') {
    return platformHeaders.getSetCookie();
  }

  const cookie = headers.get('set-cookie');
  if (!cookie) return [];

  return splitFoldedSetCookie(cookie);
}

function splitFoldedSetCookie(folded: string): string[] {
  const cookies: string[] = [];
  const boundary = /,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/g;
  let lastIndex = 0;
  for (let match = boundary.exec(folded); match !== null; match = boundary.exec(folded)) {
    cookies.push(folded.slice(lastIndex, match.index).trim());
    lastIndex = boundary.lastIndex;
  }
  const tail = folded.slice(lastIndex).trim();
  if (tail) cookies.push(tail);
  return cookies.filter((cookie) => cookie.length > 0);
}
