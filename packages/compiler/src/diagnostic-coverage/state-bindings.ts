import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const stateBindingsDiagnosticCoverage = defineDiagnosticCoverage('state-bindings', [
  {
    code: 'KV301',
    spec: 'SPEC.md §4.1',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'state-ownership-ok.tsx',
        source: `
export const StateOwnershipOk = component({
  state: () => ({ open: false }),
  render: (_queries, state) => <span>{state.open}</span>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'state-ownership-bad.tsx',
        source: `
export const StateOwnershipBad = component({
  queries: { cart: cartQuery },
  state: () => ({ saved: cart.count }),
  render: ({ cart }, state) => <span>{state.saved}</span>,
});
`,
      }).diagnostics,
  },
]);
