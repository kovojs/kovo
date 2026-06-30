import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const queryBindingsDiagnosticCoverage = defineDiagnosticCoverage('query-bindings', [
  {
    code: 'KV222',
    spec: 'SPEC.md §4.8',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'binding-drift-ok.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const BindingDriftOk = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span>{cart.count}</span>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'binding-drift-bad.tsx',
        queryShapes: { cart: { count: 'number', total: 'number' } },
        source: `
export const BindingDriftBad = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.total">{cart.count}</span>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV223',
    spec: 'SPEC.md §4.8',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'binding-redundancy-ok.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const BindingRedundancyOk = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span>{cart.count}</span>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'binding-redundancy-bad.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const BindingRedundancyBad = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV226',
    spec: 'SPEC.md §5.2',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'residual-ok.tsx',
        source: `
export const ResidualOk = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="residual-ok" kovo-deps="cart">
      <span>{cart.count}</span>
    </section>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'residual-bad.tsx',
        source: `
export const ResidualBad = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="unknown-component" kovo-deps="cart">
      <span>{cart.count}</span>
    </section>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV227',
    spec: 'SPEC.md §4.8',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'nullable-ok.tsx',
        queryShapes: {
          product: { details: { kind: 'nullable', shape: { name: 'string' } } },
        },
        source: `
export const NullableOk = component({
  render: () => <span data-bind="product.details?.name">Coffee</span>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'nullable-bad.tsx',
        queryShapes: {
          product: { details: { kind: 'nullable', shape: { name: 'string' } } },
        },
        source: `
export const NullableBad = component({
  render: () => <span data-bind="product.details.name">Coffee</span>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV240',
    spec: 'SPEC.md §4.8',
    positive: () =>
      coverageFixtures.queryShapeFactDiagnostics('query-shapes-ok.tsx', [
        {
          query: 'cart',
          shape: { count: 'number' },
          source: 'generated/queries/cart.shape.ts',
        },
        {
          query: 'productGrid',
          shape: { items: [{ id: 'string' }] },
          source: 'generated/queries/product-grid.shape.ts',
        },
      ]),
    negative: () =>
      coverageFixtures.queryShapeFactDiagnostics('query-shapes-bad.tsx', [
        {
          query: 'cart',
          shape: { count: 'number' },
          source: 'generated/queries/cart.shape.ts',
        },
        {
          query: 'cart',
          shape: { total: 'number' },
          source: 'generated/queries/cart-refresh.shape.ts',
        },
      ]),
  },
  {
    code: 'KV241',
    spec: 'SPEC.md §4.2/§4.8',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'component-key-stability-ok.tsx',
        previousRegistryFacts: {
          components: ['component-key-stability-ok/component-key-stability-ok'],
        },
        source: `
export const ComponentKeyStabilityOk = component({
  render: () => <component-key-stability-ok></component-key-stability-ok>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'components/cart/badge.tsx',
        previousRegistryFacts: { components: ['components/old-cart/cart-badge'] },
        source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV246',
    spec: 'SPEC.md §4.1/§10.3',
    positive: () =>
      coverageFixtures.deriveRegistryFactsFromGraph(
        {
          mutations: [{ key: 'mutations/cart/add-to-cart', writes: ['cart'] }],
          queries: [{ domains: ['cart'], query: 'queries/cart/cart' }],
        },
        {
          mutations: { 'mutations/cart/add-to-cart': 'typeof addToCart' },
          previousRegistryFacts: {
            mutations: { 'mutations/cart/add-to-cart': 'typeof addToCart' },
          },
        },
      ).diagnostics ?? [],
    negative: () =>
      coverageFixtures.deriveRegistryFactsFromGraph(
        {
          mutations: [{ key: 'mutations/cart/add-to-cart', writes: ['cart'] }],
          queries: [{ domains: ['cart'], query: 'queries/cart/cart' }],
        },
        {
          mutations: { 'mutations/cart/add-to-cart': 'typeof addToCart' },
          previousRegistryFacts: {
            mutations: { 'mutations/old-cart/add-to-cart': 'typeof addToCart' },
          },
        },
      ).diagnostics ?? [],
  },
  {
    code: 'KV247',
    spec: 'SPEC.md §4.1/§10.2',
    positive: () =>
      coverageFixtures.deriveRegistryFactsFromGraph(
        {
          mutations: [{ key: 'mutations/cart/add-to-cart', writes: ['cart'] }],
          queries: [{ domains: ['cart'], query: 'queries/cart/cart-query' }],
        },
        {
          previousRegistryFacts: {
            queries: { 'queries/cart/cart-query': 'typeof cartQuery' },
          },
          queries: { 'queries/cart/cart-query': 'typeof cartQuery' },
        },
      ).diagnostics ?? [],
    negative: () =>
      coverageFixtures.deriveRegistryFactsFromGraph(
        {
          mutations: [{ key: 'mutations/cart/add-to-cart', writes: ['cart'] }],
          queries: [{ domains: ['cart'], query: 'queries/cart/cart-query' }],
        },
        {
          previousRegistryFacts: {
            queries: { 'queries/old-cart/cart-query': 'typeof cartQuery' },
          },
          queries: { 'queries/cart/cart-query': 'typeof cartQuery' },
        },
      ).diagnostics ?? [],
  },
  {
    code: 'KV302',
    spec: 'SPEC.md §4.8/§6.2',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'binding-shape-ok.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const BindingShapeOk = component({
  render: () => <span data-bind="cart.count">2</span>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'binding-shape-bad.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const BindingShapeBad = component({
  render: () => <span data-bind="cart.total">2</span>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV304',
    spec: 'SPEC.md §4.8',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'reserved-query-ok.tsx',
        source: `
export const ReservedQueryOk = component({
  queries: { cart: cartQuery },
  render: () => <section></section>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'reserved-query-bad.tsx',
        source: `
export const ReservedQueryBad = component({
  queries: { state: stateQuery },
  render: () => <section></section>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV311',
    spec: 'SPEC.md §4.9',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'coverage-ok.tsx',
        source: `
export const CoverageOk = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'coverage-bad.tsx',
        source: `
export const CoverageBad = component({
  queries: { cart: cartQuery },
  disableServerRefresh: true,
  render: ({ cart }) => <strong className={cart.discount}>Discount</strong>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV312',
    spec: 'SPEC.md §4.8/§4.9',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'clock-render-ok.tsx',
        source: `
export const ClockRenderOk = component({
  clocks: { ago: { every: '30s' } },
  render: ({ now }) => <time>{formatRelative(now.ago)}</time>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'clock-render-bad.tsx',
        source: `
export const ClockRenderBad = component({
  render: ({ now }) => <time>{formatRelative(now.ago)}</time>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV315',
    spec: 'SPEC.md §4.8/§4.9',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'clock-derive-ok.tsx',
        source: `
export const ClockDeriveOk$label = derive(['cart'], (cart) => cart.count);

export const ClockDeriveOk = component({
  render: () => <output data-derive="cart.ClockDeriveOk$label">0</output>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'clock-derive-bad.tsx',
        source: `
export const ClockDeriveBad$label = derive(['cart'], (cart) => Date.now() - new Date().getTime());

export const ClockDeriveBad = component({
  render: () => <output data-derive="cart.ClockDeriveBad$label">0</output>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV318',
    spec: 'SPEC.md §4.8',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'isomorphic-justification-ok.tsx',
        source: `
export const IsomorphicJustificationOk = component({
  /* KV318: local chooser self-renders while filtering query data. */
  isomorphic: true,
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge>{cart.count}</cart-badge>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'isomorphic-justification-bad.tsx',
        source: `
export const IsomorphicJustificationBad = component({
  isomorphic: true,
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge>{cart.count}</cart-badge>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV435',
    spec: 'SPEC.md §6.2/§6.6/§10.2',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'query-wire-ok.tsx',
        queryShapes: {
          user: {
            id: 'string',
            name: 'string',
          },
        },
        source: `
export const UserCard = component({
  queries: { user: {} },
  render: () => (
    <user-card>
      <span data-bind="user.id">u1</span>
    </user-card>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'query-wire-bad.tsx',
        queryShapes: {
          user: {
            id: 'string',
            passwordHash: {
              kind: 'secret',
              shape: 'string',
            },
          },
        },
        source: `
export const UserCard = component({
  queries: { user: {} },
  render: () => (
    <user-card>
      <span data-bind="user.id">u1</span>
    </user-card>
  ),
});
`,
      }).diagnostics,
  },
]);
