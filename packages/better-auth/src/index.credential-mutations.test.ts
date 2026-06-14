import { runMutation } from '@jiso/server';
import { describe, expect, it } from 'vitest';
import {
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  betterAuthSignUpEmailMutation,
  getBetterAuthSetCookie,
  isBetterAuthCredentialFailureError,
} from './index.js';
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
          'jiso_session=session-1; Path=/; HttpOnly; SameSite=Lax',
          'jiso_session_data=user-1; Path=/; HttpOnly; SameSite=Lax',
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
        'Set-Cookie': ['jiso_session=session-2; Path=/; HttpOnly; SameSite=Lax'],
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
    const headers = requestHeaders('jiso_session=session-1');
    const signOut = betterAuthSignOutMutation(auth, { csrf: false });

    const result = await runMutation(signOut, {}, { headers });

    expect(auth.lastSignOut).toEqual({
      asResponse: true,
      headers,
    });
    expect(result).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': [
          'jiso_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
          'jiso_session_data=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
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
      'jiso_session=session-1; Path=/; HttpOnly; SameSite=Lax',
    ]).headers;

    expect(getBetterAuthSetCookie(headers)).toEqual([
      'jiso_session=session-1; Path=/; HttpOnly; SameSite=Lax',
    ]);
    expect(isBetterAuthCredentialFailureError(new AuthApiError(403, 'Forbidden'))).toBe(true);
    expect(isBetterAuthCredentialFailureError(new AuthApiError(500, 'Broken'))).toBe(false);
  });
});
