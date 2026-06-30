import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const navigationIdrefDiagnosticCoverage = defineDiagnosticCoverage('navigation-idref', [
  {
    code: 'KV220',
    spec: 'SPEC.md §6.4/§9.5',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'navigation-ok.tsx',
        registryFacts: { routes: ['/cart'] },
        source: `
export const NavigationOk = component({
  render: () => <a href="/cart">Cart</a>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'navigation-bad.tsx',
        registryFacts: { routes: ['/cart'] },
        source: `
export const NavigationBad = component({
  render: () => <a href="/checkout">Checkout</a>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV221',
    spec: 'SPEC.md §4.5/§6.4',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'idref-ok.tsx',
        source: `
export const IdrefOk = component({
  render: () => (
    <section>
      <input id="name" />
      <label for="name">Name</label>
    </section>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'idref-bad.tsx',
        source: `
export const IdrefBad = component({
  render: () => <label for="missing">Name</label>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV224',
    spec: 'SPEC.md §4.5',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'ids-ok.tsx',
        source: `
export const IdsOk = component({
  render: () => <section><h2 id="title">A</h2><output id="summary">B</output></section>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'ids-bad.tsx',
        source: `
export const IdsBad = component({
  render: () => <section><h2 id="title">A</h2><output id="title">B</output></section>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV225',
    spec: 'SPEC.md §4.2',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'markup-ok.tsx',
        source: `
export const MarkupOk = component({
  render: () => <section><p>Good</p><div>Still good</div></section>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'markup-bad.tsx',
        source: `
export const MarkupBad = component({
  render: () => <p><div>Bad</div></p>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV236',
    spec: 'SPEC.md §1/§5.2',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'output-context-ok.tsx',
        registryFacts: { routes: ['/pricing'] },
        source: `
export const OutputContextOk = component({
  render: ({ product }) => (
    <article title={product.name} aria-label={product.name}>
      <a href="/pricing">Pricing</a>
      <h2>{product.name}</h2>
    </article>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'output-context-bad.tsx',
        registryFacts: { routes: ['/pricing'] },
        source: `
export const OutputContextBad = component({
  render: () => <a href="javascript:alert(1)">bad</a>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV243',
    spec: 'SPEC.md §9.1',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'stream-target-ok.tsx',
        source: `
export const StreamTargetOk = component({
  render: () => <p streamText="message:a1"></p>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'stream-target-bad.tsx',
        source: `
export const StreamTargetBad = component({
  render: () => <p streamText="#message"></p>,
});
`,
      }).diagnostics,
  },
]);
