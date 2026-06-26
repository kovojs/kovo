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
  // targets KV238, view transitions KV239, query shapes KV240); mutations had none, so
  // deriveInvalidationFactsFromGraph silently last-write-wins the invalidation set for a
  // duplicate key while server dispatch first-match-wins the handler.
  it('reports KV421 for duplicate mutation-key facts (today none; invalidations last-write-wins)', () => {
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

  it('threads framework-owned agent-tool reachable sink facts into the app graph', () => {
    const derived = deriveAppGraph({
      graph: {
        agentToolSinks: [
          {
            capability: 'email.send',
            evidence: 'static-tool-body-egress',
            grade: 'sound',
            kind: 'egress',
            site: 'app/tools/orders.ts:42',
            target: 'smtp',
            tool: 'orders.updateStatus',
          },
          {
            capability: 'secrets.read',
            evidence: 'static-tool-body-secret-read',
            grade: 'sound',
            kind: 'secret-read',
            site: 'app/tools/orders.ts:43',
            target: 'env.SENDGRID_TOKEN',
            tool: 'orders.updateStatus',
          },
        ],
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['orders.write'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Update one order.',
            site: 'app/tools/orders.ts:12',
            target: 'orders.updateStatus',
          },
        ],
        mutations: [{ key: 'orders.updateStatus', writes: ['orders'] }],
        touchGraph: {
          'orders.updateStatus': {
            touches: [
              {
                domain: 'auditLog',
                keys: null,
                site: 'app/tools/orders.ts:31',
                via: 'auditLog.insert',
              },
            ],
            unresolved: [],
          },
        },
      },
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'email.send',
        evidence: 'static-tool-body-egress',
        grade: 'sound',
        kind: 'egress',
        site: 'app/tools/orders.ts:42',
        target: 'smtp',
        tool: 'orders.updateStatus',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-body-secret-read',
        grade: 'sound',
        kind: 'secret-read',
        site: 'app/tools/orders.ts:43',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.updateStatus',
      },
      {
        capability: 'auditLog.write',
        evidence: 'graph-write-domain',
        grade: 'sound',
        kind: 'write',
        site: 'app/tools/orders.ts:31',
        target: 'auditLog',
        tool: 'orders.updateStatus',
      },
      {
        capability: 'orders.write',
        evidence: 'graph-write-domain',
        grade: 'sound',
        kind: 'write',
        site: 'mutation:orders.updateStatus',
        target: 'orders',
        tool: 'orders.updateStatus',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from direct framework-owned tool handler AST', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'export const notify = tool({',
            "  name: 'orders.notify',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  async handler() {',
            '    const token = process.env.SENDGRID_TOKEN;',
            "    await fetch('https://api.sendgrid.com/v3/mail/send', {",
            '      headers: { authorization: token },',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
      graph: {
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:2',
            target: 'orders.notify',
          },
        ],
      },
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-body-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:10:11',
        target: 'api.sendgrid.com',
        tool: 'orders.notify',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-body-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:9:19',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notify',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static handler function references', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'async function notifyBuyer() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'export const notify = tool({',
            "  name: 'orders.notifyReferencedHandler',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            '  handler: notifyBuyer,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-body-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:4:10',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyReferencedHandler',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-body-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:3:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyReferencedHandler',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from direct same-module helper calls', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'export const notify = tool({',
            "  name: 'orders.notify',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  async handler() {',
            '    await sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
      graph: {
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:8',
            target: 'orders.notify',
          },
        ],
      },
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:4:10',
        target: 'api.sendgrid.com',
        tool: 'orders.notify',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:3:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notify',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from parenthesized and type-only helper call targets', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'function sendPostmark() {',
            '  const token = process.env.POSTMARK_TOKEN;',
            "  return fetch('https://api.postmarkapp.com/email', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'function sendMailgun() {',
            '  const token = process.env.MAILGUN_TOKEN;',
            "  return fetch('https://api.mailgun.net/v3/messages', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'const mail = { sendPostmark };',
            'const helpers = [sendMailgun] as const;',
            'export const notify = tool({',
            "  name: 'orders.notifyWrappedCalls',",
            '  async handler() {',
            '    await (sendMail)();',
            '    await (mail.sendPostmark satisfies () => Promise<unknown>)();',
            '    await (helpers[0] as () => Promise<unknown>)();',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.mailgun.net',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:16:10',
        target: 'api.mailgun.net',
        tool: 'orders.notifyWrappedCalls',
      },
      {
        capability: 'egress:api.postmarkapp.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:10:10',
        target: 'api.postmarkapp.com',
        tool: 'orders.notifyWrappedCalls',
      },
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:4:10',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyWrappedCalls',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:15:17',
        target: 'env.MAILGUN_TOKEN',
        tool: 'orders.notifyWrappedCalls',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:9:17',
        target: 'env.POSTMARK_TOKEN',
        tool: 'orders.notifyWrappedCalls',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:3:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyWrappedCalls',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static optional helper call targets', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'function sendPostmark() {',
            '  const token = process.env.POSTMARK_TOKEN;',
            "  return fetch('https://api.postmarkapp.com/email', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'function sendMailgun() {',
            '  const token = process.env.MAILGUN_TOKEN;',
            "  return fetch('https://api.mailgun.net/v3/messages', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'function sendResend() {',
            '  const token = process.env.RESEND_TOKEN;',
            "  return fetch('https://api.resend.com/emails', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'const mail = { sendPostmark };',
            'const mailgun = { sendMailgun };',
            'const helpers = [sendResend] as const;',
            'export const notify = tool({',
            "  name: 'orders.notifyOptionalCalls',",
            '  async handler() {',
            '    await sendMail?.();',
            '    await mail.sendPostmark?.();',
            '    await (mailgun)?.sendMailgun();',
            '    await (helpers)[0]?.();',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.mailgun.net',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:16:10',
        target: 'api.mailgun.net',
        tool: 'orders.notifyOptionalCalls',
      },
      {
        capability: 'egress:api.postmarkapp.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:10:10',
        target: 'api.postmarkapp.com',
        tool: 'orders.notifyOptionalCalls',
      },
      {
        capability: 'egress:api.resend.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:22:10',
        target: 'api.resend.com',
        tool: 'orders.notifyOptionalCalls',
      },
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:4:10',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyOptionalCalls',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:15:17',
        target: 'env.MAILGUN_TOKEN',
        tool: 'orders.notifyOptionalCalls',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:9:17',
        target: 'env.POSTMARK_TOKEN',
        tool: 'orders.notifyOptionalCalls',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:21:17',
        target: 'env.RESEND_TOKEN',
        tool: 'orders.notifyOptionalCalls',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:3:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyOptionalCalls',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from simple imported local helper calls', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import { sendMail as deliverMail } from './mail';",
            'export const notify = tool({',
            "  name: 'orders.notifyImported',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  async handler() {',
            '    await deliverMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
      graph: {
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:3',
            target: 'orders.notifyImported',
          },
        ],
      },
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyImported',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyImported',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from default imported local helper calls', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import sendMail from './mail';",
            'export const notify = tool({',
            "  name: 'orders.notifyDefaultImported',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  async handler() {',
            '    await sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export default function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
      graph: {
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:3',
            target: 'orders.notifyDefaultImported',
          },
        ],
      },
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyDefaultImported',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyDefaultImported',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from default export aliases to local helpers', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import sendMail from './mail';",
            'export const notify = tool({',
            "  name: 'orders.notifyDefaultAlias',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'export default sendMail;',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyDefaultAlias',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyDefaultAlias',
      },
    ]);
  });

  it('produces sound agent-tool sink rows through static named re-export barrels', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import { deliverMail } from './mail';",
            'export const notify = tool({',
            "  name: 'orders.notifyBarrel',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  async handler() {',
            '    await deliverMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: "export { sendMail as deliverMail } from './mail/send';",
        },
        {
          fileName: 'src/tools/mail/send.ts',
          source: [
            'export function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
      graph: {
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:3',
            target: 'orders.notifyBarrel',
          },
        ],
      },
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail/send.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyBarrel',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail/send.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyBarrel',
      },
    ]);
  });

  it('produces sound agent-tool sink rows through static default re-export barrels', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import { deliverMail } from './mail/default-helper';",
            "import mailObject from './mail/default-object';",
            "import { mailArray } from './mail/named-array';",
            'export const notifyHelper = tool({',
            "  name: 'orders.defaultHelperBarrel',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  async handler() {',
            '    await deliverMail();',
            '  },',
            '});',
            'export const notifyObject = tool({',
            "  name: 'orders.defaultObjectBarrel',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  async handler() {',
            '    await mailObject.sendMail();',
            '  },',
            '});',
            'export const notifyArray = tool({',
            "  name: 'orders.defaultArrayBarrel',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  async handler() {',
            '    await mailArray[0]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail/default-helper.ts',
          source: "export { default as deliverMail } from './send-default';",
        },
        {
          fileName: 'src/tools/mail/default-object.ts',
          source: "export { default } from './send-object';",
        },
        {
          fileName: 'src/tools/mail/named-array.ts',
          source: "export { default as mailArray } from './send-array';",
        },
        {
          fileName: 'src/tools/mail/send-default.ts',
          source: [
            'export default function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail/send-object.ts',
          source: [
            'function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'export default { sendMail };',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail/send-array.ts',
          source: [
            'function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'const mail = [sendMail] as const;',
            'export default mail;',
          ].join('\n'),
        },
      ],
      graph: {
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:24',
            target: 'orders.defaultArrayBarrel',
          },
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:5',
            target: 'orders.defaultHelperBarrel',
          },
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:14',
            target: 'orders.defaultObjectBarrel',
          },
        ],
      },
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail/send-array.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.defaultArrayBarrel',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail/send-array.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.defaultArrayBarrel',
      },
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail/send-default.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.defaultHelperBarrel',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail/send-default.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.defaultHelperBarrel',
      },
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail/send-object.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.defaultObjectBarrel',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail/send-object.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.defaultObjectBarrel',
      },
    ]);
  });

  it('produces sound agent-tool sink rows through unique static export-star barrels for named imports', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import { sendMail } from './mail';",
            'export const notify = tool({',
            "  name: 'orders.notifyStarBarrelNamedImport',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  async handler() {',
            '    await sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: "export * from './mail/send';",
        },
        {
          fileName: 'src/tools/mail/send.ts',
          source: [
            'export function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
      graph: {
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:3',
            target: 'orders.notifyStarBarrelNamedImport',
          },
        ],
      },
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail/send.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyStarBarrelNamedImport',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail/send.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyStarBarrelNamedImport',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from directly-invoked inline function bodies', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'export const notify = tool({',
            "  name: 'orders.notifyInline',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  async handler() {',
            '    await (async () => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    })();',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
      graph: {
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:2',
            target: 'orders.notifyInline',
          },
        ],
      },
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-inline-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:11:14',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyInline',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-inline-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:10:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyInline',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from directly-invoked same-module helper callbacks', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  return callback();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.notifyCallbackHelper',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  handler() {',
            '    return withToolBody(() => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
      graph: {
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:5',
            target: 'orders.notifyCallbackHelper',
          },
        ],
      },
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:14:14',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyCallbackHelper',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:13:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyCallbackHelper',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from directly-invoked imported helper callbacks', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import { withToolBody } from './callbacks';",
            'export const notify = tool({',
            "  name: 'orders.notifyImportedCallbackHelper',",
            "  purpose: 'Notify the buyer.',",
            "  audit: { owner: 'security' },",
            "  authority: [{ kind: 'principal', principal: 'user:123', requirement: 'caller' }],",
            "  capabilities: [{ name: 'egress:api.sendgrid.com', reason: 'send mail' }],",
            '  handler() {',
            '    return withToolBody(() => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/callbacks.ts',
          source: [
            'export function withToolBody(callback: () => unknown) {',
            '  return callback();',
            '}',
          ].join('\n'),
        },
      ],
      graph: {
        capabilities: [
          {
            ambientBrowserCredentials: 'rejected',
            authority: ['principal:user:123'],
            declaredCapabilities: ['egress:api.sendgrid.com'],
            kind: 'agentTool',
            owner: 'security',
            purpose: 'Notify the buyer.',
            site: 'src/tools/orders.ts:3',
            target: 'orders.notifyImportedCallbackHelper',
          },
        ],
      },
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:12:14',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyImportedCallbackHelper',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:11:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyImportedCallbackHelper',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from directly-invoked same-module helper callback aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const run = callback;',
            '  return run();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.notifyCallbackAliasHelper',",
            '  handler() {',
            '    return withToolBody(() => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:11:14',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyCallbackAliasHelper',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:10:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyCallbackAliasHelper',
      },
    ]);
  });

  it('does not produce enforced agent-tool sink rows from type-only or nested tool identifiers', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/type-only.ts',
          source: [
            "import type { tool } from '@kovojs/server';",
            'declare const localTool: typeof tool;',
            'export const notify = localTool({',
            "  name: 'orders.typeOnly',",
            '  handler() {',
            "    return fetch('https://api.sendgrid.com/v3/mail/send');",
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/nested-shadow.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'export function register(tool: typeof import("@kovojs/server").tool) {',
            '  return tool({',
            "    name: 'orders.shadowed',",
            '    handler() {',
            "      return fetch('https://api.sendgrid.com/v3/mail/send');",
            '    },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('does not produce enforced agent-tool sink rows from unsummarized callback arguments', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/callback.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'declare function maybeInvoke(callback: () => Promise<unknown>): void;',
            'export const notify = tool({',
            "  name: 'orders.callback',",
            '  handler() {',
            '    maybeInvoke(async () => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('produces sound agent-tool sink rows from directly-invoked imported helper callback aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import { withToolBody } from './callbacks';",
            'export const notify = tool({',
            "  name: 'orders.notifyImportedCallbackAliasHelper',",
            '  handler() {',
            '    return withToolBody(() => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/callbacks.ts',
          source: [
            'export function withToolBody(callback: () => unknown) {',
            '  const run = callback;',
            '  return run();',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:8:14',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyImportedCallbackAliasHelper',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:7:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyImportedCallbackAliasHelper',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static helper callback object-property aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = { run: callback };',
            '  return callbacks.run();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.notifyCallbackObjectAliasHelper',",
            '  handler() {',
            '    return withToolBody(() => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:11:14',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyCallbackObjectAliasHelper',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:10:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyCallbackObjectAliasHelper',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static helper callback array-index aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  return callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.notifyCallbackArrayAliasHelper',",
            '  handler() {',
            '    return withToolBody(() => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:11:14',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyCallbackArrayAliasHelper',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:10:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyCallbackArrayAliasHelper',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from readonly helper callback array wrapper methods', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  callbacks.forEach((run) => run());',
            '}',
            'export const notify = tool({',
            "  name: 'orders.notifyCallbackArrayWrapperHelper',",
            '  handler() {',
            '    return withToolBody(() => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:11:14',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyCallbackArrayWrapperHelper',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:10:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyCallbackArrayWrapperHelper',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static helper callback array object wrappers', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  const wrapper = { callbacks } as const;',
            '  return wrapper.callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.notifyCallbackArrayObjectWrapperHelper',",
            '  handler() {',
            '    return withToolBody(() => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:12:14',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyCallbackArrayObjectWrapperHelper',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:11:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyCallbackArrayObjectWrapperHelper',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static nested callback array object wrappers', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  const wrapper = { callbacks } as const;',
            '  const outer = { wrapper } as const;',
            '  return outer.wrapper.callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.notifyNestedCallbackArrayObjectWrapperHelper',",
            '  handler() {',
            '    return withToolBody(() => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:13:14',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyNestedCallbackArrayObjectWrapperHelper',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:12:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyNestedCallbackArrayObjectWrapperHelper',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from inline callback array object wrapper methods', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const wrapper = { callbacks: [callback] as const } as const;',
            '  wrapper.callbacks.forEach((run) => run());',
            '}',
            'export const notify = tool({',
            "  name: 'orders.notifyInlineCallbackArrayObjectWrapperMethod',",
            '  handler() {',
            '    return withToolBody(() => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/orders.ts:11:14',
        target: 'api.sendgrid.com',
        tool: 'orders.notifyInlineCallbackArrayObjectWrapperMethod',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/orders.ts:10:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.notifyInlineCallbackArrayObjectWrapperMethod',
      },
    ]);
  });

  it('does not produce enforced agent-tool sink rows from unproven callback object-property or array-index aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/computed-callback-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            "  const callbacks = { ['run']: callback };",
            '  return callbacks.run();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.computedCallbackObjectAlias',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/spread-callback-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const source = { run: callback };',
            '  const callbacks = { ...source };',
            '  return callbacks.run();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.spreadCallbackObjectAlias',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mutated-callback-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = { run: callback };',
            '  callbacks.run = () => undefined;',
            '  return callbacks.run();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.mutatedCallbackObjectAlias',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/element-callback-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = { run: callback };',
            "  return callbacks['run']();",
            '}',
            'export const notify = tool({',
            "  name: 'orders.elementCallbackObjectAlias',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/escaped-callback-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'declare function replaceCallbacks(callbacks: { run: () => unknown }): void;',
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = { run: callback };',
            '  replaceCallbacks(callbacks);',
            '  return callbacks.run();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.escapedCallbackObjectAlias',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/spread-callback-array.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [...[callback]] as const;',
            '  return callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.spreadCallbackArrayAlias',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mutated-callback-array.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  callbacks[0] = () => undefined;',
            '  return callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.mutatedCallbackArrayAlias',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/dynamic-callback-array.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  const index = 0;',
            '  return callbacks[index]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.dynamicCallbackArrayAlias',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/escaped-callback-array.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'declare function replaceCallbacks(callbacks: readonly [() => unknown]): void;',
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  replaceCallbacks(callbacks);',
            '  return callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.escapedCallbackArrayAlias',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mutating-callback-array-method.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  callbacks.push(() => undefined);',
            '  return callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.mutatingCallbackArrayMethod',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/dynamic-callback-array-method.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            "  const method = 'forEach';",
            '  callbacks[method]((run) => run());',
            '}',
            'export const notify = tool({',
            "  name: 'orders.dynamicCallbackArrayMethod',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/inline-spread-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const wrapper = { callbacks: [...[callback]] as const } as const;',
            '  wrapper.callbacks.forEach((run) => run());',
            '}',
            'export const notify = tool({',
            "  name: 'orders.inlineSpreadCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/inline-dynamic-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const wrapper = { callbacks: [callback] as const } as const;',
            "  const method = 'forEach';",
            '  wrapper.callbacks[method]((run) => run());',
            '}',
            'export const notify = tool({',
            "  name: 'orders.inlineDynamicCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/inline-escaped-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'declare function replaceWrapper(wrapper: { callbacks: readonly [() => unknown] }): void;',
            'function withToolBody(callback: () => unknown) {',
            '  const wrapper = { callbacks: [callback] as const } as const;',
            '  replaceWrapper(wrapper);',
            '  wrapper.callbacks.forEach((run) => run());',
            '}',
            'export const notify = tool({',
            "  name: 'orders.inlineEscapedCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/computed-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            "  const wrapper = { ['callbacks']: callbacks } as const;",
            '  return wrapper.callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.computedCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/spread-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  const source = { callbacks } as const;',
            '  const wrapper = { ...source };',
            '  return wrapper.callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.spreadCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mutated-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  const wrapper = { callbacks } as { callbacks: Array<() => unknown> };',
            '  wrapper.callbacks = [() => undefined];',
            '  return wrapper.callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.mutatedCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/dynamic-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  const wrapper = { callbacks } as const;',
            '  const index = 0;',
            '  return wrapper.callbacks[index]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.dynamicCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/escaped-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'declare function replaceWrapper(wrapper: { callbacks: readonly [() => unknown] }): void;',
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  const wrapper = { callbacks } as const;',
            '  replaceWrapper(wrapper);',
            '  return wrapper.callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.escapedCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/computed-nested-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  const wrapper = { callbacks } as const;',
            "  const outer = { ['wrapper']: wrapper } as const;",
            '  return outer.wrapper.callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.computedNestedCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/spread-nested-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  const wrapper = { callbacks } as const;',
            '  const source = { wrapper } as const;',
            '  const outer = { ...source };',
            '  return outer.wrapper.callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.spreadNestedCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mutated-nested-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  const wrapper = { callbacks } as const;',
            '  const outer = { wrapper } as { wrapper: { callbacks: Array<() => unknown> } };',
            '  outer.wrapper = { callbacks: [() => undefined] };',
            '  return outer.wrapper.callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.mutatedNestedCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/escaped-nested-callback-array-wrapper-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'declare function replaceOuter(outer: { wrapper: { callbacks: readonly [() => unknown] } }): void;',
            'function withToolBody(callback: () => unknown) {',
            '  const callbacks = [callback] as const;',
            '  const wrapper = { callbacks } as const;',
            '  const outer = { wrapper } as const;',
            '  replaceOuter(outer);',
            '  return outer.wrapper.callbacks[0]();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.escapedNestedCallbackArrayObjectWrapper',",
            '  handler() {',
            '    return withToolBody(() => fetch("https://api.sendgrid.com/v3/mail/send"));',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('does not produce enforced agent-tool sink rows from dynamically assigned helper callback aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/callback-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function withToolBody(callback: () => unknown) {',
            '  let run = callback;',
            '  return run();',
            '}',
            'export const notify = tool({',
            "  name: 'orders.dynamicCallbackHelper',",
            '  handler() {',
            '    return withToolBody(() => {',
            '      const token = process.env.SENDGRID_TOKEN;',
            "      return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '        headers: { authorization: token },',
            '      });',
            '    });',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('does not produce enforced agent-tool sink rows from unproven handler references', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/handler-call.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function makeHandler() {',
            '  return () => fetch("https://api.sendgrid.com/v3/mail/send");',
            '}',
            'export const notify = tool({',
            "  name: 'orders.handlerCall',",
            '  handler: makeHandler(),',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/handler-member.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'const handlers = {',
            '  notify: () => fetch("https://api.sendgrid.com/v3/mail/send"),',
            '};',
            'export const notify = tool({',
            "  name: 'orders.handlerMember',",
            '  handler: handlers.notify,',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('does not produce enforced agent-tool sink rows when a local binding shadows a helper', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/shadowed-helper.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
            'export const notify = tool({',
            "  name: 'orders.shadowedHelper',",
            '  handler() {',
            '    const sendMail = () => undefined;',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('produces sound agent-tool sink rows from static namespace imported helper calls', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/namespace.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import * as mail from './mail';",
            'export const notify = tool({',
            "  name: 'orders.namespaceImport',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.namespaceImport',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.namespaceImport',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static const object helper aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/object-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import { sendMail } from './mail';",
            'const mail = { sendMail };',
            'export const notify = tool({',
            "  name: 'orders.objectAlias',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.objectAlias',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.objectAlias',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static nested const object helper aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/nested-object-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import * as importedMail from './mail';",
            'function localMail() {',
            '  const token = process.env.LOCAL_TOKEN;',
            "  return fetch('https://local-mail.example.test/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'const local = { localMail };',
            'const providers = { importedMail, local };',
            'export const notifyImported = tool({',
            "  name: 'orders.nestedImportedObjectAlias',",
            '  handler() {',
            '    return providers.importedMail.sendMail();',
            '  },',
            '});',
            'export const notifyLocal = tool({',
            "  name: 'orders.nestedLocalObjectAlias',",
            '  handler() {',
            '    return providers.local.localMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.nestedImportedObjectAlias',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.nestedImportedObjectAlias',
      },
      {
        capability: 'egress:local-mail.example.test',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/nested-object-alias.ts:5:10',
        target: 'local-mail.example.test',
        tool: 'orders.nestedLocalObjectAlias',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/nested-object-alias.ts:4:17',
        target: 'env.LOCAL_TOKEN',
        tool: 'orders.nestedLocalObjectAlias',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static const array helper aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/array-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import { sendMail } from './mail';",
            "import defaultSendMail from './default-mail';",
            'const mail = [sendMail, defaultSendMail] as const;',
            'export const notifyNamed = tool({',
            "  name: 'orders.arrayAliasNamed',",
            '  handler() {',
            '    return mail[0]();',
            '  },',
            '});',
            'export const notifyDefault = tool({',
            "  name: 'orders.arrayAliasDefault',",
            '  handler() {',
            '    return mail[1]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-mail.ts',
          source: [
            'export default function sendMail() {',
            '  const token = process.env.POSTMARK_TOKEN;',
            "  return fetch('https://api.postmarkapp.com/email', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.postmarkapp.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/default-mail.ts:3:10',
        target: 'api.postmarkapp.com',
        tool: 'orders.arrayAliasDefault',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/default-mail.ts:2:17',
        target: 'env.POSTMARK_TOKEN',
        tool: 'orders.arrayAliasDefault',
      },
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.arrayAliasNamed',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.arrayAliasNamed',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from frozen static helper aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/frozen-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import { sendMail } from './mail';",
            "import defaultSendMail from './default-mail';",
            "import defaultMail from './default-object-mail';",
            'const mail = Object.freeze({ sendMail });',
            'const providers = Object.freeze([defaultSendMail] as const);',
            'export const notifyObject = tool({',
            "  name: 'orders.frozenObjectAlias',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
            'export const notifyArray = tool({',
            "  name: 'orders.frozenArrayAlias',",
            '  handler() {',
            '    return providers[0]();',
            '  },',
            '});',
            'export const notifyDefaultObject = tool({',
            "  name: 'orders.frozenDefaultObject',",
            '  handler() {',
            '    return defaultMail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-mail.ts',
          source: [
            'export default function sendMail() {',
            '  const token = process.env.POSTMARK_TOKEN;',
            "  return fetch('https://api.postmarkapp.com/email', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-object-mail.ts',
          source: [
            'function sendMail() {',
            '  const token = process.env.MAILGUN_TOKEN;',
            "  return fetch('https://api.mailgun.net/v3/messages', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'export default Object.freeze({ sendMail });',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.postmarkapp.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/default-mail.ts:3:10',
        target: 'api.postmarkapp.com',
        tool: 'orders.frozenArrayAlias',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/default-mail.ts:2:17',
        target: 'env.POSTMARK_TOKEN',
        tool: 'orders.frozenArrayAlias',
      },
      {
        capability: 'egress:api.mailgun.net',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/default-object-mail.ts:3:10',
        target: 'api.mailgun.net',
        tool: 'orders.frozenDefaultObject',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/default-object-mail.ts:2:17',
        target: 'env.MAILGUN_TOKEN',
        tool: 'orders.frozenDefaultObject',
      },
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.frozenObjectAlias',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.frozenObjectAlias',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from frozen existing static helper aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/frozen-existing-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendSendgrid() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'function sendPostmark() {',
            '  const token = process.env.POSTMARK_TOKEN;',
            "  return fetch('https://api.postmarkapp.com/email', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'function sendMailgun() {',
            '  const token = process.env.MAILGUN_TOKEN;',
            "  return fetch('https://api.mailgun.net/v3/messages', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'const mail = { sendMail: sendSendgrid };',
            'const frozenMail = Object.freeze(mail);',
            'const providers = [sendPostmark] as const;',
            'const frozenProviders = Object.freeze(providers);',
            'const mailgun = { sendMail: sendMailgun };',
            'const nestedProviders = { mailgun };',
            'const frozenNestedProviders = Object.freeze(nestedProviders);',
            'export const notifyObject = tool({',
            "  name: 'orders.freezeExistingObjectAlias',",
            '  handler() {',
            '    return frozenMail.sendMail();',
            '  },',
            '});',
            'export const notifyArray = tool({',
            "  name: 'orders.freezeExistingArrayAlias',",
            '  handler() {',
            '    return frozenProviders[0]();',
            '  },',
            '});',
            'export const notifyNested = tool({',
            "  name: 'orders.freezeExistingNestedAlias',",
            '  handler() {',
            '    return frozenNestedProviders.mailgun.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.postmarkapp.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/frozen-existing-alias.ts:10:10',
        target: 'api.postmarkapp.com',
        tool: 'orders.freezeExistingArrayAlias',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/frozen-existing-alias.ts:9:17',
        target: 'env.POSTMARK_TOKEN',
        tool: 'orders.freezeExistingArrayAlias',
      },
      {
        capability: 'egress:api.mailgun.net',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/frozen-existing-alias.ts:16:10',
        target: 'api.mailgun.net',
        tool: 'orders.freezeExistingNestedAlias',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/frozen-existing-alias.ts:15:17',
        target: 'env.MAILGUN_TOKEN',
        tool: 'orders.freezeExistingNestedAlias',
      },
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/frozen-existing-alias.ts:4:10',
        target: 'api.sendgrid.com',
        tool: 'orders.freezeExistingObjectAlias',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/frozen-existing-alias.ts:3:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.freezeExistingObjectAlias',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static destructured helper aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/destructured.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import * as mail from './mail';",
            "import { postmarkMail } from './postmark';",
            'const { sendMail: deliverSendgrid } = mail;',
            'const helpers = [postmarkMail] as const;',
            'const [deliverPostmark] = helpers;',
            'export const notifySendgrid = tool({',
            "  name: 'orders.destructuredNamespace',",
            '  handler() {',
            '    return deliverSendgrid();',
            '  },',
            '});',
            'export const notifyPostmark = tool({',
            "  name: 'orders.destructuredArray',",
            '  handler() {',
            '    return deliverPostmark();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/postmark.ts',
          source: [
            'export function postmarkMail() {',
            '  const token = process.env.POSTMARK_TOKEN;',
            "  return fetch('https://api.postmarkapp.com/email', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.postmarkapp.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/postmark.ts:3:10',
        target: 'api.postmarkapp.com',
        tool: 'orders.destructuredArray',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/postmark.ts:2:17',
        target: 'env.POSTMARK_TOKEN',
        tool: 'orders.destructuredArray',
      },
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.destructuredNamespace',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.destructuredNamespace',
      },
    ]);
  });

  it('does not produce enforced agent-tool sink rows from unproven destructured helper shapes', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/default-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import * as mail from './mail';",
            "function fallback() { return fetch('https://fallback.example.test/mail'); }",
            'const { sendMail = fallback } = mail;',
            'export const notify = tool({',
            "  name: 'orders.defaultDestructure',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/computed-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import * as mail from './mail';",
            "const { ['sendMail']: deliverMail } = mail;",
            'export const notify = tool({',
            "  name: 'orders.computedDestructure',",
            '  handler() {',
            '    return deliverMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/nested-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import * as mail from './mail';",
            'const { nested: { sendMail } } = mail;',
            'export const notify = tool({',
            "  name: 'orders.nestedDestructure',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mutable-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import * as mail from './mail';",
            'let { sendMail } = mail;',
            'export const notify = tool({',
            "  name: 'orders.mutableDestructure',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-import-default-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-import-mail';",
            "function fallback() { return fetch('https://fallback.example.test/mail'); }",
            'const { sendMail = fallback } = mail;',
            'export const notify = tool({',
            "  name: 'orders.defaultImportDefaultDestructure',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-import-computed-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-import-mail';",
            "const { ['sendMail']: deliverMail } = mail;",
            'export const notify = tool({',
            "  name: 'orders.defaultImportComputedDestructure',",
            '  handler() {',
            '    return deliverMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-import-nested-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-import-mail';",
            'const { nested: { sendMail } } = mail;',
            'export const notify = tool({',
            "  name: 'orders.defaultImportNestedDestructure',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-import-rest-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-import-mail';",
            'const { ...helpers } = mail;',
            'export const notify = tool({',
            "  name: 'orders.defaultImportRestDestructure',",
            '  handler() {',
            '    return helpers.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-import-mutable-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-import-mail';",
            'let { sendMail } = mail;',
            'export const notify = tool({',
            "  name: 'orders.defaultImportMutableDestructure',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-import-array-default-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-import-array-mail';",
            "function fallback() { return fetch('https://fallback.example.test/mail'); }",
            'const [sendMail = fallback] = mail;',
            'export const notify = tool({',
            "  name: 'orders.defaultImportArrayDefaultDestructure',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-import-array-rest-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-import-array-mail';",
            'const [...helpers] = mail;',
            'export const notify = tool({',
            "  name: 'orders.defaultImportArrayRestDestructure',",
            '  handler() {',
            '    return helpers[0]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-import-array-nested-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-import-array-mail';",
            'const [[sendMail]] = mail;',
            'export const notify = tool({',
            "  name: 'orders.defaultImportArrayNestedDestructure',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-import-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-import.example.test/mail');",
            '}',
            'export default { sendMail };',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-import-array-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-import-array.example.test/mail');",
            '}',
            'export default [sendMail] as const;',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('produces sound agent-tool sink rows from static default array helper exports', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/default-array.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-array-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultArray',",
            '  handler() {',
            '    return mail[0]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-mail.ts',
          source: [
            'function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'const helpers = [sendMail] as const;',
            'export default helpers;',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-existing-array.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-frozen-existing-array-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenExistingArray',",
            '  handler() {',
            '    return mail[0]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-existing-array-mail.ts',
          source: [
            "import { sendMail } from './mail';",
            'const helpers = [sendMail] as const;',
            'export default Object.freeze(helpers);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export function sendMail() {',
            '  const token = process.env.POSTMARK_TOKEN;',
            "  return fetch('https://api.postmarkapp.com/email', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/default-array-mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.defaultArray',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/default-array-mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.defaultArray',
      },
      {
        capability: 'egress:api.postmarkapp.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail.ts:3:10',
        target: 'api.postmarkapp.com',
        tool: 'orders.defaultFrozenExistingArray',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail.ts:2:17',
        target: 'env.POSTMARK_TOKEN',
        tool: 'orders.defaultFrozenExistingArray',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static default object helper exports', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/default-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-object-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultObject',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-object-mail.ts',
          source: [
            'function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'export default { sendMail };',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/default-object-mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.defaultObject',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/default-object-mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.defaultObject',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static default nested object helper exports', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/default-nested-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import providers from './default-nested-object-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultNestedObject',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-nested-object-mail.ts',
          source: [
            'function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'const mail = { sendMail };',
            'const providers = { mail };',
            'export default providers;',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import providers from './default-frozen-nested-object-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenNestedObject',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-object-mail.ts',
          source: [
            'function sendMail() {',
            '  const token = process.env.POSTMARK_TOKEN;',
            "  return fetch('https://api.postmarkapp.com/email', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'const mail = { sendMail };',
            'const providers = { mail };',
            'export default Object.freeze(providers);',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.postmarkapp.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/default-frozen-nested-object-mail.ts:3:10',
        target: 'api.postmarkapp.com',
        tool: 'orders.defaultFrozenNestedObject',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/default-frozen-nested-object-mail.ts:2:17',
        target: 'env.POSTMARK_TOKEN',
        tool: 'orders.defaultFrozenNestedObject',
      },
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/default-nested-object-mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.defaultNestedObject',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/default-nested-object-mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.defaultNestedObject',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from static destructuring of default helper imports', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/default-object-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-object-destructure-mail';",
            'const { sendMail } = mail;',
            'export const notify = tool({',
            "  name: 'orders.defaultObjectDestructure',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-object-destructure-mail.ts',
          source: [
            'function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'export default { sendMail };',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-destructure.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-array-destructure-mail';",
            'const [sendMail] = mail;',
            'export const notify = tool({',
            "  name: 'orders.defaultArrayDestructure',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-destructure-mail.ts',
          source: [
            'function sendMail() {',
            '  const token = process.env.POSTMARK_TOKEN;',
            "  return fetch('https://api.postmarkapp.com/email', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
            'export default [sendMail] as const;',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.postmarkapp.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/default-array-destructure-mail.ts:3:10',
        target: 'api.postmarkapp.com',
        tool: 'orders.defaultArrayDestructure',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/default-array-destructure-mail.ts:2:17',
        target: 'env.POSTMARK_TOKEN',
        tool: 'orders.defaultArrayDestructure',
      },
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/default-object-destructure-mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.defaultObjectDestructure',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/default-object-destructure-mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.defaultObjectDestructure',
      },
    ]);
  });

  it('produces sound agent-tool sink rows from frozen existing default object helper exports', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/default-frozen-existing-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-frozen-existing-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenExistingObject',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-existing-mail.ts',
          source: [
            "import { sendMail } from './mail';",
            'const mail = { sendMail };',
            'export default Object.freeze(mail);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export function sendMail() {',
            '  const token = process.env.SENDGRID_TOKEN;',
            "  return fetch('https://api.sendgrid.com/v3/mail/send', {",
            '    headers: { authorization: token },',
            '  });',
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-imported-helper-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/mail.ts:3:10',
        target: 'api.sendgrid.com',
        tool: 'orders.defaultFrozenExistingObject',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-imported-helper-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/mail.ts:2:17',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.defaultFrozenExistingObject',
      },
    ]);
  });

  it('does not produce enforced agent-tool sink rows from unproven namespace helper shapes', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/computed.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import * as mail from './mail';",
            'export const notify = tool({',
            "  name: 'orders.computedNamespaceImport',",
            '  handler() {',
            "    return mail['sendMail']();",
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/computed-optional.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import * as mail from './mail';",
            'export const notify = tool({',
            "  name: 'orders.optionalComputedNamespaceImport',",
            '  handler() {',
            "    return mail?.['sendMail']?.();",
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail.ts',
          source: [
            'export function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/star-barrel.ts',
          source: "export * from './star-mail';",
        },
        {
          fileName: 'src/tools/star-mail.ts',
          source: [
            'export function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/star-import.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import * as mail from './star-barrel';",
            'export const notify = tool({',
            "  name: 'orders.starBarrel',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('does not produce enforced agent-tool sink rows from unproven const object aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/wrapped-computed-object-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://wrapped-computed.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'export const notify = tool({',
            "  name: 'orders.wrappedComputedObjectAlias',",
            '  handler() {',
            "    return (mail['sendMail'] as () => Promise<unknown>)();",
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/computed-object-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
            "const mail = { ['sendMail']: sendMail };",
            'export const notify = tool({',
            "  name: 'orders.computedObjectAlias',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/spread-object-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
            'const helpers = { sendMail };',
            'const mail = { ...helpers };',
            'export const notify = tool({',
            "  name: 'orders.spreadObjectAlias',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/dynamic-object-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
            'let mail = { sendMail };',
            'export const notify = tool({',
            "  name: 'orders.dynamicObjectAlias',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/computed-nested-object-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://computed-nested.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            "const providers = { ['mail']: mail };",
            'export const notify = tool({',
            "  name: 'orders.computedNestedObjectAlias',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/spread-nested-object-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://spread-nested.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'const providers = { ...{ mail } };',
            'export const notify = tool({',
            "  name: 'orders.spreadNestedObjectAlias',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mutable-nested-object-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://mutable-nested.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'const providers = { mail };',
            'providers.mail = { sendMail };',
            'export const notify = tool({',
            "  name: 'orders.mutableNestedObjectAlias',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('does not produce enforced agent-tool sink rows from unproven default nested object exports', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/default-nested-computed.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import providers from './default-nested-computed-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultNestedComputed',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-nested-computed-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-nested-computed.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            "const providers = { ['mail']: mail };",
            'export default providers;',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-nested-spread.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import providers from './default-nested-spread-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultNestedSpread',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-nested-spread-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-nested-spread.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'const providers = { ...{ mail } };',
            'export default providers;',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-nested-mutated.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import providers from './default-nested-mutated-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultNestedMutated',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-nested-mutated-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-nested-mutated.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'const providers = { mail };',
            'providers.mail = { sendMail };',
            'export default providers;',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-computed.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import providers from './default-frozen-nested-computed-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenNestedComputed',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-computed-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-frozen-nested-computed.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            "const providers = { ['mail']: mail };",
            'export default Object.freeze(providers);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-spread.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import providers from './default-frozen-nested-spread-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenNestedSpread',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-spread-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-frozen-nested-spread.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'const providers = { ...{ mail } };',
            'export default Object.freeze(providers);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-mutated.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import providers from './default-frozen-nested-mutated-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenNestedMutated',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-mutated-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-frozen-nested-mutated.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'const providers = { mail };',
            'providers.mail = { sendMail };',
            'export default Object.freeze(providers);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-shadowed.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import providers from './default-frozen-nested-shadowed-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenNestedShadowed',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-shadowed-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-frozen-nested-shadowed.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'const providers = { mail };',
            'const Object = { freeze<T>(value: T): T { return value; } };',
            'export default Object.freeze(providers);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-unresolved.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import providers from './default-frozen-nested-unresolved-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenNestedUnresolved',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-unresolved-mail.ts',
          source: [
            'const sendMail = 1;',
            'const mail = { sendMail };',
            'const providers = { mail };',
            'export default Object.freeze(providers);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-ambiguous.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import providers from './default-frozen-nested-ambiguous-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenNestedAmbiguous',",
            '  handler() {',
            '    return providers.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-nested-ambiguous-mail.ts',
          source: [
            'function firstMail() {',
            "  return fetch('https://default-frozen-nested-first.example.test/mail');",
            '}',
            'function secondMail() {',
            "  return fetch('https://default-frozen-nested-second.example.test/mail');",
            '}',
            'const mail = { sendMail: firstMail, sendMail: secondMail };',
            'const providers = { mail };',
            'export default Object.freeze(providers);',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('does not produce enforced agent-tool sink rows from unproven frozen helper aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/frozen-computed-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://computed-freeze.example.test/mail');",
            '}',
            "const mail = Object.freeze({ ['sendMail']: sendMail });",
            'export const notify = tool({',
            "  name: 'orders.frozenComputedObject',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-spread-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://spread-freeze.example.test/mail');",
            '}',
            'const helpers = { sendMail };',
            'const mail = Object.freeze({ ...helpers });',
            'export const notify = tool({',
            "  name: 'orders.frozenSpreadObject',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-duplicate-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function firstMail() {',
            "  return fetch('https://first-freeze.example.test/mail');",
            '}',
            'function secondMail() {',
            "  return fetch('https://second-freeze.example.test/mail');",
            '}',
            'const mail = Object.freeze({ sendMail: firstMail, sendMail: secondMail });',
            'export const notify = tool({',
            "  name: 'orders.frozenDuplicateObject',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-mutable-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://mutable-freeze.example.test/mail');",
            '}',
            'let mail = Object.freeze({ sendMail });',
            'export const notify = tool({',
            "  name: 'orders.frozenMutableObject',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-unresolved-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'const sendMail = 1;',
            'const mail = Object.freeze({ sendMail });',
            'export const notify = tool({',
            "  name: 'orders.frozenUnresolvedObject',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-shadowed-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://shadowed-freeze.example.test/mail');",
            '}',
            'const Object = { freeze<T>(value: T): T { return value; } };',
            'const mail = Object.freeze({ sendMail });',
            'export const notify = tool({',
            "  name: 'orders.frozenShadowedObject',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-spread-array.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://array-spread-freeze.example.test/mail');",
            '}',
            'const helpers = [sendMail] as const;',
            'const mail = Object.freeze([...helpers] as const);',
            'export const notify = tool({',
            "  name: 'orders.frozenSpreadArray',",
            '  handler() {',
            '    return mail[0]();',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('does not produce enforced agent-tool sink rows from unproven frozen existing aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/frozen-existing-unresolved.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'const sendMail = 1;',
            'const mail = { sendMail };',
            'const frozenMail = Object.freeze(mail);',
            'export const notify = tool({',
            "  name: 'orders.frozenExistingUnresolved',",
            '  handler() {',
            '    return frozenMail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-existing-computed.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://computed-existing-freeze.example.test/mail');",
            '}',
            "const mail = { ['sendMail']: sendMail };",
            'const frozenMail = Object.freeze(mail);',
            'export const notify = tool({',
            "  name: 'orders.frozenExistingComputed',",
            '  handler() {',
            '    return frozenMail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-existing-spread.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://spread-existing-freeze.example.test/mail');",
            '}',
            'const helpers = { sendMail };',
            'const mail = { ...helpers };',
            'const frozenMail = Object.freeze(mail);',
            'export const notify = tool({',
            "  name: 'orders.frozenExistingSpread',",
            '  handler() {',
            '    return frozenMail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-existing-mutated.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://mutated-existing-freeze.example.test/mail');",
            '}',
            'function fallbackMail() {',
            "  return fetch('https://fallback-existing-freeze.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'mail.sendMail = fallbackMail;',
            'const frozenMail = Object.freeze(mail);',
            'export const notify = tool({',
            "  name: 'orders.frozenExistingMutated',",
            '  handler() {',
            '    return frozenMail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-existing-shadowed-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://shadowed-existing-freeze.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'const Object = { freeze<T>(value: T): T { return value; } };',
            'const frozenMail = Object.freeze(mail);',
            'export const notify = tool({',
            "  name: 'orders.frozenExistingShadowedObject',",
            '  handler() {',
            '    return frozenMail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-existing-non-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://non-alias-existing-freeze.example.test/mail');",
            '}',
            'const frozenMail = Object.freeze(sendMail);',
            'export const notify = tool({',
            "  name: 'orders.frozenExistingNonAlias',",
            '  handler() {',
            '    return frozenMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-existing-ambiguous.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function firstMail() {',
            "  return fetch('https://first-existing-freeze.example.test/mail');",
            '}',
            'function secondMail() {',
            "  return fetch('https://second-existing-freeze.example.test/mail');",
            '}',
            'const mail = { sendMail: firstMail, sendMail: secondMail };',
            'const frozenMail = Object.freeze(mail);',
            'export const notify = tool({',
            "  name: 'orders.frozenExistingAmbiguous',",
            '  handler() {',
            '    return frozenMail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/frozen-existing-mutated-nested.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://mutated-nested-existing-freeze.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'const providers = { mail };',
            'providers.mail = { sendMail };',
            'const frozenProviders = Object.freeze(providers);',
            'export const notify = tool({',
            "  name: 'orders.frozenExistingMutatedNested',",
            '  handler() {',
            '    return frozenProviders.mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('does not produce enforced agent-tool sink rows from unproven const array aliases', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/spread-array-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
            'const helpers = [sendMail] as const;',
            'const mail = [...helpers] as const;',
            'export const notify = tool({',
            "  name: 'orders.spreadArrayAlias',",
            '  handler() {',
            '    return mail[0]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/dynamic-array-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
            'const mail = [sendMail] as const;',
            'const index = 0;',
            'export const notify = tool({',
            "  name: 'orders.dynamicArrayAlias',",
            '  handler() {',
            '    return mail[index]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mutable-array-alias.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            'function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
            'let mail = [sendMail];',
            'export const notify = tool({',
            "  name: 'orders.mutableArrayAlias',",
            '  handler() {',
            '    return mail[0]();',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('does not produce enforced agent-tool sink rows from ambiguous export-star named imports', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/orders.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import { sendMail } from './ambiguous-barrel';",
            'export const notify = tool({',
            "  name: 'orders.ambiguousStarBarrel',",
            '  handler() {',
            '    return sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/ambiguous-barrel.ts',
          source: ["export * from './mail-a';", "export * from './mail-b';"].join('\n'),
        },
        {
          fileName: 'src/tools/mail-a.ts',
          source: [
            'export function sendMail() {',
            "  return fetch('https://a.example.test/mail');",
            '}',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/mail-b.ts',
          source: [
            'export function sendMail() {',
            "  return fetch('https://b.example.test/mail');",
            '}',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('does not produce enforced agent-tool sink rows from unproven default helper shapes', () => {
    const derived = deriveAppGraph({
      agentToolModules: [
        {
          fileName: 'src/tools/default-computed.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-computed-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultComputed',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-computed-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
            "export default { ['sendMail']: sendMail };",
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-reexport-computed.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-reexport-computed-barrel';",
            'export const notify = tool({',
            "  name: 'orders.defaultReexportComputed',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-reexport-computed-barrel.ts',
          source: "export { default } from './default-computed-mail';",
        },
        {
          fileName: 'src/tools/default-spread.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-spread-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultSpread',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-spread-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://api.sendgrid.com/v3/mail/send');",
            '}',
            'const mail = { sendMail };',
            'export default { ...mail };',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-computed.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-frozen-computed-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenComputed',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-computed-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-frozen-computed.example.test/mail');",
            '}',
            "const mail = { ['sendMail']: sendMail };",
            'export default Object.freeze(mail);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-spread.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-frozen-spread-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenSpread',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-spread-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-frozen-spread.example.test/mail');",
            '}',
            'const helpers = { sendMail };',
            'const mail = { ...helpers };',
            'export default Object.freeze(mail);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-mutable.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-frozen-mutable-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenMutable',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-mutable-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-frozen-mutable.example.test/mail');",
            '}',
            'let mail = { sendMail };',
            'export default Object.freeze(mail);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-shadowed-object.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-frozen-shadowed-object-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenShadowedObject',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-shadowed-object-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-frozen-shadowed.example.test/mail');",
            '}',
            'const mail = { sendMail };',
            'const Object = { freeze<T>(value: T): T { return value; } };',
            'export default Object.freeze(mail);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-unresolved.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-frozen-unresolved-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenUnresolved',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-unresolved-mail.ts',
          source: [
            'const sendMail = 1;',
            'const mail = { sendMail };',
            'export default Object.freeze(mail);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-ambiguous.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-frozen-ambiguous-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultFrozenAmbiguous',",
            '  handler() {',
            '    return mail.sendMail();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-frozen-ambiguous-mail.ts',
          source: [
            'function firstMail() {',
            "  return fetch('https://default-frozen-first.example.test/mail');",
            '}',
            'function secondMail() {',
            "  return fetch('https://default-frozen-second.example.test/mail');",
            '}',
            'const mail = { sendMail: firstMail, sendMail: secondMail };',
            'export default Object.freeze(mail);',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-spread.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-array-spread-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultArraySpread',",
            '  handler() {',
            '    return mail[0]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-spread-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-array-spread.example.test/mail');",
            '}',
            'const helpers = [sendMail] as const;',
            'export default [...helpers] as const;',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-hole.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-array-hole-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultArrayHole',",
            '  handler() {',
            '    return mail[1]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-hole-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-array-hole.example.test/mail');",
            '}',
            'export default [, sendMail] as const;',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-non-helper.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-array-non-helper-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultArrayNonHelper',",
            '  handler() {',
            '    return mail[0]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-non-helper-mail.ts',
          source: ['const sendMail = 1;', 'export default [sendMail] as const;'].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-dynamic-index.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-array-dynamic-index-mail';",
            'const index = 0;',
            'export const notify = tool({',
            "  name: 'orders.defaultArrayDynamicIndex',",
            '  handler() {',
            '    return mail[index]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-dynamic-index-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-array-dynamic-index.example.test/mail');",
            '}',
            'const helpers = [sendMail] as const;',
            'export default helpers;',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-mutated.ts',
          source: [
            "import { tool } from '@kovojs/server';",
            "import mail from './default-array-mutated-mail';",
            'export const notify = tool({',
            "  name: 'orders.defaultArrayMutated',",
            '  handler() {',
            '    return mail[0]();',
            '  },',
            '});',
          ].join('\n'),
        },
        {
          fileName: 'src/tools/default-array-mutated-mail.ts',
          source: [
            'function sendMail() {',
            "  return fetch('https://default-array-mutated.example.test/mail');",
            '}',
            'function fallbackMail() {',
            "  return fetch('https://default-array-fallback.example.test/mail');",
            '}',
            'const helpers = [sendMail] as const;',
            'helpers[0] = fallbackMail;',
            'export default helpers;',
          ].join('\n'),
        },
      ],
    });

    expect(derived.graph.agentToolSinks).toBeUndefined();
  });

  it('derives page access facts from compiled JSX route pages', () => {
    const routes = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { guards, publicAccess, route as defineRoute } from '@kovojs/server';
import * as kovo from '@kovojs/server';

const authed = guards.authed();

export const publicDocs = defineRoute('/docs', {
  access: publicAccess('public documentation'),
  page: () => <DocsPage />,
});

export const account = defineRoute('/account', {
  guard: authed,
  page: () => <AccountPage />,
});

export const missing = kovo.route('/missing', {
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
