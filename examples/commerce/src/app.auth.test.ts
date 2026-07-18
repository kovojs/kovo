import '../../../tests/example-generated-graphs.setup.js';

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

import { addToCart, commerceSession, createCommerceDb } from './domain.js';
import { commerceAuthCsrf, commerceSignIn, createCommerceAuth } from './auth.js';
import {
  commerceAuthRequest,
  createCommerceScenarioClient,
  mutationSetCookieHeaders,
  readOrders,
} from './app-test-helpers.js';

describe('commerce example', () => {
  it('uses only framework-resolved anonymous CSRF identities', () => {
    const db = createCommerceDb();
    const request = { db, headers: new Headers(), url: 'http://localhost/login' };
    expect(commerceAuthCsrf.sessionId(request)).toBeUndefined();
    expect(commerceAuthCsrf.sessionId({ ...request, authCsrfId: 'browser-a' })).toBe('browser-a');
    expect(commerceAuthCsrf.sessionId({ ...request, authCsrfId: 'browser-b' })).toBe('browser-b');
  });

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

  it('maps local fixture cookies into the commerce session provider', async () => {
    const auth = createCommerceAuth(createCommerceDb());
    const request = commerceAuthRequest(undefined, auth);
    const signIn = await runMutation(
      commerceSignIn,
      {
        csrf: csrfToken(request, commerceAuthCsrf, { mutation: commerceSignIn }),
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
    const setCookie = mutationSetCookieHeaders(signIn)[0] ?? '';
    expect(setCookie).toMatch(
      /^kovo_commerce_session=[0-9a-f-]+; Max-Age=3600; Path=\/; HttpOnly; SameSite=Lax$/u,
    );
    const cookie = cookiePair(setCookie);
    const token = cookie.split('=', 2)[1] ?? '';

    const session = sessionValue(await auth.sessionProvider(commerceAuthRequest(cookie, auth)));
    expect(session).toEqual({
      id: expect.any(String),
      user: {
        id: 'u1',
      },
    });
    expect(session?.id).not.toBe(token);
  });

  it('uses only the exact __Host session cookie on HTTPS', async () => {
    const httpsUrl = 'https://localhost/account';
    const auth = createCommerceAuth(createCommerceDb());
    const request = commerceAuthRequest(undefined, auth, httpsUrl);
    const signIn = await runMutation(
      commerceSignIn,
      {
        csrf: csrfToken(request, commerceAuthCsrf, { mutation: commerceSignIn }),
        email: 'ada@example.com',
        password: 'correct',
      },
      request,
      { csrf: commerceAuthCsrf },
    );
    if (!signIn.ok) throw new Error('expected HTTPS loopback fixture sign-in to succeed');
    const setCookie = mutationSetCookieHeaders(signIn)[0] ?? '';
    expect(setCookie).toMatch(
      /^__Host-kovo_commerce_session=[0-9a-f-]+; Max-Age=3600; Path=\/; HttpOnly; Secure; SameSite=Lax$/u,
    );
    const httpsLoopbackPair = cookiePair(setCookie);
    const token = httpsLoopbackPair.split('=', 2)[1] ?? '';

    await expect(
      auth.sessionProvider(commerceAuthRequest(`kovo_commerce_session=${token}`, auth, httpsUrl)),
    ).resolves.toBeNull();
    const session = sessionValue(
      await auth.sessionProvider(commerceAuthRequest(httpsLoopbackPair, auth, httpsUrl)),
    );
    expect(session).toEqual({
      id: expect.any(String),
      user: { id: 'u1' },
    });
    expect(session?.id).not.toBe(token);
  });

  it('rejects every non-loopback origin before the auth mutation can emit a cookie', async () => {
    const auth = createCommerceAuth(createCommerceDb());
    const request = commerceAuthRequest(undefined, auth, 'http://commerce.test/login');

    await expect(
      runMutation(
        commerceSignIn,
        {
          csrf: csrfToken(request, commerceAuthCsrf, { mutation: commerceSignIn }),
          email: 'ada@example.com',
          password: 'correct',
        },
        request,
        { csrf: commerceAuthCsrf },
      ),
    ).rejects.toThrow('requires an exact loopback request URL');

    const remoteHttps = commerceAuthRequest(undefined, auth, 'https://commerce.test/login');
    await expect(
      runMutation(
        commerceSignIn,
        {
          csrf: csrfToken(remoteHttps, commerceAuthCsrf, { mutation: commerceSignIn }),
          email: 'ada@example.com',
          password: 'correct',
        },
        remoteHttps,
        { csrf: commerceAuthCsrf },
      ),
    ).rejects.toThrow('requires an exact loopback request URL');
  });

  it('refuses the local fixture in production even when deployment secrets are configured', async () => {
    const previousMode = process.env.NODE_ENV;
    const previousSecret = process.env.KOVO_COMMERCE_AUTH_CSRF_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.KOVO_COMMERCE_AUTH_CSRF_SECRET = 'configured-production-secret';
    try {
      const auth = createCommerceAuth(createCommerceDb());
      const request = commerceAuthRequest(undefined, auth);
      await expect(
        runMutation(
          commerceSignIn,
          {
            csrf: csrfToken(request, commerceAuthCsrf, { mutation: commerceSignIn }),
            email: 'ada@example.com',
            password: 'correct',
          },
          request,
          { csrf: commerceAuthCsrf },
        ),
      ).rejects.toThrow('explicit local-only development capability');
    } finally {
      restoreEnv('NODE_ENV', previousMode);
      restoreEnv('KOVO_COMMERCE_AUTH_CSRF_SECRET', previousSecret);
    }
  });

  it('requires an operator-chosen development password instead of the fixed test credential', async () => {
    const previousMode = process.env.NODE_ENV;
    const previousCapability = process.env.KOVO_ENABLE_LOCAL_AUTH_FIXTURE;
    const previousPassword = process.env.KOVO_LOCAL_AUTH_FIXTURE_PASSWORD;
    process.env.NODE_ENV = 'development';
    process.env.KOVO_ENABLE_LOCAL_AUTH_FIXTURE = 'I_UNDERSTAND_THIS_IS_LOCAL_ONLY';
    process.env.KOVO_LOCAL_AUTH_FIXTURE_PASSWORD = 'unique-local-password-123';
    try {
      const auth = createCommerceAuth(createCommerceDb());
      const fixedRequest = commerceAuthRequest(undefined, auth);
      const fixed = await runMutation(
        commerceSignIn,
        {
          csrf: csrfToken(fixedRequest, commerceAuthCsrf, { mutation: commerceSignIn }),
          email: 'ada@example.com',
          password: 'correct',
        },
        fixedRequest,
        { csrf: commerceAuthCsrf },
      );
      expect(fixed).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' }, ok: false });

      const chosenRequest = commerceAuthRequest(undefined, auth);
      const chosen = await runMutation(
        commerceSignIn,
        {
          csrf: csrfToken(chosenRequest, commerceAuthCsrf, { mutation: commerceSignIn }),
          email: 'ada@example.com',
          password: 'unique-local-password-123',
        },
        chosenRequest,
        { csrf: commerceAuthCsrf },
      );
      expect(chosen).toMatchObject({ ok: true });
    } finally {
      restoreEnv('NODE_ENV', previousMode);
      restoreEnv('KOVO_ENABLE_LOCAL_AUTH_FIXTURE', previousCapability);
      restoreEnv('KOVO_LOCAL_AUTH_FIXTURE_PASSWORD', previousPassword);
    }
  });

  it('falls back from hostile post-login redirect values', async () => {
    for (const next of ['https://evil.test', '//evil.test', '/\\evil.test']) {
      const auth = createCommerceAuth(createCommerceDb());
      const request = commerceAuthRequest(undefined, auth);
      const result = await runMutation(
        commerceSignIn,
        {
          csrf: csrfToken(request, commerceAuthCsrf, { mutation: commerceSignIn }),
          email: 'ada@example.com',
          next,
          password: 'correct',
        },
        request,
        { csrf: commerceAuthCsrf },
      );
      expect(result).toMatchObject({ ok: true, value: { redirectTo: '/cart' } });
    }
    const auth = createCommerceAuth(createCommerceDb());
    const request = commerceAuthRequest(undefined, auth);
    const controlResult = await runMutation(
      commerceSignIn,
      {
        csrf: csrfToken(request, commerceAuthCsrf, { mutation: commerceSignIn }),
        email: 'ada@example.com',
        next: '/cart\nInjected',
        password: 'correct',
      },
      request,
      { csrf: commerceAuthCsrf },
    );
    expect(controlResult).toMatchObject({ ok: false, status: 422 });
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
      remoteAddress: '127.0.0.80',
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

    const login = await client.signIn({ remoteAddress: '127.0.0.81' });
    expect(login.status).toBe(303);
    expect(login.headers.get('cache-control')).toBe('private, no-store');
    expect(login.headers.get('location')).toBe('/cart');
    expect(cookiePair(login.headers.get('set-cookie') ?? '')).toMatch(
      /^__Host-kovo_commerce_session=[0-9a-f-]+$/u,
    );

    const logout = await client.signOut();
    expect(logout.status).toBe(303);
    expect(logout.headers.get('cache-control')).toBe('private, no-store');
    expect(logout.headers.get('location')).toBe('/login');
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('isolates sessions and rate-limit capacity between real application handlers', async () => {
    const clientA = createCommerceScenarioClient();
    const clientB = createCommerceScenarioClient();
    const loginA = await clientA.signIn({ remoteAddress: '127.0.0.90' });
    const cookieA = cookiePair(loginA.headers.get('set-cookie') ?? '');
    expect(loginA.status).toBe(303);

    const foreignPage = await clientB.get('/cart', { headers: { cookie: cookieA } });
    const foreignHtml = await foreignPage.text();
    expect(foreignPage.status, foreignHtml).toBe(200);
    expect(htmlFormFacts(foreignHtml).some((form) => form.action === '/_m/auth/sign-out')).toBe(
      false,
    );

    const limitedA = createCommerceScenarioClient();
    const sameIpB = createCommerceScenarioClient();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failure = await limitedA.signIn({
        password: 'wrong',
        remoteAddress: '127.0.0.91',
      });
      expect(failure.status).toBe(422);
    }
    const exhausted = await limitedA.signIn({
      password: 'wrong',
      remoteAddress: '127.0.0.91',
    });
    expect(exhausted.status, await exhausted.text()).toBe(429);
    const independent = await sameIpB.signIn({
      password: 'wrong',
      remoteAddress: '127.0.0.91',
    });
    expect(independent.status).toBe(422);
  });
});

function sessionValue<T>(value: T | { value: T } | null): T | null {
  return value && typeof value === 'object' && 'value' in value ? value.value : value;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
