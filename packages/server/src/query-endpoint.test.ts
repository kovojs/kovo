import { describe, expect, it, vi } from 'vitest';

import { domain } from './domain.js';
import {
  query,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
  runQuery,
} from './query.js';
import { s, type Schema } from './schema.js';

describe('query endpoints', () => {
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
      body: '<kovo-query name="product:p1" version="3">{"id":"p1","max":3,"userId":"u1"}</kovo-query>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 200,
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

    await expect(renderQueryEndpointResponse(productQuery, { onError, request })).resolves.toEqual({
      body: '{"code":"SERVER_ERROR","payload":{}}',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
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

    await expect(renderQueryEndpointResponse(productQuery, { request: {} })).resolves.toEqual({
      body: '{"code":"VALIDATION","payload":{"issues":[{"message":"Expected string","path":["id"]}]}}',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
    await expect(renderQueryEndpointResponse(productQuery, { request: {} })).resolves.toEqual({
      body: '{"code":"KV410","payload":{}}',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
      body: '<kovo-query name="product:p1">{"id":"p1","name":"Mug"}</kovo-query>',
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
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
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
