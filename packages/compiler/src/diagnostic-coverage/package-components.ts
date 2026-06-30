import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const packageComponentsDiagnosticCoverage = defineDiagnosticCoverage('package-components', [
  {
    code: 'KV234',
    spec: 'SPEC.md §6.1.1',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'prefix-ok.tsx',
        packageComponentPrefixes: [{ packageName: '@acme/widgets', prefix: 'acme-' }],
        source: `
export const PrefixOk = component({
  render: () => <section></section>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'prefix-bad.tsx',
        packageComponentPrefixes: [{ packageName: '@acme/widgets', prefix: 'kovo-' }],
        source: `
export const PrefixBad = component({
  render: () => <section></section>,
});
`,
      }).diagnostics,
  },
]);
