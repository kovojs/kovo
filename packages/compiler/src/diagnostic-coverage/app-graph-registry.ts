import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const appGraphRegistryDiagnosticCoverage = defineDiagnosticCoverage('app-graph-registry', [
  {
    code: 'KV228',
    spec: 'SPEC.md §9.5',
    positive: () =>
      coverageFixtures.deriveAppGraph({
        graph: {
          pages: [{ route: '/cart' }, { route: '/products/:id' }],
        },
      }).diagnostics,
    negative: () =>
      coverageFixtures.deriveAppGraph({
        graph: {
          pages: [{ route: '/cart' }, { route: '/cart' }, { route: '/products/:id' }],
        },
      }).diagnostics,
  },
  {
    code: 'KV237',
    spec: 'SPEC.md §6.1.1',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'component-name-ok.tsx',
        source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});

export const MiniCartBadge = component({
  render: () => <mini-cart-badge></mini-cart-badge>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'component-name-bad.tsx',
        source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});

export const Cart_Badge = component({
  render: () => <mini-cart-badge></mini-cart-badge>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV238',
    spec: 'SPEC.md §4.5/§6.2',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'fragment-target-name-ok.tsx',
        source: `
export const ProductGrid = component({
  queries: { productGrid: productGridQuery },
  render: () => <product-grid></product-grid>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'fragment-target-name-bad.tsx',
        source: `
export const ProductGrid = component({
  queries: { productGrid: productGridQuery },
  render: () => <product-grid></product-grid>,
});

export const Product_Grid = component({
  queries: { productGrid: productGridQuery },
  render: () => <mini-grid></mini-grid>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV239',
    spec: 'SPEC.md §8',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'view-transition-ok.tsx',
        source: `
export const ViewTransitionOk = component({
  render: () => (
    <section>
      <img viewTransitionName="product-hero" src="/hero.png" />
      <img viewTransitionName="product-thumb" src="/thumb.png" />
    </section>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'view-transition-bad.tsx',
        source: `
export const ViewTransitionBad = component({
  render: () => (
    <section>
      <img viewTransitionName="product-hero" src="/hero.png" />
      <img viewTransitionName="product-hero" src="/thumb.png" />
    </section>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV421',
    spec: 'SPEC.md §6.1/§9.5',
    positive: () =>
      coverageFixtures.deriveRegistryFactsFromGraph({
        mutations: [
          { key: 'cart/add', writes: ['cart'] },
          { key: 'cart/remove', writes: ['order'] },
        ],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['order'], query: 'orderHistory' },
        ],
      }).diagnostics ?? [],
    negative: () =>
      coverageFixtures.deriveRegistryFactsFromGraph({
        mutations: [
          { key: 'cart/add', writes: ['cart'] },
          { key: 'cart/add', writes: ['order'] },
        ],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['order'], query: 'orderHistory' },
        ],
      }).diagnostics ?? [],
  },
]);
