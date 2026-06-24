import { publicAccess } from './access.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp } from './app.js';
import { stylesheet } from './hints.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';
import { renderedHtml } from './html.js';

describe('server static export', () => {
  it('rejects non-file static asset source URLs before synthetic route replay', async () => {
    let rendered = false;
    const app = createApp({
      routes: [
        route('/', {
          access: publicAccess('test fixture'),
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
            access: publicAccess('test fixture'),
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

  it('returns configured static asset metadata without requiring an output directory', async () => {
    const app = createApp({
      routes: [
        route('/', {
          access: publicAccess('test fixture'),
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

  it('replays app-wide stylesheets into static route documents', async () => {
    const app = createApp({
      routes: [
        route('/', {
          access: publicAccess('test fixture'),
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
      routes: [
        route('/', {
          access: publicAccess('test fixture'),
          page: () => trustedHtml('<main>Home</main>'),
        }),
      ],
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
        routes: [
          route('/', {
            access: publicAccess('test fixture'),
            page: () => trustedHtml('<main>Home</main>'),
          }),
        ],
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
        routes: [
          route('/', {
            access: publicAccess('test fixture'),
            page: () => trustedHtml('<main>Home</main>'),
          }),
        ],
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
        routes: [
          route('/', {
            access: publicAccess('test fixture'),
            page: () => trustedHtml('<main>Home</main>'),
          }),
        ],
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
        routes: [
          route('/', {
            access: publicAccess('test fixture'),
            page: () => trustedHtml('<main>Home</main>'),
          }),
        ],
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
