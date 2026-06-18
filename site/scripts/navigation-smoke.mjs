import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));

const MIME = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function fileFor(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/^\//, '');
  if (clean === '') return path.join(distDir, 'index.html');
  if (clean.endsWith('/')) return path.join(distDir, clean, 'index.html');
  if (path.extname(clean)) return path.join(distDir, clean);
  return path.join(distDir, clean, 'index.html');
}

const failures = [];

async function check(label, predicate) {
  const ok = await predicate();
  process.stdout.write(`${ok ? 'ok' : 'FAIL'} ${label}\n`);
  if (!ok) failures.push(label);
}

async function assertTheme(page, theme) {
  await check(`${theme} theme survives enhanced docs navigation`, () =>
    page.evaluate((expected) => {
      const dark = document.documentElement.classList.contains('dark');
      return (
        localStorage.getItem('theme') === expected &&
        document.documentElement.dataset.theme === expected &&
        (expected === 'dark' ? dark : !dark)
      );
    }, theme),
  );
}

async function installNavigationProbe(page) {
  await page.evaluate(() => {
    globalThis.__kovoNavigationSmokeEvents = [];
    addEventListener('kovo:navigate', (event) => {
      globalThis.__kovoNavigationSmokeEvents.push(event.detail.url);
    });
  });
}

async function assertEnhancedClick(page, click, expectedPath, label) {
  const stampCount = await page.evaluate(
    () => document.querySelectorAll('[kovo-nav-segment]').length,
  );
  await check(`${label} exposes navigation stamps`, () => Promise.resolve(stampCount > 0));
  await page.evaluate(() => {
    globalThis.__kovoNavigationSmokeHeader = document.querySelector('.site-bar');
  });
  await click();
  await page.waitForFunction((path) => location.pathname === path, expectedPath);
  await check(`${label} fires kovo:navigate`, () =>
    page.evaluate((path) => {
      const events = globalThis.__kovoNavigationSmokeEvents ?? [];
      return events.some((url) => new URL(url).pathname === path);
    }, expectedPath),
  );
  await check(`${label} preserves docs header DOM identity`, () =>
    page.evaluate(
      () => document.querySelector('.site-bar') === globalThis.__kovoNavigationSmokeHeader,
    ),
  );
}

async function assertHashBelowHeader(page, hash, label) {
  await check(label, () =>
    page.evaluate((expectedHash) => {
      const raw = expectedHash.slice(1);
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch {}
      const target =
        document.getElementById(decoded) ??
        document.getElementById(raw) ??
        document.getElementsByName(decoded)[0] ??
        document.getElementsByName(raw)[0];
      const header = document.querySelector('.site-bar');
      if (!target || !header) return false;
      return target.getBoundingClientRect().top >= header.getBoundingClientRect().bottom - 1;
    }, hash),
  );
}

const server = createServer(async (request, response) => {
  const file = fileFor(request.url ?? '/');
  if (!existsSync(file)) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
  });
  response.end(await readFile(file));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

try {
  const page = await browser.newPage();

  await page.goto(`${origin}/docs/mental-model/`, { waitUntil: 'networkidle' });
  await installNavigationProbe(page);
  await page.click('button[on\\:click^="/c/theme.js"]');
  await page.waitForFunction(
    () =>
      document.documentElement.classList.contains('dark') &&
      localStorage.getItem('theme') === 'dark',
  );
  await assertEnhancedClick(
    page,
    () => page.click('.site-nav a[href="/reference/"]'),
    '/reference/',
    'docs reference click',
  );
  await assertTheme(page, 'dark');

  await page.click('button[on\\:click^="/c/theme.js"]');
  await page.waitForFunction(
    () =>
      !document.documentElement.classList.contains('dark') &&
      localStorage.getItem('theme') === 'light',
  );
  await assertEnhancedClick(
    page,
    () => page.click('.site-nav a[href="/docs/why-kovo/"]'),
    '/docs/why-kovo/',
    'docs page click',
  );
  await assertTheme(page, 'light');

  await page.goto(`${origin}/api/core/`, { waitUntil: 'networkidle' });
  await installNavigationProbe(page);
  const railLink = page.locator('.api-nav li > a:first-child').nth(10);
  const hash = await railLink.getAttribute('href');
  if (!hash) {
    failures.push('API rail exposes a symbol hash');
  } else {
    await railLink.click();
    await page.waitForFunction((expectedHash) => location.hash === expectedHash, hash);
    await assertHashBelowHeader(page, hash, 'same-page API rail hash lands below sticky header');

    await page.goto(`${origin}/docs/mental-model/`, { waitUntil: 'networkidle' });
    await installNavigationProbe(page);
    await page.evaluate((targetHash) => {
      const link = document.createElement('a');
      link.id = 'synthetic-api-symbol-link';
      link.href = `/api/core/${targetHash}`;
      link.textContent = 'API symbol';
      document.body.append(link);
    }, hash);
    await assertEnhancedClick(
      page,
      () => page.click('#synthetic-api-symbol-link'),
      '/api/core/',
      'cross-page API symbol click',
    );
    await page.waitForFunction((expectedHash) => location.hash === expectedHash, hash);
    await assertHashBelowHeader(page, hash, 'cross-page API rail hash lands below sticky header');

    await page.click('.site-nav a[href="/docs/why-kovo/"]');
    await page.waitForFunction(() => location.pathname === '/docs/why-kovo/');
    await installNavigationProbe(page);
    await page.evaluate((targetHash) => {
      document.querySelector('#synthetic-api-symbol-link')?.remove();
      const link = document.createElement('a');
      link.id = 'synthetic-api-symbol-link';
      link.href = `/api/core/${targetHash}`;
      link.textContent = 'API symbol';
      document.body.append(link);
    }, hash);
    await assertEnhancedClick(
      page,
      () => page.click('#synthetic-api-symbol-link'),
      '/api/core/',
      'fresh API symbol click',
    );
    await page.waitForFunction((expectedHash) => location.hash === expectedHash, hash);
    await assertHashBelowHeader(
      page,
      hash,
      'fresh API symbol click ignores stale saved scroll',
    );

    const apiScroll = await page.evaluate(() => window.scrollY);
    await page.click('.site-nav a[href="/docs/why-kovo/"]');
    await page.waitForFunction(() => location.pathname === '/docs/why-kovo/');
    const docsScroll = await page.evaluate(() => {
      window.scrollTo(0, 220);
      return window.scrollY;
    });
    await page.evaluate(() => history.back());
    await page.waitForFunction(
      (expectedHash) => location.pathname === '/api/core/' && location.hash === expectedHash,
      hash,
    );
    await page.waitForFunction((expectedY) => Math.abs(window.scrollY - expectedY) <= 2, apiScroll);
    await check('back restores API symbol scroll below sticky header', () =>
      page.evaluate(
        ({ expectedHash, expectedY }) => {
          const raw = expectedHash.slice(1);
          let decoded = raw;
          try {
            decoded = decodeURIComponent(raw);
          } catch {}
          const target =
            document.getElementById(decoded) ??
            document.getElementById(raw) ??
            document.getElementsByName(decoded)[0] ??
            document.getElementsByName(raw)[0];
          const header = document.querySelector('.site-bar');
          return (
            Math.abs(window.scrollY - expectedY) <= 2 &&
            target &&
            header &&
            target.getBoundingClientRect().top >= header.getBoundingClientRect().bottom - 1
          );
        },
        { expectedHash: hash, expectedY: apiScroll },
      ),
    );
    await page.evaluate(() => history.forward());
    await page.waitForFunction(() => location.pathname === '/docs/why-kovo/');
    await page.waitForFunction(
      (expectedY) => Math.abs(window.scrollY - expectedY) <= 2,
      docsScroll,
    );
    await check('forward restores docs page scroll after API symbol popstate', () =>
      page.evaluate((expectedY) => Math.abs(window.scrollY - expectedY) <= 2, docsScroll),
    );
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length > 0) {
  process.stderr.write(`site-navigation-smoke/v1\nFAIL ${failures.join(' | ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('site-navigation-smoke/v1 OK\n');
}
