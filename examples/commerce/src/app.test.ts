import '../../../tests/example-generated-graphs.setup.js';

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { mutationCsrfTokenForTesting as csrfToken } from '@kovojs/server/testing';
import { runMutation } from '@kovojs/server/internal/execution';
import { cookiePair, enhancedMutationHeaders, firstSetCookiePair } from '@kovojs/test/headers';
import {
  kovoQueryJsonValues,
  htmlElementCount,
  htmlElementFacts,
  htmlFormActions,
  htmlFormFacts,
  htmlFormFields,
} from '@kovojs/test/html-fragment';

import { addToCart } from './domain.js';
import { commerceAuthCsrf } from './auth.js';
import { createCommerceTestApp } from './app-test-helpers.js';
import { routeValueToHtml } from './app.js';

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
  it('escapes forged rendered/trusted HTML app-shell route values', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const forgedRendered = {
      [Symbol.for('kovo.renderedHtml')]: true,
      html: payload,
      toString: () => payload,
    };
    const forgedTrusted = { __kovoTrustedHtml: true, value: payload };

    expect(routeValueToHtml(forgedRendered)).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(routeValueToHtml(forgedRendered)).not.toContain(payload);
    expect(routeValueToHtml(forgedTrusted)).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(routeValueToHtml(forgedTrusted)).not.toContain(payload);
  });

  it('serves the commerce cart document and query endpoint over node:http', async () => {
    const errors: unknown[] = [];
    const shell = createCommerceTestApp({
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

    const query = await fetch(`${origin}/_q/queries/cart-query`);
    expect(query.status).toBe(200);
    expect(kovoQueryJsonValues(await query.text(), 'queries/cart-query')).toEqual([{ count: 0 }]);
  });

  it('serves every commerce route as no-JS full HTML documents', async () => {
    const shell = createCommerceTestApp();

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
    const shell = createCommerceTestApp();

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
    const shell = createCommerceTestApp();
    const signedIn = await signInSession(shell);
    const sessionCookie = signedIn.cookie;
    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    const enhancedForm = new URLSearchParams();
    enhancedForm.set('productId', 'p1');
    enhancedForm.set('quantity', '2');
    const enhancedSource = await fetch(`${origin}/cart`, { headers: { cookie: sessionCookie } });
    enhancedForm.set(
      'csrf',
      productMutationCsrf(await enhancedSource.text(), '/_m/domain/add-to-cart', 'p1'),
    );
    const enhanced = await fetch(`${origin}/_m/domain/add-to-cart`, {
      body: enhancedForm,
      headers: {
        cookie: sessionCookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        // SPEC §6.6/§9.1: real browsers send a same-origin Origin on unsafe POSTs; the CSRF
        // Origin floor requires it. Node fetch omits it, so the test supplies it explicitly.
        Origin: origin,
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
    const noJsSource = await fetch(`${origin}/cart`, { headers: { cookie: sessionCookie } });
    noJsForm.set(
      'csrf',
      productMutationCsrf(await noJsSource.text(), '/_m/domain/add-to-cart', 'p2'),
    );
    const noJs = await fetch(`${origin}/_m/domain/add-to-cart`, {
      body: noJsForm,
      headers: {
        cookie: sessionCookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: origin,
      },
      method: 'POST',
      redirect: 'manual',
    });

    expect(noJs.status).toBe(303);
    expect(noJs.headers.get('location')).toBe('/cart');
    await expect(noJs.text()).resolves.toBe('');

    const query = await fetch(`${origin}/_q/queries/cart-query`, {
      headers: { cookie: sessionCookie },
    });
    expect(query.status).toBe(200);
    expect(kovoQueryJsonValues(await query.text(), 'queries/cart-query')).toEqual([{ count: 3 }]);
  });

  it('dispatches shell login and logout mutations', async () => {
    const shell = createCommerceTestApp();

    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    const failedSource = await authFormSource(origin, '/cart');
    const failedForm = new URLSearchParams();
    failedForm.set('csrf', failedSource.csrf);
    failedForm.set('email', 'ada@example.com');
    failedForm.set('password', 'wrong');
    failedForm.set('next', '/cart');
    const failedLogin = await fetch(`${origin}/_m/auth/sign-in`, {
      body: failedForm,
      // SECURITY (SECURITY_FINDINGS.md M7): distinct client ip => own rate-limit bucket.
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: failedSource.cookie,
        Origin: origin,
        referer: `${origin}/login?next=%2Fcart`,
        'x-forwarded-for': '127.0.0.31',
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

    const loginSource = await authFormSource(origin, '/cart');
    const loginForm = new URLSearchParams();
    loginForm.set('csrf', loginSource.csrf);
    loginForm.set('email', 'ada@example.com');
    loginForm.set('password', 'correct');
    loginForm.set('next', '/cart');
    const login = await fetch(`${origin}/_m/auth/sign-in`, {
      body: loginForm,
      // SECURITY (SECURITY_FINDINGS.md M7): distinct client ip => own rate-limit bucket.
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: loginSource.cookie,
        Origin: origin,
        'x-forwarded-for': '127.0.0.33',
      },
      method: 'POST',
      redirect: 'manual',
    });
    const sessionCookie = cookiePair(login.headers.get('set-cookie') ?? '');

    expect(login.status).toBe(303);
    expect(login.headers.get('location')).toBe('/cart');
    expect(sessionCookie).toMatch(/^kovo_commerce_session=[0-9a-f-]+$/u);

    const cartPage = await fetch(`${origin}/cart`, { headers: { cookie: sessionCookie } });
    const logoutCsrf = mutationFormCsrf(await cartPage.text(), '/_m/auth/sign-out');
    const logoutForm = new URLSearchParams({ csrf: logoutCsrf });
    const logout = await fetch(`${origin}/_m/auth/sign-out`, {
      body: logoutForm,
      headers: {
        cookie: sessionCookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: origin,
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
  expect(htmlFormActions(html)).not.toContain('/_m/domain/add-to-cart');
}

async function signInSession(shell: ReturnType<typeof createCommerceTestApp>) {
  const request = {
    authCsrfId: 'commerce-shell-login',
    clientIp: '127.0.0.34',
    db: shell.db,
    // SECURITY (SECURITY_FINDINGS.md M7): distinct client ip => own rate-limit bucket.
    headers: new Headers({ 'x-forwarded-for': '127.0.0.34' }),
    url: 'http://localhost/commerce-auth-test',
  };
  const result = await runMutation(
    shell.auth.signIn,
    {
      csrf: csrfToken(request, commerceAuthCsrf, { mutation: shell.auth.signIn }),
      email: 'ada@example.com',
      password: 'correct',
    },
    request,
    { csrf: commerceAuthCsrf },
  );
  if (!result.ok) throw new Error(`commerce sign-in failed: ${result.error.code}`);

  const cookie = firstSetCookiePair(result.responseHeaders);
  if (!cookie) throw new Error('commerce sign-in did not set a cookie');
  const resolved = await shell.auth.sessionProvider({
    headers: new Headers({ cookie }),
    url: request.url,
  } as Parameters<typeof shell.auth.sessionProvider>[0]);
  const session =
    resolved && typeof resolved === 'object' && 'value' in resolved ? resolved.value : resolved;
  if (!session) throw new Error('commerce sign-in did not resolve a session');
  return { cookie, session };
}

async function authFormSource(origin: string, next: string) {
  const response = await fetch(`${origin}/login?next=${encodeURIComponent(next)}`);
  const html = await response.text();
  return {
    cookie: cookiePair(response.headers.get('set-cookie') ?? ''),
    csrf: mutationFormCsrf(html, '/_m/auth/sign-in'),
  };
}

function mutationFormCsrf(html: string, action: string): string {
  const form = htmlFormFacts(html).find((candidate) => candidate.action === action);
  const csrf = form?.fields.find((field) => field.name === 'csrf')?.value;
  if (!csrf) throw new Error(`Expected ${action} form CSRF field.`);
  return csrf;
}

function productMutationCsrf(html: string, action: string, productId: string): string {
  const form = htmlFormFacts(html).find(
    (candidate) =>
      candidate.action === action &&
      candidate.fields.some((field) => field.name === 'productId' && field.value === productId),
  );
  const csrf = form?.fields.find((field) => field.name === 'csrf')?.value;
  if (!csrf) throw new Error(`Expected ${action} ${productId} form CSRF field.`);
  return csrf;
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
