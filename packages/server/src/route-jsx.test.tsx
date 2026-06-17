/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { domain } from './domain.js';
import { query } from './query.js';
import { layout, renderRoutePageResponse, route } from './route.js';
import { s } from './schema.js';

describe('route JSX pages', () => {
  it('loads direct component queries from the route request context', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load(_input: unknown, { request }: { request: { count: number } }) {
        return { count: request.count };
      },
      reads: [cart],
    });
    const CartBadge = component({
      queries: { cart: cartQuery },
      render: ({ cart }: { cart: { count: number } }) => (
        <cart-badge>{cart.count}</cart-badge>
      ),
    });
    const cartRoute = route('/cart', {
      page: () => <CartBadge />,
    });

    await expect(renderRoutePageResponse(cartRoute, {}, { count: 3 })).resolves.toMatchObject({
      body: '<cart-badge>3</cart-badge>',
      status: 200,
    });
  });

  it('loads prop-bound component queries from route params', async () => {
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
    const productRoute = route('/products/:id', {
      params: s.object({ id: s.string() }),
      page: ({ params }) => <ProductDetail productId={params.id} />,
    });

    await expect(
      renderRoutePageResponse(productRoute, { params: { id: 'p1' } }, { locale: 'en-US' }),
    ).resolves.toMatchObject({
      body: '<section data-product="p1" data-prop="p1">en-US:p1</section>',
      status: 200,
    });
  });

  it('forwards JSX component props into render slots', async () => {
    const products = domain('product');
    const productsQuery = query('products', {
      load: () => ({ items: ['p1'] }),
      reads: [products],
    });
    const ProductGrid = component({
      queries: { products: productsQuery },
      render: ({ products }: { products: { items: string[] } }, _state, slots) => (
        <section data-read-only={slots.readOnly ? 'true' : 'false'}>
          {products.items.join(',')}
        </section>
      ),
    });
    const productRoute = route('/products', {
      page: () => <ProductGrid readOnly />,
    });

    await expect(renderRoutePageResponse(productRoute, {}, {})).resolves.toMatchObject({
      body: '<section data-read-only="true">p1</section>',
      status: 200,
    });
  });

  it('wraps route JSX with nested layouts and loads layout queries from the request', async () => {
    const viewer = domain('viewer');
    const viewerQuery = query('viewer', {
      load(_input: unknown, { request }: { request: { userId: string } }) {
        return { id: request.userId };
      },
      reads: [viewer],
    });
    const AppLayout = layout({
      queries: { viewer: viewerQuery },
      render: ({ viewer }, _state, { children }) => (
        <main data-viewer={viewer.id}>{children}</main>
      ),
    });
    const AdminLayout = layout({
      parent: AppLayout,
      render: (_queries, _state, { children }) => <section data-admin>{children}</section>,
    });
    const adminRoute = route('/admin', {
      layout: AdminLayout,
      page: () => <h1>Admin</h1>,
    });

    await expect(renderRoutePageResponse(adminRoute, {}, { userId: 'u1' })).resolves.toMatchObject({
      body: '<main data-viewer="u1"><section data-admin><h1>Admin</h1></section></main>',
      status: 200,
    });
  });

  it('runs layout guards before rendering the route page', async () => {
    const AdminLayout = layout<{ session?: { user?: { id: string } | null } | null }>({
      guard: (request) => (request.session?.user ? true : { kind: 'unauthenticated' }),
      render: (_queries, _state, { children }) => <main>{children}</main>,
    });
    const adminRoute = route('/admin', {
      layout: AdminLayout,
      page: () => <h1>Admin</h1>,
    });

    await expect(
      renderRoutePageResponse(adminRoute, {}, { session: null }, String, {
        currentUrl: '/admin',
      }),
    ).resolves.toMatchObject({
      headers: { Location: '/login?next=%2Fadmin' },
      status: 303,
    });
  });
});
