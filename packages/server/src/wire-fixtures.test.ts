import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { renderDeferredStream } from './deferred-stream.js';
import { domain } from './domain.js';
import {
  renderMutationEndpointResponse,
  renderMutationResponse,
  renderNoJsMutationResponse,
} from './mutation.js';
import { query, renderQueryEndpointResponse } from './query.js';
import type { MutationResponseHeaderValue } from './response.js';
import { s } from './schema.js';
import {
  cartBadgeFragmentHtml,
  createCartMutationFixture,
  createCartQueryFixture,
  testMutation as mutation,
} from './test-fixtures.js';

describe('server wire fixture contracts', () => {
  it('matches the typed read wire fixture response byte-for-byte', async () => {
    const productQuery = query('product', {
      args: s.object({ id: s.string() }),
      instanceKey: (input) => `product:${(input as { id: string }).id}`,
      load(input: { id: string }) {
        expect(input).toEqual({ id: 'p1' });
        return { name: 'Mug', stock: 4 };
      },
      reads: [domain('product')],
    });
    const response = await renderQueryEndpointResponse(productQuery, {
      request: {},
      search: new URLSearchParams([['id', 'p1']]),
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/typed-read.http', import.meta.url),
      'utf8',
    );

    expect(normalizeWireResponse(response, 'OK')).toEqual(readFixtureResponses(fixture).at(-1));
  });

  it('matches the deferred stream wire fixture response byte-for-byte', async () => {
    const response = renderDeferredStream({
      closeHtml: '</body></html>',
      chunks: [
        {
          fragments: [
            {
              html: '<section kovo-c="reviews" kovo-deps="product:p1"><article kovo-key="r1">5</article></section>',
              priority: 5,
              stylesheets: ['/assets/reviews.css'],
              target: 'reviews:p1',
            },
            {
              html: '<section kovo-c="recommendations" kovo-deps="product:p1"><article kovo-key="rec-1">Beans</article></section>',
              target: 'recommendations:p1',
            },
          ],
          queries: [
            { key: 'product:p1', name: 'reviews', value: { items: [{ id: 'r1', rating: 5 }] } },
            { key: 'product:p1', name: 'recommendations', value: { items: [{ id: 'rec-1' }] } },
          ],
        },
      ],
      shell:
        '<!doctype html>\n<html><body><main><product-page kovo-deps="product:p1"><kovo-defer target="reviews:p1" state="pending"></kovo-defer><kovo-defer target="recommendations:p1" state="pending"></kovo-defer></product-page></main>\n',
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/defer-stream.http', import.meta.url),
      'utf8',
    );

    expect(normalizeWireResponse(response, 'OK')).toEqual(readFixtureResponses(fixture).at(-1));
  });

  it('matches the enhanced mutation wire fixture response byte-for-byte', async () => {
    const { addToCart } = createCartMutationFixture({
      instanceKey: 'cart:c1',
      version: 7,
    });

    const response = expectBufferedWireResponse(
      await renderMutationResponse(addToCart, {
        idem: 'idem_01HX',
        liveTargetDescriptors: [
          {
            component: 'components/cart/badge',
            props: {},
            target: 'cart-badge',
          },
        ],
        liveTargetRenderers: [
          {
            component: 'components/cart/badge',
            queries: ['cart'],
            render: () => cartBadgeFragmentHtml,
          },
        ],
        liveTargets: [{ deps: ['cart'], target: 'cart-badge' }],
        rawInput: { productId: 'p1', quantity: 1 },
        request: {},
        targets: ['cart-badge'],
      }),
    );
    const fixture = await readFile(
      new URL('../../../fixtures/wire/enhanced-mutation.http', import.meta.url),
      'utf8',
    );

    expect(normalizeWireResponse(response, 'OK')).toEqual(readFixtureResponses(fixture).at(-1));
  });

  it('matches the P0 wire fixtures through a live HTTP server byte-for-byte', async () => {
    const { cart, cartQuery } = createCartQueryFixture({
      instanceKey: 'cart:c1',
      version: 7,
    });
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input, _request, context) {
        if (input.quantity > 5) return context.fail('OUT_OF_STOCK', { availableQuantity: 5 });
        return input;
      },
    });
    const productQuery = query('product', {
      args: s.object({ id: s.string() }),
      instanceKey: (input) => `product:${(input as { id: string }).id}`,
      load: () => ({ name: 'Mug', stock: 4 }),
      reads: [domain('product')],
    });
    const server = createServer(async (request, response) => {
      try {
        await routeWireFixtureRequest(request, response, {
          enhancedAddToCart: async (headers, rawInput) =>
            expectBufferedWireResponse(
              await renderMutationEndpointResponse(addToCart, {
                failureTarget: 'product-form:p1',
                headers,
                liveTargetRenderers: [
                  {
                    component: 'components/cart/badge',
                    queries: ['cart'],
                    render: () => cartBadgeFragmentHtml,
                  },
                ],
                rawInput,
                renderFailureFragment: (failure, failedRawInput) => {
                  const input = Object.fromEntries(
                    (failedRawInput as FormData).entries(),
                  ) as Record<string, string>;
                  const data = failure.error.payload as { availableQuantity: number };

                  return [
                    '<form kovo-c="product-form" aria-invalid="true">',
                    `<output role="alert" data-error-code="${failure.error.code}">Only ${data.availableQuantity} left.</output>`,
                    `<input name="productId" value="${input.productId}">`,
                    `<input name="quantity" value="${input.quantity}">`,
                    '</form>',
                  ].join('');
                },
                request: {},
                redirectTo: '/cart',
              }),
            ),
          noJsAddToCart: async (headers, rawInput) =>
            expectBufferedWireResponse(
              await renderMutationEndpointResponse(addToCart, {
                headers,
                rawInput,
                redirectTo: '/cart',
                request: {},
              }),
            ),
          product: async (search) =>
            renderQueryEndpointResponse(productQuery, {
              request: {},
              search,
            }),
        });
      } catch {
        response
          .writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end('Internal Server Error');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('expected TCP server');
      const origin = `http://127.0.0.1:${address.port}`;

      await expect(fetchWireFixture(origin, 'typed-read.http')).resolves.toEqual(
        readFixtureResponses(
          await readFile(
            new URL('../../../fixtures/wire/typed-read.http', import.meta.url),
            'utf8',
          ),
        ),
      );
      await expect(fetchWireFixture(origin, 'enhanced-mutation.http')).resolves.toEqual(
        readFixtureResponses(
          await readFile(
            new URL('../../../fixtures/wire/enhanced-mutation.http', import.meta.url),
            'utf8',
          ),
        ),
      );
      await expect(fetchWireFixture(origin, 'validation-422-fragment.http')).resolves.toEqual(
        readFixtureResponses(
          await readFile(
            new URL('../../../fixtures/wire/validation-422-fragment.http', import.meta.url),
            'utf8',
          ),
        ),
      );
      await expect(fetchWireFixture(origin, 'defer-stream.http')).resolves.toEqual(
        readFixtureResponses(
          await readFile(
            new URL('../../../fixtures/wire/defer-stream.http', import.meta.url),
            'utf8',
          ),
        ),
      );
      await expect(fetchWireFixture(origin, 'no-js-post-redirect-get.http')).resolves.toEqual(
        readFixtureResponses(
          await readFile(
            new URL('../../../fixtures/wire/no-js-post-redirect-get.http', import.meta.url),
            'utf8',
          ),
        ),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('matches the validation failure wire fixture response byte-for-byte', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 5 });
      },
    });

    const response = expectBufferedWireResponse(
      await renderMutationResponse(addToCart, {
        failureTarget: 'product-form:p1',
        idem: 'idem_01HY',
        rawInput: { productId: 'p1', quantity: 99 },
        renderFailureFragment: (failure, rawInput) => {
          const input = rawInput as { productId: string; quantity: number };
          const data = failure.error.payload as { availableQuantity: number };

          return [
            '<form kovo-c="product-form" aria-invalid="true">',
            `<output role="alert" data-error-code="${failure.error.code}">Only ${data.availableQuantity} left.</output>`,
            `<input name="productId" value="${input.productId}">`,
            `<input name="quantity" value="${input.quantity}">`,
            '</form>',
          ].join('');
        },
        request: {},
        targets: ['product-form:p1'],
      }),
    );
    const fixture = await readFile(
      new URL('../../../fixtures/wire/validation-422-fragment.http', import.meta.url),
      'utf8',
    );

    expect(normalizeWireResponse(response, 'Unprocessable Content')).toEqual(
      readFixtureResponses(fixture).at(-1),
    );
  });

  it('matches the no-JS POST redirect wire fixture response byte-for-byte', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(input) {
        return input;
      },
    });

    const response = await renderNoJsMutationResponse(addToCart, {
      rawInput: { productId: 'p1', quantity: 1 },
      redirectTo: '/cart',
      request: {},
    });
    const fixture = await readFile(
      new URL('../../../fixtures/wire/no-js-post-redirect-get.http', import.meta.url),
      'utf8',
    );
    const [postResponse] = readFixtureResponses(fixture);

    expect(postResponse).toEqual({
      body: `${response.body}`,
      headers: {
        'cache-control': response.headers['Cache-Control'],
        location: response.headers.Location,
      },
      statusLine: 'HTTP/1.1 303 See Other',
    });
  });
});

type WireFixtureHandlers = {
  enhancedAddToCart(
    headers: Record<string, string>,
    rawInput: FormData,
  ): Promise<{
    body: string;
    headers: Record<string, MutationResponseHeaderValue>;
    status: number;
  }>;
  noJsAddToCart(
    headers: Record<string, string>,
    rawInput: FormData,
  ): Promise<{
    body: string;
    headers: Record<string, MutationResponseHeaderValue>;
    status: number;
  }>;
  product(
    search: URLSearchParams,
  ): Promise<{ body: string; headers: Record<string, string>; status: number }>;
};

async function routeWireFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handlers: WireFixtureHandlers,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://fixture.test');

  if (request.method === 'GET' && url.pathname === '/_q/product') {
    return writeLiveFixtureResponse(response, await handlers.product(url.searchParams), 'OK');
  }

  if (request.method === 'GET' && url.pathname === '/products/p1') {
    return writeLiveFixtureResponse(
      response,
      renderDeferredStream({
        closeHtml: '</body></html>',
        chunks: [
          {
            fragments: [
              {
                html: '<section kovo-c="reviews" kovo-deps="product:p1"><article kovo-key="r1">5</article></section>',
                priority: 5,
                stylesheets: ['/assets/reviews.css'],
                target: 'reviews:p1',
              },
              {
                html: '<section kovo-c="recommendations" kovo-deps="product:p1"><article kovo-key="rec-1">Beans</article></section>',
                target: 'recommendations:p1',
              },
            ],
            queries: [
              { key: 'product:p1', name: 'reviews', value: { items: [{ id: 'r1', rating: 5 }] } },
              {
                key: 'product:p1',
                name: 'recommendations',
                value: { items: [{ id: 'rec-1' }] },
              },
            ],
          },
        ],
        shell:
          '<!doctype html>\n<html><body><main><product-page kovo-deps="product:p1"><kovo-defer target="reviews:p1" state="pending"></kovo-defer><kovo-defer target="recommendations:p1" state="pending"></kovo-defer></product-page></main>\n',
      }),
      'OK',
    );
  }

  if (request.method === 'POST' && url.pathname === '/_m/cart/add') {
    const wireResponse = await handlers.enhancedAddToCart(
      liveFixtureHeaders(request),
      await readUrlEncodedForm(request),
    );

    return writeLiveFixtureResponse(
      response,
      wireResponse,
      wireResponse.status === 422 ? 'Unprocessable Content' : 'OK',
    );
  }

  if (request.method === 'POST' && url.pathname === '/cart/add') {
    return writeLiveFixtureResponse(
      response,
      await handlers.noJsAddToCart(liveFixtureHeaders(request), await readUrlEncodedForm(request)),
      'See Other',
    );
  }

  if (request.method === 'GET' && url.pathname === '/cart') {
    return writeLiveFixtureResponse(
      response,
      {
        body: '<!doctype html>\n<html><body><script type="application/json" kovo-query="cart">{"count":1,"items":[{"productId":"p1","qty":1,"unitPrice":1499}]}</script><cart-badge kovo-deps="cart"><span data-bind="cart.count">1</span></cart-badge></body></html>',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      },
      'OK',
    );
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
}

function liveFixtureHeaders(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, value]) => [name, value]),
  );
}

function writeLiveFixtureResponse(
  response: ServerResponse,
  wireResponse: {
    body: string;
    headers: Record<string, MutationResponseHeaderValue>;
    status: number;
  },
  reason: string,
): void {
  response.statusCode = wireResponse.status;
  response.statusMessage = reason;

  for (const [name, value] of Object.entries(wireResponse.headers)) {
    response.setHeader(name, value);
  }

  response.end(wireResponse.body);
}

async function readUrlEncodedForm(request: IncomingMessage): Promise<FormData> {
  const form = new FormData();
  const body = await readRequestBody(request);

  for (const [name, value] of new URLSearchParams(body)) {
    form.append(name, value);
  }

  return form;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function fetchWireFixture(
  origin: string,
  fixtureName: string,
): Promise<{ body: string; headers: Record<string, string>; statusLine: string }[]> {
  const fixture = await readFile(
    new URL(`../../../fixtures/wire/${fixtureName}`, import.meta.url),
    'utf8',
  );
  const expectedResponses = readFixtureResponses(fixture);
  const responses = [];

  for (const [index, request] of readFixtureRequests(fixture).entries()) {
    const init: RequestInit = {
      headers: request.headers,
      method: request.method,
      redirect: 'manual',
    };
    if (request.body !== '') init.body = request.body;

    const response = await fetch(`${origin}${request.path}`, init);
    const expected = expectedResponses[index];
    if (expected === undefined) throw new Error(`missing fixture response ${index + 1}`);

    const body = await response.text();

    responses.push({
      body,
      headers: Object.fromEntries(
        Object.keys(expected.headers).map((name) => [name, response.headers.get(name) ?? '']),
      ),
      statusLine: `HTTP/1.1 ${response.status} ${response.statusText}`,
    });
  }

  return responses;
}

function readFixtureRequests(
  fixture: string,
): { body: string; headers: Record<string, string>; method: string; path: string }[] {
  const requests = [];
  let cursor = 0;

  while (true) {
    const requestStart = fixture.indexOf('>>> REQUEST', cursor);
    if (requestStart === -1) return requests;

    const lineStart = fixture.indexOf('\n', requestStart);
    expect(lineStart).toBeGreaterThanOrEqual(0);

    const responseStart = fixture.indexOf('\n<<< RESPONSE', lineStart + 1);
    expect(responseStart).toBeGreaterThanOrEqual(0);

    const requestBlock = fixture.slice(lineStart + 1, responseStart);
    const headerEnd = requestBlock.indexOf('\n\n');
    const headerText = headerEnd === -1 ? requestBlock.trimEnd() : requestBlock.slice(0, headerEnd);
    const body = headerEnd === -1 ? '' : requestBlock.slice(headerEnd + 2).trimEnd();
    const [requestLine = '', ...headerLines] = headerText.split('\n');
    const [method = '', path = ''] = requestLine.split(' ');
    const headers = Object.fromEntries(
      headerLines.map((line) => {
        const separator = line.indexOf(':');
        expect(separator).toBeGreaterThan(0);
        return [line.slice(0, separator), line.slice(separator + 1).trim()];
      }),
    );

    requests.push({ body, headers, method, path });
    cursor = responseStart + 1;
  }
}

function normalizeWireResponse(
  response: { body: string; headers: Record<string, MutationResponseHeaderValue>; status: number },
  reason: string,
): { body: string; headers: Record<string, string>; statusLine: string } {
  return {
    body: response.body,
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([name, value]) => [
        name.toLowerCase(),
        Array.isArray(value) ? value.join('\n') : value,
      ]),
    ),
    statusLine: `HTTP/1.1 ${response.status} ${reason}`,
  };
}

function expectBufferedWireResponse<
  Response extends {
    body: ReadableStream<Uint8Array> | string;
    headers: Record<string, MutationResponseHeaderValue>;
    status: number;
  },
>(response: Response): Response & { body: string } {
  if (typeof response.body !== 'string') {
    throw new Error('Expected buffered wire response for string fixture normalization.');
  }

  return response as Response & { body: string };
}

function readFixtureResponses(
  fixture: string,
): { body: string; headers: Record<string, string>; statusLine: string }[] {
  const responses: { body: string; headers: Record<string, string>; statusLine: string }[] = [];
  let cursor = 0;

  while (true) {
    const responseStart = fixture.indexOf('<<< RESPONSE', cursor);
    if (responseStart === -1) return responses;

    const statusStart = fixture.indexOf('\n', responseStart);
    expect(statusStart).toBeGreaterThanOrEqual(0);

    const nextRequestStart = fixture.indexOf('\n>>> REQUEST', statusStart + 1);
    const responseBlock =
      nextRequestStart === -1
        ? fixture.slice(statusStart + 1)
        : fixture.slice(statusStart + 1, nextRequestStart);
    const headerEnd = responseBlock.indexOf('\n\n');
    const headerText =
      headerEnd === -1 ? responseBlock.trimEnd() : responseBlock.slice(0, headerEnd);
    const [statusLine = '', ...headerLines] = headerText.split('\n');
    const body =
      headerEnd === -1 ? '' : trimFixtureResponseBody(responseBlock.slice(headerEnd + 2));
    const headers = Object.fromEntries(
      headerLines.map((line) => {
        const separator = line.indexOf(':');
        expect(separator).toBeGreaterThan(0);
        return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
      }),
    );

    responses.push({ body, headers, statusLine });
    cursor = nextRequestStart === -1 ? fixture.length : nextRequestStart + 1;
  }
}

function trimFixtureResponseBody(body: string): string {
  if (body.endsWith('\r\n')) return body.slice(0, -2);
  if (body.endsWith('\n')) return body.slice(0, -1);
  return body;
}
