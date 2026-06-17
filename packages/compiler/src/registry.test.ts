import { diagnosticDefinitions } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule, compileRouteModule, deriveAppGraph } from './index.js';
import { deriveRegistryFactsFromGraph } from './internal-graph.js';

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
  'components/cart/cart-badge/cart-badge': { component: 'components/cart/cart-badge/cart-badge'; queries: readonly ['cart']; props: {}; };
}`);
    expect(registry).toContain(`declare module '@kovojs/core' {`);
    expect(registry).toContain(`  interface ComponentRegistry {
  'components/cart/cart-badge/cart-badge': import('@kovojs/core').Component<import('@kovojs/core').ComponentDefinitionInput>;
  'components/products/product-grid/product-grid': import('@kovojs/core').Component<import('@kovojs/core').ComponentDefinitionInput>;
  }`);
    expect(registry).toContain(`  interface FragmentTargets {
  'components/cart/cart-badge/cart-badge': {};
  }`);
    expect(registry).toContain(`  interface LiveTargetRegistry {
  'components/cart/cart-badge/cart-badge': { component: 'components/cart/cart-badge/cart-badge'; queries: readonly ['cart']; props: {}; };
  }`);
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
        fragments: ['components/cart/cart-badge/cart-badge'],
        name: 'components/cart/cart-badge/cart-badge',
        queries: ['cart'],
      },
      {
        domName: 'product-grid',
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
});
