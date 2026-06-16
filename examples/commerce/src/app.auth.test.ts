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

// SECURITY (SECURITY_FINDINGS.md M7): commerceSignIn now carries a per-client
// rate-limit guard whose key derives from request headers (x-forwarded-for / UA)
// with a process-wide counter. Give each sign-in scenario a distinct client ip so
// scenarios get independent buckets and never collide with each other (or with the
// dedicated brute-force test below).
function signInRequest(clientIp: string, cookie?: string) {
  const request = commerceAuthRequest(cookie);
  request.headers.set('x-forwarded-for', clientIp);
  return request;
}

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
    const request = signInRequest('203.0.113.10');
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
    const request = signInRequest('203.0.113.11');

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

    const memberRequest = signInRequest('203.0.113.12');
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

    const adminRequest = signInRequest('203.0.113.13');
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

  // SECURITY (SECURITY_FINDINGS.md M7): sign-in must throttle brute-force attempts.
  it('rate-limits repeated sign-in attempts from the same client (M7 brute-force guard)', async () => {
    const attempt = (clientIp: string) => {
      const request = signInRequest(clientIp);
      return runMutation(
        commerceSignIn,
        {
          csrf: csrfToken(request, commerceAuthCsrf),
          email: 'ada@example.com',
          password: 'wrong',
        },
        request,
        { csrf: commerceAuthCsrf },
      );
    };

    // Dedicated client bucket (distinct from the success-path scenarios above).
    const bruteIp = '198.51.100.7';
    // The guard allows `max` attempts per window, then 429s further attempts.
    for (let i = 0; i < 5; i += 1) {
      const result = await attempt(bruteIp);
      // Each is a credential failure (422), NOT a rate-limit failure yet.
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(422);
    }

    const throttled = await attempt(bruteIp);
    expect(throttled.ok).toBe(false);
    if (!throttled.ok) {
      expect(throttled.status).toBe(429);
      expect(throttled.error.code).toBe('RATE_LIMITED');
    }

    // A different client (distinct key) is unaffected by the first client's bucket.
    const otherClient = await attempt('198.51.100.8');
    expect(otherClient.ok).toBe(false);
    if (!otherClient.ok) expect(otherClient.status).toBe(422);
  });

  // SECURITY (SECURITY_FINDINGS.md M6): the pre-session login CSRF token is derived
  // from a process-wide constant, so we add an Origin/Sec-Fetch-Site same-origin
  // check that rejects cross-site sign-in posts (login CSRF).
  it('rejects a cross-origin sign-in even with a valid (forgeable) CSRF token (M6 same-origin)', async () => {
    const buildRequest = (headerEntries: Record<string, string>) => {
      const request = commerceAuthRequest();
      for (const [name, value] of Object.entries(headerEntries)) request.headers.set(name, value);
      // Give each case a distinct rate-limit bucket so the throttle never interferes.
      request.headers.set('x-forwarded-for', headerEntries['x-forwarded-for'] ?? '198.51.100.99');
      return request;
    };

    const validCredentials = (request: ReturnType<typeof commerceAuthRequest>) => ({
      csrf: csrfToken(request, commerceAuthCsrf),
      email: 'ada@example.com',
      password: 'correct',
    });

    // Cross-site Sec-Fetch-Site is rejected before the credentials are checked.
    const crossSiteFetch = buildRequest({
      'sec-fetch-site': 'cross-site',
      'x-forwarded-for': '198.51.100.20',
    });
    const crossSiteResult = await runMutation(
      commerceSignIn,
      validCredentials(crossSiteFetch),
      crossSiteFetch,
      { csrf: commerceAuthCsrf },
    );
    expect(crossSiteResult.ok).toBe(false);
    if (!crossSiteResult.ok) expect(crossSiteResult.error.code).toBe('UNAUTHORIZED');

    // A cross-origin Origin header (host mismatch) is also rejected.
    const crossOrigin = buildRequest({
      host: 'commerce.test',
      origin: 'https://evil.example',
      'x-forwarded-for': '198.51.100.21',
    });
    const crossOriginResult = await runMutation(
      commerceSignIn,
      validCredentials(crossOrigin),
      crossOrigin,
      { csrf: commerceAuthCsrf },
    );
    expect(crossOriginResult.ok).toBe(false);
    if (!crossOriginResult.ok) expect(crossOriginResult.error.code).toBe('UNAUTHORIZED');

    // A same-origin sign-in (matching Origin host, or same-origin Sec-Fetch-Site)
    // is accepted.
    const sameOrigin = buildRequest({
      host: 'commerce.test',
      origin: 'https://commerce.test',
      'sec-fetch-site': 'same-origin',
      'x-forwarded-for': '198.51.100.22',
    });
    const sameOriginResult = await runMutation(
      commerceSignIn,
      validCredentials(sameOrigin),
      sameOrigin,
      { csrf: commerceAuthCsrf },
    );
    expect(sameOriginResult).toMatchObject({ ok: true, value: { status: 'signed-in' } });
  });
});
