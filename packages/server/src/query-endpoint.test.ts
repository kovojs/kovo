import { describe, expect, it, vi } from 'vitest';

import { domain } from './domain.js';
import {
  query,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
  runQuery,
} from './query.js';
import { s } from './schema.js';

describe('query endpoints', () => {
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
      body: '<fw-query name="product:p1" version="3">{"id":"p1","max":3,"userId":"u1"}</fw-query>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
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
      body: '<fw-query name="product:p1">{"id":"p1","name":"Mug"}</fw-query>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
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
