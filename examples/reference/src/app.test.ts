import { describe, expect, it } from 'vitest';

import {
  referenceAuthRequest,
  referenceAuthToken,
  referenceSessionProvider,
  renderReferenceAccountRoute,
  renderReferenceAdminRoute,
  renderReferenceLoginForm,
  renderReferenceLogoutForm,
  submitReferenceSignInNoJs,
  submitReferenceSignOutNoJs,
} from './app.js';

function headerValues(headers: Record<string, string | string[]>, name: string): string[] {
  const values = headers[name];
  if (!values) return [];

  return Array.isArray(values) ? values : [values];
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0] ?? setCookie;
}

describe('reference auth adoption', () => {
  it('ships no-JS login and logout forms backed by Jiso credential mutations', () => {
    const request = referenceAuthRequest();

    expect(renderReferenceLoginForm(request, { next: '/admin' })).toContain(
      'data-mutation="auth/sign-in"',
    );
    expect(
      renderReferenceLogoutForm({
        ...request,
        session: {
          id: 'session-u1',
          user: { email: 'ada@example.com', id: 'u1', name: 'Ada Lovelace', roles: ['admin'] },
        },
      }),
    ).toContain('data-mutation="auth/sign-out"');
  });

  it('maps Better Auth cookies into the declared reference session', async () => {
    const request = referenceAuthRequest();
    const signIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(request),
        email: 'ada@example.com',
        password: 'correct',
      },
      request,
    );
    const cookie = cookiePair(headerValues(signIn.headers, 'Set-Cookie')[0] ?? '');

    await expect(referenceSessionProvider(referenceAuthRequest(cookie))).resolves.toEqual({
      id: 'session-u1',
      user: {
        email: 'ada@example.com',
        id: 'u1',
        name: 'Ada Lovelace',
        roles: ['admin', 'member'],
      },
    });
  });

  it('runs sign-in failures and successes through the blessed adapter mutation', async () => {
    const request = referenceAuthRequest();

    await expect(
      submitReferenceSignInNoJs(
        {
          csrf: referenceAuthToken(request),
          email: 'ada@example.com',
          next: '/admin',
          password: 'wrong',
        },
        request,
      ),
    ).resolves.toMatchObject({
      body: expect.stringContaining('data-error-code="INVALID_CREDENTIALS"'),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });

    await expect(
      submitReferenceSignInNoJs(
        {
          csrf: referenceAuthToken(request),
          email: 'ada@example.com',
          next: '/admin',
          password: 'correct',
        },
        request,
      ),
    ).resolves.toMatchObject({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/admin',
        'Set-Cookie': ['jiso_reference_session=session-u1; Path=/; HttpOnly; SameSite=Lax'],
      },
      status: 303,
    });
  });

  it('renders authed and role guards through the reference app flow', async () => {
    await expect(renderReferenceAccountRoute(referenceAuthRequest())).resolves.toEqual({
      body: '',
      headers: { Location: '/login?next=%2Faccount' },
      status: 303,
    });

    const memberRequest = referenceAuthRequest();
    const memberSignIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(memberRequest),
        email: 'grace@example.com',
        password: 'correct',
      },
      memberRequest,
    );
    const memberCookie = cookiePair(headerValues(memberSignIn.headers, 'Set-Cookie')[0] ?? '');

    await expect(renderReferenceAdminRoute(referenceAuthRequest(memberCookie))).resolves.toEqual({
      body: '<main>Forbidden</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 403,
    });

    const adminRequest = referenceAuthRequest();
    const adminSignIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(adminRequest),
        email: 'ada@example.com',
        password: 'correct',
      },
      adminRequest,
    );
    const adminCookie = cookiePair(headerValues(adminSignIn.headers, 'Set-Cookie')[0] ?? '');

    await expect(renderReferenceAdminRoute(referenceAuthRequest(adminCookie))).resolves.toEqual({
      body: expect.stringContaining('admin:u1<form method="post" action="/_m/auth/sign-out"'),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
  });

  it('clears the reference auth cookie through guarded sign-out', async () => {
    const request = referenceAuthRequest();
    const signIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(request),
        email: 'ada@example.com',
        password: 'correct',
      },
      request,
    );
    const cookie = cookiePair(headerValues(signIn.headers, 'Set-Cookie')[0] ?? '');

    await expect(submitReferenceSignOutNoJs(referenceAuthRequest(cookie))).resolves.toMatchObject({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/login',
        'Set-Cookie': ['jiso_reference_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'],
      },
      status: 303,
    });
  });
});
