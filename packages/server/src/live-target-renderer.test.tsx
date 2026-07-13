/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { domain } from './domain.js';
import { registerGeneratedQueryReadRegistry } from './generated-query-registry.js';
import { componentLiveTargetRenderer } from './live-target-renderer.js';
import { query, queryRuntimeWarningsFromRequest } from './query.js';
import { s } from './schema.js';
import { createLiveTargetTestAuthority } from './test-fixtures.js';

const liveTargetRendererTestAuthority = createLiveTargetTestAuthority(
  'live-target-renderer-test-build',
);

describe('generated component live target renderers', () => {
  it('closes over immutable query and error-boundary construction facts', async () => {
    const records = domain('records');
    const reviewedQuery = query('reviewed-record', {
      load: () => ({ label: 'SAFE' }),
      reads: [records],
    });
    const binding = { name: 'record', query: reviewedQuery };
    const boundary = { fallback: () => <output>SAFE BOUNDARY</output> };
    const RecordRegion = component({
      errorBoundary: boundary,
      render: ({ record }: { record: { label: string } }) => <section>{record.label}</section>,
    });
    const renderer = componentLiveTargetRenderer({
      component: RecordRegion,
      componentId: 'components/record/region',
      queries: [binding],
    }) as ReturnType<typeof componentLiveTargetRenderer> & {
      queryBindings: readonly Readonly<{ query: typeof reviewedQuery }>[];
    };

    expect(Object.isFrozen(renderer)).toBe(true);
    expect(Object.isFrozen(renderer.mutationKeys)).toBe(true);
    expect(renderer.mutationKeys).toEqual([]);
    expect(Object.isFrozen(renderer.queries)).toBe(true);
    expect(Object.isFrozen(renderer.queryDefinitions)).toBe(true);
    expect(Object.isFrozen(renderer.queryBindings)).toBe(true);
    expect(Object.isFrozen(renderer.queryBindings[0])).toBe(true);
    expect(Object.isFrozen(renderer.queryBindings[0]!.query)).toBe(true);
    expect(Object.isFrozen(renderer.errorBoundary)).toBe(true);

    binding.query = query('reviewed-record', {
      load: () => ({ label: 'LEAKED' }),
      reads: [records],
    });
    reviewedQuery.load = () => ({ label: 'LEAKED' });
    boundary.fallback = () => <output>LEAKED BOUNDARY</output>;

    const html = await renderer.render({
      attestationAuthority: liveTargetRendererTestAuthority.authority,
      input: {},
      props: {},
      request: {},
      target: 'record',
    });
    expect(html).toContain('>SAFE</section>');
    expect(html).not.toContain('LEAKED');
    expect(String(renderer.errorBoundary?.render(new Error('boom'), {}))).toContain(
      'SAFE BOUNDARY',
    );
    expect(String(renderer.errorBoundary?.render(new Error('boom'), {}))).not.toContain('LEAKED');
  });

  it('rejects accessor-backed compiler renderer options and query bindings', () => {
    const stableQuery = query('accessor-record', { load: () => ({ ok: true }), reads: [] });
    const Region = component({ render: () => <section /> });
    const optionsWithAccessor = {
      component: Region,
      get componentId() {
        return 'components/accessor/region';
      },
    };
    expect(() => componentLiveTargetRenderer(optionsWithAccessor)).toThrow(
      'componentId must be a stable own data property',
    );

    const bindingWithAccessor = {
      name: 'record',
      get query() {
        return stableQuery;
      },
    };
    expect(() =>
      componentLiveTargetRenderer({
        component: Region,
        componentId: 'components/accessor/region',
        queries: [bindingWithAccessor],
      }),
    ).toThrow('query must be a stable own data property');
  });

  it('loads declared queries from serialized props and renders the component', async () => {
    const product = domain('product');
    const productQuery = query('product', {
      args: s.object({ id: s.string() }),
      load(input: { id: string }, { request }: { request: { locale: string } }) {
        return { id: input.id, label: `${request.locale}:${input.id}` };
      },
      reads: [product],
    });
    const ProductDetail = component({
      props: { productId: String },
      queries: {
        product: productQuery.args((props: { productId: string }) => ({ id: props.productId })),
      },
      render: ({
        product,
        productId,
      }: {
        product: { id: string; label: string };
        productId: string;
      }) => (
        <section data-product={product.id} data-prop={productId}>
          {product.label}
        </section>
      ),
    });

    const renderer = componentLiveTargetRenderer({
      component: ProductDetail,
      componentId: 'components/product-detail/product-detail',
    });

    expect(renderer.queries).toEqual(['product']);
    expect(renderer.queryDefinitions?.map((queryDefinition) => queryDefinition.key)).toEqual([
      productQuery.key,
    ]);
    const html = await renderer.render({
      attestationAuthority: liveTargetRendererTestAuthority.authority,
      input: {},
      props: { productId: 'p1' },
      request: { locale: 'en-US' },
      target: 'product-detail:p1',
    });

    expect(html).toContain('data-product="p1"');
    expect(html).toContain('data-prop="p1"');
    expect(html).toContain('>en-US:p1</section>');
    expect(html).toContain('kovo-c="product-detail"');
    expect(html).toContain('kovo-deps="product"');
    expect(html).toContain('kovo-fragment-target="product-detail:p1"');
    expect(html).toContain('kovo-live-component="components/product-detail/product-detail"');
    expect(html).toContain('kovo-live-token="');
    expect(html).toContain('kovo-props="{&quot;productId&quot;:&quot;p1&quot;}"');
  });

  it('folds generated query reads into component-bound live target query definitions', async () => {
    const productQuery = query('generatedLiveProduct', {
      args: s.object({ id: s.string() }),
      load(input: { id: string }) {
        return { id: input.id };
      },
    });
    const ProductDetail = component({
      queries: {
        product: productQuery.args((props: { productId: string }) => ({ id: props.productId })),
      },
      render: () => <section />,
    });

    registerGeneratedQueryReadRegistry([
      { domains: ['generated-live-product'], query: 'generatedLiveProduct' },
    ]);
    const renderer = componentLiveTargetRenderer({
      component: ProductDetail,
      componentId: 'components/generated-product-detail/product-detail',
    });

    expect(renderer.queryDefinitions?.[0]?.reads).toEqual([{ key: 'generated-live-product' }]);
  });

  it('folds generated query reads into compiler-emitted live target query bindings', async () => {
    const productQuery = query('generatedExplicitLiveProduct', {
      args: s.object({ id: s.string() }),
      load(input: { id: string }) {
        return { id: input.id };
      },
    });
    const ProductDetail = component({
      render: () => <section />,
    });

    registerGeneratedQueryReadRegistry([
      { domains: ['generated-explicit-live-product'], query: 'generatedExplicitLiveProduct' },
    ]);
    const renderer = componentLiveTargetRenderer({
      component: ProductDetail,
      componentId: 'components/generated-explicit-product-detail/product-detail',
      queries: [
        {
          args: (props) => ({ id: props.productId }),
          name: 'product',
          query: productQuery,
        },
      ],
    });

    expect(renderer.queryDefinitions?.[0]?.reads).toEqual([
      { key: 'generated-explicit-live-product' },
    ]);
  });

  it('throws when a generated query reload fails', async () => {
    const product = domain('product');
    const productQuery = query('product', {
      args: s.object({ id: s.string() }),
      load(input: { id: string }) {
        return { id: input.id };
      },
      reads: [product],
    });
    const ProductDetail = component({
      queries: { product: productQuery },
      render: () => <section />,
    });
    const renderer = componentLiveTargetRenderer({
      component: ProductDetail,
      componentId: 'components/product-detail/product-detail',
    });

    await expect(
      renderer.render({
        attestationAuthority: liveTargetRendererTestAuthority.authority,
        input: {},
        props: {},
        request: {},
        target: 'product-detail',
      }),
    ).rejects.toThrow('Live target query failed: product');
  });

  it('provides request and default mutation form slots while rendering', async () => {
    const cart = domain('cart');
    const addToCart = form('cart/add');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const CartForm = component({
      mutations: { addToCart },
      queries: { cart: cartQuery },
      render: ({ cart }: { cart: { count: number } }, _state, slots) => (
        <form data-count={cart.count} data-request={slots.request === undefined ? 'no' : 'yes'}>
          {slots.forms.addToCart.failure ? 'failed' : 'ready'}
        </form>
      ),
    });
    const renderer = componentLiveTargetRenderer({
      component: CartForm,
      componentId: 'components/cart-form/cart-form',
    });
    expect(renderer.mutationKeys).toEqual(['cart/add']);
    expect(Object.isFrozen(renderer.mutationKeys)).toBe(true);

    const html = await renderer.render({
      attestationAuthority: liveTargetRendererTestAuthority.authority,
      input: {},
      props: {},
      request: { csrf: 'token' },
      target: 'cart-form',
    });

    expect(html).toContain('data-count="1"');
    expect(html).toContain('data-request="yes"');
    expect(html).toContain('>ready</form>');
    expect(html).toContain('kovo-c="cart-form"');
    expect(html).toContain('kovo-deps="cart"');
    expect(html).toContain('kovo-fragment-target="cart-form"');
    expect(html).toContain('kovo-live-component="components/cart-form/cart-form"');
    expect(html).toContain('kovo-live-token="');
  });

  it('records query warnings from live target query reloads on the lifecycle request', async () => {
    const cartQuery = query('liveTargetWarning', {
      load: () => ({ items: Array.from({ length: 105 }, (_, id) => ({ id })) }),
      reads: [],
    });
    const Cart = component({
      queries: { cart: cartQuery },
      render: ({ cart }: { cart: { items: unknown[] } }) => (
        <section data-count={cart.items.length} />
      ),
    });
    const renderer = componentLiveTargetRenderer({
      component: Cart,
      componentId: 'components/cart/cart',
    });
    const request = {};

    const html = await renderer.render({
      attestationAuthority: liveTargetRendererTestAuthority.authority,
      input: {},
      maxListItems: 2,
      props: {},
      request,
      target: 'cart',
    });

    expect(String(html)).toContain('data-count="2"');
    expect(queryRuntimeWarningsFromRequest(request)).toEqual([
      { code: 'QUERY_LIST_LIMIT', limit: 2, path: '$.items' },
    ]);
  });
});
