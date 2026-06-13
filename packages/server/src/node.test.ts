import { request as httpRequest, createServer } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { toNodeHandler } from './node.js';

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
