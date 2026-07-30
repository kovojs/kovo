import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { expect as expectLocator } from '@playwright/test';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const CLOSE_MUTATION = 'mutations/close-deal';
const MOVE_MUTATION = 'mutations/move-deal';
const CRM_ROOT = resolve('examples/crm');
const KOVO_BIN = resolve(CRM_ROOT, 'node_modules/.bin/kovo');
const OPTIMISM_MODULE_PATTERN = /^\/c\/__v\/[a-f0-9]{64}\/src\/mutations\.client\.js$/u;

let browser: Browser | undefined;
let context: BrowserContext | undefined;
let devServer: ChildProcess | undefined;
let devServerProcessGroup: number | undefined;
let origin = '';

beforeAll(async () => {
  const port = await reserveLoopbackPort();
  origin = `http://127.0.0.1:${port}`;
  devServer = spawn(
    KOVO_BIN,
    ['dev', './src/app-shell.ts', '--host', '127.0.0.1', '--port', String(port), '--strict-port'],
    {
      cwd: CRM_ROOT,
      detached: process.platform !== 'win32',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  devServerProcessGroup = devServer.pid;
  await waitForCrm(devServer, origin);
  browser = await chromium.launch({ headless: true });
}, 120_000);

afterEach(async () => {
  await context?.close();
  context = undefined;
});

afterAll(async () => {
  await context?.close();
  context = undefined;
  await browser?.close();
  browser = undefined;
  await stopChildTree(devServer, devServerProcessGroup);
  devServer = undefined;
  devServerProcessGroup = undefined;
});

describe('CRM compiler-to-browser optimistic round trip', () => {
  it('loads one immutable plan, predicts one POST, then rebases and persists server truth', async () => {
    const activeBrowser = requireBrowser();
    context = await activeBrowser.newContext({
      extraHTTPHeaders: { 'x-kovo-demo-sid': `optimism-success-${Date.now()}` },
    });
    const page = await context.newPage();
    let mutationRequests = 0;
    const optimismModuleUrls: string[] = [];
    const responseGate = deferred();

    await page.route(`**/_m/${CLOSE_MUTATION}`, async (route) => {
      mutationRequests += 1;
      await responseGate.promise;
      await route.continue();
    });
    page.on('request', (request) => {
      if (OPTIMISM_MODULE_PATTERN.test(new URL(request.url()).pathname)) {
        optimismModuleUrls.push(request.url());
      }
    });
    await page.goto(`${origin}/deals/d1`, { waitUntil: 'domcontentloaded' });

    const detail = page.locator('[kovo-c="deal-detail-region"]');
    const deal = page.locator('[data-crm-deal]');
    const form = page.locator(`form[data-mutation="${CLOSE_MUTATION}"]`);
    const moduleHref = await form.getAttribute('data-kovo-optimistic-module');
    expect(moduleHref).toMatch(OPTIMISM_MODULE_PATTERN);
    await expectLocator(form).toHaveAttribute('data-kovo-module-allowlist', moduleHref!);
    await expectLocator(deal).toHaveAttribute('data-crm-stage', 'open');
    await expectLocator(deal).toHaveAttribute('data-crm-amount', '5000');

    const response = page.waitForResponse((candidate) =>
      candidate.url().endsWith(`/_m/${CLOSE_MUTATION}`),
    );
    await page.getByRole('button', { name: 'Close won' }).click();

    await expectLocator(deal).toHaveAttribute('data-crm-stage', 'won');
    await expectLocator(deal).toHaveAttribute('data-crm-amount', '5000');
    await expectLocator(detail).toHaveAttribute('kovo-pending', '');
    await expectLocator(detail).toHaveAttribute('aria-busy', 'true');

    responseGate.resolve();
    expect((await response).status()).toBe(200);
    await expectLocator(deal).toHaveAttribute('data-crm-stage', 'won');
    await expectLocator(deal).toHaveAttribute('data-crm-amount', '4000');
    await expectLocator(detail).not.toHaveAttribute('kovo-pending', '');
    await expectLocator(detail).not.toHaveAttribute('aria-busy', 'true');
    expect(mutationRequests).toBe(1);
    expect(optimismModuleUrls).toEqual([`${origin}${moduleHref}`]);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectLocator(page.locator('[data-crm-deal]')).toHaveAttribute('data-crm-stage', 'won');
    await expectLocator(page.locator('[data-crm-deal]')).toHaveAttribute('data-crm-amount', '4000');
  }, 30_000);

  it('rolls back a rejected keyed prediction and preserves server truth across reload', async () => {
    const activeBrowser = requireBrowser();
    context = await activeBrowser.newContext({
      extraHTTPHeaders: { 'x-kovo-demo-sid': `optimism-rejection-${Date.now()}` },
    });
    const page = await context.newPage();
    let mutationRequests = 0;
    const responseGate = deferred();

    await page.route(`**/_m/${MOVE_MUTATION}`, async (route) => {
      mutationRequests += 1;
      await responseGate.promise;
      await route.continue();
    });
    await page.goto(`${origin}/deals/d1`, { waitUntil: 'domcontentloaded' });

    const form = page.locator(`form[data-mutation="${MOVE_MUTATION}"][kovo-key="proposal"]`);
    const moduleHref = await form.getAttribute('data-kovo-optimistic-module');
    expect(moduleHref).toMatch(OPTIMISM_MODULE_PATTERN);
    await expectLocator(form).toHaveAttribute('data-kovo-module-allowlist', moduleHref!);
    await form.locator('input[name="stage"]').evaluate((element: HTMLInputElement) => {
      element.value = 'invalid-stage';
    });

    const detail = page.locator('[kovo-c="deal-detail-region"]');
    const deal = page.locator('[data-crm-deal]');
    const response = page.waitForResponse((candidate) =>
      candidate.url().endsWith(`/_m/${MOVE_MUTATION}`),
    );

    await form.getByRole('button', { name: 'proposal' }).click();
    await expectLocator(deal).toHaveAttribute('data-crm-stage', 'invalid-stage');
    await expectLocator(detail).toHaveAttribute('kovo-pending', '');
    await expectLocator(detail).toHaveAttribute('aria-busy', 'true');

    responseGate.resolve();
    expect((await response).status()).toBe(422);
    await expectLocator(deal).toHaveAttribute('data-crm-stage', 'open');
    await expectLocator(deal).toHaveAttribute('data-crm-amount', '5000');
    await expectLocator(detail).not.toHaveAttribute('kovo-pending', '');
    await expectLocator(detail).not.toHaveAttribute('aria-busy', 'true');
    expect(mutationRequests).toBe(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectLocator(page.locator('[data-crm-deal]')).toHaveAttribute('data-crm-stage', 'open');
    await expectLocator(page.locator('[data-crm-deal]')).toHaveAttribute('data-crm-amount', '5000');
  }, 30_000);
});

function requireBrowser(): Browser {
  if (!browser) throw new TypeError('CRM browser acceptance started before Chromium was ready.');
  return browser;
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not reserve a loopback port for CRM acceptance.');
  }
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

async function waitForCrm(child: ChildProcess, targetOrigin: string): Promise<void> {
  let logs = '';
  const append = (chunk: Buffer | string) => {
    logs = `${logs}${String(chunk)}`.slice(-40_000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const deadline = Date.now() + 110_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`kovo dev exited ${child.exitCode} before readiness.\n${logs}`);
    }
    try {
      const response = await fetch(`${targetOrigin}/deals/d1`, {
        headers: { 'x-kovo-demo-sid': 'optimism-healthcheck' },
      });
      if (response.status === 200) return;
    } catch {
      // The ordinary dev server is still compiling or has not started listening.
    }
    await delay(250);
  }
  throw new Error(`kovo dev did not serve CRM within 110 seconds.\n${logs}`);
}

async function stopChildTree(
  child: ChildProcess | undefined,
  processGroup: number | undefined,
): Promise<void> {
  if (!child) return;
  const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
  signalChildTree(child, processGroup, 'SIGTERM');
  await Promise.race([exited, delay(5_000)]);
  if (childTreeIsRunning(child, processGroup)) {
    signalChildTree(child, processGroup, 'SIGKILL');
    await Promise.race([exited, delay(1_000)]);
  }
}

function signalChildTree(
  child: ChildProcess,
  processGroup: number | undefined,
  signal: NodeJS.Signals,
): void {
  try {
    if (process.platform !== 'win32' && processGroup !== undefined) {
      process.kill(-processGroup, signal);
    } else if (child.exitCode === null) {
      child.kill(signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function childTreeIsRunning(child: ChildProcess, processGroup: number | undefined): boolean {
  try {
    if (process.platform !== 'win32' && processGroup !== undefined) {
      process.kill(-processGroup, 0);
      return true;
    }
    return child.exitCode === null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
