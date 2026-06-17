/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
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
      render: ({ product }: { product: { id: string; label: string } }) => (
        <section data-product={product.id}>{product.label}</section>
      ),
    });

    const renderer = componentLiveTargetRenderer({
      component: ProductDetail,
      componentId: 'components/product-detail/product-detail',
      queries: [
        {
          args: (props) => ({ id: props.productId }),
          name: 'product',
          query: productQuery,
        },
      ],
    });

    expect(renderer.queries).toEqual(['product']);
    await expect(
      renderer.render({
        input: {},
        props: { productId: 'p1' },
        request: { locale: 'en-US' },
        target: 'product-detail:p1',
      }),
    ).resolves.toBe('<section data-product="p1">en-US:p1</section>');
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
      queries: [{ name: 'product', query: productQuery }],
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
});
