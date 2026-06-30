import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const deferLoweringDiagnosticCoverage = defineDiagnosticCoverage('defer-lowering', [
  {
    code: 'KV244',
    spec: 'SPEC.md §8',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'defer-jsx-ok.tsx',
        source: `
import { Defer } from '@kovojs/server';

export const DeferJsxOk = component({
  render: () => <main><Defer target="panel" render={() => <section>Ready</section>} /></main>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'defer-jsx-bad.tsx',
        source: `
import { defer } from '@kovojs/server';

export const DeferJsxBad = component({
  render: () => <main>{defer({ target: 'panel', priority: 'after-paint', render: () => '<section>Ready</section>' })}</main>,
});
`,
      }).diagnostics,
  },
]);
