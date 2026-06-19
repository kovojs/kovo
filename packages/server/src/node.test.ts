import { request as httpRequest, createServer } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { domain } from './domain.js';
import { mutation } from './mutation.js';
import { toNodeHandler } from './node.js';
import { query } from './query.js';
import { route } from './route.js';
import { s } from './schema.js';

describe('server node adapter', () => {
  it('serves web-standard handlers through node:http with request bodies and early hints', async () => {
    const server = await serveWithNode(
      toNodeHandler(async (request) => {
        if (new URL(request.url).pathname === '/echo') {
          return new Response(await request.text(), {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              Link: '</app.css>; rel=preload; as=style',
            },
            status: 201,
            statusText: 'Created',
          });
        }

        return new Response('missing', { status: 404 });
      }),
    );

    try {
      const response = await server.fetch('/echo?tab=details', {
        body: 'hello=node',
        headers: { 'Content-Type': 'text/plain' },
        method: 'POST',
      });

      expect(response).toMatchObject({
        body: 'hello=node',
        earlyHints: [{ link: '</app.css>; rel=preload; as=style' }],
        headers: expect.objectContaining({
          'content-type': 'text/plain; charset=utf-8',
          link: '</app.css>; rel=preload; as=style',
        }),
        status: 201,
      });
    } finally {
      await server.close();
    }
  });

  it('suppresses response bodies for HEAD requests', async () => {
    const server = await serveWithNode(
      toNodeHandler(async () => new Response('body', { status: 200 })),
    );

    try {
      const response = await server.fetch('/head', { method: 'HEAD' });

      expect(response).toMatchObject({
        body: '',
        status: 200,
      });
    } finally {
      await server.close();
    }
  });

  it('can suppress early hints while preserving final Link headers', async () => {
    const server = await serveWithNode(
      toNodeHandler(
        async () =>
          new Response('asset-linked', {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              Link: '</app.css>; rel=preload; as=style',
            },
          }),
        { earlyHints: false },
      ),
    );

    try {
      const response = await server.fetch('/linked');

      expect(response).toMatchObject({
        body: 'asset-linked',
        earlyHints: [],
        headers: expect.objectContaining({
          link: '</app.css>; rel=preload; as=style',
        }),
        status: 200,
      });
    } finally {
      await server.close();
    }
  });

  it('serves a SPEC §9.5 app shell surface through node:http', async () => {
    const cart = domain('cart');
    const db = { count: 0 };
    const cartQuery = query('cart', {
      load: () => ({ count: db.count }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ quantity: s.number().int().min(1).default(1) }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        db.count += input.quantity;
        return { count: db.count };
      },
    });
    const app = createApp({
      mutations: [addToCart],
      queries: [cartQuery],
      routes: [
        route('/cart', {
          modulepreloads: [],
          page: () => `<main>Cart ${db.count}</main>`,
        }),
      ],
    });
    const clientHref = app.clientModules.put({
      path: '/c/cart.client.js',
      source: 'export const cartClient = true;',
      version: 'cart-v1',
    });
    app.routes[0]!.modulepreloads = [clientHref];
    const server = await serveWithNode(toNodeHandler(createRequestHandler(app)));

    try {
      const document = await server.fetch('/cart');
      expect(document).toMatchObject({
        body: expect.stringContaining('<main>Cart 0</main>'),
        headers: expect.objectContaining({
          'content-type': 'text/html; charset=utf-8',
          link: `</c/__v/cart-v1/cart.client.js>; rel=modulepreload`,
        }),
        status: 200,
      });

      const queryResponse = await server.fetch('/_q/cart');
      expect(queryResponse).toMatchObject({
        body: '<kovo-query name="cart">{"count":0}</kovo-query>',
        headers: expect.objectContaining({
          'content-type': 'text/html; charset=utf-8',
        }),
        status: 200,
      });

      const moduleResponse = await server.fetch(clientHref);
      expect(moduleResponse).toMatchObject({
        body: 'export const cartClient = true;',
        headers: expect.objectContaining({
          'cache-control': 'public, max-age=31536000, immutable',
          'content-type': 'text/javascript; charset=utf-8',
        }),
        status: 200,
      });

      const mutationResponse = await server.fetch('/_m/cart/add', {
        body: formBody({ quantity: '2' }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      });
      expect(mutationResponse).toMatchObject({
        body: '',
        headers: expect.objectContaining({
          location: '/',
        }),
        status: 303,
      });

      const refreshedQuery = await server.fetch('/_q/cart');
      expect(refreshedQuery).toMatchObject({
        body: '<kovo-query name="cart">{"count":2}</kovo-query>',
        status: 200,
      });
    } finally {
      await server.close();
    }
  });
});

interface NodeTestResponse {
  body: string;
  earlyHints: IncomingHttpHeaders[];
  headers: IncomingHttpHeaders;
  status: number;
}

async function serveWithNode(handler: RequestListener): Promise<{
  close(): Promise<void>;
  fetch(pathname: string, options?: NodeTestRequestOptions): Promise<NodeTestResponse>;
}> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    fetch(pathname, options = {}) {
      return nodeFetch(`${origin}${pathname}`, options);
    },
  };
}

interface NodeTestRequestOptions {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
}

function formBody(fields: Record<string, string>): string {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    body.set(name, value);
  }
  return body.toString();
}

async function nodeFetch(
  url: string,
  options: NodeTestRequestOptions = {},
): Promise<NodeTestResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        headers: options.headers,
        method: options.method ?? 'GET',
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            earlyHints,
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    const earlyHints: IncomingHttpHeaders[] = [];
    request.on('information', (response: IncomingMessage) => {
      if (response.statusCode === 103) earlyHints.push(response.headers);
    });
    request.on('error', reject);
    request.end(options.body);
  });
}
