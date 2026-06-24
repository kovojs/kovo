import { publicAccess } from './access.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp } from './app.js';
import { route } from './route.js';
import { blockingStaticExportDiagnostics } from './static-export-diagnostics.js';
import { exportStaticApp } from './static-export.js';

describe('server static export diagnostic boundary', () => {
  it('coerces only blocking compiler diagnostics into KV229-compatible export diagnostics', () => {
    expect(
      blockingStaticExportDiagnostics([
        {
          code: 'KV201',
          fileName: 'src/cart.tsx',
          help: 'Fixes: move the value into component/query state via ctx.',
          message: 'Closure captures unserializable value.',
          start: { column: 12, line: 4 },
        },
        {
          code: 'KV210',
          fileName: 'src/cart.tsx',
          message: 'Anonymous handler; name it for stable identity.',
        },
      ]),
    ).toEqual([
      {
        code: 'KV201',
        message: [
          'Static export refused error diagnostic KV201 at src/cart.tsx:4:12. Closure captures unserializable value.',
          'Fixes: move the value into component/query state via ctx.',
        ].join('\n'),
        routePath: 'src/cart.tsx',
      },
    ]);
  });

  it('blocks error diagnostics before route replay or output writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-diagnostics-'));
    try {
      const app = createApp({
        routes: [
          route('/', {
            access: publicAccess('test fixture'),
            page() {
              throw new Error('route replay should not run');
            },
          }),
        ],
      });

      await expect(
        exportStaticApp(app, {
          diagnostics: [
            {
              code: 'KV201',
              fileName: 'src/cart.tsx',
              message: 'Closure captures unserializable value.',
              start: { column: 12, line: 4 },
            },
          ],
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'KV201',
        diagnostics: [
          {
            code: 'KV201',
            message: expect.stringContaining('src/cart.tsx:4:12'),
            routePath: 'src/cart.tsx',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('blocks KV228 app route-table diagnostics before route replay or output writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-kv228-'));
    try {
      const app = createApp({
        routes: [
          route('/products/:id', {
            access: publicAccess('test fixture'),
            page() {
              throw new Error('ambiguous route replay should not run');
            },
          }),
          route('/products/new', {
            access: publicAccess('test fixture'),
            page: () => trustedHtml('<main>New</main>'),
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'KV228',
        diagnostics: [
          {
            code: 'KV228',
            message: expect.stringContaining('/products/new'),
            routePath: '/products/:id <-> /products/new',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'products', 'new', 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('allows non-blocking compiler diagnostics to continue through static replay', async () => {
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
        diagnostics: [
          {
            code: 'KV210',
            fileName: 'src/cart.tsx',
            message: 'Anonymous handler; name it for stable identity.',
          },
        ],
      }),
    ).resolves.toMatchObject({
      artifacts: [{ path: '/index.html' }],
      diagnostics: [],
    });
  });
});
