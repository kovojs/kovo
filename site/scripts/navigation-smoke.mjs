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
    globalThis.__kovoNavigationSmokeLayout = document.querySelector('[data-site-route-layout]');
  });
  await click();
  await page.waitForFunction((path) => location.pathname === path, expectedPath);
  await check(`${label} fires kovo:navigate`, () =>
    page.evaluate((path) => {
      const events = globalThis.__kovoNavigationSmokeEvents ?? [];
      return events.some((url) => new URL(url).pathname === path);
    }, expectedPath),
  );
  await check(`${label} preserves route layout DOM identity`, () =>
    page.evaluate(
      () =>
        document.querySelector('[data-site-route-layout]') ===
        globalThis.__kovoNavigationSmokeLayout,
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
      const targetTop = target.getBoundingClientRect().top;
      return (
        targetTop >= header.getBoundingClientRect().bottom - 1 && targetTop < window.innerHeight
      );
    }, hash),
  );
}

async function assertApiRailState(page, hash, label) {
  try {
    await page.waitForFunction(
      (expectedHash) =>
        document
          .querySelector(`.api-nav li > a:first-child[href="${expectedHash}"]`)
          ?.classList.contains('active') === true,
      hash,
      { timeout: 1500 },
    );
  } catch {}
  await check(label, () =>
    page.evaluate((expectedHash) => {
      const nav = document.querySelector('.api-nav');
      if (!nav) return false;
      const link = Array.from(nav.querySelectorAll('li > a:first-child')).find(
        (candidate) => candidate.getAttribute('href') === expectedHash,
      );
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
      const linkRect = link?.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const targetRect = target?.getBoundingClientRect();
      const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
      const detailsOpen =
        link !== undefined &&
        Array.from(nav.querySelectorAll('details'))
          .filter((details) => details.contains(link))
          .every((details) => details.open);

      return (
        link?.classList.contains('active') === true &&
        detailsOpen &&
        linkRect !== undefined &&
        linkRect.top >= navRect.top - 1 &&
        linkRect.bottom <= navRect.bottom + 1 &&
        targetRect !== undefined &&
        targetRect.top >= headerBottom - 1 &&
        targetRect.top < window.innerHeight
      );
    }, hash),
  );
}

async function assertFallbackNavigation(page, click, expectedPath, label) {
  await page.evaluate(() => {
    globalThis.__kovoNavigationSmokeEvents = [];
  });
  await click();
  await page.waitForFunction((path) => location.pathname === path, expectedPath);
  await check(label, () =>
    page.evaluate((path) => {
      const events = globalThis.__kovoNavigationSmokeEvents ?? [];
      return location.pathname === path && events.length === 0;
    }, expectedPath),
  );
}

async function deepApiRailHashFor(page, path) {
  return page.evaluate(async (urlPath) => {
    const html = await fetch(urlPath).then((response) => response.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('.api-nav li > a:first-child'));
    return links.at(-1)?.getAttribute('href');
  }, path);
}

const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/__kovo-smoke-build-mismatch/')) {
    const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
    const mismatched = html.replace(
      /<meta name="kovo-build" content="[^"]*">/,
      '<meta name="kovo-build" content="smoke-build-mismatch">',
    );
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(mismatched);
    return;
  }

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

  await page.goto(`${origin}/getting-started/mental-model/`, { waitUntil: 'networkidle' });
  await installNavigationProbe(page);
  await page.click('button[on\\:click$="theme.js#toggle"]');
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

  await page.click('button[on\\:click$="theme.js#toggle"]');
  await page.waitForFunction(
    () =>
      !document.documentElement.classList.contains('dark') &&
      localStorage.getItem('theme') === 'light',
  );
  await assertEnhancedClick(
    page,
    () => page.click('.site-nav a[href="/getting-started/why-kovo/"]'),
    '/getting-started/why-kovo/',
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
    const samePageEventCount = await page.evaluate(
      () => (globalThis.__kovoNavigationSmokeEvents ?? []).length,
    );
    await railLink.click();
    await page.waitForFunction((expectedHash) => location.hash === expectedHash, hash);
    await check('same-page API rail hash stays local to the current document', () =>
      page.evaluate(
        ({ expectedHash, expectedCount }) =>
          location.pathname === '/api/core/' &&
          location.hash === expectedHash &&
          (globalThis.__kovoNavigationSmokeEvents ?? []).length === expectedCount,
        { expectedHash: hash, expectedCount: samePageEventCount },
      ),
    );
    await assertHashBelowHeader(page, hash, 'same-page API rail hash lands below sticky header');
    await assertApiRailState(
      page,
      hash,
      'same-page API rail marks active symbol, opens details, and scrolls the rail',
    );

    await page.goto(`${origin}/getting-started/mental-model/`, { waitUntil: 'networkidle' });
    await installNavigationProbe(page);
    const serverHash = await deepApiRailHashFor(page, '/api/server/');
    if (!serverHash) {
      failures.push('API server rail exposes a symbol hash');
    }
    await page.evaluate((targetHash) => {
      const link = document.createElement('a');
      link.id = 'synthetic-api-symbol-link';
      link.href = `/api/server/${targetHash}`;
      link.textContent = 'API symbol';
      document.body.append(link);
    }, serverHash);
    await assertEnhancedClick(
      page,
      () => page.click('#synthetic-api-symbol-link'),
      '/api/server/',
      'cross-page API symbol click',
    );
    await page.waitForFunction((expectedHash) => location.hash === expectedHash, serverHash);
    await assertHashBelowHeader(
      page,
      serverHash,
      'cross-page API rail hash lands below sticky header',
    );
    await assertApiRailState(
      page,
      serverHash,
      'cross-page API rail reinitializes active symbol, details, and rail scroll',
    );

    await page.click('.site-nav a[href="/getting-started/why-kovo/"]');
    await page.waitForFunction(() => location.pathname === '/getting-started/why-kovo/');
    await installNavigationProbe(page);
    await page.evaluate((targetHash) => {
      document.querySelector('#synthetic-api-symbol-link')?.remove();
      const link = document.createElement('a');
      link.id = 'synthetic-api-symbol-link';
      link.href = `/api/server/${targetHash}`;
      link.textContent = 'API symbol';
      document.body.append(link);
    }, serverHash);
    await assertEnhancedClick(
      page,
      () => page.click('#synthetic-api-symbol-link'),
      '/api/server/',
      'fresh API symbol click',
    );
    await page.waitForFunction((expectedHash) => location.hash === expectedHash, serverHash);
    await assertHashBelowHeader(
      page,
      serverHash,
      'fresh API symbol click ignores stale saved scroll',
    );
    await assertApiRailState(
      page,
      serverHash,
      'fresh API symbol click keeps rail active after stale scroll exists',
    );

    const apiScroll = await page.evaluate(() => window.scrollY);
    await page.click('.site-nav a[href="/getting-started/why-kovo/"]');
    await page.waitForFunction(() => location.pathname === '/getting-started/why-kovo/');
    const docsScroll = await page.evaluate(() => {
      window.scrollTo(0, 220);
      return window.scrollY;
    });
    await page.evaluate(() => history.back());
    await page.waitForFunction(
      (expectedHash) => location.pathname === '/api/server/' && location.hash === expectedHash,
      serverHash,
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
            target.getBoundingClientRect().top >= header.getBoundingClientRect().bottom - 1 &&
            target.getBoundingClientRect().top < window.innerHeight
          );
        },
        { expectedHash: serverHash, expectedY: apiScroll },
      ),
    );
    await assertApiRailState(
      page,
      serverHash,
      'back restoration keeps API rail active and visible',
    );
    await page.evaluate(() => history.forward());
    await page.waitForFunction(() => location.pathname === '/getting-started/why-kovo/');
    await page.waitForFunction(
      (expectedY) => Math.abs(window.scrollY - expectedY) <= 2,
      docsScroll,
    );
    await check('forward restores docs page scroll after API symbol popstate', () =>
      page.evaluate((expectedY) => Math.abs(window.scrollY - expectedY) <= 2, docsScroll),
    );

    await installNavigationProbe(page);
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.id = 'synthetic-build-mismatch-link';
      link.href = '/__kovo-smoke-build-mismatch/';
      link.textContent = 'Mismatched build';
      document.body.append(link);
    });
    await assertFallbackNavigation(
      page,
      () => page.click('#synthetic-build-mismatch-link'),
      '/__kovo-smoke-build-mismatch/',
      'build-token mismatch falls back to full navigation',
    );
    await check('build-token mismatch loads the fallback document shell', () =>
      page.evaluate(
        () =>
          document.querySelector('meta[name="kovo-build"]')?.getAttribute('content') ===
          'smoke-build-mismatch',
      ),
    );

    await installNavigationProbe(page);
    const stylesheetPath = await page.evaluate(() => {
      const href = document.querySelector('link[rel="stylesheet"]')?.getAttribute('href');
      return href ? new URL(href, location.href).pathname : '';
    });
    if (!stylesheetPath) {
      failures.push('site exposes a stylesheet for non-HTML fallback smoke');
    } else {
      await page.evaluate((href) => {
        const link = document.createElement('a');
        link.id = 'synthetic-non-html-link';
        link.href = href;
        link.textContent = 'Stylesheet';
        document.body.append(link);
      }, stylesheetPath);
      await assertFallbackNavigation(
        page,
        () => page.click('#synthetic-non-html-link'),
        stylesheetPath,
        'same-origin non-HTML response falls back to full navigation',
      );
    }
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
