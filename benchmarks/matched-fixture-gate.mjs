#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { browserFixtureRuntimeContract } from './browser-fixture-identity.mjs';

const benchmarkRoot = fileURLToPath(new URL('.', import.meta.url));
const partsMediaType = 'application/vnd.kovo.document-parts+json';

/**
 * Exercise both production entrants against the authoritative matched fixture. Source projection
 * is authenticated before either build; browser observations then prove that all 24 products,
 * links, assets, controls, CSS facts, state transitions, and detail routes actually survive each
 * framework's production pipeline.
 */
export async function runMatchedFixtureGate({
  build = true,
  frameworks = ['kovo', 'nextjs'],
} = {}) {
  const contract = await browserFixtureRuntimeContract();
  if (!contract.identity.complete) {
    throw new Error(
      `Matched fixture source identity is incomplete: ${contract.identity.findings.join('; ')}`,
    );
  }
  const selected = frameworks.map(entrantDefinition);
  if (new Set(frameworks).size !== frameworks.length) {
    throw new TypeError('Matched fixture gate frameworks must not contain duplicates.');
  }
  if (build) {
    for (const entrant of selected) await buildEntrant(entrant);
  }

  const evidence = [];
  for (const entrant of selected) {
    evidence.push(await exerciseEntrant(entrant, contract));
  }
  return {
    entrants: evidence,
    fixtureDigest: contract.identity.digest,
    fixtureSchema: contract.identity.schema,
  };
}

// Backward-compatible command export; unlike the historical implementation, the default gate now
// proves both entrants because a Kovo-only browser run cannot establish comparison identity.
export async function runMatchedKovoFixtureGate(options = {}) {
  return await runMatchedFixtureGate(options);
}

async function exerciseEntrant(entrant, contract) {
  const port = await availablePort();
  const origin = `http://localhost:${String(port)}`;
  const server = launchServer(entrant, port);
  const browserErrors = [];
  let browser;
  try {
    await waitForHttp(`${origin}/matched/l0`, server, entrant.framework);
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400 && new URL(response.url()).pathname !== '/favicon.ico') {
        browserErrors.push(`${String(response.status())} ${response.url()}`);
      }
    });

    await page.goto(`${origin}/matched/l0`, { waitUntil: 'networkidle' });
    await assertListing(page, contract, { basePath: '/matched/l0', lane: 'matched-l0' });
    if (entrant.framework === 'kovo') {
      assertEqual(await page.locator('script').count(), 0, 'Kovo matched L0 script count');
      assertEqual(
        await page.locator('[on\\:click]').count(),
        0,
        'Kovo matched L0 action marker count',
      );
    }
    const l0Dialog = page.getByRole('dialog');
    assertEqual(
      await l0Dialog.isVisible(),
      false,
      `${entrant.framework} matched L0 initial dialog`,
    );
    await page.getByRole('button', { name: contract.fixture.l0.cartLabel }).click();
    await l0Dialog.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Close' }).click();
    await l0Dialog.waitFor({ state: 'hidden' });

    await page.locator(`a[href="/matched/l0/product/${contract.catalog[0].slug}"]`).first().click();
    await page.waitForURL(
      (url) => url.pathname === `/matched/l0/product/${contract.catalog[0].slug}`,
    );
    await assertDetail(page, contract.catalog[0], '/matched/l0');

    let enhancedPartsRequests = 0;
    page.on('request', (request) => {
      const accept = request.headers().accept ?? '';
      if (accept.includes(partsMediaType)) enhancedPartsRequests += 1;
    });
    await page.goto(`${origin}/matched/l1`, { waitUntil: 'networkidle' });
    await assertListing(page, contract, { basePath: '/matched/l1', lane: 'matched-l1' });
    assert((await page.locator('script').count()) > 0, `${entrant.framework} L1 runtime is absent`);
    if (entrant.framework === 'kovo') {
      assert(
        (await page.locator('[on\\:click]').count()) > 0,
        'Kovo matched L1 compiled action markers are absent',
      );
    }

    const dialog = page.getByRole('dialog');
    assertEqual(await dialog.isVisible(), false, `${entrant.framework} matched L1 initial dialog`);
    await page.getByRole('button', { name: /Open cart with 0 items/u }).click();
    await dialog.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Add benchmark item' }).click();
    await expectText(page.getByRole('button', { name: /Open cart/u }), 'Cart (1)');
    await expectText(page.locator('.cart-line'), `${contract.fixture.l1.itemLabel} x 1`);
    await page.getByRole('button', { name: 'Use alternate email' }).click();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expectText(
      page.getByRole('status'),
      `Order placed. Confirmation sent to ${contract.fixture.l1.alternateEmail}.`,
    );
    await page.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'hidden' });

    await page.locator(`a[href="/matched/l1/product/${contract.catalog[0].slug}"]`).first().click();
    await page.waitForURL(
      (url) => url.pathname === `/matched/l1/product/${contract.catalog[0].slug}`,
    );
    await assertDetail(page, contract.catalog[0], '/matched/l1');
    if (entrant.framework === 'kovo') {
      assert(
        enhancedPartsRequests > 0,
        'Kovo matched L1 navigation never requested structured document parts',
      );
    }

    if (browserErrors.length > 0) {
      throw new Error(
        `Matched ${entrant.framework} browser gate observed request/runtime errors:\n${browserErrors.join('\n')}`,
      );
    }
    return {
      catalogItems: contract.catalog.length,
      enhancedPartsRequests,
      framework: entrant.framework,
      routesExercised: 4,
    };
  } finally {
    await browser?.close();
    await stopProcess(server.child);
  }
}

async function assertListing(page, contract, { basePath, lane }) {
  assertEqual(
    await page.locator('[data-benchmark-lane]').getAttribute('data-benchmark-lane'),
    lane,
    `${lane} marker`,
  );
  assertEqual(
    (await page.locator('.hero h1').textContent())?.trim(),
    contract.fixture.listingHeading,
    `${lane} heading`,
  );
  assertEqual(
    (await page.locator('.hero p').textContent())?.trim(),
    contract.fixture.listingDescription,
    `${lane} description`,
  );
  assertEqual(
    (await page.locator('.brand').textContent())?.trim(),
    contract.fixture.brand,
    `${lane} brand`,
  );
  const cards = page.locator('main .card');
  assertEqual(await cards.count(), contract.catalog.length, `${lane} product count`);
  for (const [index, product] of contract.catalog.entries()) {
    const card = cards.nth(index);
    const primaryLink = card.locator('a[aria-label^="View "]').first();
    assertEqual((await card.locator('h2, h3').textContent())?.trim(), product.name, `${lane} name`);
    assertEqual((await card.locator('p').textContent())?.trim(), product.blurb, `${lane} blurb`);
    assertEqual(
      (await card.locator('.price').textContent())?.trim(),
      `$${product.price.toFixed(2)}`,
      `${lane} price`,
    );
    assertEqual(
      await primaryLink.getAttribute('aria-label'),
      `View ${product.name}`,
      `${lane} view label`,
    );
    assertEqual(
      new URL(await primaryLink.getAttribute('href'), page.url()).pathname,
      `${basePath}/product/${product.slug}`,
      `${lane} href`,
    );
    assertEqual(
      new URL(await card.locator('img').getAttribute('src'), page.url()).pathname,
      product.img,
      `${lane} image`,
    );
  }
  const css = await page.evaluate(() => {
    const card = document.querySelector('.card');
    const image = card?.querySelector('img');
    const nav = document.querySelector('.nav');
    return {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      bodyColor: getComputedStyle(document.body).color,
      cardDisplay: card === null ? null : getComputedStyle(card).display,
      cardImageAspectRatio:
        image === null || image === undefined ? null : getComputedStyle(image).aspectRatio,
      navPosition: nav === null ? null : getComputedStyle(nav).position,
    };
  });
  assertEqual(
    JSON.stringify(css),
    JSON.stringify(contract.identity.identity.css.facts),
    `${lane} computed CSS projection`,
  );
}

async function assertDetail(page, product, basePath) {
  assertEqual(
    await page.locator('main').getAttribute('data-benchmark-destination'),
    'detail',
    `${basePath} detail marker`,
  );
  assertEqual((await page.locator('main h1').textContent())?.trim(), product.name, 'detail name');
  assertEqual(
    (await page.locator('.detail-copy p').textContent())?.trim(),
    product.blurb,
    'detail blurb',
  );
  assertEqual(
    (await page.locator('.detail-copy .price').textContent())?.trim(),
    `$${product.price.toFixed(2)}`,
    'detail price',
  );
  assertEqual(
    new URL(await page.locator('.detail-media img').getAttribute('src'), page.url()).pathname,
    product.img,
    'detail image',
  );
}

function entrantDefinition(framework) {
  if (framework === 'kovo') {
    return {
      build: ['vp', ['exec', 'pnpm', '--dir', path.join(benchmarkRoot, 'kovo'), 'run', 'build']],
      cwd: path.join(benchmarkRoot, 'kovo'),
      env: {
        KOVO_ATTESTATION_DEPLOYMENT_ID: 'deployment:matched-fixture-gate',
        KOVO_ATTESTATION_SECRET:
          'matched-fixture-gate-0123456789abcdef0123456789abcdef0123456789abcdef',
      },
      framework,
      start: [process.execPath, ['dist/server/server.mjs']],
    };
  }
  if (framework === 'nextjs') {
    return {
      build: ['vp', ['exec', 'pnpm', '--dir', path.join(benchmarkRoot, 'nextjs'), 'run', 'build']],
      cwd: path.join(benchmarkRoot, 'nextjs', '.next/standalone/benchmarks/nextjs'),
      framework,
      generatedInput: path.join(benchmarkRoot, 'nextjs/next-env.d.ts'),
      start: [process.execPath, ['server.js']],
    };
  }
  throw new TypeError(`Unsupported matched fixture entrant ${String(framework)}.`);
}

async function buildEntrant(entrant) {
  const snapshot =
    entrant.generatedInput === undefined ? undefined : await readFile(entrant.generatedInput);
  try {
    await runCommand(entrant.build[0], entrant.build[1], {
      cwd: benchmarkRoot,
      label: `matched-${entrant.framework}:build`,
      timeoutMs: 300_000,
    });
  } finally {
    if (snapshot !== undefined) await writeFile(entrant.generatedInput, snapshot);
  }
}

function launchServer(entrant, port) {
  const output = [];
  const child = spawn(entrant.start[0], entrant.start[1], {
    cwd: entrant.cwd,
    env: {
      ...process.env,
      ...entrant.env,
      HOST: 'localhost',
      HOSTNAME: 'localhost',
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

async function waitForHttp(url, server, framework) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `Matched ${framework} server exited before readiness:\n${server.output.join('')}`,
      );
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
    throw new Error(
      `${label} failed (code ${String(code)}, signal ${String(signal)}):\n${output.join('')}`,
    );
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
  const result = await runMatchedFixtureGate({ build: !process.argv.includes('--skip-build') });
  process.stdout.write(
    `matched Kovo/Next build/browser fixture gate passed (${result.fixtureDigest})\n`,
  );
}
