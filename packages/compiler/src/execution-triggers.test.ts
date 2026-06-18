import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

const kv211 = diagnosticDefinitions.KV211;
const kv212 = diagnosticDefinitions.KV212;

describe('execution trigger validation', () => {
  it('accepts known delegated events and declared execution triggers', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component({
  render: () => (
    <section>
      <button on:click="/c/cart.client.js#Cart$add">Add</button>
      <search-index on:idle="/c/search.client.js#Search$warm"></search-index>
      <sales-chart on:visible="/c/chart.client.js#SalesChart$mount"></sales-chart>
      {/* KV211: stock ticker intentionally starts at parse for market-open pages. */}
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports KV211 and KV212 for unjustified eager execution and unknown triggers', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component({
  render: () => (
    <section>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
      <video-player on:media="/c/video.client.js#Video$mount"></video-player>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV211',
        fileName: 'execution-triggers.tsx',
        length: 7,
        message: `${kv211.message} on:load`,
        severity: kv211.severity,
        start: { column: 21, line: 5 },
      },
      {
        code: 'KV212',
        fileName: 'execution-triggers.tsx',
        length: 8,
        message: `${kv212.message} on:media`,
        severity: kv212.severity,
        start: { column: 21, line: 6 },
      },
    ]);
  });

  it('ignores malformed on-colon attribute names before trigger validation', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component({
  render: () => (
    <section>
      <button on:Click="/c/cart.client.js#Cart$add">Add</button>
      <button on:="/c/cart.client.js#Cart$add">Add</button>
      <button on:-click="/c/cart.client.js#Cart$add">Add</button>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores execution trigger text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component({
  render: () => {
    const sample = '<stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>';
    // <video-player on:media="/c/video.client.js#Video$mount"></video-player>
    return <button on:click="/c/cart.client.js#Cart$add">Add</button>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('requires KV211 justification to be attached to the eager trigger', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component({
  render: () => (
    <section>
      {/* KV211: this explains another trigger. */}
      <button on:click="/c/cart.client.js#Cart$add">Add</button>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV211',
        fileName: 'execution-triggers.tsx',
        length: 7,
        message: `${kv211.message} on:load`,
        severity: kv211.severity,
        start: { column: 21, line: 7 },
      },
    ]);
  });

  it('does not attach KV211 justification from inside a preceding element', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component({
  render: () => (
    <section>
      <p>{/* KV211: paragraph text explains something else. */}</p>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV211',
        fileName: 'execution-triggers.tsx',
        length: 7,
        message: `${kv211.message} on:load`,
        severity: kv211.severity,
        start: { column: 21, line: 6 },
      },
    ]);
  });
});
