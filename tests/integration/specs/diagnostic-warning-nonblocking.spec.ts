// SPEC.md §11.3: non-error diagnostics do not block dev serving.
import { createServer, type Server } from 'node:http';

import { createApp, route } from '@kovojs/server';
import {
  createKovoAppShellDevDiagnosticLedger,
  kovoAppShellVitePlugin,
  type KovoAppShellViteMiddleware,
} from '@kovojs/server/app-shell/vite';
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'diagnostic-warning-nonblocking' });

test('does not block serving for non-error diagnostics recorded against a route module', async () => {
  const diagnostics = createKovoAppShellDevDiagnosticLedger();
  const app = createApp({
    routes: [
      route('/cart', {
        modulepreloads: ['/c/src/components/cart.client.js?v=warn'],
        page: () => '<main><h1>Cart stays available</h1></main>',
      }),
    ],
  });
  const server = await serveWithViteMiddleware(app, diagnostics);

  try {
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'KV210',
          fileName: 'src/components/cart.tsx',
          message: 'Anonymous handler; name it for stable identity.',
        },
      ],
      fileName: 'src/components/cart.tsx',
    });

    const response = await fetch(`${server.origin}/cart`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('<h1>Cart stays available</h1>');
    expect(body).not.toContain('kovo-diagnostic-code');
    expect(
      diagnostics.diagnosticsForModuleHref('/c/src/components/cart.client.js?v=warn'),
    ).toBeUndefined();
    expect(
      diagnostics.allDiagnosticsForModuleHref('/c/src/components/cart.client.js?v=warn'),
    ).toMatchObject({
      diagnostics: [{ code: 'KV210' }],
      fileName: 'src/components/cart.tsx',
    });
    expect(diagnostics.allDiagnosticsForFile('src/components/cart.tsx')).toMatchObject({
      diagnostics: [{ code: 'KV210' }],
      fileName: 'src/components/cart.tsx',
    });
  } finally {
    await server.close();
  }
});

async function serveWithViteMiddleware(
  app: ReturnType<typeof createApp>,
  diagnostics: ReturnType<typeof createKovoAppShellDevDiagnosticLedger>,
): Promise<{ close(): Promise<void>; origin: string }> {
  const plugin = kovoAppShellVitePlugin(app, { devDiagnostics: diagnostics });
  const middlewares: KovoAppShellViteMiddleware[] = [];
  plugin.configureServer({
    middlewares: {
      use(handler) {
        middlewares.push(handler);
      },
    },
  });

  const server: Server = createServer((request, response) => {
    middlewares[0]?.(request, response, (error) => {
      if (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : JSON.stringify(error));
        return;
      }

      response.writeHead(418, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('next');
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (typeof address === 'object' && address !== null) resolve(address.port);
      else reject(new Error('diagnostic warning server did not expose a port'));
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
