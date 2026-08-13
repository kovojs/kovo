#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const benchmarkRoot = fileURLToPath(new URL('.', import.meta.url));
const kovoRoot = path.join(benchmarkRoot, 'kovo');
const partsMediaType = 'application/vnd.kovo.document-parts+json';

export async function runMatchedKovoFixtureGate({ build = true } = {}) {
  if (build) {
    await runCommand('pnpm', ['--dir', kovoRoot, 'run', 'build'], {
      cwd: benchmarkRoot,
      label: 'matched-kovo:build',
      timeoutMs: 180_000,
    });
  }

  const port = await availablePort();
  const origin = `http://localhost:${port}`;
  const server = launchServer(port);
  const browserErrors = [];
  let browser;
  try {
    await waitForHttp(`${origin}/matched/l0`, server);
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400 && new URL(response.url()).pathname !== '/favicon.ico') {
        browserErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(`${origin}/matched/l0`, { waitUntil: 'networkidle' });
    assertEqual(await page.locator('script').count(), 0, 'matched L0 script count');
    assertEqual(await page.locator('[on\\:click]').count(), 0, 'matched L0 action marker count');
    assertEqual(
      await page.locator('[data-benchmark-lane]').getAttribute('data-benchmark-lane'),
      'matched-l0',
      'matched L0 lane marker',
    );

    let enhancedPartsRequests = 0;
    page.on('request', (request) => {
      const accept = request.headers().accept ?? '';
      if (accept.includes(partsMediaType)) enhancedPartsRequests += 1;
    });
    await page.goto(`${origin}/matched/l1`, { waitUntil: 'networkidle' });
    assert((await page.locator('script').count()) > 0, 'matched L1 did not install a runtime');
    assert(
      (await page.locator('[on\\:click]').count()) > 0,
      'matched L1 did not emit compiled action markers',
    );

    const dialog = page.locator('[role="dialog"]');
    assertEqual(await dialog.isVisible(), false, 'matched L1 initial cart visibility');
    await page.getByRole('button', { name: /Open cart with 0 items/u }).click();
    await dialog.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Add benchmark item' }).click();
    await expectText(page.getByRole('button', { name: /Open cart/u }), 'Cart (1)');
    await expectText(page.locator('.cart-line'), 'Benchmark item x 1');

    await page.getByRole('button', { name: 'Use alternate email' }).click();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expectText(
      page.getByRole('status'),
      'Order placed. Confirmation sent to alternate@example.test.',
    );
    await page.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'hidden' });

    await page.locator('a[href="/matched/l1/product/linen-field-jacket"]').last().click();
    await page.waitForURL((url) => url.pathname === '/matched/l1/product/linen-field-jacket');
    await page.getByRole('heading', { name: 'Linen Field Jacket' }).waitFor();
    assert(
      enhancedPartsRequests > 0,
      'matched L1 navigation never requested Kovo structured document parts',
    );
    assertEqual(
      await page.locator('[data-benchmark-lane]').getAttribute('data-benchmark-lane'),
      'matched-l1',
      'matched L1 destination lane marker',
    );

    if (browserErrors.length > 0) {
      throw new Error(
        `Matched Kovo browser gate observed request/runtime errors:\n${browserErrors.join('\n')}`,
      );
    }
  } finally {
    await browser?.close();
    await stopProcess(server.child);
  }
}

function launchServer(port) {
  const output = [];
  const child = spawn(process.execPath, ['dist/server/server.mjs'], {
    cwd: kovoRoot,
    env: {
      ...process.env,
      HOST: 'localhost',
      HOSTNAME: 'localhost',
      KOVO_ATTESTATION_DEPLOYMENT_ID: 'deployment:matched-fixture-gate',
      KOVO_ATTESTATION_SECRET:
        'matched-fixture-gate-0123456789abcdef0123456789abcdef0123456789abcdef',
      NODE_ENV: 'production',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk) => {
      output.push(String(chunk));
      if (output.join('').length > 64 * 1024) output.splice(0, output.length - 16);
    });
  }
  return { child, output };
}

async function waitForHttp(url, server) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`Matched Kovo server exited before readiness:\n${server.output.join('')}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}:\n${server.output.join('')}`);
}

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, 'localhost', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local fixture-gate port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function runCommand(command, args, { cwd, label, timeoutMs }) {
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk) => output.push(String(chunk)));
  }
  const timeout = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  const { code, signal } = await new Promise((resolve) =>
    child.once('exit', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal })),
  );
  clearTimeout(timeout);
  if (code !== 0) {
    throw new Error(`${label} failed (code ${code}, signal ${signal}):\n${output.join('')}`);
  }
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const forced = new Promise((resolve) =>
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 5_000),
  );
  await Promise.race([exited, forced]);
}

async function expectText(locator, expected) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await locator.textContent())?.includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for text ${JSON.stringify(expected)}.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMatchedKovoFixtureGate({ build: !process.argv.includes('--skip-build') });
  process.stdout.write('matched Kovo build/browser fixture gate passed\n');
}
