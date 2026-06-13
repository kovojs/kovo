import { request as httpRequest, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { route } from './route.js';
import {
  createJisoAppShellDevDiagnosticLedger,
  jisoAppShellVitePlugin,
  type JisoAppShellViteMiddleware,
} from './api/app-shell/vite.js';

describe('server app shell Vite diagnostics', () => {
  it('gates page-route diagnostics red and green through the dev middleware ledger', async () => {
    const diagnostics = createJisoAppShellDevDiagnosticLedger();
    const cartRoute = route('/cart', {
      modulepreloads: ['/c/src/components/cart.client.js?v=failed'],
      page() {
        return '<main>Cart</main>';
      },
    });
    const plugin = jisoAppShellVitePlugin(createApp({ routes: [cartRoute] }), {
      devDiagnostics: diagnostics,
    });
    const middlewares: JisoAppShellViteMiddleware[] = [];

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const server = createServer((request, response) => {
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
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const port = (server.address() as AddressInfo).port;

      diagnostics.recordModuleDiagnostics({
        diagnostics: [
          {
            code: 'FW225',
            fileName: 'src/components/cart.tsx',
            message: 'JSX nesting violates the HTML content model.',
          },
        ],
        fileName: 'src/components/cart.tsx',
      });

      // SPEC section 11.3: error diagnostics block dev page requests with a teaching document.
      const redResponse = await nodeFetch(`http://127.0.0.1:${port}/cart`);

      expect(redResponse).toMatchObject({
        body: expect.stringContaining('<p class="jiso-diagnostic-code">FW225</p>'),
        headers: expect.objectContaining({
          'content-type': 'text/html; charset=utf-8',
        }),
        status: 500,
      });
      expect(redResponse.body).not.toContain('<main>Cart</main>');

      diagnostics.recordModuleDiagnostics({
        diagnostics: [
          {
            code: 'FW210',
            fileName: 'src/components/cart.tsx',
            message: 'Anonymous handler; name it for stable identity.',
          },
        ],
        fileName: 'src/components/cart.tsx',
      });

      const greenResponse = await nodeFetch(`http://127.0.0.1:${port}/cart`);

      expect(greenResponse).toMatchObject({
        body: expect.stringContaining('<main>Cart</main>'),
        headers: expect.objectContaining({
          'content-type': 'text/html; charset=utf-8',
        }),
        status: 200,
      });
      expect(greenResponse.body).not.toContain('jiso-diagnostic-code');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('serves mutation diagnostics as fragment wire or document responses', async () => {
    const diagnostics = createJisoAppShellDevDiagnosticLedger();
    const plugin = jisoAppShellVitePlugin(
      createApp({
        mutations: [{ key: 'cart/add' }],
      }),
      { devDiagnostics: diagnostics },
    );
    const middlewares: JisoAppShellViteMiddleware[] = [];

    plugin.configureServer({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const server = createServer((request, response) => {
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
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const port = (server.address() as AddressInfo).port;
      diagnostics.recordModuleDiagnostics({
        diagnostics: [
          {
            code: 'FW225',
            fileName: 'src/mutations/cart.ts',
            message: 'JSX nesting violates the HTML content model.',
          },
        ],
        fileName: 'src/mutations/cart.ts',
        moduleHrefs: ['/_m/cart/add'],
      });

      const fragmentResponse = await nodeFetch(`http://127.0.0.1:${port}/_m/cart/add`, {
        headers: {
          'FW-Fragment': 'true',
          'FW-Targets': 'cart-errors',
        },
        method: 'POST',
      });

      expect(fragmentResponse).toMatchObject({
        body: expect.stringContaining('<fw-fragment target="cart-errors">'),
        headers: expect.objectContaining({
          'content-type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        }),
        status: 500,
      });
      expect(fragmentResponse.body).toContain('<p class="jiso-diagnostic-code">FW225</p>');
      expect(fragmentResponse.body).not.toContain('next');

      const documentResponse = await nodeFetch(`http://127.0.0.1:${port}/_m/cart/add`, {
        method: 'POST',
      });

      expect(documentResponse).toMatchObject({
        body: expect.stringContaining('<title>FW225 diagnostic</title>'),
        headers: expect.objectContaining({
          'content-type': 'text/html; charset=utf-8',
        }),
        status: 500,
      });
      expect(documentResponse.body).not.toContain('<fw-fragment');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

interface NodeResponse {
  body: string;
  headers: Record<string, string | string[] | undefined>;
  status: number;
}

interface NodeFetchOptions {
  headers?: Record<string, string>;
  method?: string;
}

async function nodeFetch(url: string, options: NodeFetchOptions = {}): Promise<NodeResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        headers: options.headers,
        method: options.method,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}
