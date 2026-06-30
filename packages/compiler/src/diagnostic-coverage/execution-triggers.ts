import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const executionTriggersDiagnosticCoverage = defineDiagnosticCoverage('execution-triggers', [
  {
    code: 'KV211',
    spec: 'SPEC.md §4.7',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'trigger-load-ok.tsx',
        source: `
export const TriggerLoadOk = component({
  render: () => (
    <stock-ticker>
      {/* KV211: market-open pages intentionally start this ticker at parse time. */}
      <span on:load="/c/ticker.client.js#Ticker$start">Open</span>
    </stock-ticker>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'trigger-load-bad.tsx',
        source: `
export const TriggerLoadBad = component({
  render: () => <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV212',
    spec: 'SPEC.md §4.7',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'trigger-known-ok.tsx',
        source: `
export const TriggerKnownOk = component({
  render: () => <video-player on:visible="/c/video.client.js#Video$mount"></video-player>,
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'trigger-known-bad.tsx',
        source: `
export const TriggerKnownBad = component({
  render: () => <video-player on:media="/c/video.client.js#Video$mount"></video-player>,
});
`,
      }).diagnostics,
  },
]);
