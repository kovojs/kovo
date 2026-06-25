import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';
import { component, form } from '@kovojs/core';

import {
  coalesceMutationStreamChunks,
  errorBoundary,
  mutation as defineMutation,
  renderMutationEndpointResponse,
  renderMutationResponse,
  stream,
} from './mutation.js';
import { renderComponentMutationFailure } from './component-render.js';
import { domain } from './domain.js';
import { renderedHtml } from './html.js';
import { createMemoryMutationReplayStore } from './replay.js';
import { query } from './query.js';
import { s } from './schema.js';
import {
  cartMutationFragmentRenderers,
  cartMutationTargets,
  createCartMutationFixture,
  testMutation as mutation,
} from './test-fixtures.js';
import { componentLiveTargetRenderer } from './live-target-renderer.js';
import { createLiveTargetAttestation } from './mutation-wire.js';

function attestedLiveTargetHeader(
  target: string,
  component: string,
  props: Record<string, unknown> = {},
): string {
  const token = createLiveTargetAttestation({ component, props, target }, { request: {} });
  return `${target}#${component}@${token}:${JSON.stringify(props)}`;
}

describe('server mutation primitives', () => {
  it('rejects raw string streaming fragments while keeping stream.text as escaped text', () => {
    const assertRawFragmentRejected = () => {
      stream.fragment({
        // @ts-expect-error SPEC §9.1: streaming fragment markup needs rendered JSX or trustedHtml().
        html: '<article>raw</article>',
        target: 'messages',
      });
    };

    expect(assertRawFragmentRejected).toBeTypeOf('function');
    expect(stream.text('messages', '<article>text</article>')).toEqual({
      kind: 'text',
      target: 'messages',
      text: '<article>text</article>',
    });
  });

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
        Vary: 'Cookie',
      },
      status: 200,
    });
    expect(coveredCartBadge).not.toHaveBeenCalled();
    expect(uncoveredCartSummary).toHaveBeenCalledOnce();
    expect(accountLoad).not.toHaveBeenCalled();
  });

  it('auto-renders affected live target descriptors from generated renderers', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 2 }),
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
    const renderCartPanel = vi.fn(
      ({
        props,
        request,
        target,
      }: {
        props: Record<string, unknown>;
        request: unknown;
        target: string;
      }) =>
        `<cart-panel data-target="${target}">${(request as { tenant: string }).tenant}:${String(props.cartId)}</cart-panel>`,
    );

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart-panel', 'components/cart/panel', { cartId: 'c1' })}`,
          'Kovo-Targets': 'cart-panel=cart',
        },
        liveTargetRenderers: [
          {
            component: 'components/cart/panel',
            queries: ['cart'],
            render: renderCartPanel,
          },
        ],
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: { tenant: 'shop' },
      }),
    ).resolves.toMatchObject({
      body: [
        '<kovo-query name="cart">{"count":2}</kovo-query>',
        '<kovo-fragment target="cart-panel"><cart-panel data-target="cart-panel">shop:c1</cart-panel></kovo-fragment>',
      ].join('\n'),
      headers: {
        'Kovo-Changes': '[{"domain":"cart"}]',
        Vary: 'Cookie',
      },
      status: 200,
    });
    expect(renderCartPanel).toHaveBeenCalledOnce();
  });

  it('does not let generated live target descriptors bypass the submitted live DOM targets', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 2 }),
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
    const renderAdminPanel = vi.fn(() => '<admin-panel>secret</admin-panel>');

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('admin-panel', 'components/admin/panel')}`,
          'Kovo-Targets': 'cart-badge=cart',
        },
        liveTargetRenderers: [
          {
            component: 'components/admin/panel',
            queries: ['cart'],
            render: renderAdminPanel,
          },
        ],
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '<kovo-query name="cart">{"count":2}</kovo-query>',
      status: 200,
    });
    expect(renderAdminPanel).not.toHaveBeenCalled();
  });

  it('matches generated live target descriptors by component-bound query instance identity', async () => {
    const product = domain('product');
    const productLoad = vi.fn((input) => ({ id: (input as { id: string }).id }));
    const productQuery = query('product', {
      instanceKey: (input) => `product:${(input as { id: string }).id}`,
      load: productLoad,
      reads: [product],
    });
    const ProductCard = component({
      render: ({ product }) => renderedHtml(`<product-card>${product.id}</product-card>`),
    });
    const reserveProduct = mutation('product/reserve', {
      input: s.object({ productId: s.string() }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [productQuery],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(reserveProduct, {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': [
            `${attestedLiveTargetHeader('product-card:p1', 'components/product/card', { productId: 'p1' })}`,
            `${attestedLiveTargetHeader('product-card:p2', 'components/product/card', { productId: 'p2' })}`,
          ].join('; '),
          'Kovo-Targets': 'product-card:p1=product:p1; product-card:p2=product:p2',
        },
        liveTargetRenderers: [
          componentLiveTargetRenderer({
            component: ProductCard,
            componentId: 'components/product/card',
            queries: [
              {
                args: (props) => ({ id: props.productId }),
                name: 'product',
                query: productQuery,
              },
            ],
          }),
        ],
        rawInput: { productId: 'p1' },
        redirectTo: '/products/p1',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: [
        '<kovo-query name="product" key="product:p1">{"id":"p1"}</kovo-query>',
        '<kovo-fragment target="product-card:p1"><product-card>p1</product-card></kovo-fragment>',
      ].join('\n'),
      status: 200,
    });
    expect(productLoad).toHaveBeenCalledWith({ id: 'p1' }, { request: {} });
    expect(productLoad).not.toHaveBeenCalledWith({ id: 'p2' }, { request: {} });
  });

  it('does not match broad query deps for instance-specific live target invalidations', async () => {
    const product = domain('product');
    const productQuery = query('product', {
      instanceKey: (input) => `product:${(input as { id: string }).id}`,
      load: (input) => ({ id: (input as { id: string }).id }),
      reads: [product],
    });
    const ProductCard = component({
      render: ({ product }) => renderedHtml(`<product-card>${product.id}</product-card>`),
    });
    const reserveProduct = mutation('product/reserve', {
      input: s.object({ productId: s.string() }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [productQuery],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(reserveProduct, {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('product-card:p2', 'components/product/card', { productId: 'p2' })}`,
          'Kovo-Targets': 'product-card:p2=product',
        },
        liveTargetRenderers: [
          componentLiveTargetRenderer({
            component: ProductCard,
            componentId: 'components/product/card',
            queries: [
              {
                args: (props) => ({ id: props.productId }),
                name: 'product',
                query: productQuery,
              },
            ],
          }),
        ],
        rawInput: { productId: 'p1' },
        redirectTo: '/products/p1',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '',
      status: 200,
    });
  });

  it('reruns generated live target query chunks with component-bound query input', async () => {
    const question = domain('question');
    const questionLoad = vi.fn((input) => ({ id: (input as { id: string }).id }));
    const questionDetail = query('questionDetail', {
      instanceKey: (input) => `question:${(input as { id: string }).id}`,
      load: questionLoad,
      reads: [question],
    });
    const QuestionDetail = component({
      render: ({ question }) => renderedHtml(`<question-detail>${question.id}</question-detail>`),
    });
    const postAnswer = mutation('answer/post', {
      input: s.object({ id: s.string(), questionId: s.string() }),
      registry: {
        inferredTouches: [{ domain: 'question', keys: 'arg:questionId' }],
        queries: [questionDetail],
      },
      handler(input) {
        return input;
      },
    });

    await expect(
      renderMutationEndpointResponse(postAnswer, {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('question-detail-region', 'components/question/detail', { questionId: 'q1' })}`,
          'Kovo-Targets': 'question-detail-region=question:q1',
        },
        liveTargetRenderers: [
          componentLiveTargetRenderer({
            component: QuestionDetail,
            componentId: 'components/question/detail',
            queries: [
              {
                args: (props) => ({ id: props.questionId }),
                name: 'question',
                query: questionDetail,
              },
            ],
          }),
        ],
        rawInput: { id: 'a2', questionId: 'q1' },
        redirectTo: '/questions/q1',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: [
        '<kovo-query name="questionDetail" key="question:q1">{"id":"q1"}</kovo-query>',
        '<kovo-fragment target="question-detail-region"><question-detail>q1</question-detail></kovo-fragment>',
      ].join('\n'),
      status: 200,
    });
    expect(questionLoad).toHaveBeenCalledWith({ id: 'q1' }, { request: {} });
    expect(questionLoad).not.toHaveBeenCalledWith({ id: 'a2' }, { request: {} });
  });

  it('renders generated live target error boundaries per affected descriptor', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 2 }),
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
    const renderCartPanel = vi.fn(() => {
      throw new Error('cart panel unavailable');
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart-panel', 'components/cart/panel', { cartId: 'c1' })}`,
          'Kovo-Targets': 'cart-panel=cart',
        },
        liveTargetRenderers: [
          {
            component: 'components/cart/panel',
            errorBoundary: {
              render(error) {
                return `<section role="alert">${(error as Error).message}</section>`;
              },
            },
            queries: ['cart'],
            render: renderCartPanel,
          },
        ],
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: [
        '<kovo-query name="cart">{"count":2}</kovo-query>',
        '<kovo-fragment target="cart-panel" error-boundary="cart-panel"><section role="alert">cart panel unavailable</section></kovo-fragment>',
      ].join('\n'),
      headers: {
        'Kovo-Changes': '[{"domain":"cart"}]',
        Vary: 'Cookie',
      },
      status: 200,
    });
    expect(renderCartPanel).toHaveBeenCalledOnce();
  });

  it('uses component-local error boundaries for generated live-target fragment failures', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 2 }),
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
    const CartPanel = component({
      errorBoundary: {
        fallback: renderedHtml('<section role="alert">Cart panel unavailable.</section>'),
        target: 'cart-panel',
      },
      queries: { cart: cartQuery },
      render: () => {
        throw new Error('cart panel failed');
      },
    });

    await expect(
      renderMutationEndpointResponse(addToCart, {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart-panel', 'components/cart/panel')}`,
          'Kovo-Targets': 'cart-panel=cart',
        },
        liveTargetRenderers: [
          componentLiveTargetRenderer({
            component: CartPanel,
            componentId: 'components/cart/panel',
          }),
        ],
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: [
        '<kovo-query name="cart">{"count":2}</kovo-query>',
        '<kovo-fragment target="cart-panel" error-boundary="cart-panel"><section role="alert">Cart panel unavailable.</section></kovo-fragment>',
      ].join('\n'),
      headers: {
        'Kovo-Changes': '[{"domain":"cart"}]',
        Vary: 'Cookie',
      },
      status: 200,
    });
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
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        Vary: 'Cookie',
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
      render: (_queries, _state, { forms }) =>
        renderedHtml(
          `<form>` +
            (forms.addToCart.failure?.code === 'OUT_OF_STOCK'
              ? `<output role="alert" data-error-code="OUT_OF_STOCK">Only ${forms.addToCart.failure.payload.availableQuantity} left.</output>`
              : '') +
            `</form>`,
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
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        Vary: 'Cookie',
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
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[{"domain":"cart"}]',
        Vary: 'Cookie',
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
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[{"domain":"cart"}]',
        Vary: 'Cookie',
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
        Vary: 'Cookie',
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
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[]',
        Vary: 'Cookie',
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
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[]',
        Vary: 'Cookie',
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
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        Vary: 'Cookie',
      },
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
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        Vary: 'Cookie',
      },
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
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        Vary: 'Cookie',
      },
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
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        Vary: 'Cookie',
      },
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
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 422,
    });
  });

  it('streams mutation chunks after validation and reconciles with final server truth', async () => {
    const chat = domain('chat');
    const chatQuery = query('chat', {
      load: () => ({ messages: 2 }),
      reads: [chat],
    });
    const sendMessage = mutation('chat/send', {
      input: s.object({ body: s.string() }),
      registry: {
        queries: [chatQuery],
        touches: [chat],
      },
      handler(input, _request, context) {
        context.invalidate(chat);
        return { assistantId: 'a1', body: input.body };
      },
      async *stream({ result }) {
        yield stream.fragment({
          html: trustedHtml(
            '<article data-role="assistant"><span data-stream-text="assistant:a1"></span></article>',
          ),
          mode: 'append',
          target: 'messages',
        });
        yield stream.text('assistant:a1', 'Hel');
        yield stream.text('assistant:a1', 'lo <strong>');
        yield stream.text('assistant:a1', 'Hello server', { mode: 'checkpoint' });
        yield stream.text('assistant:a1', ` truth:${result.value.assistantId}`);
      },
    });

    const response = await renderMutationEndpointResponse(sendMessage, {
      fragmentRenderers: [
        {
          render: () => '<article data-role="assistant"><p>Hello server truth:a1</p></article>',
          target: 'messages',
        },
      ],
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Stream': 'true',
        'Kovo-Targets': 'messages=chat',
      },
      rawInput: { body: 'Hi' },
      redirectTo: '/chat',
      request: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(ReadableStream);
    const body = await readResponseBody(response.body);
    expect(body).toBe(
      [
        '<kovo-fragment target="messages" mode="append"><article data-role="assistant"><span data-stream-text="assistant:a1"></span></article></kovo-fragment>',
        '<kovo-text target="assistant:a1">Hello &lt;strong&gt;</kovo-text>',
        '<kovo-text target="assistant:a1" mode="checkpoint">Hello server</kovo-text>',
        '<kovo-text target="assistant:a1"> truth:a1</kovo-text>',
        '<kovo-fragment target="messages"><article data-role="assistant"><p>Hello server truth:a1</p></article></kovo-fragment>',
        '<kovo-done></kovo-done>',
        '',
      ].join('\n'),
    );

    const bufferedResponse = await renderMutationEndpointResponse(sendMessage, {
      fragmentRenderers: [
        {
          render: () => '<article data-role="assistant"><p>Hello server truth:a1</p></article>',
          target: 'messages',
        },
      ],
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Targets': 'messages=chat',
      },
      rawInput: { body: 'Hi' },
      redirectTo: '/chat',
      request: {},
    });
    expect(typeof bufferedResponse.body).toBe('string');
    expect(body).toContain(bufferedResponse.body as string);
  });

  it('keeps the buffered enhanced mutation path when Kovo-Stream is absent', async () => {
    const chat = domain('chat-buffered');
    const chatQuery = query('chatBuffered', {
      load: () => ({ messages: 1 }),
      reads: [chat],
    });
    const streamSpy = vi.fn();
    const sendMessage = mutation('chat/send-buffered', {
      input: s.object({ body: s.string() }),
      registry: {
        queries: [chatQuery],
        touches: [chat],
      },
      handler(input) {
        return input;
      },
      *stream() {
        streamSpy();
        yield stream.text('assistant:a1', 'should not run');
      },
    });

    const response = await renderMutationEndpointResponse(sendMessage, {
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Targets': 'messages=chat-buffered',
      },
      rawInput: { body: 'Hi' },
      redirectTo: '/chat',
      request: {},
    });

    expect(response).toMatchObject({
      body: '',
      status: 200,
    });
    expect(response.body).not.toBeInstanceOf(ReadableStream);
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('lets stream.done terminate a streaming mutation before final reconciliation', async () => {
    const sendMessage = mutation('chat/send-done', {
      input: s.object({ body: s.string() }),
      handler(input) {
        return { body: input.body };
      },
      *stream() {
        yield stream.text('assistant:a1', 'partial');
        yield stream.done({ reason: 'error' });
      },
    });

    const response = await renderMutationEndpointResponse(sendMessage, {
      fragmentRenderers: [
        {
          render: () => '<article>final truth</article>',
          target: 'messages',
        },
      ],
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Stream': 'true',
        'Kovo-Targets': 'messages=chat',
      },
      rawInput: { body: 'Hi' },
      redirectTo: '/chat',
      request: {},
    });

    expect(response.body).toBeInstanceOf(ReadableStream);
    await expect(readResponseBody(response.body)).resolves.toBe(
      '<kovo-text target="assistant:a1">partial</kovo-text>\n<kovo-done reason="error"></kovo-done>\n',
    );
  });

  it('does not invoke mutation streams for CSRF failures', async () => {
    const streamSpy = vi.fn();
    const sendMessage = defineMutation('chat/send-csrf', {
      input: s.object({ body: s.string() }),
      handler(input) {
        return input;
      },
      *stream() {
        streamSpy();
        yield stream.text('assistant:a1', 'should not run');
      },
    });

    await expect(
      renderMutationEndpointResponse(sendMessage, {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Stream': 'true',
        },
        rawInput: { body: 'Hi' },
        redirectTo: '/chat',
        request: {},
      }),
    ).resolves.toMatchObject({ status: 422 });
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('does not invoke mutation streams for schema failures', async () => {
    const streamSpy = vi.fn();
    const sendMessage = mutation('chat/send-invalid', {
      input: s.object({ body: s.string() }),
      handler(input) {
        return input;
      },
      *stream() {
        streamSpy();
        yield stream.text('assistant:a1', 'should not run');
      },
    });

    await expect(
      renderMutationEndpointResponse(sendMessage, {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Stream': 'true',
        },
        rawInput: {},
        redirectTo: '/chat',
        request: {},
      }),
    ).resolves.toMatchObject({ status: 422 });
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('does not invoke mutation streams for guard failures', async () => {
    const streamSpy = vi.fn();
    const sendMessage = mutation('chat/send-guarded', {
      guard: () => false,
      input: s.object({ body: s.string() }),
      handler(input) {
        return input;
      },
      *stream() {
        streamSpy();
        yield stream.text('assistant:a1', 'should not run');
      },
    });

    await expect(
      renderMutationEndpointResponse(sendMessage, {
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Stream': 'true',
        },
        rawInput: { body: 'Hi' },
        redirectTo: '/chat',
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '',
      headers: {
        'Cache-Control': 'private, no-store',
        'Kovo-Reauth': '/login?next=%2F',
      },
      status: 401,
    });
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('commits streaming responses to replay without rerunning the handler or stream', async () => {
    const replayStore = createMemoryMutationReplayStore();
    const streamSpy = vi.fn();
    const handlerSpy = vi.fn((input: { body: string }) => input);
    const sendMessage = mutation('chat/send-replay', {
      input: s.object({ body: s.string() }),
      handler: handlerSpy,
      *stream() {
        streamSpy();
        yield stream.text('assistant:a1', 'first response only');
      },
    });
    const request = {
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_stream',
        'Kovo-Stream': 'true',
      },
      rawInput: { body: 'Hi' },
      redirectTo: '/chat',
      replayStore,
      request: { sessionId: 's1' },
    };

    const first = await renderMutationEndpointResponse(sendMessage, request);
    expect(first.body).toBeInstanceOf(ReadableStream);
    await expect(readResponseBody(first.body)).resolves.toContain('first response only');

    // A3 (SPEC §10.3:1063 + §9): the replayed body must contain the full settled stream
    // (streamed chunks + <kovo-done>), not the head-only empty body committed before the
    // stream ran. This inverts the previous `toBe('')` assertion that codified the loss.
    const second = await renderMutationEndpointResponse(sendMessage, request);
    expect(typeof second.body).toBe('string');
    expect(second.body).toContain('first response only');
    expect(second.body).toContain('<kovo-done>');
    expect(handlerSpy).toHaveBeenCalledOnce();
    expect(streamSpy).toHaveBeenCalledOnce();
  });

  it('coalesces small text chunks by size and checkpoint boundaries', async () => {
    await expect(
      collectAsync(
        coalesceMutationStreamChunks(
          [
            stream.text('assistant:a1', 'He'),
            stream.text('assistant:a1', 'llo'),
            stream.text('assistant:a1', ' server', { mode: 'checkpoint' }),
            stream.text('assistant:a1', '!'),
          ],
          { maxTextChars: 5 },
        ),
      ),
    ).resolves.toEqual([
      stream.text('assistant:a1', 'Hello', { mode: 'append' }),
      stream.text('assistant:a1', ' server', { mode: 'checkpoint' }),
      stream.text('assistant:a1', '!', { mode: 'append' }),
    ]);
  });

  it('coalesces small text chunks by a deterministic flush timer', async () => {
    vi.useFakeTimers();
    try {
      const iterator = coalesceMutationStreamChunks(delayedTextChunks(), {
        maxDelayMs: 25,
        maxTextChars: 100,
      })[Symbol.asyncIterator]();

      const first = iterator.next();
      await vi.advanceTimersByTimeAsync(24);
      const pending = vi.fn();
      void first.then(pending);
      await Promise.resolve();
      expect(pending).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await expect(first).resolves.toEqual({
        done: false,
        value: stream.text('assistant:a1', 'Hel', { mode: 'append' }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // H4 (SPEC §9): the streaming ReadableStream must have a cancel() handler that
  // calls return() on the source iterator so generator cleanup (finally) runs on
  // client disconnect. Uses a sync generator because calling return() on an async
  // generator that is suspended at an internal `await` (not a `yield`) cannot be
  // interrupted by V8's async generator protocol.
  it('H4: reader.cancel() propagates to the source iterator via the cancel handler', async () => {
    let finallyRan = false;

    const sendMessage = mutation('chat/h4', {
      input: s.object({ body: s.string() }),
      handler: (input) => input,
      *stream() {
        try {
          yield stream.text('assistant:a1', 'chunk 1');
          // chunk 2 is never reached after cancel().
          yield stream.text('assistant:a1', 'chunk 2 (unreachable)');
        } finally {
          finallyRan = true;
        }
      },
    });

    const response = await renderMutationEndpointResponse(sendMessage, {
      headers: { 'Kovo-Fragment': 'true', 'Kovo-Stream': 'true' },
      rawInput: { body: 'hi' },
      redirectTo: '/chat',
      request: {},
    });

    expect(response.body).toBeInstanceOf(ReadableStream);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    // Read the first chunk (generator advances past first yield).
    const first = await reader.read();
    expect(first.done).toBe(false);

    // Cancel the stream before reading chunk 2 — simulates client disconnect.
    // The ReadableStream cancel() handler calls sourceIterator.return(), which
    // causes the sync generator's finally block to run immediately.
    await reader.cancel();

    // Flush pending microtasks.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(finallyRan).toBe(true);
  });

  // L10-1 (SPEC §9): a streaming mutation generator that throws mid-stream must report
  // the error via onError AND emit a <kovo-done reason="error"> failure terminator so the
  // client observes a clean end-of-stream instead of a silent hang.
  it('L10-1: streaming generator that throws mid-stream reports onError and emits a done terminator', async () => {
    const onError = vi.fn();
    const thrown = new Error('stream boom');
    const sendMessage = mutation('chat/stream-error', {
      input: s.object({ body: s.string() }),
      handler: (input) => input,
      *stream() {
        yield stream.text('assistant:a1', 'partial');
        throw thrown;
      },
    });

    const response = await renderMutationEndpointResponse(sendMessage, {
      headers: { 'Kovo-Fragment': 'true', 'Kovo-Stream': 'true' },
      onError,
      rawInput: { body: 'hi' },
      redirectTo: '/chat',
      request: {},
    });

    expect(response.body).toBeInstanceOf(ReadableStream);
    const body = await readResponseBody(response.body);
    expect(body).toContain('<kovo-text target="assistant:a1">partial</kovo-text>');
    expect(body).toContain('<kovo-done reason="error">');

    expect(onError).toHaveBeenCalledWith(thrown, {
      mutationKey: 'chat/stream-error',
      operation: 'mutation-stream',
      request: {},
      targets: [],
    });
  });
});

async function readResponseBody(body: ReadableStream<Uint8Array> | string): Promise<string> {
  if (typeof body === 'string') return body;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let output = '';

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return output;
    output += decoder.decode(chunk.value, { stream: true });
  }
}

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

async function* delayedTextChunks(): AsyncIterable<ReturnType<typeof stream.text>> {
  yield stream.text('assistant:a1', 'Hel');
  await new Promise<never>(() => undefined);
}
