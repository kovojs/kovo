import { describe, expect, it, vi } from 'vitest';
import { form, type FormFailure, type Route } from '@jiso/core';

import { createQueryStore, createSubmitContext } from './index.js';
import { FakeMorphRoot } from './runtime-test-fakes.js';

declare module '@jiso/core' {
  interface RouteRegistry {
    '/cart': Route<'/cart'>;
    '/catalog': Route<'/catalog', {}, { max: number; sort: string }>;
    '/catalog/:id': Route<'/catalog/:id', { id: string }, { max: number; sort: string }>;
  }
}

// SPEC.md §4.4/§9.1: ctx.submit decodes 422 responses through the shared
// tag-close attribute scanner into typed FormFailure values (custom error
// codes and VALIDATION field maps), tolerating quoted '>' characters inside
// attributes. The success/apply seam lives in sibling submit-context-apply.test.ts.
describe('submit context failure parsing', () => {
  it('passes typed validation failures from ctx.submit on 422 responses', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; data: { availableQuantity: number } }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn((failure: FormFailure<typeof addToCart>) => {
      if (failure.code === 'VALIDATION') {
        expect(failure.fields.quantity).toBeTypeOf('string');
        return;
      }

      expect(failure.data.availableQuantity).toBeTypeOf('number');
    });
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-fragment target="error"><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></fw-fragment>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    const result = await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 1 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({
      code: 'OUT_OF_STOCK',
      data: { availableQuantity: 0 },
    });
    expect(result.fragments).toEqual([
      {
        html: '<output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output>',
        target: 'error',
      },
    ]);
  });

  it('parses fw-error mutation failures with shared tag-close attribute scanning', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; data: { availableQuantity: number } }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-error data-debug="quantity > stock">{"code":"OUT_OF_STOCK","data":{"availableQuantity":0}}</fw-error>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 1 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({
      code: 'OUT_OF_STOCK',
      data: { availableQuantity: 0 },
    });
  });

  it('parses output mutation failures when attributes contain quoted tag closers', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; data: { availableQuantity: number } }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-fragment target="error"><output role="alert" data-debug="quantity > stock" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></fw-fragment>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 1 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({
      code: 'OUT_OF_STOCK',
      data: { availableQuantity: 0 },
    });
  });

  it('passes schema validation field failures from ctx.submit on server-shaped 422 fragments', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'VALIDATION'; fields: { quantity: string } }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-fragment target="product-form:p1"><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></fw-fragment>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 0 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({
      code: 'VALIDATION',
      fields: { quantity: 'Expected number >= 1' },
    });
  });

  it('parses validation output paths when attributes contain quoted tag closers', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'VALIDATION'; fields: { quantity: string } }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-fragment target="product-form:p1"><output role="alert" data-debug="quantity > min" data-error-path="quantity">Expected number &gt;= 1</output></fw-fragment>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 0 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({
      code: 'VALIDATION',
      fields: { quantity: 'Expected number >= 1' },
    });
  });
});
