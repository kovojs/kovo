import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const authoringSurfaceDiagnosticCoverage = defineDiagnosticCoverage('authoring-surface', [
  {
    code: 'KV235',
    spec: 'SPEC.md §5.2',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'authoring-surface-ok.tsx',
        source: `
export const AuthoringSurfaceOk = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge><span>{cart.count}</span></cart-badge>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'authoring-surface-bad.tsx',
        source: `
export const AuthoringSurfaceBad = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => \`<cart-badge kovo-deps="cart"><span data-bind="cart.count">\${cart.count}</span></cart-badge>\`,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV245',
    spec: 'SPEC.md §5.2',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'parse-ok.tsx',
        source: `
export const ParseOk = component({
  render: () => <section><span>Ready</span></section>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'parse-bad.tsx',
        source: `
export const ParseBad = component({
  render: () => <section><span>Broken</section>,
});
`,
      }).diagnostics,
  },
]);
