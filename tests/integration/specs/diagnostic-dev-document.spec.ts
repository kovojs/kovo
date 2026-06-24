// SPEC.md §11.3: error diagnostics block dev page requests with teaching documents.
import { createServer, type Server } from 'node:http';

import { DiagnosticCode } from '@kovojs/core';
import { createApp, publicAccess, route } from '@kovojs/server';
import {
  createKovoAppShellDevDiagnosticLedger,
  kovoAppShellVitePlugin,
  type KovoAppShellViteMiddleware,
} from '@kovojs/server/internal/app-shell-vite';
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'diagnostic-dev-document' });

test('serves a teaching diagnostic document for a route depending on an error module', async () => {
  const diagnostics = createKovoAppShellDevDiagnosticLedger();
  const app = createApp({
    routes: [
      route('/cart', {
        access: publicAccess('integration test fixture route /cart has no runtime guard'),
        modulepreloads: ['/c/src/components/cart.client.js?v=failed'],
        page: () => '<main><h1>Cart</h1></main>',
      }),
    ],
  });

  const server = await serveWithViteMiddleware(app, diagnostics);
  try {
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'KV225',
          fileName: 'src/components/cart.tsx',
          help: 'Move the block element outside the paragraph.',
          message: 'JSX nesting violates the HTML content model.',
          start: { column: 7, line: 2 },
        },
      ],
      fileName: 'src/components/cart.tsx',
      source: 'export function Cart() {\n  return <p><div>bad</div></p>;\n}',
    });

    const response = await fetch(`${server.origin}/cart`);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('text/html; charset=utf-8');
    expect(body).toContain('<title>KV225 diagnostic</title>');
    expect(body).toContain('<p class="kovo-diagnostic-code">KV225</p>');
    expect(body).toContain('src/components/cart.tsx:2:7');
    expect(body).not.toContain('<h1>Cart</h1>');
  } finally {
    await server.close();
  }
});

// testing-audit §5.5: only ~1 error code was surfaced e2e (and KV242 had zero
// coverage). Surface a high-impact subset through the same ledger→teaching-document
// path, asserting each blocking `error` code yields a 500 carrying the exact code.
const ERROR_CODES = [
  {
    code: 'KV227',
    help: 'Add ?. or a null-handling derive.',
    message: 'Binding path traverses a nullable segment without ?.',
  },
  {
    code: 'KV242',
    help: 'Match the form control names to the mutation input schema.',
    message: 'Enhanced mutation form control names do not match the bound mutation input schema.',
  },
  {
    code: 'KV302',
    help: 'Bind a path that exists in the declared query shape.',
    message: 'data-bind path is not present in the declared query shape.',
  },
] satisfies readonly { code: DiagnosticCode; help: string; message: string }[];

for (const entry of ERROR_CODES) {
  test(`surfaces ${entry.code} as a blocking 500 teaching document`, async () => {
    const diagnostics = createKovoAppShellDevDiagnosticLedger();
    const app = createApp({
      routes: [
        route('/cart', {
          access: publicAccess('integration test fixture route /cart has no runtime guard'),
          modulepreloads: [`/c/src/components/cart.client.js?v=${entry.code}`],
          page: () => '<main><h1>Cart</h1></main>',
        }),
      ],
    });
    const server = await serveWithViteMiddleware(app, diagnostics);
    try {
      diagnostics.recordModuleDiagnostics({
        diagnostics: [
          {
            code: entry.code,
            fileName: 'src/components/cart.tsx',
            help: entry.help,
            message: entry.message,
            start: { column: 3, line: 1 },
          },
        ],
        fileName: 'src/components/cart.tsx',
        source: 'export function Cart() {}',
      });

      const response = await fetch(`${server.origin}/cart`);
      const body = await response.text();

      expect(response.status, `${entry.code} must block dev serving`).toBe(500);
      expect(body).toContain(`<title>${entry.code} diagnostic</title>`);
      expect(body).toContain(`<p class="kovo-diagnostic-code">${entry.code}</p>`);
      expect(body).toContain('src/components/cart.tsx:1:3');
      expect(body).not.toContain('<h1>Cart</h1>');
    } finally {
      await server.close();
    }
  });
}

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
      else reject(new Error('diagnostic dev server did not expose a port'));
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
