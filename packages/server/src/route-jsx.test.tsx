/** @jsxImportSource @kovojs/server */
import { component, ErrorBoundary, FieldError, form, FormError } from '@kovojs/core';
import { describe, expect, it, vi } from 'vitest';

import { csrfToken } from './csrf.js';
import { domain } from './domain.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { defineCompiledRoutePage } from './route-ir.js';
import { jsx } from './jsx-runtime.js';
import { layout, notFound, renderRoutePageResponse, route } from './route.js';
import { s } from './schema.js';

describe('route JSX pages', () => {
  it('renders the nearest ErrorBoundary fallback for unexpected component render failures', async () => {
    const ProductGrid = component({
      render: () => {
        throw new Error('product query renderer failed');
      },
    });
    const productRoute = route('/products', {
      page: () => (
        <ErrorBoundary fallback={<section role="alert">Products are unavailable.</section>}>
          <ProductGrid />
        </ErrorBoundary>
      ),
    });

    await expect(renderRoutePageResponse(productRoute, {}, {})).resolves.toMatchObject({
      body: '<section role="alert">Products are unavailable.</section>',
      status: 200,
    });
  });

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
      render: ({ cart }: { cart: { count: number } }) => <cart-badge>{cart.count}</cart-badge>,
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

  it('stamps named query-backed component roots for source-served morph targets', async () => {
    const product = domain('product');
    const inventory = domain('inventory');
    const productQuery = query('productById', {
      args: s.object({ id: s.string() }),
      load(input: { id: string }) {
        return { id: input.id, label: `Product ${input.id}` };
      },
      reads: [product],
    });
    const inventoryQuery = query('inventoryStatus', {
      load: () => ({ available: true }),
      reads: [inventory],
    });
    const ProductDetail = component({
      props: { productId: String },
      queries: {
        inventory: inventoryQuery,
        product: productQuery.args((props: { productId: string }) => ({ id: props.productId })),
      },
      render: ({
        inventory,
        product,
      }: {
        inventory: { available: boolean };
        product: { id: string; label: string };
      }) => (
        <section data-available={inventory.available ? 'yes' : 'no'} data-product={product.id}>
          {product.label}
        </section>
      ),
    });
    ProductDetail.name = 'components/products/product-detail/product-detail';
    const productRoute = route('/products/:id', {
      params: s.object({ id: s.string() }),
      page: ({ params }) => <ProductDetail productId={params.id} />,
    });

    await expect(
      renderRoutePageResponse(productRoute, { params: { id: 'p1' } }, {}),
    ).resolves.toMatchObject({
      body: '<section data-available="yes" data-product="p1" kovo-c="product-detail" kovo-deps="inventoryStatus productById" kovo-fragment-target="product-detail:p1" kovo-live-component="components/products/product-detail/product-detail" kovo-props="{&quot;productId&quot;:&quot;p1&quot;}">Product p1</section>',
      status: 200,
    });
  });

  it('stamps repeated source-served component instances with distinct live target identities', async () => {
    const product = domain('product');
    const productQuery = query('productById', {
      args: s.object({ id: s.string() }),
      load(input: { id: string }) {
        return { id: input.id, label: `Product ${input.id}` };
      },
      reads: [product],
    });
    const ProductDetail = component({
      props: { productId: String },
      queries: {
        product: productQuery.args((props: { productId: string }) => ({ id: props.productId })),
      },
      render: ({ product }: { product: { id: string; label: string } }) => (
        <section data-product={product.id}>{product.label}</section>
      ),
    });
    ProductDetail.name = 'components/products/product-detail/product-detail';
    const productRoute = route('/products', {
      page: () => (
        <main>
          <ProductDetail key="featured" productId="p1" />
          <ProductDetail productId="p2" />
        </main>
      ),
    });

    const response = await renderRoutePageResponse(productRoute, {}, {});
    const headers = collectLiveTargetHeaders(response.body);

    // SPEC.md §4.8/§13.2: repeated inferred fragment targets use authored key
    // first, then serializable stamped props, so the live headers retain both
    // source/runtime component instances instead of collapsing by leaf name.
    expect(headers.targets).toEqual(
      'product-detail:featured=productById; product-detail:p2=productById',
    );
    expect(headers.liveTargets).toEqual(
      [
        'product-detail:featured#components/products/product-detail/product-detail:{"productId":"p1"}',
        'product-detail:p2#components/products/product-detail/product-detail:{"productId":"p2"}',
      ].join(','),
    );
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

  it('injects CSRF and submitted mutation failure state into route JSX forms', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
      errors: { OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }) },
      handler(input) {
        return input;
      },
    });
    const addToCartForm = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } }
    >('cart/add');
    const AddToCartForm = component({
      mutations: { addToCart: addToCartForm },
      render: () => (
        <form enhance mutation={addToCart}>
          <input type="hidden" name="productId" value="p1" />
          <input name="quantity" value="1" />
          <FieldError name="quantity" />
          <FormError
            code="OUT_OF_STOCK"
            message={(failure: { payload: { availableQuantity: number } }) =>
              `Only ${failure.payload.availableQuantity} left.`
            }
          />
        </form>
      ),
    });
    const productRoute = route('/products/p1', {
      page: () => jsx(AddToCartForm, {}),
    });
    const request = { session: { id: 's1' } };
    const csrf = {
      secret: 'test-secret',
      sessionId: (value: typeof request) => value.session.id,
    };

    const result = (await renderRoutePageResponse(productRoute as any, {}, request, undefined, {
      csrf,
      mutationFailure: {
        failure: {
          error: { code: 'OUT_OF_STOCK', payload: { availableQuantity: 3 } },
          ok: false,
          status: 422,
        },
        mutationKey: 'cart/add',
      },
    })) as { body: string; status: number };

    // The per-submit Kovo-Idem hidden field (SPEC §10.3) carries a fresh random token; normalize it
    // for the golden comparison while still asserting the field is emitted alongside the CSRF field.
    const normalizedBody = result.body.replace(
      /name="Kovo-Idem" value="[^"]*"/,
      'name="Kovo-Idem" value="<idem>"',
    );
    expect(normalizedBody).toBe(
      `<form enhance method="post" action="/_m/cart/add" data-mutation="cart/add"><input type="hidden" name="productId" value="p1"><input name="quantity" value="1"><output role="alert" data-error-code="OUT_OF_STOCK">Only 3 left.</output><input type="hidden" name="kovo-csrf" value="${csrfToken(request, csrf)}"><input type="hidden" name="Kovo-Idem" value="<idem>"></form>`,
    );
    expect(result.status).toBe(200);
  });

  it('stamps compiler-derived page navigation segment metadata on route JSX roots', async () => {
    const productRoute = route('/products', {
      page: defineCompiledRoutePage(
        {
          components: [
            {
              localName: 'ProductGrid',
              props: [],
              propsExpression: '{}',
              serializedPropsExpression: 'JSON.stringify({})',
            },
          ],
          fileName: 'src/routes.tsx',
          navigationSegments: [
            {
              components: ['ProductGrid'],
              id: 'page:/products',
              kind: 'page',
              localName: 'page',
            },
          ],
          route: '/products',
        },
        () => <main>Products</main>,
      ),
    });

    await expect(renderRoutePageResponse(productRoute, {}, {})).resolves.toMatchObject({
      body: '<main kovo-nav-segment="page:/products" kovo-nav-kind="page" kovo-nav-name="page" kovo-nav-components="ProductGrid">Products</main>',
      status: 200,
    });
  });

  it('stamps authored fallback page and layout navigation segments', async () => {
    const sharedLayout = layout({
      render: (_queries, _state, { children }) => <main>{children}</main>,
    });
    const homeRoute = route('/', {
      layout: sharedLayout,
      page: () => <section>Home</section>,
    });
    const cartRoute = route('/cart', {
      layout: sharedLayout,
      page: () => <section>Cart</section>,
    });

    const home = await renderRoutePageResponse(homeRoute, {}, {});
    const cart = await renderRoutePageResponse(cartRoute, {}, {});
    const homeBody = home.body as string;
    const cartBody = cart.body as string;
    const homeLayoutSegment = /kovo-nav-segment="(layout:[^"]+)"/.exec(homeBody)?.[1];
    const cartLayoutSegment = /kovo-nav-segment="(layout:[^"]+)"/.exec(cartBody)?.[1];

    expect(homeLayoutSegment).toBeTruthy();
    expect(cartLayoutSegment).toBe(homeLayoutSegment);
    expect(homeBody).toContain('kovo-nav-segment="page:/"');
    expect(cartBody).toContain('kovo-nav-segment="page:/cart"');
  });

  it('stamps compiler-derived navigation metadata from page functions when route WeakMap metadata is absent', async () => {
    const productRoute = {
      page: defineCompiledRoutePage(
        {
          components: [
            {
              localName: 'ProductGrid',
              props: [],
              propsExpression: '{}',
              serializedPropsExpression: 'JSON.stringify({})',
            },
          ],
          fileName: 'src/generated/app.kovo-route.tsx',
          navigationSegments: [
            {
              components: ['ProductGrid'],
              id: 'page:/products',
              kind: 'page',
              localName: 'page',
            },
          ],
          route: '/products',
        },
        () => <main>Products</main>,
      ),
      path: '/products',
    };

    await expect(renderRoutePageResponse(productRoute as any, {}, {})).resolves.toMatchObject({
      body: '<main kovo-nav-segment="page:/products" kovo-nav-kind="page" kovo-nav-name="page" kovo-nav-components="ProductGrid">Products</main>',
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
      render: ({ viewer }, _state, { children }) => <main data-viewer={viewer.id}>{children}</main>,
    });
    const AdminLayout = layout({
      parent: AppLayout,
      render: (_queries, _state, { children }) => <section data-admin>{children}</section>,
    });
    const adminRoute = route('/admin', {
      layout: AdminLayout,
      page: () => <h1>Admin</h1>,
    });

    const response = await renderRoutePageResponse(adminRoute, {}, { userId: 'u1' });

    expect(response.status).toBe(200);
    expect(response.body).toContain('data-viewer="u1"');
    expect(response.body).toContain('kovo-deps="viewer"');
    expect(response.body).toContain('kovo-fragment-target="kovo-layout-');
    expect(response.body).toContain('<section data-admin');
    expect(response.body).toContain('<h1 kovo-nav-segment="page:/admin"');
  });

  it('stamps compiler-derived layout navigation segment metadata on nested layout roots', async () => {
    const viewer = domain('viewer');
    const viewerQuery = query('viewer', {
      load(_input: unknown, { request }: { request: { userId: string } }) {
        return { id: request.userId };
      },
      reads: [viewer],
    });
    const AppLayout = layout({
      queries: { viewer: viewerQuery },
      render: ({ viewer }, _state, { children }) => <main data-viewer={viewer.id}>{children}</main>,
    });
    const AdminLayout = layout({
      parent: AppLayout,
      render: (_queries, _state, { children }) => <section data-admin>{children}</section>,
    });
    const adminRoute = route('/admin', {
      layout: AdminLayout,
      page: defineCompiledRoutePage(
        {
          components: [
            {
              localName: 'AdminPanel',
              props: [],
              propsExpression: '{}',
              serializedPropsExpression: 'JSON.stringify({})',
            },
          ],
          fileName: 'src/routes.tsx',
          layouts: [
            { localName: 'AppLayout', queries: ['viewer'] },
            { localName: 'AdminLayout', queries: [] },
          ],
          navigationSegments: [
            {
              id: 'layout:AppLayout',
              kind: 'layout',
              localName: 'AppLayout',
              queries: ['viewer'],
            },
            {
              id: 'layout:AdminLayout',
              kind: 'layout',
              localName: 'AdminLayout',
              queries: [],
            },
            {
              components: ['AdminPanel'],
              id: 'page:/admin',
              kind: 'page',
              localName: 'page',
            },
          ],
          route: '/admin',
        },
        () => <h1>Admin</h1>,
      ),
    });

    const response = await renderRoutePageResponse(adminRoute, {}, { userId: 'u1' });

    expect(response.status).toBe(200);
    expect(response.body).toContain(
      '<main data-viewer="u1" kovo-deps="viewer" kovo-fragment-target="kovo-layout-',
    );
    expect(response.body).toContain('kovo-nav-segment="layout:AppLayout"');
    expect(response.body).toContain('kovo-nav-kind="layout"');
    expect(response.body).toContain('kovo-nav-name="AppLayout"');
    expect(response.body).toContain('kovo-nav-queries="viewer"');
    expect(response.body).toContain(
      '<section data-admin kovo-nav-segment="layout:AdminLayout" kovo-nav-kind="layout" kovo-nav-name="AdminLayout">',
    );
    expect(response.body).toContain(
      '<h1 kovo-nav-segment="page:/admin" kovo-nav-kind="page" kovo-nav-name="page" kovo-nav-components="AdminPanel">Admin</h1>',
    );
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

  it('renders nearest layout boundaries for route notFound outcomes', async () => {
    const AdminLayout = layout({
      boundaries: {
        notFound: ({ status }) => <main data-layout-boundary="not-found">missing:{status}</main>,
      },
      render: (_queries, _state, { children }) => <section>{children}</section>,
    });
    const missingRoute = route('/admin/missing', {
      layout: AdminLayout,
      page: () => notFound(),
    });

    await expect(renderRoutePageResponse(missingRoute, {}, {})).resolves.toMatchObject({
      body: '<main data-layout-boundary="not-found">missing:404</main>',
      status: 404,
    });
  });

  it('renders nearest layout boundaries for forbidden segment guards', async () => {
    const AdminLayout = layout<{ session?: { user?: { roles?: readonly string[] } } }>({
      boundaries: {
        unauthorized: ({ status }) => (
          <main data-layout-boundary="unauthorized">denied:{status}</main>
        ),
      },
      guard: (request) =>
        request.session?.user?.roles?.includes('admin') ? true : { kind: 'forbidden' },
      render: (_queries, _state, { children }) => <section>{children}</section>,
    });
    const adminRoute = route('/admin', {
      layout: AdminLayout,
      page: () => <h1>Admin</h1>,
    });

    await expect(
      renderRoutePageResponse(adminRoute, {}, { session: { user: { roles: ['staff'] } } }),
    ).resolves.toMatchObject({
      body: '<main data-layout-boundary="unauthorized">denied:403</main>',
      status: 403,
    });
  });

  it('renders nearest layout error boundaries without leaking thrown details', async () => {
    const renderError = new Error('private layout detail');
    const onError = vi.fn();
    const AdminLayout = layout({
      boundaries: {
        error: ({ status }) => <main data-layout-boundary="error">failed:{status}</main>,
      },
      render: () => {
        throw renderError;
      },
    });
    const adminRoute = route('/admin', {
      layout: AdminLayout,
      page: () => <h1>Admin</h1>,
    });

    await expect(
      renderRoutePageResponse(adminRoute, {}, {}, String, { onError }),
    ).resolves.toMatchObject({
      body: '<main data-layout-boundary="error">failed:500</main>',
      status: 500,
    });
    expect(onError).toHaveBeenCalledWith(renderError, {
      operation: 'route-page',
      request: {},
      routePath: '/admin',
    });
  });
});

function collectLiveTargetHeaders(html: string): { liveTargets: string; targets: string } {
  const targets: string[] = [];
  const liveTargets: string[] = [];

  for (const match of html.matchAll(/<([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/g)) {
    const attrs = parseAttributes(match[2] ?? '');
    const target = attrs.get('kovo-fragment-target') ?? attrs.get('id') ?? attrs.get('kovo-c');
    const deps = attrs.get('kovo-deps');
    if (target && deps) targets.push(`${target}=${deps}`);

    const componentName = attrs.get('kovo-live-component') ?? attrs.get('kovo-c') ?? target;
    if (target && componentName) {
      const props = attrs.get('kovo-props') ?? '{}';
      liveTargets.push(`${target}#${componentName}:${props}`);
    }
  }

  return {
    liveTargets: liveTargets.join(','),
    targets: targets.join('; '),
  };
}

function parseAttributes(attrs: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const match of attrs.matchAll(
    /(?:^|\s)([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    const name = match[1];
    if (!name) continue;
    values.set(name, decodeAttribute(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return values;
}

function decodeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}
