import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { createServer as createViteServer } from 'vite-plus';

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
  it('serves auth routes and mutations through the reference Vite dev middleware', async () => {
    const vite = await createViteServer({
      appType: 'custom',
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      logLevel: 'error',
      root: fileURLToPath(new URL('..', import.meta.url)),
      server: { middlewareMode: true },
    });
    let devServerError: unknown;
    vite.middlewares.use(
      (
        error: unknown,
        _request: IncomingMessage,
        _response: ServerResponse,
        next: (error?: unknown) => void,
      ) => {
        devServerError = error;
        next(error);
      },
    );
    server = createServer(vite.middlewares);

    try {
      await listen(server);
      const origin = serverOrigin(server);

      const loginPage = await fetch(`${origin}/login?next=/admin`);
      const loginPageBody = await loginPage.text();
      expect(loginPage.status, formatDevServerFailure(loginPageBody, devServerError)).toBe(200);
      expect(loginPageBody).toContain('<title>Kovo Reference Sign In</title>');
      expect(loginPageBody).toContain('action="/_m/auth/sign-in"');
      const loginCsrf = hiddenInputValue(loginPageBody, 'csrf');

      const loginForm = new URLSearchParams();
      loginForm.set('csrf', loginCsrf);
      loginForm.set('email', 'ada@example.com');
      loginForm.set('password', 'correct');
      loginForm.set('next', '/admin');
      const login = await fetch(`${origin}/_m/auth/sign-in`, {
        body: loginForm,
        // SPEC §6.6/§9.1: browsers send a same-origin Origin on unsafe POSTs; the CSRF Origin floor
        // requires it. Node fetch omits it, so the test supplies it (mirrors a real form submit).
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin },
        method: 'POST',
        redirect: 'manual',
      });
      const loginBody = await login.text();
      expect(login.status, formatDevServerFailure(loginBody, devServerError)).toBe(303);
      const sessionCookie = cookiePair(login.headers.get('set-cookie') ?? '');

      const admin = await fetch(`${origin}/admin`, {
        headers: { cookie: sessionCookie },
        redirect: 'manual',
      });
      const adminBody = await admin.text();
      expect(admin.status, formatDevServerFailure(adminBody, devServerError)).toBe(200);
      expect(adminBody).toContain('admin:u1');

      const sourceModule = await fetch(`${origin}/src/app.ts`);
      const sourceModuleBody = await sourceModule.text();
      expect(sourceModule.status, formatDevServerFailure(sourceModuleBody, devServerError)).toBe(
        200,
      );
      expect(sourceModuleBody).toContain('referenceSignIn');
    } finally {
      await vite.close();
    }
  });

  it('wires vp run export to the public reference shell static output', async () => {
    const referenceRoot = fileURLToPath(new URL('..', import.meta.url));
    const distDir = path.join(referenceRoot, 'dist');

    await rm(distDir, { force: true, recursive: true });

    try {
      const result = await execFileResult(
        pnpmCommand(),
        ['exec', 'vp', 'run', '--no-cache', 'export'],
        {
          cwd: referenceRoot,
          timeout: 30000,
        },
      );
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status, output).toBe(0);
      expect(output).toContain('reference-export/v1');
      expect(output).toContain('html=1');
      expect(output).toContain('client-modules=2');
      expect(output).toContain('diagnostics=0');

      const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
      expect(html).toContain('<title>Kovo Reference Public Shell</title>');
      expect(html).toContain('data-reference-public-shell');
      expect(html).toContain('/c/__v/reference-r7/reference.client.js');

      const clientModule = await readFile(
        path.join(distDir, 'c/__v/reference-r7/reference.client.js'),
        'utf8',
      );
      expect(clientModule).toContain('Reference$markReady');
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });

  it('keeps reference static export failures from creating partial output', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-reference-export-'));
    const outDir = path.join(tmpDir, 'dist');

    try {
      const result = await execFileResult(
        process.execPath,
        ['scripts/export-static.mjs', '--out', outDir],
        {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          timeout: 30000,
        },
      );
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status, output).toBe(1);
      expect(output).toContain('reference-export/v1');
      expect(output).toContain('ERROR KV229 route=/login');
      await expect(readdir(outDir)).rejects.toThrow();
    } finally {
      await rm(tmpDir, { force: true, recursive: true });
    }
  });

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
    expect(loginPageBody).toContain('<title>Kovo Reference Sign In</title>');
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
      // SPEC §6.6/§9.1: supply the same-origin Origin header the CSRF floor requires (see above).
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin },
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin },
      method: 'POST',
      redirect: 'manual',
    });
    const sessionCookie = cookiePair(login.headers.get('set-cookie') ?? '');

    expect(login.status).toBe(303);
    expect(login.headers.get('location')).toBe('/admin');
    expect(sessionCookie).toBe('kovo_reference_session=session-u1');

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

function formatDevServerFailure(body: string, error: unknown): string {
  if (!error) return body;
  return `${formatUnknownError(error)}\n\n${body}`;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return JSON.stringify(error);
}

interface ExecFileResult {
  status: number;
  stderr: string;
  stdout: string;
}

function execFileResult(
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number },
): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeout,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error);
          return;
        }

        resolve({
          status: typeof error?.code === 'number' ? error.code : 0,
          stderr,
          stdout,
        });
      },
    );
  });
}

function pnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}
