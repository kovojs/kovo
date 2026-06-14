import { describe, expect, it } from 'vitest';

import { cookiePair } from '@jiso/test/headers';
import { htmlFormFacts } from '@jiso/test/html-fragment';
import { csrfToken, runMutation } from '@jiso/server';

import {
  addToCart,
  commerceAuthCsrf,
  commerceSessionProvider,
  commerceSignIn,
  commerceSession,
  createCommerceDb,
  renderCommerceAdminRoute,
  renderCommerceLoginForm,
  renderCommerceLogoutForm,
  submitCommerceSignInNoJs,
  submitCommerceSignOutNoJs,
} from './app.js';
import {
  commerceAuthRequest,
  mutationSetCookieHeaders,
  readOrders,
  setCookieHeaders,
} from './app-test-helpers.js';

describe('commerce example', () => {
  it('uses the typed commerce session schema in authenticated mutations', async () => {
    const db = createCommerceDb();
    const request = { db, session: { id: 's1', user: { id: 'u1' } } };

    expect(commerceSession.parse(request)).toEqual({ id: 's1', user: { id: 'u1' } });

    await addToCart.handler({ productId: 'p1', quantity: 1 }, request, {
      fail(code, payload) {
        return { error: { code, payload }, ok: false, status: 422 };
      },
      invalidate(domain, options) {
        return { domain: domain.key, ...options, manual: true };
      },
    });

    expect((await readOrders(db))[0]?.userId).toBe('u1');
  });

  it('maps Better Auth cookies into the commerce session provider', async () => {
    const request = commerceAuthRequest();
    const signIn = await runMutation(
      commerceSignIn,
      {
        csrf: csrfToken(request, commerceAuthCsrf),
        email: 'ada@example.com',
        password: 'correct',
      },
      request,
      { csrf: commerceAuthCsrf },
    );

    expect(signIn).toMatchObject({
      ok: true,
      value: {
        redirectTo: '/cart',
        status: 'signed-in',
      },
    });
    if (!signIn.ok) throw new Error('expected commerce sign-in to succeed');
    const cookie = cookiePair(mutationSetCookieHeaders(signIn)[0] ?? '');

    await expect(commerceSessionProvider(commerceAuthRequest(cookie))).resolves.toEqual({
      id: 'session-u1',
      user: {
        id: 'u1',
        roles: ['admin', 'member'],
      },
    });
  });

  it('runs commerce login and logout through Better Auth credential mutations', async () => {
    const request = commerceAuthRequest();

    expect(htmlFormFacts(renderCommerceLoginForm(request, { next: '/admin' }))).toMatchObject([
      { attrs: { 'data-mutation': 'auth/sign-in' } },
    ]);
    await expect(
      submitCommerceSignInNoJs(
        {
          csrf: csrfToken(request, commerceAuthCsrf),
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
        'Set-Cookie': ['jiso_commerce_session=session-u1; Path=/; HttpOnly; SameSite=Lax'],
      },
      status: 303,
    });

    await expect(
      submitCommerceSignInNoJs(
        {
          csrf: csrfToken(request, commerceAuthCsrf),
          email: 'ada@example.com',
          password: 'wrong',
        },
        request,
      ),
    ).resolves.toMatchObject({
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });

    const authedRequest = {
      ...commerceAuthRequest('jiso_commerce_session=session-u1'),
      session: {
        id: 'session-u1',
        user: { id: 'u1', roles: ['admin', 'member'] as const },
      },
    };

    expect(htmlFormFacts(renderCommerceLogoutForm(authedRequest))).toMatchObject([
      { attrs: { 'data-mutation': 'auth/sign-out' } },
    ]);
    await expect(submitCommerceSignOutNoJs(authedRequest)).resolves.toMatchObject({
      headers: {
        'Cache-Control': 'no-store',
        Location: '/login',
        'Set-Cookie': ['jiso_commerce_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'],
      },
      status: 303,
    });
  });

  it('renders commerce admin route through real authed and role guards', async () => {
    await expect(renderCommerceAdminRoute(commerceAuthRequest())).resolves.toEqual({
      body: '',
      headers: { Location: '/login?next=%2Fadmin' },
      status: 303,
    });

    const memberRequest = commerceAuthRequest();
    const memberSignIn = await submitCommerceSignInNoJs(
      {
        csrf: csrfToken(memberRequest, commerceAuthCsrf),
        email: 'grace@example.com',
        password: 'correct',
      },
      memberRequest,
    );
    const memberCookie = cookiePair(setCookieHeaders(memberSignIn)[0] ?? '');

    await expect(renderCommerceAdminRoute(commerceAuthRequest(memberCookie))).resolves.toEqual({
      body: '<main>Forbidden</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 403,
    });

    const adminRequest = commerceAuthRequest();
    const adminSignIn = await submitCommerceSignInNoJs(
      {
        csrf: csrfToken(adminRequest, commerceAuthCsrf),
        email: 'ada@example.com',
        password: 'correct',
      },
      adminRequest,
    );
    const adminCookie = cookiePair(setCookieHeaders(adminSignIn)[0] ?? '');

    await expect(renderCommerceAdminRoute(commerceAuthRequest(adminCookie))).resolves.toMatchObject(
      {
        body: expect.stringContaining(
          '<main>admin:u1<form method="post" action="/_m/auth/sign-out"',
        ),
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      },
    );
  });
});
