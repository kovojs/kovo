import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { guards, route } from './index.js';
import { exportStaticApp, StaticExportError } from './static-export.js';

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
          page: () => '<main>About Jiso</main>',
        }),
      ],
    });

    const result = await exportStaticApp(app);

    expect(result.diagnostics).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      headers: { 'content-type': 'text/html; charset=utf-8' },
      path: '/about.html',
      status: 200,
    });
    expect(result.artifacts[0]?.body).toContain('<title>About</title>');
    expect(result.artifacts[0]?.body).toContain('<body data-export-shell><main>About Jiso</main>');
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
    const handled = await handler(new Request('https://jiso.local/'));

    expect(exported.artifacts[0]?.path).toBe('/index.html');
    await expect(handled.text()).resolves.toBe(exported.artifacts[0]?.body);
    expect(exported.artifacts[0]?.body).toContain('<main data-url="/">from-page</main>');
    expect(exported.artifacts[0]?.body).toContain('installInlineJisoLoader');
  });

  it('writes replayed html artifacts under the configured output directory', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
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

      expect(result.diagnostics).toEqual([]);
      expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
        '/index.html',
        '/docs/intro.html',
      ]);
      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toBe(
        result.artifacts[0]?.body,
      );
      await expect(readFile(path.join(outDir, 'docs/intro.html'), 'utf8')).resolves.toBe(
        result.artifacts[1]?.body,
      );
      expect(result.artifacts[1]?.body).toContain('<main data-route="/docs/intro">intro</main>');
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('fails loudly for guarded and session-provider routes', async () => {
    const guardedApp = createApp({
      routes: [
        route('/account', {
          guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
          page: () => '<main>Account</main>',
        }),
      ],
    });

    await expect(exportStaticApp(guardedApp)).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          routePath: '/account',
          message: expect.stringContaining('guarded route'),
        },
      ],
    });

    const sessionApp = createApp({
      routes: [route('/profile', { page: () => '<main>Profile</main>' })],
      sessionProvider: () => ({ user: { id: 'u1' } }),
    });

    await expect(exportStaticApp(sessionApp)).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          routePath: '/profile',
          message: expect.stringContaining('sessionProvider'),
        },
      ],
    });
  });

  it('fails or skips loudly for param routes without static-path metadata', async () => {
    const app = createApp({
      routes: [
        route('/products/:id', {
          page: () => '<main>Product</main>',
        }),
      ],
    });

    await expect(exportStaticApp(app)).rejects.toBeInstanceOf(StaticExportError);
    await expect(exportStaticApp(app)).rejects.toMatchObject({
      diagnostics: [
        {
          code: 'FW229',
          routePath: '/products/:id',
          message: expect.stringContaining('static-path metadata'),
        },
      ],
    });

    await expect(exportStaticApp(app, { onNonExportable: 'skip' })).resolves.toEqual({
      artifacts: [],
      diagnostics: [
        {
          code: 'FW229',
          routePath: '/products/:id',
          message: expect.stringContaining('static-path metadata'),
        },
      ],
    });
  });
});
