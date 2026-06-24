// SPEC.md §9.5: dynamic route inputs fail static export loudly with KV229.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApp, exportStaticApp, guards, publicAccess, route } from '@kovojs/server';
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'static-export-rejects-dynamic' });

test('rejects guarded and unenumerated param routes before writing partial artifacts', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'kovo-static-export-dynamic-'));
  const app = createApp({
    routes: [
      route('/account', {
        access: { kind: 'guard-chain', guards: [{ name: 'guards.authed' }] },
        guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
        page: () => '<main>Account</main>',
      }),
      route('/products/:id', {
        access: publicAccess('integration test fixture route /products/:id has no runtime guard'),
        page: () => '<main>Product</main>',
      }),
    ],
  });

  try {
    await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'KV229',
          message: expect.stringContaining('guarded route'),
          routePath: '/account',
        }),
        expect.objectContaining({
          code: 'KV229',
          message: expect.stringContaining('staticPaths metadata'),
          routePath: '/products/:id',
        }),
      ]),
    });
    await expect(readFile(path.join(outDir, 'account', 'index.html'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(outDir, 'products', 'index.html'), 'utf8')).rejects.toThrow();
  } finally {
    await rm(outDir, { force: true, recursive: true });
  }
});
