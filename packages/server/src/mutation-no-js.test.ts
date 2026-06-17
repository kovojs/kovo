import { describe, expect, it, vi } from 'vitest';
import { component, form } from '@kovojs/core';

import { renderComponentMutationFailure } from './component-render.js';
import { renderNoJsMutationResponse } from './mutation.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

describe('no-JS mutation responses', () => {
  it('renders no-JS mutation success as POST-redirect-GET', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1', quantity: 1 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/cart',
      },
      status: 303,
    });
  });

  it('renders no-JS mutation failures as a full HTML 422 page', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });

  it('can render no-JS failures through the same component mutation form state', async () => {
    const addToCartForm = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } }
    >('cart/add');
    const AddToCartForm = component({
      mutations: { addToCart: addToCartForm },
      render: (_queries, _state, { forms }) =>
        '<!doctype html><html><body><form>' +
        (forms.addToCart.failure?.code === 'OUT_OF_STOCK'
          ? `<output role="alert">Only ${forms.addToCart.failure.payload.availableQuantity} left.</output>`
          : '') +
        '</form></body></html>',
    });
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 3 });
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1', quantity: 2 },
        redirectTo: '/cart',
        renderFailurePage: (failure) =>
          renderComponentMutationFailure(AddToCartForm, {}, failure, { formName: 'addToCart' }),
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><form><output role="alert">Only 3 left.</output></form></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });

  it('renders no-JS mutation handler exceptions as an HTML 500 response', async () => {
    const thrown = new Error('handler unavailable');
    const onError = vi.fn();
    const request = {};
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler() {
        throw thrown;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        onError,
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request,
      }),
    ).resolves.toEqual({
      body: 'Internal Server Error',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 500,
    });
    expect(onError).toHaveBeenCalledWith(thrown, {
      mutationKey: 'cart/add',
      operation: 'no-js-mutation-handler',
      request,
    });
  });

  it('renders no-JS schema validation failures with field paths by default', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1', quantity: 0 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });
});
