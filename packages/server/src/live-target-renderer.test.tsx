/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { domain } from './domain.js';
import { componentLiveTargetRenderer } from './live-target-renderer.js';
import { query } from './query.js';
import { s } from './schema.js';

describe('generated component live target renderers', () => {
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
    await expect(
      renderer.render({
        input: {},
        props: { productId: 'p1' },
        request: { locale: 'en-US' },
        target: 'product-detail:p1',
      }),
    ).resolves.toBe('<section data-product="p1" data-prop="p1">en-US:p1</section>');
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

    await expect(
      renderer.render({
        input: {},
        props: {},
        request: { csrf: 'token' },
        target: 'cart-form',
      }),
    ).resolves.toBe('<form data-count="1" data-request="yes">ready</form>');
  });
});
