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
    (await noJsPage.locator('.tagline').textContent())?.includes('hands your agent the fix'),
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

  await page.click('button[on\\:click^="/c/search.js"]');
  await page.waitForFunction(() => document.getElementById('site-search')?.open === true);
  check(scriptRequests.includes('/c/search.js'), 'JS: search module loads on first interaction');

  await page.fill('#site-search input', 'mutation');
  await page.waitForFunction(
    () => (document.getElementById('site-search-results')?.children.length ?? 0) > 0,
  );
  const firstResult = await page.locator('#site-search-results a').first().getAttribute('href');
  check(Boolean(firstResult?.startsWith('/')), 'JS: search returns linked results');
  check(scriptRequests.includes('/search-index.json'), 'JS: index fetched on demand');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  await page.waitForFunction(() => document.getElementById('site-search')?.open === true);
  check(true, 'JS: ⌘K reopens after first use');

  const galleryScripts = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/c/examples/gallery/src/generated/interactive/')) {
      galleryScripts.push(url.pathname);
    }
  });
  await page.goto(`${origin}/gallery/interactive/`, { waitUntil: 'networkidle' });
  check(
    await page
      .locator('main[data-gallery-route="/gallery/interactive"]')
      .count()
      .then((count) => count === 1),
    'JS: interactive gallery route renders',
  );
  const accordionButton = page
    .locator('#accordion-demo button[on\\:click*="accordion-demo.client.js"]')
    .first();
  await accordionButton.click();
  await page.waitForFunction(
    () => document.querySelector('#accordion-demo [data-state="open"]') !== null,
  );
  check(
    galleryScripts.includes(
      '/c/examples/gallery/src/generated/interactive/accordion-demo.client.js',
    ),
    'JS: interactive gallery client module loads on interaction',
  );
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
