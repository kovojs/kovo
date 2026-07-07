import { describe, expect, it, vi } from 'vitest';

import { domain } from './domain.js';
import {
  registeredGeneratedMutationTouches,
  registerGeneratedMutationTouchRegistry,
} from './generated-mutation-registry.js';
import { guards } from './guards.js';
import { registerGeneratedQueryReadRegistry } from './generated-query-registry.js';
import {
  mutation as defineMutation,
  renderMutationEndpointResponse as renderMutationEndpointResponseBase,
  runMutation,
  StaleVersionError,
} from './mutation.js';
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
  it.each([
    {
      define: () =>
        defineMutation('lifecycle/invalid-csrf', {
          input: s.object({ value: s.string() }),
          handler(input) {
            return input;
          },
        }),
      direct: { ok: false, status: 422, code: 'CSRF' },
      enhanced: { status: 422, text: 'CSRF' },
      name: 'invalid CSRF',
      noJs: { status: 422, text: 'CSRF' },
      rawInput: { value: 'ok' },
    },
    {
      define: () =>
        mutation('lifecycle/invalid-body', {
          csrf: false,
          input: s.object({ value: s.string() }),
          handler(input) {
            return input;
          },
        }),
      direct: { ok: false, status: 422, code: 'VALIDATION' },
      enhanced: { status: 422, text: 'Expected string' },
      name: 'invalid schema body',
      noJs: { status: 422, text: 'Expected string' },
      rawInput: {},
    },
    {
      define: () =>
        mutation('lifecycle/rate-limit', {
          csrf: false,
          guard: guards.rateLimit({ max: 0, per: 'global', windowMs: 2_000 }),
          input: s.object({ value: s.string() }),
          handler(input) {
            return input;
          },
        }),
      direct: { ok: false, status: 429, code: 'RATE_LIMITED' },
      enhanced: { status: 429, text: 'RATE_LIMITED' },
      name: 'rate limit',
      noJs: { status: 429, text: 'RATE_LIMITED' },
      rawInput: { value: 'ok' },
    },
    {
      define: () =>
        mutation('lifecycle/stale-version', {
          csrf: false,
          input: s.object({ value: s.string() }),
          handler() {
            throw new StaleVersionError();
          },
        }),
      direct: { ok: false, status: 409, code: 'STALE_VERSION' },
      enhanced: { status: 409, text: 'STALE_VERSION' },
      name: 'stale version',
      noJs: { status: 409, text: 'STALE_VERSION' },
      rawInput: { value: 'ok' },
    },
  ])(
    'maps $name through the shared lifecycle for enhanced/no-JS/direct paths',
    async (scenario) => {
      const enhanced = await renderMutationEndpointResponse(scenario.define(), {
        headers: { 'Kovo-Fragment': 'true' },
        rawInput: scenario.rawInput,
        redirectTo: '/done',
        request: {},
      });
      expect(enhanced.status).toBe(scenario.enhanced.status);
      expect(enhanced.body).toContain(scenario.enhanced.text);

      const noJs = await renderMutationEndpointResponse(scenario.define(), {
        headers: {},
        rawInput: scenario.rawInput,
        redirectTo: '/done',
        request: {},
      });
      expect(noJs.status).toBe(scenario.noJs.status);
      expect(noJs.body).toContain(scenario.noJs.text);

      const direct = await runMutation(scenario.define(), scenario.rawInput, {});
      expect(direct.ok).toBe(scenario.direct.ok);
      expect(direct.status).toBe(scenario.direct.status);
      expect(direct.ok ? undefined : direct.error.code).toBe(scenario.direct.code);
    },
  );

  it.each([
    {
      headers: { 'Kovo-Fragment': 'true' },
      name: 'enhanced',
      operation: 'mutation-handler',
      status: 500,
    },
    {
      headers: {},
      name: 'no-JS',
      operation: 'no-js-mutation-handler',
      status: 500,
    },
  ])('maps handler throws through the shared lifecycle for $name responses', async (scenario) => {
    const thrown = new Error(`handler failed:${scenario.name}`);
    const onError = vi.fn();
    const fails = mutation(`lifecycle/handler-throw-${scenario.name}`, {
      csrf: false,
      input: s.object({ value: s.string() }),
      handler() {
        throw thrown;
      },
    });

    const response = await renderMutationEndpointResponse(fails, {
      headers: scenario.headers,
      onError,
      rawInput: { value: 'ok' },
      redirectTo: '/done',
      request: {},
    });

    expect(response.status).toBe(scenario.status);
    expect(onError).toHaveBeenCalledWith(
      thrown,
      expect.objectContaining({
        mutationKey: fails.key,
        operation: scenario.operation,
        request: {},
      }),
    );
    await expect(runMutation(fails, { value: 'ok' }, {})).rejects.toBe(thrown);
  });

  it('D1: logs default-config mutation handler exceptions to stderr', async () => {
    const thrown = new Error('handler failed:default');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fails = mutation('lifecycle/handler-throw-default-log', {
      csrf: false,
      input: s.object({ value: s.string() }),
      handler() {
        throw thrown;
      },
    });

    try {
      const response = await renderMutationEndpointResponse(fails, {
        headers: {},
        rawInput: { value: 'ok' },
        redirectTo: '/done',
        request: {},
      });

      expect(response.status).toBe(500);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[kovo] no-js-mutation-handler failed mutation=lifecycle/handler-throw-default-log',
        ),
        thrown,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

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

    const headerInjectionResponse = await renderMutationEndpointResponse(signIn, {
      headers: {},
      rawInput: { next: '/account\nSet-Cookie:owned=true' },
      redirectTo: (result) => result.value.next,
      request: {},
    });
    expect(headerInjectionResponse.status).toBe(422);
    expect(headerInjectionResponse.headers).not.toHaveProperty('Location');
    expect(headerInjectionResponse.body).toContain('data-error-path="next"');
    expect(headerInjectionResponse.body).toContain('Expected string without line terminators');
  });

  it('preserves no-JS mutation rate-limit denials as 429 with Retry-After', async () => {
    const addToCart = mutation('cart/add', {
      guard: guards.rateLimit<{ session?: { id?: string } | null }>({
        max: 0,
        per: 'global',
        windowMs: 2_000,
      }),
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
    ).resolves.toMatchObject({
      body: '<!doctype html><html><body><output role="alert" data-error-code="RATE_LIMITED">{}</output></body></html>',
      headers: expect.objectContaining({
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'Retry-After': '2',
      }),
      status: 429,
    });
  });

  it('redirects true no-JS unauthenticated auth guard failures to login', async () => {
    const addToCart = mutation('cart/add', {
      guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        currentUrl: '/cart',
        headers: {},
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: { session: null },
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/login?next=%2Fcart',
      },
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
      body:
        '<kovo-query name="generatedProductDetail" key="generated-direct-product:p1">' +
        '{"id":"p1","stock":0}</kovo-query>',
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
    ).resolves.toMatchObject({
      body: '<!doctype html><html><body><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></body></html>',
      headers: expect.objectContaining({ 'Content-Type': 'text/html; charset=utf-8' }),
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
