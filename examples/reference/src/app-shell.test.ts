import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createReferenceAppShell } from './app-shell.js';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe('reference app shell HTTP entry', () => {
  it('serves auth routes and mutations through the shared request shell over HTTP', async () => {
    const shell = createReferenceAppShell();

    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    const anonymousAccount = await fetch(`${origin}/account`, { redirect: 'manual' });
    expect(anonymousAccount.status).toBe(303);
    expect(anonymousAccount.headers.get('location')).toBe('/login?next=%2Faccount');

    const loginPage = await fetch(`${origin}/login?next=/admin`);
    const loginPageBody = await loginPage.text();
    expect(loginPage.status, loginPageBody).toBe(200);
    expect(loginPageBody).toContain('<title>Jiso Reference Sign In</title>');
    expect(loginPageBody).toContain('action="/_m/auth/sign-in"');
    expect(loginPageBody).toContain('name="next" value="/admin"');
    const loginCsrf = hiddenInputValue(loginPageBody, 'csrf');

    const failedForm = new URLSearchParams();
    failedForm.set('csrf', loginCsrf);
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

    const loginForm = new URLSearchParams();
    loginForm.set('csrf', loginCsrf);
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
    expect(sessionCookie).toBe('jiso_reference_session=session-u1');

    const account = await fetch(`${origin}/account`, {
      headers: { cookie: sessionCookie },
      redirect: 'manual',
    });
    const accountBody = await account.text();
    expect(account.status, accountBody).toBe(200);
    expect(accountBody).toContain('account:ada@example.com');
    expect(accountBody).toContain('action="/_m/auth/sign-out"');

    const admin = await fetch(`${origin}/admin`, {
      headers: { cookie: sessionCookie },
      redirect: 'manual',
    });
    const adminBody = await admin.text();
    expect(admin.status, adminBody).toBe(200);
    expect(adminBody).toContain('admin:u1');
    const logoutCsrf = hiddenInputValue(adminBody, 'csrf');

    const logoutForm = new URLSearchParams();
    logoutForm.set('csrf', logoutCsrf);
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

function hiddenInputValue(html: string, name: string): string {
  const pattern = new RegExp(
    `<input[^>]+type="hidden"[^>]+name="${escapeRegExp(name)}"[^>]+value="([^"]*)"`,
  );
  const match = pattern.exec(html);
  if (!match?.[1]) throw new Error(`Missing hidden input '${name}' in:\n${html}`);
  return decodeHtmlAttribute(match[1]);
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
