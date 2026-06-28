import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { stylesheet } from './hints.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';
import { renderedHtml } from './html.js';

const sriSha384 = (source: string | Buffer): string =>
  `sha384-${createHash('sha384').update(source).digest('base64')}`;

describe('server static export', () => {
  it('rejects non-file static asset source URLs before synthetic route replay', async () => {
    let rendered = false;
    const app = createApp({
      routes: [
        route('/', {
          page: () => {
            rendered = true;
            return renderedHtml('<main>Home</main>');
          },
        }),
      ],
    });

    await expect(
      exportStaticApp(app, {
        assets: [
          {
            path: '/assets/app.css',
            source: new URL('https://cdn.example.test/app.css'),
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining('Static asset sources must be filesystem paths'),
          routePath: '/assets/app.css',
        },
      ],
    });
    expect(rendered).toBe(false);
  });

  it('copies configured static assets with exact bytes and represented headers', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-assets-'));
    try {
      const cssSource = path.join(sourceDir, 'app.css');
      const iconSource = path.join(sourceDir, 'icon.bin');
      const iconBytes = Buffer.from([0, 1, 2, 255]);
      await writeFile(cssSource, 'body { color: rebeccapurple; }\n', 'utf8');
      await writeFile(iconSource, iconBytes);
      const app = createApp({
        routes: [
          route('/', {
            stylesheets: ['/assets/app.css'],
            page: () => trustedHtml('<main>Home</main>'),
          }),
        ],
      });

      const result = await exportStaticApp(app, {
        assets: [
          {
            contentType: 'text/css; charset=utf-8',
            path: '/assets/app.css',
            source: cssSource,
          },
          {
            headers: { 'cache-control': 'public, max-age=31536000' },
            path: '/assets/icons/icon.bin',
            source: pathToFileURL(iconSource),
          },
        ],
        outDir,
      });

      expect(result.assets).toEqual([
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          path: '/assets/app.css',
          source: cssSource,
          status: 200,
        },
        {
          headers: { 'cache-control': 'public, max-age=31536000' },
          path: '/assets/icons/icon.bin',
          source: iconSource,
          status: 200,
        },
      ]);
      await expect(readFile(path.join(outDir, 'assets/app.css'), 'utf8')).resolves.toBe(
        'body { color: rebeccapurple; }\n',
      );
      await expect(readFile(path.join(outDir, 'assets/icons/icon.bin'))).resolves.toEqual(
        iconBytes,
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('adds sha384 integrity to exported first-party module and stylesheet tags with known bytes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-assets-'));
    try {
      const appCss = 'body { color: black; }\n';
      const asyncCss = '.cart { color: teal; }\n';
      const moduleSource = 'export const cart = "sri";';
      const appCssSource = path.join(sourceDir, 'app.css');
      const asyncCssSource = path.join(sourceDir, 'async.css');
      await writeFile(appCssSource, appCss, 'utf8');
      await writeFile(asyncCssSource, asyncCss, 'utf8');

      const registry = createMemoryVersionedClientModuleRegistry();
      const cartHref = registry.put({
        path: '/c/cart.client.js',
        source: moduleSource,
        version: 'cart-sri',
      });
      const app = createApp({
        routes: [
          route('/', {
            bootstrapScript: cartHref,
            modulepreloads: [cartHref],
            page: () => trustedHtml('<main>Home</main>'),
            stylesheets: [
              '/assets/app.css',
              stylesheet('./async.css', { deferFull: true, href: '/assets/async.css' }),
            ],
          }),
        ],
      });
      app.clientModules = registry;

      const result = await exportStaticApp(app, {
        assets: [
          {
            contentType: 'text/css; charset=utf-8',
            path: '/assets/app.css',
            source: appCssSource,
          },
          {
            contentType: 'text/css; charset=utf-8',
            path: '/assets/async.css',
            source: asyncCssSource,
          },
        ],
        outDir,
      });

      const html = result.artifacts[0]?.body ?? '';
      const appIntegrity = sriSha384(appCss);
      const asyncIntegrity = sriSha384(asyncCss);
      const moduleIntegrity = sriSha384(moduleSource);

      expect(html).toContain(
        `<link rel="stylesheet" href="/assets/app.css" integrity="${appIntegrity}">`,
      );
      expect(html).toContain(
        `<link rel="preload" as="style" href="/assets/async.css" data-kovo-deferred-style integrity="${asyncIntegrity}">`,
      );
      expect(html).toContain(
        `<noscript><link rel="stylesheet" href="/assets/async.css" integrity="${asyncIntegrity}"></noscript>`,
      );
      expect(html).toContain(
        `<link rel="modulepreload" href="${cartHref}" integrity="${moduleIntegrity}">`,
      );
      expect(html).toContain(
        `<script type="module" src="${cartHref}" integrity="${moduleIntegrity}"></script>`,
      );
      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toBe(html);
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('returns configured static asset metadata without requiring an output directory', async () => {
    const app = createApp({
      routes: [
        route('/', {
          stylesheets: ['/assets/app.css'],
          page: () => trustedHtml('<main>Home</main>'),
        }),
      ],
    });

    const result = await exportStaticApp(app, {
      assets: [
        {
          contentType: 'text/css; charset=utf-8',
          path: '/assets/app.css',
          source: '/workspace/dist/assets/app.css',
        },
      ],
    });

    expect(result.assets).toEqual([
      {
        headers: { 'content-type': 'text/css; charset=utf-8' },
        path: '/assets/app.css',
        source: '/workspace/dist/assets/app.css',
        status: 200,
      },
    ]);
    expect(result.artifacts.map((artifact) => artifact.path)).toEqual(['/index.html']);
  });

  it('copies document-referenced public assets from a configured public asset root', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    const publicRoot = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-public-'));
    try {
      await writeFile(path.join(publicRoot, 'mark.svg'), '<svg viewBox="0 0 1 1"></svg>', 'utf8');
      await writeFile(path.join(publicRoot, 'note.txt'), 'public note\n', 'utf8');
      const app = createApp({
        routes: [
          route('/', {
            page: () =>
              trustedHtml('<main><img src="/mark.svg" alt=""><a href="/note.txt">Note</a></main>'),
          }),
        ],
      });

      const result = await exportStaticApp(app, { outDir, publicAssetRoot: publicRoot });

      expect(result.assets).toEqual([
        { headers: {}, path: '/mark.svg', source: path.join(publicRoot, 'mark.svg'), status: 200 },
        { headers: {}, path: '/note.txt', source: path.join(publicRoot, 'note.txt'), status: 200 },
      ]);
      await expect(readFile(path.join(outDir, 'mark.svg'), 'utf8')).resolves.toBe(
        '<svg viewBox="0 0 1 1"></svg>',
      );
      await expect(readFile(path.join(outDir, 'note.txt'), 'utf8')).resolves.toBe('public note\n');
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(publicRoot, { force: true, recursive: true });
    }
  });

  it('copies public assets referenced by exported CSS url(...) values', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    const publicRoot = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-public-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-assets-'));
    try {
      await mkdir(path.join(publicRoot, 'icons'), { recursive: true });
      await writeFile(path.join(publicRoot, 'static-bg.txt'), 'css public bg\n', 'utf8');
      await writeFile(path.join(publicRoot, 'icons', 'mark.svg'), '<svg></svg>', 'utf8');
      const cssSource = path.join(sourceDir, 'styles.css');
      await writeFile(
        cssSource,
        [
          '.hero { background: url("/static-bg.txt"); }',
          '.mark { background: url(../icons/mark.svg#logo); }',
          '.hash { background: url("#paint"); }',
          '.data { background: url(data:image/png;base64,aaaa); }',
          '.external { background: url("https://cdn.example.test/bg.png"); }',
          '.built { background: url("/assets/chunk.png"); }',
        ].join('\n'),
        'utf8',
      );
      const app = createApp({
        routes: [
          route('/', {
            page: () => trustedHtml('<main>Home</main>'),
            stylesheets: ['/assets/styles.css'],
          }),
        ],
      });

      const result = await exportStaticApp(app, {
        assets: [
          {
            contentType: 'text/css; charset=utf-8',
            path: '/assets/styles.css',
            source: cssSource,
          },
        ],
        outDir,
        publicAssetRoot: publicRoot,
      });

      expect(result.assets.map((asset) => asset.path)).toEqual([
        '/assets/styles.css',
        '/icons/mark.svg',
        '/static-bg.txt',
      ]);
      await expect(readFile(path.join(outDir, 'static-bg.txt'), 'utf8')).resolves.toBe(
        'css public bg\n',
      );
      await expect(readFile(path.join(outDir, 'icons', 'mark.svg'), 'utf8')).resolves.toBe(
        '<svg></svg>',
      );
      await expect(readFile(path.join(outDir, 'assets', 'chunk.png'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(publicRoot, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('rejects missing document-referenced public assets before writing output', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    const publicRoot = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-public-'));
    try {
      const app = createApp({
        routes: [
          route('/', {
            page: () => trustedHtml('<main><img src="/missing.svg" alt=""></main>'),
          }),
        ],
      });

      await expect(
        exportStaticApp(app, { outDir, publicAssetRoot: publicRoot }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining("referenced public asset '/missing.svg'"),
            routePath: '/missing.svg',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(publicRoot, { force: true, recursive: true });
    }
  });

  it('replays app-wide stylesheets into static route documents', async () => {
    const app = createApp({
      routes: [
        route('/', {
          stylesheets: [stylesheet('./home.css')],
          page: () => trustedHtml('<main>Home</main>'),
        }),
      ],
      stylesheets: [stylesheet('./styles.css')],
    });

    const result = await exportStaticApp(app);

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.body).toContain(
      '<link rel="stylesheet" href="/assets/styles.css">',
    );
    expect(result.artifacts[0]?.body).toContain('<link rel="stylesheet" href="/assets/home.css">');
    expect(result.artifacts[0]?.headers.link).toBe(
      '</assets/styles.css>; rel=preload; as=style, </assets/home.css>; rel=preload; as=style',
    );
  });

  it('rejects duplicate static asset paths during dry-run inventory planning', async () => {
    const app = createApp({
      routes: [route('/', { page: () => trustedHtml('<main>Home</main>') })],
    });

    await expect(
      exportStaticApp(app, {
        assets: [
          { path: '/assets/app.css', source: '/workspace/dist/assets/app.css' },
          { path: '/assets/app.css', source: '/workspace/public/app.css' },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining(
            "static asset '/assets/app.css' because it conflicts with static asset '/assets/app.css'",
          ),
          routePath: '/assets/app.css',
        },
      ],
    });
  });

  it('rejects unsafe static asset output paths before copying', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-assets-'));
    try {
      const source = path.join(sourceDir, 'app.css');
      await writeFile(source, 'body {}\n', 'utf8');
      const app = createApp({
        routes: [route('/', { page: () => trustedHtml('<main>Home</main>') })],
      });

      await expect(
        exportStaticApp(app, {
          assets: [{ path: '/assets/%2e%2e/app.css', source }],
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining('unsafe static asset path segment'),
            routePath: '%2e%2e',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('rejects static asset output conflicts with generated export files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-assets-'));
    try {
      const source = path.join(sourceDir, 'index.html');
      await writeFile(source, '<p>asset</p>', 'utf8');
      const app = createApp({
        routes: [route('/', { page: () => trustedHtml('<main>Home</main>') })],
      });

      await expect(
        exportStaticApp(app, {
          assets: [{ path: '/index.html', source }],
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining(
              "static asset '/index.html' because it conflicts with route document '/index.html'",
            ),
            routePath: '/index.html',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('rejects duplicate static asset output paths', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-assets-'));
    try {
      const firstSource = path.join(sourceDir, 'first.css');
      const secondSource = path.join(sourceDir, 'second.css');
      await writeFile(firstSource, 'body { color: red; }\n', 'utf8');
      await writeFile(secondSource, 'body { color: blue; }\n', 'utf8');
      const app = createApp({
        routes: [route('/', { page: () => trustedHtml('<main>Home</main>') })],
      });

      await expect(
        exportStaticApp(app, {
          assets: [
            { path: '/assets/app.css', source: firstSource },
            { path: '/assets/app.css', source: secondSource },
          ],
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining(
              "static asset '/assets/app.css' because it conflicts with static asset '/assets/app.css'",
            ),
            routePath: '/assets/app.css',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'assets/app.css'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('rejects unreadable static asset sources before writing generated files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-assets-'));
    try {
      const missingSource = path.join(sourceDir, 'missing.css');
      const app = createApp({
        routes: [route('/', { page: () => trustedHtml('<main>Home</main>') })],
      });

      await expect(
        exportStaticApp(app, {
          assets: [{ path: '/assets/missing.css', source: missingSource }],
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining('is not a readable file'),
            routePath: '/assets/missing.css',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
      await expect(readFile(path.join(outDir, 'assets', 'missing.css'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });
});
