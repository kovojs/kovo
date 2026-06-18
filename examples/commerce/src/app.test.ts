import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { csrfToken } from '@kovojs/server';
import { runMutation } from '@kovojs/server/internal/execution';
import { cookiePair, enhancedMutationHeaders, firstSetCookiePair } from '@kovojs/test/headers';
import {
  kovoQueryJsonValues,
  htmlElementCount,
  htmlElementFacts,
  htmlFormActions,
  htmlFormFields,
} from '@kovojs/test/html-fragment';

import { commerceAuthCsrf, commerceCsrf, commerceSignIn } from './domain.js';
import { createCommerceApp } from './generated/app.kovo-route.js';

let server: Server | undefined;

const commerceShellSelector = {
  attrs: { 'data-commerce-shell': 'cart' },
  tag: 'div',
} as const;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe('commerce app HTTP entry', () => {
  it('serves the commerce cart document and query endpoint over node:http', async () => {
    const errors: unknown[] = [];
    const shell = createCommerceApp({
      onError(error) {
        errors.push(error);
      },
    });

    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    const document = await fetch(`${origin}/cart`);
    const html = await document.text();
    expect(errors).toEqual([]);
    expect(document.status, html).toBe(200);
    expect(document.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(document.headers.get('link')).toContain('</assets/styles.css>; rel=preload; as=style');
    expect(html).toContain('<!doctype html>');
    expectCommerceShellDocument(html);
    expect(htmlElementCount(html, { attrs: { 'kovo-fragment-target': 'cart-badge' } })).toBe(1);

    const query = await fetch(`${origin}/_q/cart`);
    expect(query.status).toBe(200);
    expect(kovoQueryJsonValues(await query.text(), 'cart')).toEqual([{ count: 0 }]);
  });

  it('serves every commerce route as no-JS full HTML documents', async () => {
    const shell = createCommerceApp();

    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    for (const route of ['/', '/cart', '/login?next=%2Fcart']) {
      const response = await fetch(`${origin}${route}`, {
        headers: { Accept: 'text/html' },
      });
      const html = await response.text();

      expect(response.status, html).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('<main');
      expect(html).not.toContain('<kovo-fragment');
    }
  });

  it('renders home and cart with a shared navigation layout segment', async () => {
    const shell = createCommerceApp();

    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    const home = await fetch(`${origin}/`);
    const homeHtml = await home.text();
    const cart = await fetch(`${origin}/cart`);
    const cartHtml = await cart.text();

    expect(home.status, homeHtml).toBe(200);
    expect(cart.status, cartHtml).toBe(200);
    expect(homeHtml).toContain('kovo-nav-segment="layout:');
    expect(cartHtml).toContain('kovo-nav-segment="layout:');
    expect(homeHtml).toContain('kovo-nav-segment="page:/"');
    expect(cartHtml).toContain('kovo-nav-segment="page:/cart"');

    const homeLayout = /kovo-nav-segment="(layout:[^"]+)"/.exec(homeHtml)?.[1];
    const cartLayout = /kovo-nav-segment="(layout:[^"]+)"/.exec(cartHtml)?.[1];
    expect(homeLayout).toBeTruthy();
    expect(cartLayout).toBe(homeLayout);
  });

  it('dispatches enhanced and no-JS cart mutations through the shared app over HTTP', async () => {
    const shell = createCommerceApp();
    const sessionCookie = await signInCookie(shell.db);
    const sessionRequest = {
      db: shell.db,
      headers: new Headers({ cookie: sessionCookie }),
      session: { id: 'session-u1', user: { id: 'u1' } },
    };

    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    const enhancedForm = new URLSearchParams();
    enhancedForm.set('productId', 'p1');
    enhancedForm.set('quantity', '2');
    enhancedForm.set('csrf', csrfToken(sessionRequest, commerceCsrf));
    const enhanced = await fetch(`${origin}/_m/cart/add`, {
      body: enhancedForm,
      headers: {
        cookie: sessionCookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...enhancedMutationHeaders(),
      },
      method: 'POST',
    });
    const enhancedBody = await enhanced.text();

    expect(enhanced.status, enhancedBody).toBe(200);
    expect(enhanced.headers.get('content-type')).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    expect(enhanced.headers.get('kovo-changes')).toBe(
      '[{"domain":"cart"},{"domain":"order"},{"domain":"product","keys":["p1"]}]',
    );
    expect(enhancedBody).not.toContain('<!doctype html>');

    const noJsForm = new URLSearchParams();
    noJsForm.set('productId', 'p2');
    noJsForm.set('quantity', '1');
    noJsForm.set('csrf', csrfToken(sessionRequest, commerceCsrf));
    const noJs = await fetch(`${origin}/_m/cart/add`, {
      body: noJsForm,
      headers: {
        cookie: sessionCookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      redirect: 'manual',
    });

    expect(noJs.status).toBe(303);
    expect(noJs.headers.get('location')).toBe('/cart');
    await expect(noJs.text()).resolves.toBe('');

    const query = await fetch(`${origin}/_q/cart`, {
      headers: { cookie: sessionCookie },
    });
    expect(query.status).toBe(200);
    expect(kovoQueryJsonValues(await query.text(), 'cart')).toEqual([{ count: 3 }]);
  });

  it('dispatches shell login and logout mutations', async () => {
    const shell = createCommerceApp();

    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    const failedForm = new URLSearchParams();
    failedForm.set('csrf', csrfToken(shellLoginCsrfRequest(shell.db), commerceAuthCsrf));
    failedForm.set('email', 'ada@example.com');
    failedForm.set('password', 'wrong');
    failedForm.set('next', '/cart');
    const failedLogin = await fetch(`${origin}/_m/auth/sign-in`, {
      body: failedForm,
      // SECURITY (SECURITY_FINDINGS.md M7): distinct client ip => own rate-limit bucket.
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        referer: `${origin}/login?next=%2Fcart`,
        'x-forwarded-for': '203.0.113.31',
      },
      method: 'POST',
      redirect: 'manual',
    });
    const failedBody = await failedLogin.text();

    expect(failedLogin.status, failedBody).toBe(422);
    expect(
      htmlElementFacts(failedBody, {
        attrs: { 'data-error-code': 'INVALID_CREDENTIALS' },
        tag: 'output',
      }),
    ).toHaveLength(1);
    expect(htmlFormFields(failedBody, 'next')).toMatchObject([{ name: 'next', value: '/cart' }]);

    const loginForm = new URLSearchParams();
    loginForm.set('csrf', csrfToken(shellLoginCsrfRequest(shell.db), commerceAuthCsrf));
    loginForm.set('email', 'ada@example.com');
    loginForm.set('password', 'correct');
    loginForm.set('next', '/cart');
    const login = await fetch(`${origin}/_m/auth/sign-in`, {
      body: loginForm,
      // SECURITY (SECURITY_FINDINGS.md M7): distinct client ip => own rate-limit bucket.
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': '203.0.113.33',
      },
      method: 'POST',
      redirect: 'manual',
    });
    const sessionCookie = cookiePair(login.headers.get('set-cookie') ?? '');

    expect(login.status).toBe(303);
    expect(login.headers.get('location')).toBe('/cart');
    expect(sessionCookie).toBe('kovo_commerce_session=session-u1');

    const logoutForm = new URLSearchParams();
    logoutForm.set(
      'csrf',
      csrfToken(
        {
          authCsrfId: 'commerce-shell-login',
          db: shell.db,
          headers: new Headers({ cookie: sessionCookie }),
          session: { id: 'session-u1', user: { id: 'u1' } },
        },
        commerceAuthCsrf,
      ),
    );
    const logout = await fetch(`${origin}/_m/auth/sign-out`, {
      body: logoutForm,
      headers: {
        cookie: sessionCookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      redirect: 'manual',
    });

    expect(logout.status).toBe(303);
    expect(logout.headers.get('location')).toBe('/login');
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

function expectCommerceShellDocument(html: string): void {
  expect(htmlElementCount(html, commerceShellSelector)).toBe(1);
  expect(htmlFormActions(html)).toContain('/_m/cart/add');
}

async function signInCookie(db: ReturnType<typeof createCommerceApp>['db']): Promise<string> {
  const request = {
    authCsrfId: 'commerce-shell-login',
    db,
    // SECURITY (SECURITY_FINDINGS.md M7): distinct client ip => own rate-limit bucket.
    headers: new Headers({ 'x-forwarded-for': '203.0.113.34' }),
  };
  const result = await runMutation(
    commerceSignIn,
    {
      csrf: csrfToken(request, commerceAuthCsrf),
      email: 'ada@example.com',
      password: 'correct',
    },
    request,
    { csrf: commerceAuthCsrf },
  );
  if (!result.ok) throw new Error(`commerce sign-in failed: ${result.error.code}`);

  const sessionCookie = firstSetCookiePair(result.responseHeaders);
  if (!sessionCookie) throw new Error('commerce sign-in did not set a cookie');

  return sessionCookie;
}

function shellLoginCsrfRequest(db: ReturnType<typeof createCommerceApp>['db']) {
  return {
    authCsrfId: 'commerce-shell-login',
    db,
    headers: new Headers(),
  };
}

function listen(target: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    target.once('error', reject);
    target.listen(0, '127.0.0.1', () => {
      target.off('error', reject);
      resolve();
    });
  });
}

function serverOrigin(target: Server): string {
  const address = target.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
