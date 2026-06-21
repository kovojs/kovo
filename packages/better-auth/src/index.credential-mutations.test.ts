import { runMutation } from '@kovojs/server/internal/execution';
import { describe, expect, it } from 'vitest';
import {
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  betterAuthSignUpEmailMutation,
  getBetterAuthSetCookie,
  isBetterAuthCredentialFailureError,
  type BetterAuthResponseLike,
  type BetterAuthSignInEmailLike,
  type BetterAuthSignUpEmailLike,
} from './internal.js';
import {
  AuthApiError,
  FakeCredentialAuth,
  requestHeaders,
  responseWithCookies,
} from './test-fakes.js';

describe('credential mutation helpers', () => {
  it('wraps signInEmail as an ordinary mutation and forwards Better Auth cookies', async () => {
    const auth = new FakeCredentialAuth();
    const headers = requestHeaders();
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false });

    const result = await runMutation(
      signIn,
      {
        email: 'ada@example.com',
        next: '/account',
        password: 'correct',
      },
      { headers },
    );

    expect(auth.lastSignIn).toEqual({
      asResponse: true,
      body: {
        email: 'ada@example.com',
        password: 'correct',
      },
      headers,
    });
    expect(result).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': [
          'kovo_session=session-1; Path=/; HttpOnly; SameSite=Lax',
          'kovo_session_data=user-1; Path=/; HttpOnly; SameSite=Lax',
        ],
      },
      value: {
        redirectTo: '/account',
        status: 'signed-in',
      },
    });
  });

  it('maps invalid sign-in credentials to the declared mutation failure path', async () => {
    const auth = new FakeCredentialAuth();
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false });

    const result = await runMutation(
      signIn,
      {
        email: 'ada@example.com',
        password: 'wrong',
      },
      { headers: requestHeaders() },
    );

    expect(result).toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        payload: {},
      },
      ok: false,
      status: 422,
    });
  });

  it('wraps signUpEmail with a typed body and typed credential failure', async () => {
    const auth = new FakeCredentialAuth();
    const signUp = betterAuthSignUpEmailMutation(auth, {
      csrf: false,
      defaultRedirectTo: '/welcome',
    });
    const headers = requestHeaders();

    await expect(
      runMutation(
        signUp,
        {
          email: 'grace@example.com',
          name: 'Grace Hopper',
          password: 'correct',
        },
        { headers },
      ),
    ).resolves.toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': ['kovo_session=session-2; Path=/; HttpOnly; SameSite=Lax'],
      },
      value: {
        redirectTo: '/welcome',
        status: 'signed-up',
      },
    });
    expect(auth.lastSignUp).toEqual({
      asResponse: true,
      body: {
        email: 'grace@example.com',
        name: 'Grace Hopper',
        password: 'correct',
      },
      headers,
    });

    await expect(
      runMutation(
        signUp,
        {
          email: 'taken@example.com',
          name: 'Taken',
          password: 'correct',
        },
        { headers: requestHeaders() },
      ),
    ).resolves.toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        payload: {},
      },
      ok: false,
      status: 422,
    });
  });

  it('wraps signOut and forwards clearing cookies', async () => {
    const auth = new FakeCredentialAuth();
    const headers = requestHeaders('kovo_session=session-1');
    const signOut = betterAuthSignOutMutation(auth, { csrf: false });

    const result = await runMutation(signOut, {}, { headers });

    expect(auth.lastSignOut).toEqual({
      asResponse: true,
      headers,
    });
    expect(result).toMatchObject({
      ok: true,
      // B3: Better Auth Set-Cookie headers are now re-emitted through the typed cookie builder, which
      // canonicalizes attribute order (Max-Age before Path). Functionally identical clearing cookies.
      responseHeaders: {
        'Set-Cookie': [
          'kovo_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
          'kovo_session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
        ],
      },
      value: {
        redirectTo: '/login',
        status: 'signed-out',
      },
    });
  });

  it('keeps redirect targets on same-origin paths', async () => {
    const auth = new FakeCredentialAuth();
    const signIn = betterAuthSignInEmailMutation(auth, {
      csrf: false,
      defaultRedirectTo: '/dashboard',
    });

    await expect(
      runMutation(
        signIn,
        {
          email: 'ada@example.com',
          next: 'https://evil.example/account',
          password: 'correct',
        },
        { headers: requestHeaders() },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        redirectTo: '/dashboard',
      },
    });
  });

  it('exposes small helpers for Better Auth response quirks', () => {
    const headers = responseWithCookies([
      'kovo_session=session-1; Path=/; HttpOnly; SameSite=Lax',
    ]).headers;

    expect(getBetterAuthSetCookie(headers)).toEqual([
      'kovo_session=session-1; Path=/; HttpOnly; SameSite=Lax',
    ]);
    expect(isBetterAuthCredentialFailureError(new AuthApiError(403, 'Forbidden'))).toBe(true);
    expect(isBetterAuthCredentialFailureError(new AuthApiError(500, 'Broken'))).toBe(false);
  });

  // part-3 I1 (SPEC §9.1.1:856): an app serving login in a cross-site iframe sets
  // `advanced.defaultCookieAttributes = { partitioned: true }`; Better Auth then emits
  // `Set-Cookie: …; SameSite=None; Partitioned`. The re-emitted cookie MUST keep
  // `; Partitioned` or Chrome refuses/segregates it and login silently fails.
  it('preserves the Partitioned (CHIPS) attribute when forwarding Better Auth cookies', async () => {
    const auth: BetterAuthSignInEmailLike = {
      api: {
        signInEmail: () =>
          responseWithCookies([
            'better-auth.session_token=tok-1; Path=/; HttpOnly; Secure; SameSite=None; Partitioned',
          ]),
      },
    };
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false, defaultRedirectTo: '/home' });

    const result = await runMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({
      ok: true,
      responseHeaders: {
        // round-trips through the typed builder (canonical attribute order), keeping
        // `; Partitioned` and `SameSite=None`.
        'Set-Cookie': [
          'better-auth.session_token=tok-1; Path=/; HttpOnly; Secure; SameSite=None; Partitioned',
        ],
      },
      value: { redirectTo: '/home', status: 'signed-in' },
    });
  });
});

// part-3 I3 (SECURITY_FINDINGS.md M2): a clearing cookie `sid=deleted; Expires=<past>`
// (non-empty value, no Max-Age) must NOT be classified as session-establishing, so a 2xx
// carrying only such a cookie fails to sign in instead of redirecting into the protected area.
describe('Expires-in-past clearing cookie is not session-establishing (part-3 I3)', () => {
  function signInAuthReturning(cookies: readonly string[]): BetterAuthSignInEmailLike {
    return {
      api: {
        signInEmail: () => responseWithCookies(cookies, 200),
      },
    };
  }

  it('does NOT sign in on a 200 whose only cookie has Expires in the past', async () => {
    const auth = signInAuthReturning([
      'better-auth.session_token=deleted; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly',
    ]);
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false });

    const result = await runMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('still signs in when an Expires is in the future', async () => {
    const auth = signInAuthReturning([
      'better-auth.session_token=tok-1; Path=/; Expires=Tue, 19 Jan 2038 03:14:07 GMT; HttpOnly',
    ]);
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false, defaultRedirectTo: '/home' });

    const result = await runMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: true, value: { status: 'signed-in' } });
  });
});

// part-3 L13-3: `getBetterAuthSetCookie`'s no-`getSetCookie()` fallback must split a
// comma-FOLDED multi-cookie header into separate cookies WITHOUT splitting inside an
// `Expires` date that itself contains a comma.
describe('getBetterAuthSetCookie comma-folded fallback (part-3 L13-3)', () => {
  function headersWithFoldedSetCookie(folded: string): Headers {
    // A Headers shim with no getSetCookie(): forces the fallback path. The real
    // platform Headers always exposes getSetCookie(), so this models a degraded runtime.
    return {
      get: (name: string) => (name.toLowerCase() === 'set-cookie' ? folded : null),
    } as unknown as Headers;
  }

  it('splits a comma-folded two-cookie header into both cookies', () => {
    const headers = headersWithFoldedSetCookie('a=1; Path=/; HttpOnly, b=2; Path=/; HttpOnly');
    expect(getBetterAuthSetCookie(headers)).toEqual([
      'a=1; Path=/; HttpOnly',
      'b=2; Path=/; HttpOnly',
    ]);
  });

  it('does not split inside an Expires date containing a comma', () => {
    const folded = 'sid=tok; Path=/; Expires=Wed, 09 Jun 2099 10:18:14 GMT; HttpOnly';
    const headers = headersWithFoldedSetCookie(folded);
    expect(getBetterAuthSetCookie(headers)).toEqual([folded]);
  });

  it('splits two cookies that each carry an Expires-comma date', () => {
    const headers = headersWithFoldedSetCookie(
      'a=1; Expires=Wed, 09 Jun 2099 10:18:14 GMT, b=2; Expires=Thu, 10 Jun 2099 10:18:14 GMT',
    );
    expect(getBetterAuthSetCookie(headers)).toEqual([
      'a=1; Expires=Wed, 09 Jun 2099 10:18:14 GMT',
      'b=2; Expires=Thu, 10 Jun 2099 10:18:14 GMT',
    ]);
  });

  it('uses getSetCookie() verbatim when available (no comma-folding fallback)', () => {
    const headers = responseWithCookies(['a=1; Path=/', 'b=2; Path=/']).headers;
    expect(getBetterAuthSetCookie(headers)).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });
});

// SECURITY_FINDINGS.md H4: backslash / control-char open-redirect hardening.
describe('redirectPath same-origin hardening', () => {
  async function signInWithNext(next: string): Promise<string | undefined> {
    const auth = new FakeCredentialAuth();
    const signIn = betterAuthSignInEmailMutation(auth, {
      csrf: false,
      defaultRedirectTo: '/dashboard',
    });

    const result = await runMutation(
      signIn,
      { email: 'ada@example.com', next, password: 'correct' },
      { headers: requestHeaders() },
    );

    return result.ok ? (result.value as { redirectTo: string }).redirectTo : undefined;
  }

  it('falls back when a backslash forms a cross-origin authority', async () => {
    expect(await signInWithNext('/\\evil.com')).toBe('/dashboard');
    expect(await signInWithNext('/\\/evil.com')).toBe('/dashboard');
    expect(await signInWithNext('\\/evil.com')).toBe('/dashboard');
  });

  it('falls back when the target carries a control character (CRLF smuggling)', async () => {
    expect(await signInWithNext('/account\r\nLocation: https://evil.com')).toBe('/dashboard');
    expect(await signInWithNext('/account\nSet-Cookie: x=1')).toBe('/dashboard');
  });

  it('keeps legitimate same-origin paths intact', async () => {
    expect(await signInWithNext('/cart')).toBe('/cart');
    expect(await signInWithNext('/a/b?x=1#h')).toBe('/a/b?x=1#h');
  });
});

// SECURITY_FINDINGS.md M2: credential success must be classified by positive
// evidence (2xx + session-establishing Set-Cookie + not a two-factor-pending body).
describe('credential success is positively classified', () => {
  function jsonResponse(
    status: number,
    body: unknown,
    cookies: readonly string[] = [],
  ): BetterAuthResponseLike {
    const response = new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      status,
    });

    for (const cookie of cookies) response.headers.append('set-cookie', cookie);

    return response;
  }

  function signInAuthReturning(response: BetterAuthResponseLike): BetterAuthSignInEmailLike {
    return {
      api: {
        signInEmail: () => response,
      },
    };
  }

  it('treats a 2xx response with a session-establishing cookie as signed-in', async () => {
    const auth = signInAuthReturning(
      jsonResponse(200, { ok: true }, [
        'better-auth.session_token=tok-1; Path=/; HttpOnly; SameSite=Lax',
      ]),
    );
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false, defaultRedirectTo: '/home' });

    const result = await runMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': ['better-auth.session_token=tok-1; Path=/; HttpOnly; SameSite=Lax'],
      },
      value: { redirectTo: '/home', status: 'signed-in' },
    });
  });

  it('does NOT sign in on a 200 two-factor-pending body (no session cookie)', async () => {
    const auth = signInAuthReturning(jsonResponse(200, { twoFactorRedirect: true }));
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false });

    const result = await runMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toEqual({
      error: { code: 'INVALID_CREDENTIALS', payload: {} },
      ok: false,
      status: 422,
    });
  });

  it('does NOT sign in on a 2xx response without a session-establishing cookie', async () => {
    const auth = signInAuthReturning(jsonResponse(200, { ok: true }));
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false });

    const result = await runMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('treats a 429 rate-limit response as a failure, not a sign-in', async () => {
    const auth = signInAuthReturning(jsonResponse(429, { message: 'rate limited' }));
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false });

    const result = await runMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('treats a 500 response as a failure, not a sign-in', async () => {
    const auth = signInAuthReturning(jsonResponse(500, { message: 'broken' }));
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false });

    const result = await runMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('does NOT sign up on a 200 two-factor-pending body', async () => {
    const auth: BetterAuthSignUpEmailLike = {
      api: {
        signUpEmail: () => jsonResponse(200, { twoFactorRedirect: true }),
      },
    };
    const signUp = betterAuthSignUpEmailMutation(auth, { csrf: false });

    const result = await runMutation(
      signUp,
      { email: 'grace@example.com', name: 'Grace Hopper', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: false, status: 422 });
  });
});
