import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { route } from './route.js';
import { blockingStaticExportDiagnostics } from './static-export-diagnostics.js';
import { exportStaticApp } from './static-export.js';

describe('server static export diagnostic boundary', () => {
  it('coerces only blocking compiler diagnostics into FW229-compatible export diagnostics', () => {
    expect(
      blockingStaticExportDiagnostics([
        {
          code: 'FW201',
          fileName: 'src/cart.tsx',
          help: 'Fixes: move the value into component/query state via ctx.',
          message: 'Closure captures unserializable value.',
          start: { column: 12, line: 4 },
        },
        {
          code: 'FW210',
          fileName: 'src/cart.tsx',
          message: 'Anonymous handler; name it for stable identity.',
        },
      ]),
    ).toEqual([
      {
        code: 'FW201',
        message: [
          'Static export refused error diagnostic FW201 at src/cart.tsx:4:12. Closure captures unserializable value.',
          'Fixes: move the value into component/query state via ctx.',
        ].join('\n'),
        routePath: 'src/cart.tsx',
      },
    ]);
  });

  it('blocks error diagnostics before route replay or output writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-diagnostics-'));
    try {
      const app = createApp({
        routes: [
          route('/', {
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
              code: 'FW201',
              fileName: 'src/cart.tsx',
              message: 'Closure captures unserializable value.',
              start: { column: 12, line: 4 },
            },
          ],
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'FW201',
        diagnostics: [
          {
            code: 'FW201',
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

  it('allows non-blocking compiler diagnostics to continue through static replay', async () => {
    const app = createApp({
      routes: [
        route('/', {
          page: () => '<main>Home</main>',
        }),
      ],
    });

    await expect(
      exportStaticApp(app, {
        diagnostics: [
          {
            code: 'FW210',
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
