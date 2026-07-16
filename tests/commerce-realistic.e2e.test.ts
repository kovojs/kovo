// B2 / S2 / S3 (plans/bugs-and-testing.md): boot the commerce example through
// the production Vite-plugin compiler and drive the real browser workflow the
// public demo exposes: anonymous visitors see the sign-in gate, authenticated
// visitors can page products and add items through the live CSRF/session stack.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { type Browser, type Page, chromium, expect } from '@playwright/test';
import { afterAll, beforeAll, describe, it } from 'vitest';

interface DemoServerProcess {
  child: ChildProcess;
  isClosed(): boolean;
  stderr(): string;
  stdout(): string;
}

const demoServeEntry = fileURLToPath(
  new URL('../examples/commerce/scripts/demo-serve.mjs', import.meta.url),
);
const maxCapturedServerOutput = 64 * 1024;
const timerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');

let served: DemoServerProcess | undefined;
let browser: Browser | undefined;
let origin = '';

beforeAll(async () => {
  const launched = await launchDemoServer();
  served = launched.server;
  origin = launched.origin;
  try {
    browser = await chromium.launch();
  } catch (error) {
    const cleanup = await Promise.allSettled([closeDemoServer(served)]);
    served = undefined;
    if (cleanup[0]?.status === 'rejected') {
      throw new AggregateError(
        [error, cleanup[0].reason],
        'Chromium launch and commerce demo cleanup both failed.',
      );
    }
    throw error;
  }
  expect(Object.getOwnPropertyDescriptor(globalThis, 'setTimeout')).toEqual(timerDescriptor);
}, 180_000);

afterAll(async () => {
  const results = await Promise.allSettled([
    (async () => browser?.close())(),
    closeDemoServer(served),
  ]);
  expect(Object.getOwnPropertyDescriptor(globalThis, 'setTimeout')).toEqual(timerDescriptor);
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Commerce browser and demo server cleanup both failed.');
  }
});

describe('realistic-app: commerce real stack driven in a browser (B2/S2/S3)', () => {
  it('runs the public commerce sign-in, pagination, and add-to-cart workflow end to end', async () => {
    const page: Page = await browser!.newPage();
    let shopperContext;
    let shopperPage;
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });

      // The storefront SSRs through the real compiler/runtime, but anonymous
      // shoppers do not see an auth-guarded add-to-cart form.
      await expect(page.locator('[kovo-fragment-target="cart-badge"]').first()).toBeVisible();
      const initialDocument = await page.content();
      expect(initialDocument).toContain('installInlineKovoBootstrap');
      expect(initialDocument).toContain('kovo-runtime.client.js');
      await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
      await expect(page.locator('form[action="/_m/domain/add-to-cart"]')).toHaveCount(0);

      // The live CSRF/session stack still rejects a raw anonymous mutation.
      const csrf = await page.request.post(`${origin}/_m/domain/add-to-cart`, {
        form: { productId: 'p1', quantity: '1' },
        headers: { 'Kovo-Fragment': 'true' },
        failOnStatusCode: false,
      });
      expect(csrf.status()).toBe(422);
      expect(await csrf.text()).toContain('data-error-code="CSRF"');

      // The broken public pagination link is no longer exposed.
      await expect(page.getByRole('link', { name: 'More' })).toHaveCount(0);

      // Mint the real login session in a no-JS browser context, then verify the
      // visible button-driven add-to-cart workflow updates cart badge, stock,
      // and orders through POST-redirect-GET.
      shopperContext = await browser!.newContext({ javaScriptEnabled: false });
      shopperPage = await shopperContext.newPage();
      await shopperPage.goto(`${origin}/login?next=%2Fcart`, { waitUntil: 'domcontentloaded' });
      const csrfField = await shopperPage.locator('input[name="csrf"]').inputValue();
      const login = await shopperContext.request.post(`${origin}/_m/auth/sign-in`, {
        failOnStatusCode: false,
        form: {
          csrf: csrfField,
          email: 'ada@example.com',
          next: '/cart',
          password: 'correct',
        },
        headers: {
          origin,
          referer: `${origin}/login?next=%2Fcart`,
          'x-forwarded-for': '203.0.113.90',
        },
      });
      expect(login.ok()).toBe(true);

      await shopperPage.goto(`${origin}/cart`, { waitUntil: 'domcontentloaded' });
      await expect(
        shopperPage.locator('form[action="/_m/domain/add-to-cart"]').first(),
      ).toBeVisible();
      await expect(shopperPage.getByRole('link', { name: 'More' })).toHaveCount(0);
      await shopperPage.getByRole('button', { name: 'Add to cart' }).first().click();
      await shopperPage.waitForURL((url) => url.pathname === '/cart');
      await expect(shopperPage.locator('cart-badge')).toContainText('1');
      await expect(shopperPage.locator('body')).toContainText('4 in stock');
      await expect(shopperPage.locator('body')).toContainText('Order order-1');
    } finally {
      await shopperPage?.close();
      await shopperContext?.close();
      await page.close();
    }
  }, 120_000);
});

async function launchDemoServer(): Promise<{
  origin: string;
  server: DemoServerProcess;
}> {
  // The supported demo runner irreversibly locks its JavaScript realm before loading Vite or the
  // authored app (SPEC §6.6 rule 6). Keep that realm in its own process so Vitest can retain the
  // mutable timer bindings it owns for hook timeouts and teardown.
  const child = spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      demoServeEntry,
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ],
    {
      detached: process.platform !== 'win32',
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let closed = false;
  let stderr = '';
  let stdout = '';
  child.once('close', () => {
    closed = true;
  });
  const appendStderr = (chunk: string) => {
    stderr = appendBoundedOutput(stderr, chunk);
  };
  const appendStdout = (chunk: string) => {
    stdout = appendBoundedOutput(stdout, chunk);
  };
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', appendStdout);
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', appendStderr);
  child.on('error', (error) => appendStderr(`${error.stack ?? error.message}\n`));

  const server = {
    child,
    isClosed: () => closed,
    stderr: () => stderr,
    stdout: () => stdout,
  };
  try {
    const origin = await waitForDemoServerOrigin(server);
    return { origin, server };
  } catch (error) {
    const cleanup = await Promise.allSettled([closeDemoServer(server)]);
    if (cleanup[0]?.status === 'rejected') {
      throw new AggregateError(
        [error, cleanup[0].reason],
        'Commerce demo startup and cleanup both failed.',
      );
    }
    throw error;
  }
}

async function waitForDemoServerOrigin(server: DemoServerProcess): Promise<string> {
  const { child } = server;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Commerce demo server did not start.\nstdout:\n${server.stdout()}\nstderr:\n${server.stderr()}`,
        ),
      );
    }, 120_000);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off('data', onStdout);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Commerce demo server exited before startup (code ${String(code)}, signal ${String(signal)}).\nstdout:\n${server.stdout()}\nstderr:\n${server.stderr()}`,
        ),
      );
    };
    const onStdout = () => {
      const match = /commerce-demo-serve\/v1\s+(http:\/\/[^\s]+)/u.exec(server.stdout());
      if (match === null) return;
      let exactOrigin: string;
      try {
        const parsed = new URL(match[1]!);
        const port = Number(parsed.port);
        if (
          parsed.origin !== match[1] ||
          parsed.protocol !== 'http:' ||
          parsed.hostname !== '127.0.0.1' ||
          parsed.username !== '' ||
          parsed.password !== '' ||
          parsed.pathname !== '/' ||
          parsed.search !== '' ||
          parsed.hash !== '' ||
          !Number.isInteger(port) ||
          port < 1 ||
          port > 65_535
        ) {
          throw new Error(`Invalid commerce demo server origin ${JSON.stringify(match[1])}.`);
        }
        exactOrigin = parsed.origin;
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      cleanup();
      resolve(exactOrigin);
    };

    child.stdout?.on('data', onStdout);
    child.once('error', onError);
    child.once('exit', onExit);
    onStdout();
    if (child.exitCode !== null || child.signalCode !== null) {
      onExit(child.exitCode, child.signalCode);
    }
  });
}

async function closeDemoServer(server: DemoServerProcess | undefined): Promise<void> {
  if (server === undefined || server.isClosed()) return;
  if (server.child.pid !== undefined) signalDemoServerProcess(server.child, 'SIGTERM');
  if (await waitForDemoServerClose(server, 2_000)) return;
  if (server.child.pid !== undefined) signalDemoServerProcess(server.child, 'SIGKILL');
  if (await waitForDemoServerClose(server, 2_000)) return;
  throw new Error(
    `Commerce demo server did not terminate.\nstdout:\n${server.stdout()}\nstderr:\n${server.stderr()}`,
  );
}

async function waitForDemoServerClose(
  server: DemoServerProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (server.isClosed()) return true;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (didClose: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.child.off('close', onClose);
      resolve(didClose);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    server.child.once('close', onClose);
    if (server.isClosed()) finish(true);
  });
}

function signalDemoServerProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }
  child.kill(signal);
}

function appendBoundedOutput(current: string, chunk: string): string {
  return `${current}${chunk}`.slice(-maxCapturedServerOutput);
}
