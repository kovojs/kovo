import { describe, expect, it, vi } from 'vitest';
import { component, form } from '@kovojs/core';

import {
  errorBoundary,
  renderMutationEndpointResponse,
  renderMutationResponse,
} from './mutation.js';
import { renderComponentMutationFailure } from './component-render.js';
import { domain } from './domain.js';
import { query } from './query.js';
import { s } from './schema.js';
import {
  cartMutationFragmentRenderers,
  cartMutationTargets,
  createCartMutationFixture,
  testMutation as mutation,
} from './test-fixtures.js';

describe('server mutation primitives', () => {
  it('selects enhanced success chunks from committed changes intersected with live target deps', async () => {
    const cart = domain('cart');
    const account = domain('account');
    const cartQuery = query('cart', {
      load: () => ({ count: 2 }),
      reads: [cart],
    });
    const accountLoad = vi.fn(() => ({ name: 'Ada' }));
    const accountQuery = query('account', {
      load: accountLoad,
      reads: [account],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery, accountQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });
    const coveredCartBadge = vi.fn(() => '<cart-badge>fragment should not render</cart-badge>');
    const uncoveredCartSummary = vi.fn(() => '<section kovo-c="cart-summary">2</section>');

    await expect(
      renderMutationEndpointResponse(addToCart, {
        fragmentRenderers: [
          {
            render: coveredCartBadge,
            target: 'cart-badge',
            updateCoverage: 'plan',
          },
          {
            render: uncoveredCartSummary,
            target: 'cart-summary',
          },
          {
            render: () => '<account-panel>Ada</account-panel>',
            target: 'account-panel',
          },
        ],
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Targets': 'cart-badge=cart; cart-summary=cart; account-panel=account',
        },
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: [
        '<kovo-query name="cart">{"count":2}</kovo-query>',
        '<kovo-fragment target="cart-summary"><section kovo-c="cart-summary">2</section></kovo-fragment>',
      ].join('\n'),
      headers: {
        'Kovo-Changes': '[{"domain":"cart"}]',
      },
      status: 200,
    });
    expect(coveredCartBadge).not.toHaveBeenCalled();
    expect(uncoveredCartSummary).toHaveBeenCalledOnce();
    expect(accountLoad).not.toHaveBeenCalled();
  });

  it('bypasses success selection on failures and rerenders the submitted form target', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 2 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });
    const successRenderer = vi.fn(() => '<cart-badge>2</cart-badge>');

    await expect(
      renderMutationEndpointResponse(addToCart, {
        fragmentRenderers: [
          {
            render: successRenderer,
            target: 'cart-badge',
            updateCoverage: 'plan',
          },
        ],
        headers: {
          'Kovo-Form-Target': 'product-form:p1',
          'Kovo-Fragment': 'true',
          'Kovo-Targets': 'cart-badge=cart; product-form:p1=product:p1',
        },
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        renderFailureFragment: (failure) => {
          const payload = failure.error.payload as { availableQuantity: number };
          return [
            '<form aria-invalid="true">',
            `<output data-error-code="${failure.error.code}">${payload.availableQuantity}</output>`,
            '</form>',
          ].join('');
        },
        request: {},
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="product-form:p1"><form aria-invalid="true"><output data-error-code="OUT_OF_STOCK">0</output></form></kovo-fragment>',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
      },
      status: 422,
    });
    expect(successRenderer).not.toHaveBeenCalled();
  });

  it('rerenders enhanced form failures through component mutation form state', async () => {
    const addToCartForm = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } }
    >('cart/add');
    const AddToCartForm = component({
      mutations: { addToCart: addToCartForm },
      render: (_queries, _state, { forms }) => (
        `<form>` +
        (forms.addToCart.failure?.code === 'OUT_OF_STOCK'
          ? `<output role="alert" data-error-code="OUT_OF_STOCK">Only ${forms.addToCart.failure.payload.availableQuantity} left.</output>`
          : '') +
        `</form>`
      ),
    });
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 1 });
      },
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {
          'Kovo-Form-Target': 'product-form:p1',
          'Kovo-Fragment': 'true',
          'Kovo-Targets': 'cart-badge=cart',
        },
        rawInput: { productId: 'p1', quantity: 2 },
        redirectTo: '/cart',
        renderFailureFragment: (failure) =>
          renderComponentMutationFailure(AddToCartForm, {}, failure, { formName: 'addToCart' }),
        request: {},
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="product-form:p1"><form><output role="alert" data-error-code="OUT_OF_STOCK">Only 1 left.</output></form></kovo-fragment>',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
      },
      status: 422,
    });
  });

  it('renders enhanced mutation responses as query and fragment chunks', async () => {
    const { addToCart } = createCartMutationFixture({
      instanceKey: (input) => `cart:${(input as { cartId?: string }).cartId ?? 'c1'}`,
      version: 7,
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: cartMutationFragmentRenderers(),
        rawInput: { cartId: 'c1', productId: 'p1' },
        request: {},
        targets: [...cartMutationTargets],
      }),
    ).resolves.toEqual({
      body: [
        '<kovo-query name="cart" key="cart:c1" version="7">{"count":1,"items":[{"productId":"p1","qty":1,"unitPrice":1499}]}</kovo-query>',
        '<kovo-fragment target="cart-badge"><cart-badge kovo-deps="cart"><button commandfor="cart-drawer" command="show-modal"><span data-bind="cart.count">1</span></button></cart-badge></kovo-fragment>',
        '<kovo-fragment target="recommendations"><section kovo-c="recommendations" kovo-deps="product:p1"></section></kovo-fragment>',
      ].join('\n'),
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[{"domain":"cart"}]',
      },
      status: 200,
    });
  });

  it('renders a defined error when a post-commit rerun query fails', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      guard: () => false,
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });
    const onError = vi.fn();
    const request = {};

    await expect(
      renderMutationResponse(addToCart, {
        onError,
        rawInput: { productId: 'p1' },
        request,
        targets: ['cart-badge'],
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="cart-badge"><output role="alert" data-error-code="RENDER_ERROR">Internal Server Error</output></kovo-fragment>',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[{"domain":"cart"}]',
      },
      status: 500,
    });
    expect(onError).toHaveBeenCalledOnce();
    const [error, context] = onError.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Rerun query failed: cart');
    expect((error as Error).cause).toMatchObject({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
    expect(context).toEqual({
      mutationKey: 'cart/add',
      operation: 'mutation-render',
      request,
      targets: ['cart-badge'],
    });
  });

  it('renders append fragment mode for pagination fragments', async () => {
    const product = domain('product');
    const productQuery = query('productGrid', {
      load: () => ({ items: [{ id: 'p3' }], nextCursor: null }),
      reads: [product],
    });
    const loadMore = mutation('product/loadMore', {
      input: s.object({ after: s.string() }),
      registry: {
        queries: [productQuery],
        touches: [product],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(loadMore, {
        fragmentRenderers: [
          {
            mode: 'append',
            render: () => '<article kovo-key="p3"></article>',
            target: 'product-grid',
          },
        ],
        rawInput: { after: 'p2' },
        request: {},
        targets: ['product-grid'],
      }),
    ).resolves.toMatchObject({
      body: expect.stringContaining(
        '<kovo-fragment target="product-grid" mode="append"><article kovo-key="p3"></article></kovo-fragment>',
      ),
      status: 200,
    });
  });

  it('renders enhanced mutation responses from schema-coerced mutation input', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: (input) => ({ count: (input as { quantity: number }).quantity }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input.quantity;
      },
    });
    const form = new FormData();
    form.set('productId', 'p1');
    form.set('quantity', '2');

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          {
            render: (input) =>
              `<cart-badge>${typeof (input as { quantity: unknown }).quantity}:${(input as { quantity: number }).quantity}</cart-badge>`,
            target: 'cart-badge',
          },
        ],
        rawInput: form,
        request: {},
        targets: ['cart-badge'],
      }),
    ).resolves.toMatchObject({
      body: [
        '<kovo-query name="cart">{"count":2}</kovo-query>',
        '<kovo-fragment target="cart-badge"><cart-badge>number:2</cart-badge></kovo-fragment>',
      ].join('\n'),
      headers: {
        'Kovo-Changes': '[{"domain":"cart"}]',
      },
      status: 200,
    });
  });

  it('routes manual invalidation reruns from schema-coerced mutation input', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      instanceKey: (input) => `cart:${(input as { cartId: number }).cartId}`,
      load: (input) => ({
        cartId: (input as { cartId: number }).cartId,
        type: typeof (input as { cartId: unknown }).cartId,
      }),
      reads: [cart],
    });
    const refreshCart = mutation('cart/refresh', {
      input: s.object({ cartId: s.number().int().min(1) }),
      registry: {
        queries: [cartQuery],
      },
      handler(input, _request, context) {
        context.invalidate(cart);
        return input.cartId;
      },
    });
    const form = new FormData();
    form.set('cartId', '2');

    await expect(
      renderMutationResponse(refreshCart, {
        rawInput: form,
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '<kovo-query name="cart" key="cart:2">{"cartId":2,"type":"number"}</kovo-query>',
      status: 200,
    });
  });

  it('delivers late stylesheets with enhanced mutation fragments', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          {
            render: () => '<cart-drawer class="drawer-open">Added</cart-drawer>',
            stylesheets: [
              '/assets/cart-drawer.css',
              '/assets/cart-drawer.css',
              { href: '/assets/theme.css', preload: false },
            ],
            target: 'cart-drawer',
          },
        ],
        rawInput: { productId: 'p1' },
        request: {},
        targets: ['cart-drawer'],
      }),
    ).resolves.toMatchObject({
      body: '<kovo-fragment target="cart-drawer"><link rel="stylesheet" href="/assets/cart-drawer.css"><link rel="stylesheet" href="/assets/theme.css"><cart-drawer class="drawer-open">Added</cart-drawer></kovo-fragment>',
      status: 200,
    });
  });

  it('renders per-island error boundary fragments when a fragment renderer fails', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          errorBoundary(
            {
              render() {
                throw new Error('recommendations failed');
              },
              stylesheets: ['/assets/recommendations.css'],
              target: 'recommendations',
            },
            {
              render(error) {
                return `<section role="alert">${(error as Error).message}</section>`;
              },
            },
          ),
        ],
        rawInput: { productId: 'p1' },
        request: {},
        targets: ['recommendations'],
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="recommendations" error-boundary="recommendations"><link rel="stylesheet" href="/assets/recommendations.css"><section role="alert">recommendations failed</section></kovo-fragment>',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[]',
      },
      status: 200,
    });
  });

  it('renders a defined error fragment when an island errors without a boundary', async () => {
    const thrown = new Error('unhandled island error');
    const onError = vi.fn();
    const request = {};
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragmentRenderers: [
          {
            render() {
              throw thrown;
            },
            target: 'recommendations',
          },
        ],
        onError,
        rawInput: { productId: 'p1' },
        request,
        targets: ['recommendations'],
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="recommendations"><output role="alert" data-error-code="RENDER_ERROR">Internal Server Error</output></kovo-fragment>',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[]',
      },
      status: 500,
    });
    expect(onError).toHaveBeenCalledWith(thrown, {
      mutationKey: 'cart/add',
      operation: 'mutation-render',
      request,
      targets: ['recommendations'],
    });
  });

  it('renders enhanced mutation handler exceptions as 500 fragments', async () => {
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
      renderMutationResponse(addToCart, {
        onError,
        rawInput: { productId: 'p1' },
        request,
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="error"><output role="alert" data-error-code="SERVER_ERROR">Internal Server Error</output></kovo-fragment>',
      headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8' },
      status: 500,
    });
    expect(onError).toHaveBeenCalledWith(thrown, {
      mutationKey: 'cart/add',
      operation: 'mutation-handler',
      request,
    });
  });

  it('renders typed failures as 422 validation fragments', async () => {
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
      renderMutationResponse(addToCart, {
        rawInput: { productId: 'p1' },
        request: {},
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="error"><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></kovo-fragment>',
      headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('renders schema validation failures into the submitted form target', async () => {
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
      renderMutationResponse(addToCart, {
        failureTarget: 'product-form:p1',
        rawInput: { productId: 'p1', quantity: 0 },
        request: {},
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="product-form:p1"><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></kovo-fragment>',
      headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('delivers late stylesheets with enhanced mutation failure fragments', async () => {
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
      renderMutationResponse(addToCart, {
        failureStylesheets: [
          '/assets/product-form.css',
          '/assets/product-form.css',
          { href: '/assets/theme.css', preload: false },
        ],
        failureTarget: 'product-form:p1',
        rawInput: { productId: 'p1' },
        renderFailureFragment: () => '<form>Out of stock</form>',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="product-form:p1"><link rel="stylesheet" href="/assets/product-form.css"><link rel="stylesheet" href="/assets/theme.css"><form>Out of stock</form></kovo-fragment>',
      headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('lets enhanced forms override validation failure fragments', async () => {
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
      renderMutationResponse(addToCart, {
        failureTarget: 'product-form:p1',
        rawInput: { productId: 'p1', quantity: 0 },
        renderFailureFragment: (failure, rawInput) =>
          `<form kovo-c="product-form" aria-invalid="true"><output role="alert" data-error-code="${failure.error.code}">${(rawInput as { quantity: number }).quantity}</output></form>`,
        request: {},
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="product-form:p1"><form kovo-c="product-form" aria-invalid="true"><output role="alert" data-error-code="VALIDATION">0</output></form></kovo-fragment>',
      headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8' },
      status: 422,
    });
  });
});
