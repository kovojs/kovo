import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

/**
 * Browser smoke gate (plan W8/W9): against the exported site, prove
 *  1. pages render and navigate with JavaScript disabled (degradation
 *     contract, SPEC §8);
 *  2. zero handler-module JS loads before first interaction (SPEC §4.4);
 *  3. the ⌘K island works after interaction: module loads on click, the
 *     index is fetched once, queries return results.
 */

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));

const MIME = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

function fileFor(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/^\//, '');
  if (clean === '') return path.join(distDir, 'index.html');
  if (clean.endsWith('/')) return path.join(distDir, clean, 'index.html');
  if (path.extname(clean)) return path.join(distDir, clean);
  return path.join(distDir, clean, 'index.html');
}

const failures = [];

function check(condition, label) {
  if (condition) process.stdout.write(`ok ${label}\n`);
  else failures.push(label);
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
  // 1. No-JS pass: landing renders, nav reaches a docs page, content present.
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const noJsPage = await noJs.newPage();
  await noJsPage.goto(`${origin}/`);
  check(
    (await noJsPage.locator('h1').first().textContent())?.includes('KOVO'),
    'no-JS: landing hero renders',
  );
  check(
    (await noJsPage.locator('body').textContent())?.includes('hands your agent the fix'),
    'no-JS: landing tagline renders',
  );
  await noJsPage.click('a[href="/docs/installation/"]');
  check(
    (await noJsPage.locator('h1').first().textContent())?.includes('Installation'),
    'no-JS: navigation to docs works',
  );
  await noJsPage.goto(`${origin}/spec/`);
  check(
    await noJsPage
      .locator('[id="6-4"]')
      .count()
      .then((count) => count === 1),
    'no-JS: spec § anchors exist',
  );
  await noJs.close();

  // 2 + 3. JS pass: nothing loads before interaction; island works after.
  const context = await browser.newContext();
  const page = await context.newPage();
  const scriptRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/c/') || url.pathname === '/search-index.json') {
      scriptRequests.push(url.pathname);
    }
  });

  await page.goto(`${origin}/docs/mental-model/`, { waitUntil: 'networkidle' });
  check(scriptRequests.length === 0, 'JS: zero island bytes before first interaction');

  await page.click('button[on\\:click$="search.js#open"]');
  await page.waitForFunction(() => document.getElementById('site-search')?.open === true);
  check(
    scriptRequests.some((script) => script.endsWith('/search.js')),
    'JS: search module loads on first interaction',
  );
  check(
    (await page.locator('#site-search-results li[data-active="true"] a').getAttribute('href')) ===
      '/docs/quickstart/',
    'JS: search zero-state suggests useful links',
  );

  await page.fill('#site-search input', 'zzzz-no-results');
  await page.waitForFunction(() =>
    document
      .querySelector('#site-search-results [data-search-empty]')
      ?.textContent?.includes('No matching docs'),
  );
  check(
    (await page.locator('#site-search-results a[href="/api/"]').count()) === 1,
    'JS: search empty-state keeps suggested links',
  );

  await page.fill('#site-search input', 'mutation');
  await page.waitForFunction(() => {
    const links = [...document.querySelectorAll('#site-search-results a')];
    return links.length > 1 && links[0]?.getAttribute('href') !== '/docs/quickstart/';
  });
  const firstResult = await page.locator('#site-search-results a').first().getAttribute('href');
  check(Boolean(firstResult?.startsWith('/')), 'JS: search returns linked results');
  const secondResult = await page.locator('#site-search-results a').nth(1).getAttribute('href');
  await page.locator('#site-search input').press('ArrowDown');
  await page.waitForFunction(
    (href) =>
      document
        .querySelector('#site-search-results li[data-active="true"] a')
        ?.getAttribute('href') === href,
    secondResult,
  );
  check(
    (await page.locator('#site-search-results li[data-active="true"] a').getAttribute('href')) ===
      secondResult,
    'JS: search keyboard ArrowDown selects next result',
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction((href) => location.pathname + location.hash === href, secondResult);
  check(true, 'JS: search keyboard Enter opens active result');
  check(scriptRequests.includes('/search-index.json'), 'JS: index fetched on demand');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  await page.waitForFunction(() => document.getElementById('site-search')?.open === true);
  check(true, 'JS: ⌘K reopens after first use');
  await page.keyboard.press('Escape');

  await page.click('button[on\\:click$="theme.js#toggle"]');
  await page.waitForFunction(
    () =>
      document.documentElement.classList.contains('dark') &&
      localStorage.getItem('theme') === 'dark',
  );
  await page.click('a[href="/reference/"]');
  await page.waitForFunction(() => location.pathname === '/reference/');
  check(
    await page.evaluate(
      () =>
        document.documentElement.classList.contains('dark') &&
        localStorage.getItem('theme') === 'dark',
    ),
    'JS: theme choice survives enhanced docs navigation',
  );
  await page.click('main a[href="/api/"]');
  await page.waitForFunction(() => location.pathname === '/api/');
  check(
    await page.evaluate(
      () =>
        document.documentElement.classList.contains('dark') &&
        localStorage.getItem('theme') === 'dark',
    ),
    'JS: theme choice survives enhanced API navigation',
  );
  await page.click('main a[href="/api/core/"]:visible');
  await page.waitForFunction(() => location.pathname === '/api/core/');

  const apiSymbolLink = page.locator('[data-api-nav] li > a:first-child').nth(10);
  const apiSymbolHref = await apiSymbolLink.getAttribute('href');
  await apiSymbolLink.click();
  await page.waitForFunction((hash) => location.hash === hash, apiSymbolHref);
  check(
    await page.evaluate((hash) => {
      if (!hash) return false;
      const raw = hash.slice(1);
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch {}
      const target =
        document.getElementById(decoded) ??
        document.getElementById(raw) ??
        document.getElementsByName(decoded)[0] ??
        document.getElementsByName(raw)[0];
      const header = document.querySelector('[data-site-bar]');
      if (!target || !header) return false;
      const targetTop = target.getBoundingClientRect().top;
      const headerBottom = header.getBoundingClientRect().bottom;
      return targetTop >= headerBottom - 1 && targetTop < window.innerHeight;
    }, apiSymbolHref),
    'JS: API symbol rail hash lands below sticky header',
  );

  const galleryScripts = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/c/') && url.pathname.includes('/interactive/')) {
      galleryScripts.push(url.pathname);
    }
  });
  // The interactive demos are folded into the component gallery pages; the
  // accordion page carries the compiled demo (wrapped as #accordion-demo).
  await page.goto(`${origin}/gallery/components/accordion/`, { waitUntil: 'networkidle' });
  check(
    await page
      .locator('#accordion-demo')
      .count()
      .then((count) => count === 1),
    'JS: folded accordion gallery page renders the interactive demo',
  );
  const accordionButton = page
    .locator('#accordion-demo button[on\\:click*="accordion-demo.client.js"]')
    .first();
  await accordionButton.click();
  await page.waitForFunction(
    () => document.querySelector('#accordion-demo [data-state="open"]') !== null,
  );
  check(
    galleryScripts.some((script) => script.endsWith('/interactive/accordion-demo.client.js')),
    'JS: interactive gallery client module loads on interaction',
  );
  await page.goto(`${origin}/gallery/components/toggle/`, { waitUntil: 'networkidle' });
  const toggleButton = page.locator('#toggle-demo button[on\\:click*="toggle-demo.client.js"]');
  await toggleButton.click();
  await page.waitForFunction(
    () =>
      document.querySelector('#toggle-demo [data-demo-state="pressed"]')?.textContent === 'pressed',
  );
  check(
    galleryScripts.some((script) => script.endsWith('/interactive/toggle-demo.client.js')),
    'JS: folded toggle gallery page runs the compiled handler',
  );

  // Examples: public demo services are configured as sandboxed iframes while the
  // authored source stays visible beside them (SPEC §9.5). The Pages smoke gate
  // must not depend on third-party service uptime or app-internal markers.
  const EMBED_CHECKS = ['commerce', 'crm', 'stackoverflow'];
  for (const embed of EMBED_CHECKS) {
    await page.goto(`${origin}/examples/${embed}/`, { waitUntil: 'domcontentloaded' });
    check(
      (await page.locator('[data-example-panel] .code-window').count()) >= 2,
      `JS: ${embed} example shows authored source windows`,
    );
    check(
      Boolean(await page.locator('iframe[title$=" running app"]').getAttribute('src')),
      `JS: ${embed} example configures a sandboxed app iframe`,
    );
  }

  await context.close();
} finally {
  await browser.close();
  server.close();
}

if (failures.length > 0) {
  process.stderr.write(`site-smoke/v1\nFAIL ${failures.join(' | ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('site-smoke/v1\nOK\n');
}
