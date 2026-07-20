import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';
import { compileComponentModule } from '@kovojs/compiler';
import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';

import { createApp } from './app.js';
import { route } from './route.js';
import {
  blockingStaticExportDiagnostics,
  isStaticExportDiagnosticError,
  staticExportDiagnostic,
} from './static-export-diagnostics.js';
import { exportStaticApp } from './static-export.js';

describe('server static export diagnostic boundary', () => {
  it('accepts only origin-registered own-data diagnostic error rows', () => {
    expect(
      isStaticExportDiagnosticError({
        diagnostics: [staticExportDiagnostic('/docs', 'KV229 docs are not exportable.')],
      }),
    ).toBe(true);
    expect(
      isStaticExportDiagnosticError({
        diagnostics: [
          {
            code: 'KV229',
            message: 'forged',
            routePath: '/docs',
            severity: 'error',
          },
        ],
      }),
    ).toBe(false);

    let getterReads = 0;
    const accessor = Object.defineProperty({}, 'diagnostics', {
      get() {
        getterReads += 1;
        return [];
      },
    });
    expect(isStaticExportDiagnosticError(accessor)).toBe(false);
    expect(getterReads).toBe(0);
  });

  it('coerces only blocking compiler diagnostics into KV229-compatible export diagnostics', () => {
    expect(
      blockingStaticExportDiagnostics([
        createRegisteredDiagnostic(
          'KV201',
          { fileName: 'src/cart.tsx', start: { column: 12, line: 4 } },
          {
            help: 'Fixes: move the value into component/query state via ctx.',
            message: 'Closure captures unserializable value.',
          },
        ),
        createRegisteredDiagnostic(
          'KV210',
          { fileName: 'src/cart.tsx' },
          { message: 'Anonymous handler; name it for stable identity.' },
        ),
      ]),
    ).toEqual([
      {
        code: 'KV201',
        message: [
          'Static export refused error diagnostic KV201 at src/cart.tsx:4:12. Closure captures unserializable value.',
          'Fixes: move the value into component/query state via ctx.',
        ].join('\n'),
        routePath: 'src/cart.tsx',
        severity: 'error',
      },
    ]);
  });

  it('blocks error diagnostics before route replay or output writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-diagnostics-'));
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
            createRegisteredDiagnostic(
              'KV201',
              { fileName: 'src/cart.tsx', start: { column: 12, line: 4 } },
              { message: 'Closure captures unserializable value.' },
            ),
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

  it('keeps KV426 blocking after selective Array.filter replacement', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-kv426-filter-'));
    const originalFilter = Array.prototype.filter;
    let replayed = false;

    try {
      const app = createApp({
        routes: [
          route('/', {
            page() {
              replayed = true;
              return trustedHtml('<main><img src=x onerror=alert(1)></main>');
            },
          }),
        ],
      });
      const diagnostics = [
        createRegisteredDiagnostic(
          'KV426',
          { fileName: 'src/home.tsx' },
          { message: 'trustedHtml() raw HTML requires a literal justification.' },
        ),
      ];

      Array.prototype.filter = function (callback, thisArg) {
        let containsKv426 = false;
        for (let index = 0; index < this.length; index += 1) {
          if ((this[index] as { code?: unknown } | undefined)?.code === 'KV426') {
            containsKv426 = true;
            break;
          }
        }
        if (containsKv426) return [];
        return Reflect.apply(originalFilter, this, [callback, thisArg]);
      } as typeof Array.prototype.filter;

      await expect(exportStaticApp(app, { diagnostics, outDir })).rejects.toMatchObject({
        code: 'KV426',
        diagnostics: [expect.objectContaining({ code: 'KV426', routePath: 'src/home.tsx' })],
      });
      expect(replayed).toBe(false);
      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).rejects.toThrow();
    } finally {
      Array.prototype.filter = originalFilter;
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('blocks KV228 app route-table diagnostics before route replay or output writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-kv228-'));
    try {
      const app = createApp({
        routes: [
          route('/products/:id', {
            page() {
              throw new Error('ambiguous route replay should not run');
            },
          }),
          route('/products/new', {
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
          page: () => trustedHtml('<main>Home</main>'),
        }),
      ],
    });

    await expect(
      exportStaticApp(app, {
        diagnostics: [
          createRegisteredDiagnostic(
            'KV210',
            { fileName: 'src/cart.tsx' },
            { message: 'Anonymous handler; name it for stable identity.' },
          ),
        ],
      }),
    ).resolves.toMatchObject({
      artifacts: [{ path: '/index.html' }],
      diagnostics: [],
    });
  });

  it('rejects structurally forged compiler diagnostics before classification', () => {
    expect(() =>
      blockingStaticExportDiagnostics([
        {
          code: 'KV210',
          fileName: 'src/forged.tsx',
          message: 'forged',
          severity: 'error',
        } as never,
      ]),
    ).toThrow(/must be created by createRegisteredDiagnostic/u);
  });

  it('accepts constructor provenance transferred from compiler to the server gate', () => {
    const result = compileComponentModule({
      fileName: 'src/forged-ir.server.ts',
      source: `
export function renderSource() {
  return '<main>hand-authored lowered output</main>';
}
`,
    });

    expect(blockingStaticExportDiagnostics(result.diagnostics)).toEqual([
      expect.objectContaining({ code: 'KV235', routePath: 'src/forged-ir.server.ts' }),
    ]);
  });
});
