import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const attributeMergeDiagnosticCoverage = defineDiagnosticCoverage('attribute-merge', [
  {
    code: 'KV231',
    spec: 'SPEC.md §4.6',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'attribute-conflict-ok.tsx',
        source: `
export const AttributeConflictOk = component({
  render: () => <button commandfor="drawer">Open</button>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'attribute-conflict-bad.tsx',
        source: `
export const AttributeConflictBad = component({
  render: () => <button commandfor="drawer" commandfor="confirm">Open</button>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV232',
    spec: 'SPEC.md §4.6',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'attribute-override-ok.tsx',
        source: `
export const AttributeOverrideOk = component({
  render: () => <button role="button">Open</button>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'attribute-override-bad.tsx',
        source: `
export const AttributeOverrideBad = component({
  render: () => <button role="button" role="link">Open</button>,
});
`,
      }).diagnostics,
  },
  {
    // SPEC.md §4.6: state-bearing aria-* is primitive-wins; a static author value that
    // contradicts the primitive's render-time value is an error (KV317), not a lint (KV232).
    // The positive fixture passes matching primitive+author state-aria → KV232 lint, not KV317.
    // The negative fixture passes contradicting values → KV317 error.
    // Both use the attrs= primitive composition pattern so they route through
    // mergePrimitiveAndAuthorAttributes where KV317 is emitted.
    code: 'KV317',
    spec: 'SPEC.md §4.6',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'state-aria-no-contradiction.tsx',
        source: `
export const StateAriaNoContradiction = component({
  render: () => (
    <state-aria-no-contradiction>
      <Tooltip.Trigger attrs={{ 'aria-expanded': 'true' }}>
        {(attrs) => <button {...attrs} aria-expanded="true">Toggle</button>}
      </Tooltip.Trigger>
    </state-aria-no-contradiction>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'state-aria-contradiction.tsx',
        source: `
export const StateAriaContradiction = component({
  render: () => (
    <state-aria-contradiction>
      <Tooltip.Trigger attrs={{ 'aria-expanded': 'true' }}>
        {(attrs) => <button {...attrs} aria-expanded="false">Toggle</button>}
      </Tooltip.Trigger>
    </state-aria-contradiction>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV233',
    spec: 'SPEC.md §4.6/§4.8',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'binding-slot-ok.tsx',
        source: `
export const BindingSlotOk = component({
  render: () => <span data-bind="cart.count" data-bind:aria-label="cart.count">2</span>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'binding-slot-bad.tsx',
        source: `
export const BindingSlotBad = component({
  render: () => <span data-bind="cart.count" data-bind="cart.total">2</span>,
});
`,
      }).diagnostics,
  },
]);
