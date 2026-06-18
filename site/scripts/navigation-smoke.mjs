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
      return localStorage.getItem('theme') === expected && (expected === 'dark' ? dark : !dark);
    }, theme),
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
  await page.click('button[on\\:click^="/c/theme.js"]');
  await page.waitForFunction(
    () =>
      document.documentElement.classList.contains('dark') &&
      localStorage.getItem('theme') === 'dark',
  );
  await page.click('.site-nav a[href="/reference/"]');
  await page.waitForFunction(() => location.pathname === '/reference/');
  await assertTheme(page, 'dark');

  await page.click('button[on\\:click^="/c/theme.js"]');
  await page.waitForFunction(
    () =>
      !document.documentElement.classList.contains('dark') &&
      localStorage.getItem('theme') === 'light',
  );
  await page.click('.site-nav a[href="/docs/why-kovo/"]');
  await page.waitForFunction(() => location.pathname === '/docs/why-kovo/');
  await assertTheme(page, 'light');

  await page.goto(`${origin}/api/core/`, { waitUntil: 'networkidle' });
  const railLink = page.locator('.api-nav li > a:first-child').nth(10);
  const hash = await railLink.getAttribute('href');
  if (!hash) {
    failures.push('API rail exposes a symbol hash');
  } else {
    await railLink.click();
    await page.waitForFunction((expectedHash) => location.hash === expectedHash, hash);
    await assertHashBelowHeader(page, hash, 'same-page API rail hash lands below sticky header');

    await page.goto(`${origin}/docs/mental-model/`, { waitUntil: 'networkidle' });
    await page.evaluate((targetHash) => {
      const link = document.createElement('a');
      link.id = 'synthetic-api-symbol-link';
      link.href = `/api/core/${targetHash}`;
      link.textContent = 'API symbol';
      document.body.append(link);
    }, hash);
    await page.click('#synthetic-api-symbol-link');
    await page.waitForFunction(
      (expectedHash) => location.pathname === '/api/core/' && location.hash === expectedHash,
      hash,
    );
    await assertHashBelowHeader(page, hash, 'cross-page API rail hash lands below sticky header');
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
