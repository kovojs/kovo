import { describe, expect, it } from 'vitest';

import {
  assertFixpoint,
  compileComponentModule,
  deriveAppGraph,
  deriveRegistryFactsFromGraph,
} from './index.js';

const cartBadgeSource = `
import { component } from '@kovojs/core';

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
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
    expect(registry).toContain("'cart-badge': {};");
    expect(registry).toContain(`interface FragmentTargets {
  'cart-badge': {};
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
    expect(registry).toContain(`declare module '@kovojs/core' {
  interface FragmentTargets {
  'cart-badge': {};
  }

  interface QueryRegistry {
  'cart': typeof cartQuery;
  'productGrid': typeof productGridQuery;
  }

  interface MutationRegistry {
  'cart/add': typeof addToCart;
  'cart/remove': typeof removeFromCart;
  }

  interface RouteRegistry {
  '/cart': import('@kovojs/core').Route<'/cart'>;
  '/products/:id': import('@kovojs/core').Route<'/products/:id'>;
  }

  interface InvalidationSets {
  'cart/add': 'cart' | 'orderHistory' | 'productGrid';
  }
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

  it('derives app graph component facts from compiled component results', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: cartBadgeSource,
    });
    const productGrid = compileComponentModule({
      fileName: 'components/products/product-grid.tsx',
      source: `
import { component } from '@kovojs/core';

export const ProductGrid = component('product-grid', {
  queries: { productGrid: {} },
  render: () => <section><ul data-bind="productGrid.items"></ul></section>,
});
`,
    });

    expect(cartBadge.componentGraphFacts).toEqual([
      {
        fragments: ['cart-badge'],
        name: 'CartBadge',
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
        fragments: ['cart-badge'],
        name: 'CartBadge',
        queries: ['cart'],
      },
      {
        name: 'ProductGrid',
        queries: ['productGrid'],
      },
    ]);
    expect(derived.registryFacts).toEqual({
      components: ['cart-badge', 'product-grid'],
      domainKeys: ['cart', 'product'],
      fragmentTargets: ['cart-badge'],
      invalidations: {
        'cart/add': ['cart'],
      },
      routes: ['/cart'],
    });
  });
});
