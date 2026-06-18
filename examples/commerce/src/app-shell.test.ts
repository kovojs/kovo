import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { createServer as createViteServer } from 'vite';

import { csrfToken, runMutation } from '@kovojs/server';
import { cookiePair, firstSetCookiePair } from '@kovojs/test/headers';
import {
  kovoFragmentFacts,
  kovoQueryJsonValues,
  htmlDocumentFacts,
  htmlElementCount,
  htmlElementFacts,
  htmlFormActions,
  htmlFormFacts,
  htmlFormFields,
} from '@kovojs/test/html-fragment';

import {
  commerceAuthCsrf,
  commerceCsrf,
  commercePaymentWebhookSecret,
  commerceSignIn,
} from './app.js';
import {
  commerceClientModuleHref,
  createCommerceAppShell,
} from './generated/app-shell.kovo-route.js';
import { readOrders } from './app-test-helpers.js';
import { commerceSharedAppShellDevPlugin, commerceViteConfig } from '../vite.config.ts';

let server: Server | undefined;

const commerceShellSelector = {
  attrs: { 'data-commerce-shell': 'cart' },
  tag: 'div',
} as const;

const cartBadgeLiveTarget = 'cart-badge#components/cart-badge/cart-badge:{}';
const cartPageTargets = 'cart-badge=cart; product-grid=productGrid; order-history=orderHistory';
const cartPageLiveTargets = [
  cartBadgeLiveTarget,
  'product-grid#components/product-grid/product-grid:{}',
  'order-history#components/order-history/order-history:{}',
].join('; ');

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe('commerce app shell HTTP entry', () => {
  it('documents the commerce app-shell dev and serve command matrix', async () => {
    const commerceRoot = fileURLToPath(new URL('..', import.meta.url));
    const packageJson = JSON.parse(await readFile(path.join(commerceRoot, 'package.json'), 'utf8'));
    const viteConfig = commerceViteConfig as {
      plugins?: Array<{ name?: string }>;
      run?: { tasks?: Record<string, { command?: string }> };
    };

    expect(packageJson.scripts).toMatchObject({
      dev: 'vp dev',
      start: 'node scripts/serve.mjs',
    });
    expect(packageJson.scripts.static).toBeUndefined();
    expect(
      viteConfig.plugins?.some((plugin) => plugin.name === 'kovo-commerce-app-shell-dev-loader'),
    ).toBe(true);
    expect(viteConfig.run?.tasks?.serve?.command).toBe('node scripts/serve.mjs');
    expect(viteConfig.run?.tasks?.export).toBeUndefined();
    expect(commerceServeCommands().map((command) => command.label)).toEqual([
      'node scripts/serve.mjs',
      'vp run serve',
      'npm start',
    ]);

    const viteConfigSource = await readFile(path.join(commerceRoot, 'vite.config.ts'), 'utf8');
    expect(viteConfigSource).toContain("server.ssrLoadModule('@kovojs/server/app-shell/vite')");
    expect(viteConfigSource).not.toContain("server.ssrLoadModule('@kovojs/server')");

    const appShellSource = await readFile(path.join(commerceRoot, 'src/app-shell.tsx'), 'utf8');
    expect(appShellSource).toContain("from '@kovojs/server/app-shell/client-modules'");
    expect(appShellSource).toContain("from '@kovojs/server/app-shell/core'");
    expect(appShellSource).toContain("from '@kovojs/server/app-shell/node'");
    const rootImport = appShellSource.match(
      /import \{(?<imports>[\s\S]*?)\} from '@kovojs\/server';/,
    );
    expect(rootImport?.groups?.imports).not.toMatch(
      /\b(createApp|createRequestHandler|createMemoryVersionedClientModuleRegistry|toNodeHandler)\b/,
    );
  });

  it('delegates Vite dev middleware to the shared app-shell plugin through public config seams', async () => {
    const delegatedOptions: unknown[] = [];
    const configuredServers: unknown[] = [];
    let postHookCalled = false;
    const plugin = commerceSharedAppShellDevPlugin();
    const postHook = await plugin.configureServer({
      middlewares: {
        use() {
          throw new Error('shared plugin factory should own middleware registration');
        },
      },
      async ssrLoadModule(id) {
        expect(id).toBe('@kovojs/server/app-shell/vite');
        return {
          kovoAppShellViteDevPlugin(options: unknown) {
            delegatedOptions.push(options);
            return {
              configureServer(server: unknown) {
                configuredServers.push(server);
                return () => {
                  postHookCalled = true;
                };
              },
            };
          },
        };
      },
    });

    expect(plugin.name).toBe('kovo-commerce-app-shell-dev-loader');
    expect(delegatedOptions).toEqual([
      {
        moduleId: '/src/generated/app-shell.kovo-route.tsx',
        name: 'kovo-commerce-app-shell-dev',
        nodeHandlerExportName: 'commerceNodeHandler',
        order: 'post',
      },
    ]);
    expect(configuredServers).toHaveLength(1);
    expect(postHook).toBeTypeOf('function');
    if (typeof postHook !== 'function') {
      throw new Error('commerce app-shell dev plugin did not return the shared post hook');
    }
    await postHook();
    expect(postHookCalled).toBe(true);
  });

  it('serves shell routes, modules, queries, and mutations through the commerce Vite dev middleware', async () => {
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
      const viteShell = (await vite.ssrLoadModule('/src/generated/app-shell.kovo-route.tsx')) as {
        commerceAppShell: ReturnType<typeof createCommerceAppShell>;
      };
      await listen(server);
      const origin = serverOrigin(server);

      const document = await fetch(`${origin}/cart`);
      const documentBody = await document.text();
      expect(document.status, formatDevServerFailure(documentBody, devServerError)).toBe(200);
      expectCommerceShellDocument(documentBody);

      const home = await fetch(`${origin}/`);
      const homeBody = await home.text();
      expect(home.status, formatDevServerFailure(homeBody, devServerError)).toBe(200);
      expectCommerceShellDocument(homeBody);

      const moduleResponse = await fetch(`${origin}${commerceClientModuleHref}`);
      const moduleBody = await moduleResponse.text();
      expect(moduleResponse.status, formatDevServerFailure(moduleBody, devServerError)).toBe(200);
      expect(moduleBody).toContain('export function Commerce$markReady');

      const query = await fetch(`${origin}/_q/cart`);
      const queryBody = await query.text();
      expect(query.status, formatDevServerFailure(queryBody, devServerError)).toBe(200);
      expect(kovoQueryJsonValues(queryBody, 'cart')).toEqual([{ count: 0 }]);

      const loginForm = new URLSearchParams();
      loginForm.set(
        'csrf',
        csrfToken(shellLoginCsrfRequest(viteShell.commerceAppShell.db), commerceAuthCsrf),
      );
      loginForm.set('email', 'ada@example.com');
      loginForm.set('password', 'correct');
      loginForm.set('next', '/cart');
      const login = await fetch(`${origin}/_m/auth/sign-in`, {
        body: loginForm,
        // SECURITY (SECURITY_FINDINGS.md M7): distinct client ip => own rate-limit bucket.
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-forwarded-for': '203.0.113.30',
        },
        method: 'POST',
        redirect: 'manual',
      });
      const loginBody = await login.text();
      expect(login.status, formatDevServerFailure(loginBody, devServerError)).toBe(303);
      const sessionCookie = cookiePair(login.headers.get('set-cookie') ?? '');

      const mutationForm = new URLSearchParams();
      mutationForm.set('productId', 'p1');
      mutationForm.set('quantity', '1');
      mutationForm.set(
        'csrf',
        csrfToken(
          {
            db: viteShell.commerceAppShell.db,
            headers: new Headers({ cookie: sessionCookie }),
            session: { id: 'session-u1', user: { id: 'u1' } },
          },
          commerceCsrf,
        ),
      );
      const mutation = await fetch(`${origin}/_m/cart/add`, {
        body: mutationForm,
        headers: {
          cookie: sessionCookie,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': cartBadgeLiveTarget,
          'Kovo-Targets': 'cart-badge=cart',
        },
        method: 'POST',
      });
      const mutationBody = await mutation.text();

      expect(mutation.status, formatDevServerFailure(mutationBody, devServerError)).toBe(200);
      expect(kovoFragmentFacts(mutationBody, 'cart-badge')).toHaveLength(1);

      const webhookBody = JSON.stringify({
        data: {
          object: {
            id: 'order-dev-http-1',
            productId: 'p1',
            quantity: 1,
            total: 1499,
            userId: 'u1',
          },
        },
        id: 'evt_dev_http_1',
        type: 'checkout.session.completed',
      });
      const webhook = await fetch(`${origin}/webhooks/stripe`, {
        body: webhookBody,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': stripeHeader(webhookBody, commercePaymentWebhookSecret),
        },
        method: 'POST',
      });
      const webhookResponseBody = await webhook.text();

      expect(webhook.status, formatDevServerFailure(webhookResponseBody, devServerError)).toBe(200);
      expect(webhook.headers.get('kovo-changes')).toBe(
        '[{"domain":"order","keys":["order-dev-http-1"]}]',
      );
      expect(webhookResponseBody).toBe('ok');
      expect(await readOrders(viteShell.commerceAppShell.db)).toContainEqual({
        id: 'order-dev-http-1',
        productId: 'p1',
        qty: 1,
        total: 1499,
        userId: 'u1',
      });

      const sourceAsset = await fetch(`${origin}/src/styles.css`);
      const sourceAssetBody = await sourceAsset.text();
      expect(sourceAsset.status, formatDevServerFailure(sourceAssetBody, devServerError)).toBe(200);
      expectCommerceStylesheet(sourceAssetBody);

      const missing = await fetch(`${origin}/not-a-commerce-shell-route`);
      const missingBody = await missing.text();
      expect(missing.status, formatDevServerFailure(missingBody, devServerError)).toBe(404);
      expect(htmlElementCount(missingBody, commerceShellSelector)).toBe(0);
    } finally {
      await vite.close();
    }
    // The dev server SSR-loads the app, whose Drizzle/PGlite (WASM) data layer
    // takes a few seconds to initialize — past Vitest's 5s default.
  }, 30_000);

  for (const serveCommand of commerceServeCommands()) {
    it(`serves the app-shell surface through ${serveCommand.label}`, async () => {
      const commerceRoot = fileURLToPath(new URL('..', import.meta.url));
      const port = await reservePort();
      let serveProcess: ChildProcessWithoutNullStreams | undefined;

      try {
        serveProcess = spawn(serveCommand.command, serveCommand.args(port), {
          cwd: commerceRoot,
          detached: process.platform !== 'win32',
          env: { ...process.env, FORCE_COLOR: '0' },
        });
        const output = collectOutput(serveProcess);
        const origin = `http://127.0.0.1:${port}`;

        const documentBody = await fetchTextWhenReady(`${origin}/cart`, output);
        expect(output()).toContain('commerce-serve/v1');
        expectCommerceShellDocument(documentBody);

        const homeBody = await fetchTextWhenReady(`${origin}/`, output);
        expectCommerceShellDocument(homeBody);

        const moduleBody = await fetchTextWhenReady(`${origin}${commerceClientModuleHref}`, output);
        expect(moduleBody).toContain('export function Commerce$markReady');

        const queryBody = await fetchTextWhenReady(`${origin}/_q/cart`, output);
        expect(kovoQueryJsonValues(queryBody, 'cart')).toEqual([{ count: 0 }]);

        const stylesheetBody = await fetchTextWhenReady(`${origin}/src/styles.css`, output);
        expectCommerceStylesheet(stylesheetBody);

        const missing = await fetch(`${origin}/not-a-commerce-shell-route`);
        const missingBody = await missing.text();
        expect(missing.status, `${missingBody}\n${output()}`).toBe(404);
        expect(htmlElementCount(missingBody, commerceShellSelector)).toBe(0);
      } finally {
        await stopProcess(serveProcess);
      }
    });
  }

  it('serves the commerce cart document, query endpoint, and client module over node:http', async () => {
    const errors: unknown[] = [];
    const shell = createCommerceAppShell({
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
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': cartPageLiveTargets,
        'Kovo-Targets': cartPageTargets,
      },
      method: 'POST',
    });
    const enhancedBody = await enhanced.text();

    expect(enhanced.status, enhancedBody).toBe(200);
    expect(enhanced.headers.get('content-type')).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    expect(enhanced.headers.get('kovo-changes')).toBe(
      '[{"domain":"cart"},{"domain":"order"},{"domain":"product","keys":["p1"]}]',
    );
    expect(kovoQueryJsonValues(enhancedBody, 'cart')).toEqual([{ count: 2 }]);
    expect(kovoFragmentFacts(enhancedBody).map((fragment) => fragment.target)).toEqual([
      'cart-badge',
      'product-grid',
      'order-history',
    ]);

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
      // SECURITY (SECURITY_FINDINGS.md M7): distinct client ip => own rate-limit bucket.
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
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
    expect(htmlFormFields(failedBody, 'next')).toMatchObject([{ name: 'next', value: '/admin' }]);

    const memberLoginForm = new URLSearchParams();
    memberLoginForm.set('csrf', csrfToken(shellLoginCsrfRequest(shell.db), commerceAuthCsrf));
    memberLoginForm.set('email', 'grace@example.com');
    memberLoginForm.set('password', 'correct');
    memberLoginForm.set('next', '/admin');
    const memberLogin = await fetch(`${origin}/_m/auth/sign-in`, {
      body: memberLoginForm,
      // SECURITY (SECURITY_FINDINGS.md M7): distinct client ip => own rate-limit bucket.
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': '203.0.113.32',
      },
      method: 'POST',
      redirect: 'manual',
    });
    const memberSessionCookie = cookiePair(memberLogin.headers.get('set-cookie') ?? '');

    expect(memberLogin.status).toBe(303);
    expect(memberLogin.headers.get('location')).toBe('/admin');
    expect(memberSessionCookie).toBe('kovo_commerce_session=session-u2');

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
    expect(login.headers.get('location')).toBe('/admin');
    expect(sessionCookie).toBe('kovo_commerce_session=session-u1');

    const admin = await fetch(`${origin}/admin`, {
      headers: { cookie: sessionCookie },
      redirect: 'manual',
    });
    const adminBody = await admin.text();

    expect(admin.status, adminBody).toBe(200);
    expect(htmlDocumentFacts(adminBody).text).toContain('admin:u1');
    expect(htmlFormFacts(adminBody)).toMatchObject([
      {
        action: '/_m/auth/sign-out',
        attrs: expect.objectContaining({ 'data-mutation': 'auth/sign-out' }),
      },
    ]);

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

function expectCommerceStylesheet(css: string): void {
  expect(css).toContain('.bg-slate-50');
  expect(css).toContain('.rounded');
  expect(css).toContain('.text-red-700');
  expect(css).toContain('.bg-teal-600');
  expect(css).toContain('.border-slate-200');
}

async function signInCookie(db: ReturnType<typeof createCommerceAppShell>['db']): Promise<string> {
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

function shellLoginCsrfRequest(db: ReturnType<typeof createCommerceAppShell>['db']) {
  return {
    authCsrfId: 'commerce-shell-login',
    db,
    headers: new Headers(),
  };
}

function stripeHeader(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function formatDevServerFailure(body: string, error: unknown): string {
  if (error instanceof Error) {
    return `${error.stack ?? error.message}\n\n${body}`;
  }

  return body;
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

function pnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function commerceServeCommands(): Array<{
  args(port: number): string[];
  command: string;
  label: string;
}> {
  const serveArgs = (port: number) => [
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ];

  return [
    {
      args: (port) => ['scripts/serve.mjs', ...serveArgs(port)],
      command: process.execPath,
      label: 'node scripts/serve.mjs',
    },
    {
      args: (port) => ['exec', 'vp', 'run', '--no-cache', 'serve', ...serveArgs(port)],
      command: pnpmCommand(),
      label: 'vp run serve',
    },
    {
      args: (port) => ['start', '--', ...serveArgs(port)],
      command: npmCommand(),
      label: 'npm start',
    },
  ];
}

function collectOutput(child: ChildProcessWithoutNullStreams): () => string {
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  return () => output;
}

async function fetchTextWhenReady(url: string, output: () => string): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok) return body;
      lastError = new Error(`HTTP ${response.status} from ${url}\n${body}`);
    } catch (error) {
      lastError = error;
    }

    await delay(100);
  }

  throw new Error(`Timed out fetching ${url}\n${String(lastError)}\n${output()}`);
}

async function reservePort(): Promise<number> {
  const probe = createNetServer();

  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      probe.off('error', reject);
      resolve();
    });
  });

  const address = probe.address() as AddressInfo;

  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });

  return address.port;
}

async function stopProcess(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.killed) return;

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
  killProcessTree(child, 'SIGTERM');

  await Promise.race([
    exited,
    delay(5_000).then(() => {
      if (child.exitCode === null && !child.killed) killProcessTree(child, 'SIGKILL');
    }),
  ]);
}

async function closeServer(): Promise<void> {
  if (!server) return;
  const target = server;
  server = undefined;

  await new Promise<void>((resolve, reject) => {
    target.close((error) => (error ? reject(error) : resolve()));
  });
}

function killProcessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;

  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal);
      return;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw error;
  }

  child.kill(signal);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
