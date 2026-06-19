// SPEC.md §9.5: static export is synthetic GET replay through the app handler.
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { exportStaticApp } from '@kovojs/server';
import { expect, test } from '@kovojs/test/internal/integration';

import {
  createStaticExportL0L1App,
  type StaticExportRenderCounter,
} from '../fixtures/static-export-l0-l1/app';

test.use({ kovoFixture: 'static-export-l0-l1' });

test('exports L0/L1 documents and serves them without a second render path', async ({ page }) => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'kovo-static-export-l0-l1-'));
  const counter: StaticExportRenderCounter = { renders: 0 };
  const app = createStaticExportL0L1App(counter);

  try {
    const result = await exportStaticApp(app, { outDir });

    expect(result.diagnostics).toEqual([]);
    expect(result.artifacts.map((artifact) => artifact.path).sort()).toEqual([
      '/docs/index.html',
      '/index.html',
      '/search/index.html',
    ]);
    expect(result.clientModules.map((artifact) => artifact.path).sort()).toEqual([
      '/c/__v/static-export-analytics-1/static-export-analytics.client.js',
      '/c/__v/static-export-docs-1/static-export-docs.client.js',
    ]);
    expect(counter.renders).toBe(3);

    await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain(
      '<main data-page="home">',
    );
    await expect(
      readFile(
        path.join(
          outDir,
          'c',
          '__v',
          'static-export-analytics-1',
          'static-export-analytics.client.js',
        ),
        'utf8',
      ),
    ).resolves.toBe('export const staticExportAnalytics = true;');
    await expect(
      readFile(
        path.join(outDir, 'c', '__v', 'static-export-docs-1', 'static-export-docs.client.js'),
        'utf8',
      ),
    ).resolves.toBe('export const staticExportDocs = true;');

    const server = await serveStaticDirectory(outDir);
    try {
      await page.goto(`${server.origin}/`);
      await expect(page.getByRole('heading', { name: 'Static Export Home' })).toBeVisible();
      await expect(page.locator('#docs-link')).toHaveAttribute('href', '/docs/');

      await page.locator('#docs-link').click();
      await expect(page).toHaveURL(`${server.origin}/docs/`);
      await expect(page.getByRole('heading', { name: 'Exported Docs' })).toBeVisible();

      await page.goto(`${server.origin}/`);
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page).toHaveURL(`${server.origin}/search?q=kovo`);
      await expect(page.getByRole('heading', { name: 'Exported Search' })).toBeVisible();
      expect(counter.renders).toBe(3);
    } finally {
      await server.close();
    }
  } finally {
    await rm(outDir, { force: true, recursive: true });
  }
});

async function serveStaticDirectory(root: string): Promise<{
  close(): Promise<void>;
  origin: string;
}> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://static.local');
      if (url.pathname.startsWith('/c/')) {
        const filePath = path.join(root, url.pathname);
        if (!filePath.startsWith(root)) {
          response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Forbidden');
          return;
        }

        const info = await stat(filePath);
        if (!info.isFile()) throw new Error('not a file');
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        createReadStream(filePath).pipe(response);
        return;
      }

      const directoryPath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
      const filePath = path.join(root, directoryPath, 'index.html');
      if (!filePath.startsWith(root)) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Forbidden');
        return;
      }

      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('not a file');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      createReadStream(filePath).pipe(response);
    })().catch(() => {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (typeof address === 'object' && address !== null) resolve(address.port);
      else reject(new Error('static export server did not expose a port'));
    });
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    origin: `http://127.0.0.1:${port}`,
  };
}
