import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { csrfToken, runMutation } from '@jiso/server';

import { addToCart, commerceAuthCsrf, commerceCsrf, commerceSignIn } from './app.js';
import { commerceClientModuleHref, createCommerceAppShell } from './app-shell.js';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe('commerce app shell HTTP entry', () => {
  it('serves the commerce cart document, query endpoint, and client module over node:http', async () => {
    const errors: unknown[] = [];
    const shell = createCommerceAppShell({
      onError(error) {
        errors.push(error);
      },
    });

    const directDocument = await shell.requestHandler(new Request('https://commerce.test/cart'));
    expect(await directDocument.text()).toContain('data-commerce-shell="cart"');
    expect(directDocument.status).toBe(200);

    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    const document = await fetch(`${origin}/cart`);
    const html = await document.text();
    expect(errors).toEqual([]);
    expect(document.status, html).toBe(200);
    expect(document.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(document.headers.get('link')).toContain('</assets/tailwind.css>; rel=preload; as=style');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('data-commerce-shell="cart"');
    expect(html).toContain('<fw-fragment target="cart-badge">');
    expect(html).toContain('action="/_m/cart/add"');

    await addToCart.handler(
      { productId: 'p1', quantity: 2 },
      { db: shell.db, session: { id: 's-http', user: { id: 'u-http' } } },
      {
        fail(code, payload) {
          return { error: { code, payload }, ok: false, status: 422 };
        },
        invalidate(domain, options) {
          return { domain: domain.key, ...options, manual: true };
        },
      },
    );

    const query = await fetch(`${origin}/_q/cart`);
    expect(query.status).toBe(200);
    await expect(query.text()).resolves.toContain('<fw-query name="cart">{"count":2}</fw-query>');

    const clientModule = await fetch(`${origin}${commerceClientModuleHref}`);
    expect(clientModule.status).toBe(200);
    expect(clientModule.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expect(clientModule.text()).resolves.toContain('Commerce$markReady');
  });

  it('dispatches enhanced and no-JS cart mutations through the shared app shell over HTTP', async () => {
    const shell = createCommerceAppShell();
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
        'FW-Fragment': 'true',
        'FW-Targets': 'cart-badge,product-grid,order-history',
      },
      method: 'POST',
    });
    const enhancedBody = await enhanced.text();

    expect(enhanced.status, enhancedBody).toBe(200);
    expect(enhanced.headers.get('content-type')).toBe('text/vnd.jiso.fragment+html; charset=utf-8');
    expect(enhanced.headers.get('fw-changes')).toBe(
      '[{"domain":"cart"},{"domain":"order"},{"domain":"product","keys":["p1"]}]',
    );
    expect(enhancedBody).toContain('<fw-query name="cart">{"count":2}</fw-query>');
    expect(enhancedBody).toContain('<fw-fragment target="cart-badge">');
    expect(enhancedBody).toContain('<fw-fragment target="product-grid">');
    expect(enhancedBody).toContain('<fw-fragment target="order-history">');

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
    await expect(query.text()).resolves.toContain('<fw-query name="cart">{"count":3}</fw-query>');
  });

  it('dispatches shell login and logout mutations before guarded admin routes', async () => {
    const shell = createCommerceAppShell();

    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    const anonymousAdmin = await fetch(`${origin}/admin`, { redirect: 'manual' });
    expect(anonymousAdmin.status).toBe(303);
    expect(anonymousAdmin.headers.get('location')).toBe('/login?next=%2Fadmin');

    const failedForm = new URLSearchParams();
    failedForm.set('csrf', csrfToken(shellLoginCsrfRequest(shell.db), commerceAuthCsrf));
    failedForm.set('email', 'ada@example.com');
    failedForm.set('password', 'wrong');
    failedForm.set('next', '/admin');
    const failedLogin = await fetch(`${origin}/_m/auth/sign-in`, {
      body: failedForm,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      redirect: 'manual',
    });
    const failedBody = await failedLogin.text();

    expect(failedLogin.status, failedBody).toBe(422);
    expect(failedBody).toContain('data-error-code="INVALID_CREDENTIALS"');
    expect(failedBody).toContain('name="next" value="/admin"');

    const memberLoginForm = new URLSearchParams();
    memberLoginForm.set('csrf', csrfToken(shellLoginCsrfRequest(shell.db), commerceAuthCsrf));
    memberLoginForm.set('email', 'grace@example.com');
    memberLoginForm.set('password', 'correct');
    memberLoginForm.set('next', '/admin');
    const memberLogin = await fetch(`${origin}/_m/auth/sign-in`, {
      body: memberLoginForm,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      redirect: 'manual',
    });
    const memberSessionCookie = cookiePair(memberLogin.headers.get('set-cookie') ?? '');

    expect(memberLogin.status).toBe(303);
    expect(memberLogin.headers.get('location')).toBe('/admin');
    expect(memberSessionCookie).toBe('jiso_commerce_session=session-u2');

    const memberAdmin = await fetch(`${origin}/admin`, {
      headers: { cookie: memberSessionCookie },
      redirect: 'manual',
    });

    expect(memberAdmin.status).toBe(403);

    const loginForm = new URLSearchParams();
    loginForm.set('csrf', csrfToken(shellLoginCsrfRequest(shell.db), commerceAuthCsrf));
    loginForm.set('email', 'ada@example.com');
    loginForm.set('password', 'correct');
    loginForm.set('next', '/admin');
    const login = await fetch(`${origin}/_m/auth/sign-in`, {
      body: loginForm,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      redirect: 'manual',
    });
    const sessionCookie = cookiePair(login.headers.get('set-cookie') ?? '');

    expect(login.status).toBe(303);
    expect(login.headers.get('location')).toBe('/admin');
    expect(sessionCookie).toBe('jiso_commerce_session=session-u1');

    const admin = await fetch(`${origin}/admin`, {
      headers: { cookie: sessionCookie },
      redirect: 'manual',
    });
    const adminBody = await admin.text();

    expect(admin.status, adminBody).toBe(200);
    expect(adminBody).toContain('<main>admin:u1');
    expect(adminBody).toContain('action="/_m/auth/sign-out"');
    expect(adminBody).toContain('data-mutation="auth/sign-out"');

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

async function signInCookie(db: ReturnType<typeof createCommerceAppShell>['db']): Promise<string> {
  const request = {
    authCsrfId: 'commerce-shell-login',
    db,
    headers: new Headers(),
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

  const setCookie = result.responseHeaders?.['Set-Cookie'];
  const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!rawCookie) throw new Error('commerce sign-in did not set a cookie');

  return rawCookie.split(';')[0] ?? rawCookie;
}

function shellLoginCsrfRequest(db: ReturnType<typeof createCommerceAppShell>['db']) {
  return {
    authCsrfId: 'commerce-shell-login',
    db,
    headers: new Headers(),
  };
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0] ?? setCookie;
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
