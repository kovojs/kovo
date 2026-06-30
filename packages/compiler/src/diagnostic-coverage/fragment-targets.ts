import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const fragmentTargetsDiagnosticCoverage = defineDiagnosticCoverage('fragment-targets', [
  {
    code: 'KV230',
    spec: 'SPEC.md §4.5',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'fragment-children-ok.tsx',
        source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }, _state, { children }) => <tr data-row={rowId}>{children}</tr>,
});

export const CartTable = component({
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{cart.rowId}</span>
      </CartRow>
    </table>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'fragment-children-bad.tsx',
        source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component({
  render: ({ cart }) => {
    const snapshot = readSnapshot();
    return (
      <table>
        <CartRow rowId={cart.rowId}>
          <span>{snapshot.total}</span>
        </CartRow>
      </table>
    );
  },
});
`,
      }).diagnostics,
  },
  {
    code: 'KV303',
    spec: 'SPEC.md §4.5',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'fragment-input-ok.tsx',
        source: `
export const FragmentInputOk = component({
  props: { priceList: String },
  render: ({ priceList }) => <section>{priceList}</section>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'fragment-input-bad.tsx',
        source: `
export const FragmentInputBad = component({
  queries: { cart: cartQuery },
  render: ({ cart, priceList }) => <section>{renderOnce(cart.count)}{priceList.version}</section>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV316',
    spec: 'SPEC.md §4.5/§4.8',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'isomorphic-slot-ok.tsx',
        source: `
export const IsomorphicSlotOk = component({
  isomorphic: true,
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge>{cart.count}</cart-badge>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'isomorphic-slot-bad.tsx',
        source: `
export const IsomorphicSlotBad = component({
  isomorphic: true,
  queries: { cart: cartQuery },
  render: ({ cart }, _state, { children }) => (
    <cart-badge>
      {children}
      <strong>{cart.count}</strong>
    </cart-badge>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV420',
    spec: 'SPEC.md §4.5/§4.9/§9.1',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'stateful-fragment-ok.tsx',
        source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});

export const CartPanel = component({
  render: () => (
    <section>
      <Stepper />
    </section>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'stateful-fragment-bad.tsx',
        source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});

export const CartPanel = component({
  queries: { cart: {} },
  render: ({ cart }) => (
    <section>
      <p>{cart.total}</p>
      <Stepper />
    </section>
  ),
});
`,
      }).diagnostics,
  },
]);
