import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import {
  assertFixpoint,
  compileComponentModule,
  compileRouteModule,
  deriveAppGraph,
} from './index.js';
import {
  appGraphContributionHash,
  deriveRegistryFactsFromGraph,
  IncrementalAppGraphCache,
} from './app-graph.js';

const cartBadgeSource = `
import { component } from '@kovojs/core';

export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <button onClick={() => removeItem(state, item.id)}>
      <span data-bind="cart.count">2</span>
    </button>
  ),
});
`;

describe('compiler registry and graph emission', () => {
  it('emits provided query, mutation, and domain key registry facts', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      registryFacts: {
        components: ['components/products/product-grid/product-grid'],
        domainKeys: ['product', 'cart', 'cart'],
        invalidations: {
          'cart/add': ['cart', 'productGrid', 'orderHistory', 'cart'],
        },
        mutations: {
          'cart/add': 'typeof addToCart',
          'cart/remove': 'typeof removeFromCart',
        },
        queries: {
          cart: 'typeof cartQuery',
          productGrid: 'typeof productGridQuery',
        },
        routes: ['/cart', '/products/:id'],
      },
      source: cartBadgeSource,
    });

    const registry = result.files[2]?.source ?? '';
    expect(registry).toContain(
      "'#cart-badge': typeof import('../components/cart/cart-badge.client.js');",
    );
    expect(registry).toContain("'components/cart/cart-badge/cart-badge': {};");
    expect(registry).toContain(`interface FragmentTargets {
  'components/cart/cart-badge/cart-badge': {};
  }`);
    expect(registry).toContain(`export interface ComponentRegistry {
  'components/cart/cart-badge/cart-badge': import('@kovojs/core').Component<import('@kovojs/core').ComponentDefinitionInput>;
  'components/products/product-grid/product-grid': import('@kovojs/core').Component<import('@kovojs/core').ComponentDefinitionInput>;
}`);
    expect(registry).toContain(`export interface QueryRegistry {
  'cart': typeof cartQuery;
  'productGrid': typeof productGridQuery;
}`);
    expect(registry).toContain(`export interface MutationRegistry {
  'cart/add': typeof addToCart;
  'cart/remove': typeof removeFromCart;
}`);
    expect(registry).toContain(`export interface InvalidationSets {
  'cart/add': 'cart' | 'orderHistory' | 'productGrid';
}`);
    expect(registry).toContain(`export interface LiveTargetRegistry {
  'components/cart/cart-badge/cart-badge': { component: 'components/cart/cart-badge/cart-badge'; targetBase: 'cart-badge'; identityProps: readonly []; queries: readonly ['cart']; queryBindings: readonly [{ name: 'cart'; queryExpression: "{}" }]; props: {}; coverage: readonly [{ query: 'cart.count'; position: "binding"; status: 'plan' }]; };
}`);
    expect(registry).toContain(`declare module '@kovojs/core/generated' {`);
    expect(registry).toContain(`  interface ComponentRegistry {
  'components/cart/cart-badge/cart-badge': import('@kovojs/core').Component<import('@kovojs/core').ComponentDefinitionInput>;
  'components/products/product-grid/product-grid': import('@kovojs/core').Component<import('@kovojs/core').ComponentDefinitionInput>;
  }`);
    expect(registry).toContain(`  interface FragmentTargets {
  'components/cart/cart-badge/cart-badge': {};
  }`);
    expect(registry).toContain(`  interface LiveTargetRegistry {
  'components/cart/cart-badge/cart-badge': { component: 'components/cart/cart-badge/cart-badge'; targetBase: 'cart-badge'; identityProps: readonly []; queries: readonly ['cart']; queryBindings: readonly [{ name: 'cart'; queryExpression: "{}" }]; props: {}; coverage: readonly [{ query: 'cart.count'; position: "binding"; status: 'plan' }]; };
  }`);
    expect(registry).toContain(`declare module '@kovojs/core' {`);
    expect(registry).toContain(`  interface QueryRegistry {
  'cart': typeof cartQuery;
  'productGrid': typeof productGridQuery;
  }`);
    expect(registry).toContain(`  interface MutationRegistry {
  'cart/add': typeof addToCart;
  'cart/remove': typeof removeFromCart;
  }`);
    expect(registry).toContain(`  interface RouteRegistry {
  '/cart': import('@kovojs/core').Route<'/cart'>;
  '/products/:id': import('@kovojs/core').Route<'/products/:id'>;
  }`);
    expect(registry).toContain(`  interface InvalidationSets {
  'cart/add': 'cart' | 'orderHistory' | 'productGrid';
  }`);
    expect(registry).toContain('export type DomainKey = "cart" | "product";');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('emits component query arg binding facts from props', () => {
    const result = compileComponentModule({
      fileName: 'components/products/product-detail.tsx',
      source: `
import { component } from '@kovojs/core';
import { productQuery } from '../queries.js';

export const ProductDetail = component({
  props: { productId: String },
  queries: {
    product: productQuery.args((props) => ({ id: props.productId })),
  },
  render: ({ product }) => <section>{product.name}</section>,
});
`,
    });

    const registry = result.files[2]?.source ?? '';

    expect(registry).toContain(`export interface LiveTargetRegistry {
  'components/products/product-detail/product-detail': { component: 'components/products/product-detail/product-detail'; targetBase: 'product-detail'; identityProps: readonly ['productId']; queries: readonly ['product']; queryBindings: readonly [{ name: 'product'; queryExpression: "productQuery"; argsExpression: "({ id: props.productId })"; argsParam: 'props'; argsPropertyAccesses: readonly ['props.productId'] }]; props: { productId: string }; coverage: readonly [{ query: 'product.name'; position: "binding"; status: 'plan' }]; };
}`);
    expect(result.loweredSource)
      .toContain(`export const ProductDetail$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: ProductDetail,
  componentId: "components/products/product-detail/product-detail",
}));`);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('unwraps refresh modifiers when emitting component query binding facts', () => {
    const result = compileComponentModule({
      fileName: 'components/products/product-detail.tsx',
      source: `
import { component } from '@kovojs/core';
import { productQuery, reviewsQuery } from '../queries.js';

export const ProductDetail = component({
  props: { productId: String },
  queries: {
    product: productQuery.args((props) => ({ id: props.productId })).refresh({ every: '30s' }),
    reviews: reviewsQuery.refresh({ at: (reviews) => reviews.nextRefreshAt }).args((props) => ({
      id: props.productId,
    })),
  },
  render: ({ product, reviews }) => (
    <section>
      <h1>{product.name}</h1>
      <span>{reviews.count}</span>
    </section>
  ),
});
`,
    });

    const registry = result.files[2]?.source ?? '';

    expect(registry).toContain(
      `queryBindings: readonly [{ name: 'product'; queryExpression: "productQuery"; argsExpression: "({ id: props.productId })"; argsParam: 'props'; argsPropertyAccesses: readonly ['props.productId']; hasRefresh: true }, { name: 'reviews'; queryExpression: "reviewsQuery"; argsExpression: "({\\n      id: props.productId,\\n    })"; argsParam: 'props'; argsPropertyAccesses: readonly ['props.productId']; hasRefresh: true }]`,
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('emits generated renderer facts for a route-param-backed component', () => {
    const component = compileComponentModule({
      fileName: 'components/questions/question-detail.tsx',
      source: `
import { component } from '@kovojs/core';
import { answerListQuery, questionQuery } from '../queries.js';

export const QuestionDetail = component({
  props: { questionId: String },
  queries: {
    question: questionQuery.args((props) => ({ id: props.questionId })),
    answers: answerListQuery.args((props) => ({ questionId: props.questionId })),
  },
  render: ({ question, answers }) => <section>{question.title}{answers.items.length}</section>,
});
`,
    });
    const route = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';

export const detail = route('/questions/:id', {
  page: ({ params }) => <QuestionDetail key={params.id} questionId={params.id} />,
});
`,
    });

    const registry = component.files[2]?.source ?? '';

    expect(route.routePageFacts[0]?.components[0]).toEqual({
      keyExpression: 'params.id',
      localName: 'QuestionDetail',
      props: [
        {
          expression: 'params.id',
          name: 'questionId',
          propertyAccesses: ['params.id'],
        },
      ],
      propsExpression: '{ questionId: params.id }',
      serializedPropsExpression: 'JSON.stringify({ questionId: params.id })',
    });
    expect(registry).toContain(
      `'components/questions/question-detail/question-detail': { component: 'components/questions/question-detail/question-detail'; targetBase: 'question-detail'; identityProps: readonly ['questionId']; queries: readonly ['question', 'answers']; queryBindings: readonly [{ name: 'question'; queryExpression: "questionQuery"; argsExpression: "({ id: props.questionId })"; argsParam: 'props'; argsPropertyAccesses: readonly ['props.questionId'] }, { name: 'answers'; queryExpression: "answerListQuery"; argsExpression: "({ questionId: props.questionId })"; argsParam: 'props'; argsPropertyAccesses: readonly ['props.questionId'] }]; props: { questionId: string }; coverage: readonly [{ query: 'question.title'; position: "binding"; status: 'plan' }, { query: 'answers.items.length'; position: "binding"; status: 'plan' }]; };`,
    );
    expect(component.loweredSource)
      .toContain(`export const QuestionDetail$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: QuestionDetail,
  componentId: "components/questions/question-detail/question-detail",
}));`);
    expect(() => assertFixpoint(component)).not.toThrow();
  });

  it('emits generated renderer facts for keyed repeated components', () => {
    const component = compileComponentModule({
      fileName: 'components/products/product-card.tsx',
      source: `
import { component } from '@kovojs/core';
import { productQuery } from '../queries.js';

export const ProductCard = component({
  props: { productId: String },
  queries: {
    product: productQuery.args((props) => ({ id: props.productId })),
  },
  render: ({ product }) => <article>{product.name}</article>,
});
`,
    });
    const route = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';

export const products = route('/products', {
  page: ({ loaderData }) => (
    <ProductGrid>
      {loaderData.products.map((product) => (
        <ProductCard key={product.id} productId={product.id} />
      ))}
    </ProductGrid>
  ),
});
`,
    });

    expect(route.routePageFacts[0]?.components[1]).toEqual({
      keyExpression: 'product.id',
      localName: 'ProductCard',
      props: [
        {
          expression: 'product.id',
          name: 'productId',
          propertyAccesses: ['product.id'],
        },
      ],
      propsExpression: '{ productId: product.id }',
      serializedPropsExpression: 'JSON.stringify({ productId: product.id })',
    });
    expect(component.loweredSource)
      .toContain(`export const ProductCard$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: ProductCard,
  componentId: "components/products/product-card/product-card",
}));`);
    expect(() => assertFixpoint(component)).not.toThrow();
  });

  it('derives registry facts from graph query, mutation, and page facts', () => {
    const registryFacts = deriveRegistryFactsFromGraph(
      {
        mutations: [
          { invalidates: ['cart'], key: 'cart/add', writes: ['cart', 'order'] },
          { key: 'product/reserve', writes: ['product'] },
        ],
        pages: [
          { route: '/cart', viewTransitions: ['cart-badge'] },
          { route: '/products/:id', viewTransitions: ['product-p1-image'] },
          { route: '/cart', viewTransitions: ['cart-badge'] },
        ],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['product'], query: 'productGrid' },
          { domains: ['order'], query: 'orderHistory' },
        ],
      },
      {
        mutations: {
          'cart/add': 'typeof addToCart',
        },
        queries: {
          cart: 'typeof cartQuery',
        },
      },
    );

    expect(registryFacts).toEqual({
      diagnostics: [
        {
          code: 'KV228',
          fileName: 'app graph route table',
          help: diagnosticDefinitions.KV228.help,
          message:
            'Ambiguous route table: two routes can match the same canonical request path or duplicate route path. duplicate route path "/cart" appears 2 times in graph pages.',
          severity: 'error',
        },
      ],
      domainKeys: ['cart', 'order', 'product'],
      invalidations: {
        'cart/add': ['cart'],
        'product/reserve': ['productGrid'],
      },
      mutations: {
        'cart/add': 'typeof addToCart',
      },
      queries: {
        cart: 'typeof cartQuery',
      },
      routes: ['/cart', '/products/:id'],
      viewTransitions: ['cart-badge', 'product-p1-image'],
    });

    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      registryFacts,
      source: cartBadgeSource,
    });
    const registry = result.files[2]?.source ?? '';

    expect(registry).toContain(`export interface RouteRegistry {
  '/cart': import('@kovojs/core').Route<'/cart'>;
  '/products/:id': import('@kovojs/core').Route<'/products/:id'>;
}`);
    expect(registry).toContain(`export interface InvalidationSets {
  'cart/add': 'cart';
  'product/reserve': 'productGrid';
}`);
    expect(registry).toContain('export type DomainKey = "cart" | "order" | "product";');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('caches app graph derivation by the multiset of contributing fact hashes', () => {
    const cart = {
      componentGraphFacts: [{ domName: 'cart-badge', name: 'components/cart/cart-badge' }],
    };
    const product = {
      componentGraphFacts: [{ domName: 'product-card', name: 'components/product/product-card' }],
    };
    const firstOptions = { components: [cart, product] };
    const reorderedOptions = { components: [product, cart] };
    const changedOptions = {
      components: [
        cart,
        {
          componentGraphFacts: [
            { domName: 'product-summary', name: 'components/product/product-summary' },
          ],
        },
      ],
    };
    const cache = new IncrementalAppGraphCache();

    expect(appGraphContributionHash(firstOptions)).toBe(appGraphContributionHash(reorderedOptions));
    expect(appGraphContributionHash(firstOptions)).not.toBe(
      appGraphContributionHash(changedOptions),
    );
    expect(cache.derive(reorderedOptions)).toBe(cache.derive(firstOptions));
    expect(cache.derive(changedOptions)).not.toBe(cache.derive(firstOptions));
  });

  it('derives route registry facts from compiled route-page JSX facts', () => {
    const routes = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';

export const home = route('/', {
  page: () => <QuestionListRegion />,
});

export const detail = route('/questions/:id', {
  page: ({ params }) => <QuestionDetail questionId={params.id} />,
});
`,
    });

    const { registryFacts } = deriveAppGraph({ routePages: [routes] });

    expect(registryFacts.routes).toEqual(['/', '/questions/:id']);
  });

  it('threads compiler-derived route layout facts into graph pages', () => {
    const routes = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { layout, route } from '@kovojs/server';

const AppLayout = layout({
  queries: { viewer: viewerQuery, cart: cartQuery },
  render: (_queries, _state, { children }) => <main>{children}</main>,
});

const AdminLayout = layout({
  parent: AppLayout,
  queries: { permissions: permissionsQuery },
  render: (_queries, _state, { children }) => <section>{children}</section>,
});

export const admin = route('/admin', {
  layout: AdminLayout,
  page: () => <AdminDashboard />,
});
`,
    });

    const { graph, registryFacts } = deriveAppGraph({ routePages: [routes] });

    expect(graph.pages).toEqual([
      {
        layouts: [
          { name: 'AppLayout', queries: ['viewer', 'cart'] },
          { name: 'AdminLayout', queries: ['permissions'] },
        ],
        navigationSegments: [
          {
            id: 'layout:AppLayout',
            kind: 'layout',
            name: 'AppLayout',
            queries: ['viewer', 'cart'],
          },
          {
            id: 'layout:AdminLayout',
            kind: 'layout',
            name: 'AdminLayout',
            queries: ['permissions'],
          },
          {
            components: ['AdminDashboard'],
            id: 'page:/admin',
            kind: 'page',
            name: 'page',
          },
        ],
        route: '/admin',
      },
    ]);
    expect(registryFacts.routes).toEqual(['/admin']);
  });

  it('derives app graph component facts from compiled component results', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: cartBadgeSource,
    });
    const productGrid = compileComponentModule({
      fileName: 'components/products/product-grid.tsx',
      source: `
import { component } from '@kovojs/core';

export const ProductGrid = component({
  queries: { productGrid: {} },
  render: () => <section><ul data-bind="productGrid.items"></ul></section>,
});
`,
    });

    expect(cartBadge.componentGraphFacts).toEqual([
      {
        domName: 'cart-badge',
        exportName: 'CartBadge',
        fragments: ['components/cart/cart-badge/cart-badge'],
        name: 'components/cart/cart-badge/cart-badge',
        queries: ['cart'],
      },
    ]);

    const derived = deriveAppGraph({
      components: [cartBadge, productGrid],
      graph: {
        mutations: [{ invalidates: ['cart'], key: 'cart/add', writes: ['cart'] }],
        pages: [{ route: '/cart' }],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['product'], query: 'productGrid' },
        ],
      },
    });

    expect(derived.graph.components).toEqual([
      {
        domName: 'cart-badge',
        exportName: 'CartBadge',
        fragments: ['components/cart/cart-badge/cart-badge'],
        name: 'components/cart/cart-badge/cart-badge',
        queries: ['cart'],
      },
      {
        domName: 'product-grid',
        exportName: 'ProductGrid',
        fragments: ['components/products/product-grid/product-grid'],
        name: 'components/products/product-grid/product-grid',
        queries: ['productGrid'],
      },
    ]);
    expect(derived.diagnostics).toEqual([]);
    expect(derived.registryFacts).toEqual({
      components: [
        'components/cart/cart-badge/cart-badge',
        'components/products/product-grid/product-grid',
      ],
      domainKeys: ['cart', 'product'],
      fragmentTargets: [
        'components/cart/cart-badge/cart-badge',
        'components/products/product-grid/product-grid',
      ],
      invalidations: {
        'cart/add': ['cart'],
      },
      routes: ['/cart'],
    });
  });

  it('derives page query facts from compiled route component usage', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: cartBadgeSource,
    });
    const productGrid = compileComponentModule({
      fileName: 'components/products/product-grid.tsx',
      source: `
import { component } from '@kovojs/core';

export const ProductGrid = component({
  queries: { productGrid: {} },
  render: () => <section><ul data-bind="productGrid.items"></ul></section>,
});
`,
    });
    const routes = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';

export const cart = route('/cart', {
  page: () => (
    <>
      <CartBadge />
      <ProductGrid />
    </>
  ),
});
`,
    });

    const derived = deriveAppGraph({
      components: [cartBadge, productGrid],
      graph: {
        pages: [
          {
            meta: { title: 'Cart' },
            route: '/cart',
            stylesheets: ['/assets/styles.css'],
          },
        ],
      },
      routePages: [routes],
    });

    expect(derived.graph.pages).toEqual([
      {
        meta: { title: 'Cart' },
        navigationSegments: [
          {
            components: ['CartBadge', 'ProductGrid'],
            id: 'page:/cart',
            kind: 'page',
            name: 'page',
            queries: ['cart', 'productGrid'],
          },
        ],
        queries: ['cart', 'productGrid'],
        route: '/cart',
        stylesheets: ['/assets/styles.css'],
      },
    ]);
  });

  it('derives page query facts from aliased compiled route component imports', () => {
    const cartBadge = compileComponentModule({
      fileName: 'src/components/cart-badge.tsx',
      source: cartBadgeSource,
    });
    const routes = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';
import { CartBadge as Badge } from './components/cart-badge.js';

export const cart = route('/cart', {
  page: () => <Badge />,
});
`,
    });

    const derived = deriveAppGraph({
      components: [cartBadge],
      routePages: [routes],
    });

    expect(routes.routePageFacts).toEqual([
      expect.objectContaining({
        components: [
          expect.objectContaining({
            exportName: 'CartBadge',
            localName: 'Badge',
          }),
        ],
      }),
    ]);
    expect(derived.graph.pages).toEqual([
      {
        navigationSegments: [
          {
            components: ['Badge'],
            id: 'page:/cart',
            kind: 'page',
            name: 'page',
            queries: ['cart'],
          },
        ],
        queries: ['cart'],
        route: '/cart',
      },
    ]);
  });

  it('emits mutation form error binding facts for component explain', () => {
    const result = compileComponentModule({
      fileName: 'components/products/product-grid.tsx',
      source: `
import { component, FieldError, FormError } from '@kovojs/core';
import { mutation, s } from '@kovojs/server';

export const addToCart = mutation('cart/add', {
  input: s.object({
    productId: s.string(),
    quantity: s.number(),
  }),
  handler() {
    return null;
  },
});

export const ProductGrid = component({
  mutations: { addToCart },
  render: (_queries, _state, slots) => (
    <form enhance mutation={addToCart} key="p1">
      <input name="productId" value="p1" />
      <input name="quantity" />
      <FieldError name="quantity" />
      <FormError code="OUT_OF_STOCK">Unable to add this item.</FormError>
    </form>
  ),
});
`,
    });

    expect(result.componentGraphFacts[0]?.mutationForms).toEqual([
      {
        fieldErrors: [{ id: 'add-to-cart-quantity-error-p1', name: 'quantity' }],
        fields: ['productId', 'quantity'],
        formErrors: [{ code: 'OUT_OF_STOCK' }],
        mutation: 'cart/add',
        slot: 'addToCart',
      },
    ]);
  });

  it('lowers object-form mutation values with source-derived keys', () => {
    const result = compileComponentModule({
      fileName: 'src/components/product-grid.tsx',
      source: `
import { component, FieldError } from '@kovojs/core';
import { mutation, s } from '@kovojs/server';

export const addToCart = mutation({
  csrf: false,
  input: s.object({
    productId: s.string(),
  }),
  queue: true,
  handler() {
    return null;
  },
});

export const ProductGrid = component({
  mutations: { addToCart },
  render: (_queries, _state, slots) => (
    <form enhance mutation={addToCart} key="p1">
      <input name="productId" />
      <FieldError name="productId" />
    </form>
  ),
});
`,
    });

    expect(result.loweredSource).toContain(
      'addToCart.key = "components/product-grid/add-to-cart";',
    );
    expect(result.loweredSource).toContain(
      'if (addToCart.queue === true) addToCart.queue = "components/product-grid/add-to-cart";',
    );
    expect(result.loweredSource).toContain('action="/_m/components/product-grid/add-to-cart"');
    expect(result.loweredSource).toContain('data-mutation="components/product-grid/add-to-cart"');
    expect(result.componentGraphFacts[0]?.mutationForms).toEqual([
      {
        fieldErrors: [{ id: 'add-to-cart-productId-error-p1', name: 'productId' }],
        fields: ['productId'],
        mutation: 'components/product-grid/add-to-cart',
        slot: 'addToCart',
      },
    ]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('marks duplicate DOM leaves with stable registry-key disambiguation facts', () => {
    const derived = deriveAppGraph({
      graph: {
        components: [
          { domName: 'root', name: 'accordion/root', queries: ['accordion'] },
          { domName: 'root', name: 'tabs/root', queries: ['tabs'] },
          { domName: 'menu', name: 'menu/root', queries: ['menu'] },
        ],
      },
    });

    expect(derived.graph.components).toEqual([
      {
        disambiguatedDomName: 'accordion/root',
        domName: 'root',
        name: 'accordion/root',
        queries: ['accordion'],
      },
      {
        disambiguatedDomName: 'tabs/root',
        domName: 'root',
        name: 'tabs/root',
        queries: ['tabs'],
      },
      { domName: 'menu', name: 'menu/root', queries: ['menu'] },
    ]);
  });

  it('reports KV228 for exact duplicate route facts before registry route dedupe', () => {
    const derived = deriveAppGraph({
      graph: {
        pages: [{ route: '/cart' }, { route: '/cart' }, { route: '/products/:id' }],
      },
    });

    expect(derived.registryFacts.routes).toEqual(['/cart', '/products/:id']);
    expect(derived.diagnostics).toMatchInlineSnapshot(`
      [
        {
          "code": "KV228",
          "fileName": "app graph route table",
          "help": "Blocked reason: static-first route matching cannot choose a single canonical handler for at least one request path.
      Fixes: remove duplicate route facts, split overlapping patterns, add a static segment, or make one route path more specific.
      SPEC §9.5 requires route matching to be unambiguous at compile time.",
          "message": "Ambiguous route table: two routes can match the same canonical request path or duplicate route path. duplicate route path "/cart" appears 2 times in graph pages.",
          "severity": "error",
        },
      ]
    `);
  });

  it('accepts distinct route facts without KV228 before registry route emission', () => {
    const derived = deriveAppGraph({
      graph: {
        pages: [{ route: '/cart' }, { route: '/products/:id' }, { route: '/checkout' }],
      },
    });

    expect(derived.registryFacts.routes).toEqual(['/cart', '/checkout', '/products/:id']);
    expect(derived.diagnostics.filter((diagnostic) => diagnostic.code === 'KV228')).toEqual([]);
  });

  // H1 (SPEC §6.1 key-addressed mutation registry / §9.5 single keyed dispatch): every other
  // registry identity has a uniqueness diagnostic (routes KV228, components KV237, fragment
  // targets KV238, view transitions KV239, query shapes/query keys KV240); mutation keys need the
  // same early graph diagnostic because deriveInvalidationFactsFromGraph otherwise silently
  // last-write-wins the invalidation set for a duplicate key while server dispatch first-match-wins
  // the handler.
  it('reports KV421 for duplicate mutation-key facts before registry emission', () => {
    const registryFacts = deriveRegistryFactsFromGraph({
      mutations: [
        { key: 'cart/add', writes: ['cart'] },
        { key: 'cart/add', writes: ['order'] },
      ],
      queries: [
        { domains: ['cart'], query: 'cart' },
        { domains: ['order'], query: 'orderHistory' },
      ],
    });

    expect(registryFacts.diagnostics ?? []).toMatchInlineSnapshot(`
      [
        {
          "code": "KV421",
          "fileName": "app graph mutation table",
          "help": "Would lower to: one mutation fact per mutation key for the invalidation registry and server dispatch table.
      Blocked reason: two mutation declarations share one key, so graph indexing silently last-write-wins the invalidation set while server dispatch first-match-wins the handler — the two layers disagree, an invalidation can be computed for a mutation that never runs, and the wrong handler (with the wrong input schema and guards) executes against attacker-shaped input.
      Fixes: emit exactly one mutation fact per mutation key, or rename one mutation so its key is unique across the app graph.
      SPEC §6.1 makes the mutation registry key-addressed and §9.5 dispatches a POST to exactly one keyed handler; duplicate mutation keys would otherwise silently last-write-wins the invalidation registry while first-match-wins server dispatch — like routes (KV228), components (KV237), fragment targets (KV238), view transitions (KV239), and query shapes (KV240), mutation keys must be unique.",
          "message": "Duplicate mutation key. mutation key "cart/add" appears 2 times in graph mutations.",
          "severity": "error",
        },
      ]
    `);

    // The latent corruption KV421 catches: the second declaration's invalidation set silently
    // overwrites the first's (last-write-wins) — only 'orderHistory' survives for 'cart/add'.
    expect(registryFacts.invalidations).toEqual({ 'cart/add': ['orderHistory'] });
  });

  it('accepts distinct mutation-key facts without KV421', () => {
    const registryFacts = deriveRegistryFactsFromGraph({
      mutations: [
        { key: 'cart/add', writes: ['cart'] },
        { key: 'cart/remove', writes: ['order'] },
      ],
      queries: [
        { domains: ['cart'], query: 'cart' },
        { domains: ['order'], query: 'orderHistory' },
      ],
    });

    expect((registryFacts.diagnostics ?? []).filter((d) => d.code === 'KV421')).toEqual([]);
  });

  // SPEC §4.1/§10.2/§10.3: source-derived query keys are typed read identities and the
  // invalidation graph currency. Duplicate query facts must fail before generated query
  // registries, kovo-query hydration, /_q dispatch, or mutation invalidations collapse them.
  it('reports KV240 for duplicate query-key facts before registry and invalidation emission', () => {
    const registryFacts = deriveRegistryFactsFromGraph({
      mutations: [{ key: 'cart/add', writes: ['cart'] }],
      queries: [
        { domains: ['cart'], query: 'queries/cart/cart' },
        { domains: ['order'], query: 'queries/cart/cart' },
      ],
    });

    expect(registryFacts.diagnostics ?? []).toMatchInlineSnapshot(`
      [
        {
          "code": "KV240",
          "fileName": "app graph query table",
          "help": "Would lower to: one query read-set fact per source-derived query key for the generated query registry, /_q dispatch, kovo-query hydration, kovo-deps, and mutation invalidation graph.
      Blocked reason: two query declarations share one key, so graph indexing can silently collapse read sets and generated wire artifacts before the server read endpoint sees the ambiguity.
      Fixes: emit exactly one query fact per query key, or rename/move one exported query so its source-derived key is unique across the app graph.
      SPEC §4.1 derives query registry identities from source, §10.2 makes each query key a typed read surface, and §10.3 relies on those stable query identities when mutations compute invalidated reads.",
          "message": "Duplicate query key. query key "queries/cart/cart" appears 2 times in graph queries.",
          "severity": "error",
        },
      ]
    `);

    // This is the collapse the diagnostic prevents from being ignored: the duplicate key appears
    // once in the generated invalidation set even though two different read surfaces claimed it.
    expect(registryFacts.invalidations).toEqual({ 'cart/add': ['queries/cart/cart'] });
  });

  it('accepts distinct query-key facts without KV240 from the app graph query table', () => {
    const registryFacts = deriveRegistryFactsFromGraph({
      mutations: [{ key: 'cart/add', writes: ['cart'] }],
      queries: [
        { domains: ['cart'], query: 'queries/cart/cart' },
        { domains: ['order'], query: 'queries/order/order' },
      ],
    });

    expect(
      (registryFacts.diagnostics ?? []).filter(
        (d) => d.code === 'KV240' && d.fileName === 'app graph query table',
      ),
    ).toEqual([]);
  });

  // SPEC.md §10.2/§6.6: deriveAppGraph populates graph.access so the KV436 consumer
  // (`kovo check`) fails any surface with no explicit access decision, guard, or
  // machine-auth posture. By-construction: the proof is this static graph fact.
  it('derives default-deny access facts for every surface (KV436)', () => {
    const derived = deriveAppGraph({
      graph: {
        endpoints: [
          { auth: 'none', method: 'GET', path: '/healthz' },
          {
            access: { kind: 'verified-machine-auth' },
            method: 'POST',
            name: 'stripe',
            path: '/webhooks/stripe',
            surface: 'webhook',
          },
          { method: 'POST', path: '/api/undecided' },
        ],
        mutations: [
          { guards: ['authed'], key: 'cart/add', writes: ['cart'] },
          { key: 'cart/clear', writes: ['cart'] },
        ],
        pages: [
          { guards: ['authed'], route: '/cart' },
          {
            access: { kind: 'public', reason: 'marketing landing page' },
            route: '/about',
          },
        ],
        queries: [
          { domains: ['cart'], guards: ['authed'], query: 'cart' },
          { domains: ['draft'], query: 'drafts' },
        ],
      },
    });

    expect(derived.graph.access).toEqual([
      {
        decision: 'missing',
        detail: 'method=POST path=/api/undecided mount=exact auth=-',
        kind: 'endpoint',
        name: '/api/undecided',
        source: 'legacy-guard',
      },
      {
        decision: 'public',
        detail: 'method=GET path=/healthz mount=exact auth=none',
        kind: 'endpoint',
        name: '/healthz',
        source: 'auth',
      },
      {
        decision: 'guard',
        detail: 'guards=authed auth=none',
        kind: 'mutation',
        name: 'cart/add',
        source: 'legacy-guard',
      },
      {
        decision: 'missing',
        detail: 'guard=-',
        kind: 'mutation',
        name: 'cart/clear',
        source: 'legacy-guard',
      },
      {
        decision: 'public',
        detail: 'access=public',
        justification: 'marketing landing page',
        kind: 'page',
        name: '/about',
        source: 'access',
      },
      {
        decision: 'guard',
        detail: 'guards=authed',
        kind: 'page',
        name: '/cart',
        source: 'legacy-guard',
      },
      {
        decision: 'guard',
        detail: 'guards=authed',
        kind: 'query',
        name: 'cart',
        source: 'legacy-guard',
      },
      {
        decision: 'missing',
        detail: 'guard=-',
        kind: 'query',
        name: 'drafts',
        source: 'legacy-guard',
      },
      {
        decision: 'verified',
        detail: 'access=verified-machine-auth method=POST path=/webhooks/stripe mount=exact auth=-',
        kind: 'webhook',
        name: 'stripe',
        source: 'access',
      },
    ]);

    // The three undecided surfaces (cart/clear, drafts, /api/undecided) are the
    // KV436 `missing` set that fails `kovo check`.
    expect(derived.graph.access?.filter((fact) => fact.decision === 'missing')).toHaveLength(3);
  });

  it('preserves caller-provided access facts when deriving the app graph', () => {
    const derived = deriveAppGraph({
      graph: {
        access: [
          {
            decision: 'guard',
            detail: 'guard=mutation.guard',
            kind: 'mutation',
            name: 'cart/add',
            source: 'legacy-guard',
          },
        ],
        mutations: [{ key: 'cart/add', writes: ['cart'] }],
        queries: [{ domains: ['cart'], query: 'cart' }],
      },
    });

    expect(derived.graph.access).toEqual([
      {
        decision: 'guard',
        detail: 'guard=mutation.guard',
        kind: 'mutation',
        name: 'cart/add',
        source: 'legacy-guard',
      },
      {
        decision: 'missing',
        detail: 'guard=-',
        kind: 'query',
        name: 'cart',
        source: 'legacy-guard',
      },
    ]);
  });

  it('derives page access facts from compiled JSX route pages', () => {
    const routes = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { guards, publicAccess, route } from '@kovojs/server';

const authed = guards.authed();

export const publicDocs = route('/docs', {
  access: publicAccess('public documentation'),
  page: () => <DocsPage />,
});

export const account = route('/account', {
  guard: authed,
  page: () => <AccountPage />,
});

export const missing = route('/missing', {
  page: () => <MissingPage />,
});
`,
    });

    const derived = deriveAppGraph({ routePages: [routes] });

    expect(derived.graph.pages).toEqual([
      expect.objectContaining({
        access: { kind: 'public', reason: 'public documentation' },
        route: '/docs',
      }),
      expect.objectContaining({ guards: ['authed'], route: '/account' }),
      expect.objectContaining({ route: '/missing' }),
    ]);
    expect(derived.graph.access).toEqual([
      {
        decision: 'guard',
        detail: 'guards=authed',
        kind: 'page',
        name: '/account',
        source: 'legacy-guard',
      },
      {
        decision: 'public',
        detail: 'access=public',
        justification: 'public documentation',
        kind: 'page',
        name: '/docs',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'guard=-',
        kind: 'page',
        name: '/missing',
        source: 'legacy-guard',
      },
    ]);
  });
});
