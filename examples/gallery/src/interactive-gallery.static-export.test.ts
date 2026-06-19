import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';

const galleryRoot = fileURLToPath(new URL('../', import.meta.url));

describe('compiled interactive gallery static export', () => {
  it('runs shipped client handlers from the verbatim static export without shims', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-gallery-static-export-'));
    let browser: Browser | undefined;
    let server: Server | undefined;

    try {
      execFileSync(process.execPath, ['scripts/export-static.mjs', '--out', outDir], {
        cwd: galleryRoot,
        stdio: 'pipe',
      });

      const html = await readFile(join(outDir, 'gallery/interactive/index.html'), 'utf8');
      expect(html).not.toContain('type="importmap"');
      expect(html).not.toContain('@kovojs/browser');

      server = await serveStaticExport(outDir);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Static export test server did not bind to a TCP port.');
      }

      browser = await chromium.launch();
      const page = await browser.newPage();
      const errors: string[] = [];
      const failedUrls = new Set<string>();

      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
          errors.push(message.text());
        }
      });
      page.on('requestfailed', (request) => {
        if (!ignoredMissingAssetUrl(request.url())) failedUrls.add(request.url());
      });
      page.on('response', (response) => {
        if (response.status() >= 400 && !ignoredMissingAssetUrl(response.url())) {
          failedUrls.add(response.url());
        }
      });

      await page.goto(`http://127.0.0.1:${address.port}/gallery/interactive/`, {
        waitUntil: 'networkidle',
      });

      await clickAndWaitForState(
        page,
        '[data-gallery-interactive="accordion"]',
        '#gallery-accordion-billing-trigger',
        '"value":"billing"',
      );
      await focusKeyAndWaitForState(
        page,
        '[data-gallery-interactive="combobox"]',
        '#gallery-combobox-input',
        'ArrowDown',
        '"open":true',
      );
      await contextMenuAndWaitForState(
        page,
        '[data-gallery-interactive="context-menu"]',
        '#gallery-context-menu-trigger',
        '"open":true',
      );
      await hoverAndWaitForState(
        page,
        '[data-gallery-interactive="tooltip"]',
        '[data-gallery-interactive="tooltip"] button',
        '"open":true',
      );

      expect(errors).toEqual([]);
      expect([...failedUrls]).toEqual([]);
    } finally {
      await browser?.close();
      await closeServer(server);
      await rm(outDir, { force: true, recursive: true });
    }
  }, 120_000);
});

async function clickAndWaitForState(
  page: Page,
  rootSelector: string,
  targetSelector: string,
  expectedStateFragment: string,
): Promise<void> {
  await page.locator(rootSelector).scrollIntoViewIfNeeded();
  await page.locator(targetSelector).click();
  await waitForState(page, rootSelector, expectedStateFragment);
}

async function focusKeyAndWaitForState(
  page: Page,
  rootSelector: string,
  targetSelector: string,
  key: string,
  expectedStateFragment: string,
): Promise<void> {
  await page.locator(rootSelector).scrollIntoViewIfNeeded();
  await page.locator(targetSelector).focus();
  await page.keyboard.press(key);
  await waitForState(page, rootSelector, expectedStateFragment);
}

async function contextMenuAndWaitForState(
  page: Page,
  rootSelector: string,
  targetSelector: string,
  expectedStateFragment: string,
): Promise<void> {
  await page.locator(rootSelector).scrollIntoViewIfNeeded();
  await page.locator(targetSelector).click({ button: 'right' });
  await waitForState(page, rootSelector, expectedStateFragment);
}

async function hoverAndWaitForState(
  page: Page,
  rootSelector: string,
  targetSelector: string,
  expectedStateFragment: string,
): Promise<void> {
  await page.locator(rootSelector).scrollIntoViewIfNeeded();
  await page.locator(targetSelector).dispatchEvent('pointerover', {
    bubbles: true,
    cancelable: true,
  });
  await waitForState(page, rootSelector, expectedStateFragment);
}

async function waitForState(
  page: Page,
  rootSelector: string,
  expectedStateFragment: string,
): Promise<void> {
  await page.waitForFunction(
    ({ rootSelector: selector, expected }) =>
      document.querySelector(selector)?.getAttribute('kovo-state')?.includes(expected) ?? false,
    { expected: expectedStateFragment, rootSelector },
  );
}

async function serveStaticExport(root: string): Promise<Server> {
  const contentTypes: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
  };
  const server = createServer(async (request, response) => {
    try {
      const filePath = staticExportFilePath(root, request.url ?? '/');
      if (!filePath || !existsSync(filePath)) {
        response.statusCode = 404;
        response.end('404');
        return;
      }

      response.setHeader(
        'Content-Type',
        contentTypes[extname(filePath)] ?? 'application/octet-stream',
      );
      response.end(await readFile(filePath));
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function staticExportFilePath(root: string, requestUrl: string): string | null {
  let pathname = decodeURIComponent(requestUrl.split('?')[0] || '/');
  if (pathname === '/' || (pathname.startsWith('/gallery/interactive') && !extname(pathname))) {
    pathname = '/gallery/interactive/index.html';
  }

  const filePath = normalize(join(root, pathname.replace(/^\/+/, '')));
  return filePath === root || filePath.startsWith(`${root}${sep}`) ? filePath : null;
}

function ignoredMissingAssetUrl(url: string): boolean {
  return (
    url.endsWith('/favicon.ico') ||
    (url.endsWith('/assets/site.css') &&
      !existsSync(join(galleryRoot, '../../site/dist-css/assets/site.css'))) ||
    /\/fonts\/[^/]+\.woff2$/.test(url)
  );
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
