import { describe, expect, it } from 'vitest';

import { cookiePair } from '@kovojs/test/headers';
import {
  htmlElementFacts,
  htmlFormFacts,
  htmlFormFields,
  htmlTextContent,
} from '@kovojs/test/html-fragment';
import { csrfToken } from '@kovojs/server';
import { runMutation } from '@kovojs/server/internal/execution';

import {
  addToCart,
  commerceAuthCsrf,
  commerceSessionProvider,
  commerceSignIn,
  commerceSession,
  createCommerceDb,
} from './domain.js';
import {
  commerceAuthRequest,
  createCommerceScenarioClient,
  mutationSetCookieHeaders,
  readOrders,
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

  it('runs commerce login and logout through the app shell credential mutations', async () => {
    const client = createCommerceScenarioClient();

    const loginPage = await client.get('/login?next=%2Fcart');
    const loginHtml = await loginPage.text();
    expect(loginPage.status, loginHtml).toBe(200);
    expect(htmlFormFacts(loginHtml)).toMatchObject([
      { attrs: { 'data-mutation': 'auth/sign-in' } },
    ]);
    expect(htmlFormFields(loginHtml, 'next')).toMatchObject([{ name: 'next', value: '/cart' }]);

    const failedLogin = await client.signIn({
      password: 'wrong',
      remoteAddress: '203.0.113.80',
    });
    const failedHtml = await failedLogin.text();
    expect(failedLogin.status, failedHtml).toBe(422);
    expect(failedLogin.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(htmlTextContent(failedHtml)).toContain('Invalid email or password.');
    expect(
      htmlElementFacts(failedHtml, {
        attrs: { 'data-error-code': 'INVALID_CREDENTIALS' },
        tag: 'output',
      }),
    ).toHaveLength(1);

    const login = await client.signIn({ remoteAddress: '203.0.113.81' });
    expect(login.status).toBe(303);
    expect(login.headers.get('cache-control')).toBe('no-store');
    expect(login.headers.get('location')).toBe('/cart');
    expect(cookiePair(login.headers.get('set-cookie') ?? '')).toBe(
      'kovo_commerce_session=session-u1',
    );

    const logout = await client.signOut();
    expect(logout.status).toBe(303);
    expect(logout.headers.get('cache-control')).toBe('no-store');
    expect(logout.headers.get('location')).toBe('/login');
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
