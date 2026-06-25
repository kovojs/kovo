import { describe, expect, it } from 'vitest';

import { domain } from './domain.js';
import {
  registeredGeneratedMutationTouches,
  registerGeneratedMutationTouchRegistry,
} from './generated-mutation-registry.js';
import { registerGeneratedQueryReadRegistry } from './generated-query-registry.js';
import { renderMutationEndpointResponse as renderMutationEndpointResponseBase } from './mutation.js';
import { query } from './query.js';
import { s, type Schema } from './schema.js';
import { cartBadgeFragmentHtml, testMutation as mutation } from './test-fixtures.js';
import { createLiveTargetAttestation } from './mutation-wire.js';

const mutationEndpointTestBuildToken = 'mutation-endpoint-test-build';

function withMutationEndpointTestBuildToken<T extends { buildToken?: string }>(
  request: T,
): T & { buildToken: string } {
  return { buildToken: mutationEndpointTestBuildToken, ...request };
}

function renderMutationEndpointResponse(
  ...[definition, request]: Parameters<typeof renderMutationEndpointResponseBase>
): ReturnType<typeof renderMutationEndpointResponseBase> {
  return renderMutationEndpointResponseBase(
    definition,
    withMutationEndpointTestBuildToken(request),
  ) as ReturnType<typeof renderMutationEndpointResponseBase>;
}

function attestedLiveTargetHeader(
  target: string,
  component: string,
  props: Record<string, unknown> = {},
): string {
  const token = createLiveTargetAttestation({ component, props, target }, { request: {} });
  return `${target}#${component}@${token}:${JSON.stringify(props)}`;
}

describe('server mutation endpoint routing', () => {
  it('routes mutation endpoints without Kovo-Fragment through the no-JS POST redirect', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {},
        rawInput: { productId: 'p1' },
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

  it('sanitizes no-JS mutation redirect targets to same-origin paths', async () => {
    const signIn = mutation('auth/sign-in', {
      input: s.object({ next: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(signIn, {
        headers: {},
        rawInput: { next: '/account?tab=orders#paid' },
        redirectTo: (result) => result.value.next,
        request: {},
      }),
    ).resolves.toMatchObject({
      headers: { Location: '/account?tab=orders#paid' },
      status: 303,
    });

    await expect(
      renderMutationEndpointResponse(signIn, {
        headers: {},
        rawInput: { next: 'https://evil.example/phish' },
        redirectTo: (result) => result.value.next,
        request: {},
      }),
    ).resolves.toMatchObject({
      headers: { Location: '/' },
      status: 303,
    });

    await expect(
      renderMutationEndpointResponse(signIn, {
        headers: {},
        rawInput: { next: '//evil.example/phish' },
        redirectTo: (result) => result.value.next,
        request: {},
      }),
    ).resolves.toMatchObject({
      headers: { Location: '/' },
      status: 303,
    });

    await expect(
      renderMutationEndpointResponse(signIn, {
        headers: {},
        rawInput: { next: '/account\nSet-Cookie:owned=true' },
        redirectTo: (result) => result.value.next,
        request: {},
      }),
    ).resolves.toMatchObject({
      headers: { Location: '/' },
      status: 303,
    });
  });

  it('routes mutation endpoints with Kovo-Fragment through enhanced fragment wire responses', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
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

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart-badge', 'components/cart/badge')}`,
          'Kovo-Targets': 'cart-badge=cart',
        },
        liveTargetRenderers: [
          {
            component: 'components/cart/badge',
            queries: ['cart'],
            render: () => cartBadgeFragmentHtml,
          },
        ],
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: [
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        `<kovo-fragment target="cart-badge">${cartBadgeFragmentHtml}</kovo-fragment>`,
      ].join('\n'),
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': 'mutation-endpoint-test-build',
        Vary: 'Cookie',
      },
      status: 200,
    });
  });

  it('rerenders only matching keyed query instances in enhanced mutation responses', async () => {
    const product = domain('product');
    const productP1 = query('productDetail', {
      instanceKey: 'product:p1',
      load: () => ({ id: 'p1', stock: 0 }),
      reads: [product],
    });
    const productP2 = query('productDetail', {
      instanceKey: 'product:p2',
      load: () => ({ id: 'p2', stock: 10 }),
      reads: [product],
    });
    const reserveProduct = mutation('product/reserve', {
      input: s.object({ productId: s.string() }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [productP1, productP2],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(reserveProduct, {
        fragmentRenderers: [],
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Targets': 'product-card:p1=product:p1',
        },
        rawInput: { productId: 'p1' },
        redirectTo: '/products/p1',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '<kovo-query name="productDetail" key="product:p1">{"id":"p1","stock":0}</kovo-query>',
      status: 200,
    });
  });

  it('uses compiler-registered mutation touch sites for direct enhanced responses', async () => {
    const cart = domain('generated-direct-cart-fallback');
    const product = domain('generated-direct-product');
    const productP1 = query('generatedProductDetail', {
      instanceKey: 'generated-direct-product:p1',
      load: () => ({ id: 'p1', stock: 0 }),
      reads: [product],
    });
    const productP2 = query('generatedProductDetail', {
      instanceKey: 'generated-direct-product:p2',
      load: () => ({ id: 'p2', stock: 10 }),
      reads: [product],
    });
    const reserveProduct = mutation('generated/product/reserve-direct', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [productP1, productP2],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });

    registerGeneratedMutationTouchRegistry({
      'generated/product/reserve-direct': [
        { domain: 'generated-direct-product', keys: 'arg:productId' },
      ],
    });
    expect(registeredGeneratedMutationTouches('generated/product/reserve-direct')).toEqual([
      { domain: 'generated-direct-product', keys: 'arg:productId' },
    ]);

    const response = await renderMutationEndpointResponse(reserveProduct, {
      fragmentRenderers: [],
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Targets': 'product-card:p1=generated-direct-product:p1',
      },
      rawInput: { productId: 'p1' },
      redirectTo: '/products/p1',
      request: {},
    });

    expect(response).toEqual({
      body: '',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': 'mutation-endpoint-test-build',
        'Kovo-Changes': '[{"domain":"generated-direct-product","keys":["p1"]}]',
        Vary: 'Cookie',
      },
      status: 200,
    });
  });

  it('uses compiler-registered query reads for direct enhanced responses', async () => {
    const cart = domain('generated-query-read-cart-fallback');
    const catalogQuery = query('generatedCatalogRead', {
      load: () => ({ items: ['p1'] }),
    });
    const refreshCatalog = mutation('generated/catalog/refresh', {
      input: s.object({}),
      registry: {
        queries: [catalogQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });

    registerGeneratedQueryReadRegistry([
      { domains: ['generated-catalog-read'], query: 'generatedCatalogRead' },
    ]);
    registerGeneratedMutationTouchRegistry({
      'generated/catalog/refresh': [{ domain: 'generated-catalog-read', keys: null }],
    });

    await expect(
      renderMutationEndpointResponse(refreshCatalog, {
        fragmentRenderers: [],
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Targets': 'catalog-region=generatedCatalogRead',
        },
        rawInput: {},
        redirectTo: '/catalog',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '<kovo-query name="generatedCatalogRead">{"items":["p1"]}</kovo-query>',
      status: 200,
    });
  });

  it('routes mutation endpoint validation failures by request mode', async () => {
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
      renderMutationEndpointResponse(addToCart, {
        failureTarget: 'cart-form',
        headers: { 'Kovo-Fragment': 'true' },
        rawInput: { productId: 'p1', quantity: 0 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="cart-form"><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></kovo-fragment>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': 'mutation-endpoint-test-build',
        Vary: 'Cookie',
      },
      status: 422,
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {},
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

  it('defaults enhanced failures to the submitted generated live target renderer', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 2 });
      },
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {
          'Kovo-Form-Target': 'add-to-cart:p1',
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('add-to-cart:p1', 'components/add-to-cart-form', { productId: 'p1' })}`,
        },
        liveTargetRenderers: [
          {
            component: 'components/add-to-cart-form',
            render: ({ failure, mutationKey, props }) => {
              if (!failure) throw new Error('expected mutation failure context');
              const payload = failure.error.payload as { availableQuantity: number };
              return `<form data-product="${String(props.productId)}" data-mutation="${mutationKey ?? ''}"><output role="alert" data-error-code="${failure.error.code}">${payload.availableQuantity}</output></form>`;
            },
          },
        ],
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="add-to-cart:p1"><form data-product="p1" data-mutation="cart/add"><output role="alert" data-error-code="OUT_OF_STOCK">2</output></form></kovo-fragment>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': 'mutation-endpoint-test-build',
        Vary: 'Cookie',
      },
      status: 422,
    });
  });

  it('renders structurally recognized input schema failures as field-scoped 422 fragments', async () => {
    const reserve = mutation('inventory/reserve', {
      input: alienValidationSchema<{ quantity: number }>('Expected number >= 1', ['quantity']),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(reserve, {
        failureTarget: 'reservation-form',
        headers: { 'Kovo-Fragment': 'true' },
        rawInput: {},
        redirectTo: '/',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="reservation-form"><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></kovo-fragment>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': 'mutation-endpoint-test-build',
        Vary: 'Cookie',
      },
      status: 422,
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
