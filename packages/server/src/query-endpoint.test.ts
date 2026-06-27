import { describe, expect, it, vi } from 'vitest';
import { trustedReveal, type Secret } from '@kovojs/core';

import { publicAccess } from './access.js';
import { domain } from './domain.js';
import {
  query,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
  runQuery,
} from './query.js';
import { s, type Schema } from './schema.js';

describe('query endpoints', () => {
  it('bounds query load results to JSON-serializable values', () => {
    interface CatalogQueryResult {
      meta: {
        page: number;
        source: string | null;
      };
      readonly rows: readonly {
        readonly id: string;
        readonly tags: readonly string[];
      }[];
    }

    const catalogQuery = query('catalog', {
      load(): CatalogQueryResult {
        return {
          meta: { page: 1, source: null },
          rows: [{ id: 'p1', tags: ['featured'] }],
        };
      },
      reads: [],
    });
    const revealedSecretQuery = query('revealed-secret-query', {
      load: () => ({
        passwordDigest: trustedReveal('hash-1' as unknown as Secret<string>, {
          justification: 'one-way digest shown to admins',
        }),
      }),
      reads: [],
    });
    const assertNonJsonQueryResultsRejected = () => {
      // @ts-expect-error SPEC §10.2 query values are JsonValue-bound client wire payloads.
      query('bad-date-query', { load: () => ({ createdAt: new Date() }), reads: [] });
      // @ts-expect-error SPEC §10.2 query values cannot carry functions to the client wire.
      query('bad-function-query', { load: () => ({ format() {} }), reads: [] });
      // @ts-expect-error SPEC §10.2 secret values cannot enter query JSON.
      query('bad-secret-query', {
        load: () => ({ passwordHash: 'hash-1' as unknown as Secret<string> }),
        reads: [],
      });
    };

    expect(catalogQuery.key).toBe('catalog');
    expect(revealedSecretQuery.key).toBe('revealed-secret-query');
    expect(assertNonJsonQueryResultsRejected).toBeTypeOf('function');
  });

  it('defaults omitted query reads to an empty derived-read placeholder', async () => {
    const productQuery = query('product', {
      load: () => ({ id: 'p1' }),
    });

    expect(productQuery.reads).toEqual([]);
    await expect(runQuery(productQuery, undefined, {})).resolves.toEqual({
      input: undefined,
      ok: true,
      value: { id: 'p1' },
    });
  });

  it('runs query endpoints through args schemas, guards, and request context', async () => {
    type ProductQueryInput = { id: string; max: number };
    type ProductQueryRequest = { session?: { userId?: string } | null };

    const productQuery = query('productDetail', {
      args: s.object({ id: s.string(), max: s.number().int().default(10) }),
      guard: (request: ProductQueryRequest) => request.session?.userId === 'u1',
      instanceKey: (input) => `product:${(input as { id: string }).id}`,
      load(input: ProductQueryInput, { request }: { request: ProductQueryRequest }) {
        return { id: input.id, max: input.max, userId: request.session?.userId };
      },
      reads: [domain('product')],
      version: (input: ProductQueryInput) => input.max,
    });

    await expect(
      runQuery(productQuery, { id: 'p1' }, { session: { userId: 'u1' } }),
    ).resolves.toEqual({
      input: { id: 'p1', max: 10 },
      ok: true,
      value: { id: 'p1', max: 10, userId: 'u1' },
    });
    await expect(runQuery(productQuery, {}, { session: { userId: 'u1' } })).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected string', path: ['id'] }] },
      },
      ok: false,
      status: 422,
    });
    await expect(runQuery(productQuery, { id: 'p1' }, { session: null })).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });

    await expect(
      renderQueryEndpointResponse(productQuery, {
        request: { session: { userId: 'u1' } },
        search: new URLSearchParams([
          ['id', 'p1'],
          ['max', '3'],
        ]),
      }),
    ).resolves.toEqual({
      body: '<kovo-query name="productDetail" key="product:p1" version="3">{"id":"p1","max":3,"userId":"u1"}</kovo-query>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 200,
    });
  });

  it('caps unbounded query list results and surfaces a wire warning', async () => {
    const catalogQuery = query('catalogList', {
      load: () => ({
        rows: Array.from({ length: 4 }, (_, id) => ({ id, tags: ['visible', 'capped'] })),
      }),
      reads: [domain('catalog')],
    });

    await expect(runQuery(catalogQuery, {}, {}, { maxListItems: 2 })).resolves.toEqual({
      input: {},
      ok: true,
      value: {
        rows: [
          { id: 0, tags: ['visible', 'capped'] },
          { id: 1, tags: ['visible', 'capped'] },
        ],
      },
      warnings: [{ code: 'QUERY_LIST_LIMIT', limit: 2, path: '$.rows' }],
    });
    await expect(
      renderQueryEndpointResponse(catalogQuery, { maxListItems: 2, request: {} }),
    ).resolves.toEqual({
      body: '<kovo-query name="catalogList">{"rows":[{"id":0,"tags":["visible","capped"]},{"id":1,"tags":["visible","capped"]}]}</kovo-query>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'Kovo-Warn': 'QUERY_LIST_LIMIT $.rows;limit=2',
        Vary: 'Cookie',
      },
      status: 200,
    });
  });

  it('preserves explicit query list limits below the default ceiling', async () => {
    const catalogQuery = query('catalogLimited', {
      args: s.object({ limit: s.number().int().default(3) }),
      load: (input: { limit: number }) => ({
        rows: Array.from({ length: input.limit }, (_, id) => ({ id })),
      }),
      reads: [domain('catalog')],
    });

    await expect(renderQueryEndpointResponse(catalogQuery, { request: {} })).resolves.toEqual({
      body: '<kovo-query name="catalogLimited">{"rows":[{"id":0},{"id":1},{"id":2}]}</kovo-query>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 200,
    });
  });

  it('allows explicit Cache-Control only for public unguarded query reads', async () => {
    const publicQuery = query('publicCatalog', {
      access: publicAccess('public product catalog'),
      load: () => ({ items: ['p1'] }),
      read: { cacheControl: 'public, max-age=60' },
      reads: [domain('catalog')],
    });
    const guardedQuery = query('privateCatalog', {
      access: publicAccess('audit metadata is not enough when a guard exists'),
      guard: () => true,
      load: () => ({ items: ['p1'] }),
      read: { cacheControl: 'public, max-age=60' },
      reads: [domain('catalog')],
    });

    await expect(renderQueryEndpointResponse(publicQuery, { request: {} })).resolves.toEqual({
      body: '<kovo-query name="publicCatalog">{"items":["p1"]}</kovo-query>',
      headers: {
        'Cache-Control': 'public, max-age=60',
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 200,
    });
    await expect(renderQueryEndpointResponse(guardedQuery, { request: {} })).resolves.toEqual({
      body: '<kovo-query name="privateCatalog">{"items":["p1"]}</kovo-query>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 200,
    });
  });

  it('stamps unknown query 404s with private cache and build headers', async () => {
    await expect(
      renderQueryRegistryEndpointResponse({ queries: [] }, 'missing', {
        buildToken: 'build-q',
        request: {},
        search: new URLSearchParams(),
      }),
    ).resolves.toEqual({
      body: 'Not Found',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'Kovo-Build': 'build-q',
        Vary: 'Cookie',
      },
      status: 404,
    });
  });

  it('keeps parameterized query args parseable while supporting component prop bindings', () => {
    const productQuery = query('product', {
      args: s.object({ id: s.string() }),
      load(input: { id: string }) {
        return { id: input.id };
      },
      reads: [domain('product')],
    });

    const bound = productQuery.args((props: { productId: string }) => ({
      id: props.productId,
    }));

    expect(productQuery.args.parse({ id: 'p1' })).toEqual({ id: 'p1' });
    expect(bound.args({ productId: 'p2' })).toEqual({ id: 'p2' });
    expect(bound.schema.parse({ id: 'p3' })).toEqual({ id: 'p3' });
  });

  it('renders query endpoint loader exceptions as stable 500 JSON', async () => {
    const thrown = new Error('database password leaked in stack');
    const onError = vi.fn();
    const request = {};
    const productQuery = query('product', {
      load() {
        throw thrown;
      },
      reads: [domain('product')],
    });

    // H3 fix: /_q/ 500 responses now carry the private cache posture (SPEC §9.4:895).
    await expect(renderQueryEndpointResponse(productQuery, { onError, request })).resolves.toEqual({
      body: '{"code":"SERVER_ERROR","payload":{}}',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/json; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 500,
    });
    expect(onError).toHaveBeenCalledWith(thrown, {
      operation: 'query-endpoint',
      queryKey: 'product',
      request,
    });
  });

  it('renders structurally recognized args schema failures as safe 422 JSON', async () => {
    const productQuery = query('product', {
      args: alienValidationSchema<{ id: string }>('Expected string', ['id']),
      load(input: { id: string }) {
        return { id: input.id };
      },
      reads: [domain('product')],
    });

    // H3 fix: /_q/ 422 responses now carry the private cache posture (SPEC §9.4:895).
    await expect(renderQueryEndpointResponse(productQuery, { request: {} })).resolves.toEqual({
      body: '{"code":"VALIDATION","payload":{"issues":[{"message":"Expected string","path":["id"]}]}}',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/json; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 422,
    });
  });

  it('validates query output schemas before rendering typed read wire HTML', async () => {
    const productQuery = query('product', {
      load() {
        return { id: 'p1', stock: 3 };
      },
      output: s.object({ id: s.string(), stock: s.number().int() }),
      reads: [domain('product')],
    });

    await expect(runQuery(productQuery, {}, {})).resolves.toEqual({
      input: {},
      ok: true,
      value: { id: 'p1', stock: 3 },
    });
    await expect(renderQueryEndpointResponse(productQuery, { request: {} })).resolves.toEqual({
      body: '<kovo-query name="product">{"id":"p1","stock":3}</kovo-query>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 200,
    });
  });

  it('reports query output schema drift as safe KV410 JSON', async () => {
    const productQuery = query('product', {
      load() {
        return { id: 'p1', stock: 'three' };
      },
      output: s.object({ id: s.string(), stock: s.number().int() }) as unknown as Schema<{
        id: string;
        stock: string;
      }>,
      reads: [domain('product')],
    });

    await expect(runQuery(productQuery, {}, {})).resolves.toEqual({
      error: { code: 'KV410', payload: {} },
      ok: false,
      status: 500,
    });
    // H3 fix: /_q/ 500 (KV410) responses now carry the private cache posture (SPEC §9.4:895).
    await expect(renderQueryEndpointResponse(productQuery, { request: {} })).resolves.toEqual({
      body: '{"code":"KV410","payload":{}}',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/json; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 500,
    });
  });

  it('dispatches typed read endpoints through a query registry', async () => {
    const productQuery = query('product', {
      args: s.object({ id: s.string() }),
      instanceKey: (input) => `product:${(input as { id: string }).id}`,
      load(input: { id: string }) {
        return { id: input.id, name: 'Mug' };
      },
      reads: [domain('product')],
    });

    await expect(
      renderQueryRegistryEndpointResponse({ queries: [productQuery] }, 'product', {
        request: {},
        search: new URLSearchParams([['id', 'p1']]),
      }),
    ).resolves.toEqual({
      body: '<kovo-query name="product" key="product:p1">{"id":"p1","name":"Mug"}</kovo-query>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 200,
    });

    await expect(
      renderQueryRegistryEndpointResponse({ queries: [productQuery] }, 'missing', {
        request: {},
      }),
    ).resolves.toEqual({
      body: 'Not Found',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 404,
    });
  });

  // H3 (medium) — SPEC §9.4:895: cache headers must be on ALL /_q/ responses,
  // including 422/500 error responses and guard-failure 403/redirect responses.

  it('H3: stamps Cache-Control + Vary on /_q/ 422 args-validation failure', async () => {
    const productQuery = query('product', {
      args: alienValidationSchema<{ id: string }>('Expected string', ['id']),
      load(input: { id: string }) {
        return { id: input.id };
      },
      reads: [],
    });

    const result = await renderQueryEndpointResponse(productQuery, { request: {} });

    expect(result.status).toBe(422);
    expect(result.headers['Cache-Control']).toBe('private, no-store');
    expect(result.headers['Vary']).toBe('Cookie');
  });

  it('H3: stamps Cache-Control + Vary on /_q/ 500 load exception', async () => {
    const productQuery = query('product', {
      load() {
        throw new Error('db down');
      },
      reads: [],
    });

    const result = await renderQueryEndpointResponse(productQuery, { request: {} });

    expect(result.status).toBe(500);
    expect(result.headers['Cache-Control']).toBe('private, no-store');
    expect(result.headers['Vary']).toBe('Cookie');
  });

  it('H3: stamps Cache-Control + Vary on /_q/ 403 guard-failure forbidden response', async () => {
    const productQuery = query('product', {
      guard: () => ({ kind: 'forbidden' as const }),
      load: () => ({ id: 'p1' }),
      reads: [],
    });

    const result = await renderQueryEndpointResponse(productQuery, {
      currentUrl: '/_q/product',
      // Simulate authed request so guard is "forbidden" (not unauthenticated redirect).
      request: { session: { user: { id: 'u1' } } },
    });

    expect(result.status).toBe(403);
    expect(result.headers['Cache-Control']).toBe('private, no-store');
    expect(result.headers['Vary']).toBe('Cookie');
  });

  it('H3: stamps Cache-Control + Vary on /_q/ 303 unauthenticated guard-failure redirect', async () => {
    const productQuery = query('product', {
      guard: () => ({ kind: 'unauthenticated' as const }),
      load: () => ({ id: 'p1' }),
      reads: [],
    });

    const result = await renderQueryEndpointResponse(productQuery, {
      currentUrl: '/_q/product',
      request: {},
    });

    expect(result.status).toBe(303);
    expect(result.headers['Cache-Control']).toBe('private, no-store');
    expect(result.headers['Vary']).toBe('Cookie');
  });

  // D2-server (high) — SPEC §5.2.1 rule 2(d): /_q/ 200 read responses must carry
  // a Kovo-Build header so a plain refetch into a stale tab is detectable.

  it('D2: stamps Kovo-Build on /_q/ 200 read response when buildToken is provided', async () => {
    const productQuery = query('product', {
      load: () => ({ id: 'p1' }),
      reads: [],
    });

    const result = await renderQueryEndpointResponse(productQuery, {
      buildToken: 'sha256-abcdef1234',
      request: {},
    });

    expect(result.status).toBe(200);
    expect(result.headers['Kovo-Build']).toBe('sha256-abcdef1234');
  });

  it('D2: omits Kovo-Build from /_q/ 200 read response when buildToken is absent', async () => {
    const productQuery = query('product', {
      load: () => ({ id: 'p1' }),
      reads: [],
    });

    const result = await renderQueryEndpointResponse(productQuery, { request: {} });

    expect(result.status).toBe(200);
    expect(result.headers['Kovo-Build']).toBeUndefined();
  });

  it('AUD-006: stamps Kovo-Build on every /_q/ non-200 response when buildToken is provided', async () => {
    const buildToken = 'sha256-aud006';
    const forbiddenQuery = query('forbidden', {
      guard: () => ({ kind: 'forbidden' as const }),
      load: () => ({ id: 'p1' }),
      reads: [],
    });
    const redirectQuery = query('redirect', {
      guard: () => ({ kind: 'unauthenticated' as const }),
      load: () => ({ id: 'p1' }),
      reads: [],
    });
    const rateLimitedQuery = query('rateLimited', {
      guard: () => ({ kind: 'rateLimited' as const, retryAfter: 7 }),
      load: () => ({ id: 'p1' }),
      reads: [],
    });
    const validationQuery = query('validation', {
      args: alienValidationSchema<{ id: string }>('Expected string', ['id']),
      load: (input: { id: string }) => input,
      reads: [],
    });
    const throwingQuery = query('throwing', {
      load() {
        throw new Error('db down');
      },
      reads: [],
    });

    const responses = [
      await renderQueryEndpointResponse(validationQuery, { buildToken, request: {} }),
      await renderQueryEndpointResponse(throwingQuery, { buildToken, request: {} }),
      await renderQueryEndpointResponse(forbiddenQuery, {
        buildToken,
        currentUrl: '/_q/forbidden',
        request: { session: { user: { id: 'u1' } } },
      }),
      await renderQueryEndpointResponse(redirectQuery, {
        buildToken,
        currentUrl: '/_q/redirect',
        request: {},
      }),
      await renderQueryRegistryEndpointResponse({ queries: [] }, 'missing', {
        buildToken,
        request: {},
      }),
      await renderQueryEndpointResponse(rateLimitedQuery, { buildToken, request: {} }),
    ];

    expect(responses.map((response) => response.status)).toEqual([422, 500, 403, 303, 404, 429]);
    for (const response of responses) {
      expect(response.headers['Kovo-Build']).toBe(buildToken);
    }
    expect(responses.at(-1)?.headers['Retry-After']).toBe('7');
  });

  it('L3: a bigint column resolves to 200 with a serialized value (no throw, headers intact)', async () => {
    const totalsQuery = query('totals', {
      load: () => ({ count: 10n }),
      reads: [],
    });

    // Previously the success render threw in JSON.stringify and the promise REJECTED,
    // dropping the §9.4:895 private-cache posture entirely.
    const result = await renderQueryEndpointResponse(totalsQuery, { request: {} });

    expect(result.status).toBe(200);
    expect(result.body).toBe(
      '<kovo-query name="totals">{"count":{"$kovo":"bigint","value":"10"}}</kovo-query>',
    );
    expect(result.headers['Cache-Control']).toBe('private, no-store');
    expect(result.headers.Vary).toBe('Cookie');
  });

  it('renders /_q success payloads as inert kovo-query JSON data', async () => {
    const payload = {
      text: '</kovo-query><script>alert(1)</script>',
      url: 'javascript:alert(1)',
    };
    const payloadQuery = query('payload', {
      load: () => payload,
      reads: [],
    });

    const result = await renderQueryEndpointResponse(payloadQuery, { request: {} });

    expect(result.status).toBe(200);
    expect(result.body).not.toContain('</kovo-query><script>');
    expect(result.body).not.toContain('<script>alert(1)</script>');
    expect(parseSingleQueryWire(result.body)).toEqual({
      delta: false,
      name: 'payload',
      value: payload,
    });
  });

  it('L3: a still-throwing success render returns 500 carrying the private-cache posture', async () => {
    // A value that JSON.stringify cannot serialize even after normalization (a circular ref)
    // must NOT let the throw escape the success branch and drop the mandated headers.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const brokenQuery = query('broken', {
      load: () => circular,
      reads: [],
    });

    const result = await renderQueryEndpointResponse(brokenQuery, { request: {} });

    expect(result.status).toBe(500);
    expect(result.headers['Cache-Control']).toBe('private, no-store');
    expect(result.headers.Vary).toBe('Cookie');
    expect(result.body).toBe(JSON.stringify({ code: 'SERVER_ERROR', payload: {} }));
  });
});

function alienValidationSchema<T>(message: string, path: readonly string[]): Schema<T> {
  return {
    parse(): T {
      const error = new Error(message) as Error & {
        issues: readonly { message: string; path: readonly string[] }[];
      };
      error.name = 'SchemaValidationError';
      error.issues = [{ message, path }];
      throw error;
    },
  };
}

function parseSingleQueryWire(body: string): {
  delta: boolean;
  name: string;
  value: unknown;
} {
  const match = /^<kovo-query\s+([^>]*)>([\s\S]*)<\/kovo-query>$/.exec(body.trim());
  if (!match) throw new Error(`Expected one kovo-query chunk, got: ${body}`);
  const [, attributes = '', encodedJson = ''] = match;
  const nameMatch = /\bname="([^"]+)"/.exec(attributes);
  if (!nameMatch) throw new Error(`Missing query name in: ${body}`);

  return {
    delta: /\sdelta(?:\s|$)/.test(` ${attributes} `),
    name: decodeHtmlText(nameMatch[1] ?? ''),
    value: JSON.parse(decodeHtmlText(encodedJson)),
  };
}

function decodeHtmlText(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
