import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';

describe('server static export', () => {
  it('exports a simple route through the app request handler to an html artifact', async () => {
    const app = createApp({
      document: {
        template({ parts }) {
          return [
            '<!doctype html>',
            '<html>',
            `<head>${parts.head}</head>`,
            `<body data-export-shell>${parts.body}</body>`,
            '</html>',
          ].join('');
        },
      },
      routes: [
        route('/about', {
          meta: { title: 'About' },
          page: () => '<main>About Kovo</main>',
        }),
      ],
    });

    const result = await exportStaticApp(app);

    expect(result.clientModules).toEqual([
      expect.objectContaining({
        path: expect.stringMatching(/^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/),
        status: 200,
      }),
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      headers: { 'content-type': 'text/html; charset=utf-8' },
      path: '/about/index.html',
      status: 200,
    });
    expect(result.artifacts[0]?.body).toContain('<title>About</title>');
    expect(result.artifacts[0]?.body).toContain('<body data-export-shell><main>About Kovo</main>');
  });

  it('uses the same handler and document assembly rather than a second render path', async () => {
    const app = createApp({
      renderRoute(value, context) {
        return `<main data-url="${new URL(context.request.url).pathname}">${String(value)}</main>`;
      },
      routes: [
        route('/', {
          page: () => 'from-page',
        }),
      ],
    });
    const handler = createRequestHandler(app);

    const exported = await exportStaticApp(app);
    const handled = await handler(new Request('https://kovo.local/'));

    expect(exported.artifacts[0]?.path).toBe('/index.html');
    expect(exported.clientModules).toEqual([
      expect.objectContaining({
        path: expect.stringMatching(/^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/),
        status: 200,
      }),
    ]);
    await expect(handled.text()).resolves.toBe(exported.artifacts[0]?.body);
    expect(exported.artifacts[0]?.body).toContain('<main data-url="/">from-page</main>');
    expect(exported.artifacts[0]?.body).toContain('installInlineKovoBootstrap');
    expect(exported.artifacts[0]?.body).toContain('/kovo-runtime.client.js');
  });

  it('writes replayed html artifacts under the configured output directory', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const app = createApp({
        renderRoute(value, context) {
          return `<main data-route="${context.route.path}">${String(value)}</main>`;
        },
        routes: [
          route('/', {
            page: () => 'home',
          }),
          route('/docs/intro', {
            page: () => 'intro',
          }),
        ],
      });

      const result = await exportStaticApp(app, { outDir: pathToFileURL(outDir) });

      expect(result.clientModules).toEqual([
        expect.objectContaining({
          path: expect.stringMatching(/^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/),
          status: 200,
        }),
      ]);
      expect(result.diagnostics).toEqual([]);
      expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
        '/index.html',
        '/docs/intro/index.html',
      ]);
      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toBe(
        result.artifacts[0]?.body,
      );
      await expect(
        readFile(path.join(outDir, 'docs', 'intro', 'index.html'), 'utf8'),
      ).resolves.toBe(result.artifacts[1]?.body);
      expect(result.artifacts[1]?.body).toContain('<main data-route="/docs/intro">intro</main>');
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });
});
