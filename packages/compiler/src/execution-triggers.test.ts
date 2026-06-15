import { diagnosticDefinitions } from '@jiso/core';
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

const fw211 = diagnosticDefinitions.FW211;
const fw212 = diagnosticDefinitions.FW212;

describe('execution trigger validation', () => {
  it('accepts known delegated events and declared execution triggers', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      <button on:click="/c/cart.client.js#Cart$add">Add</button>
      <search-index on:idle="/c/search.client.js#Search$warm"></search-index>
      <sales-chart on:visible="/c/chart.client.js#SalesChart$mount"></sales-chart>
      {/* FW211: stock ticker intentionally starts at parse for market-open pages. */}
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW211 and FW212 for unjustified eager execution and unknown triggers', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
      <video-player on:media="/c/video.client.js#Video$mount"></video-player>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW211',
        fileName: 'execution-triggers.tsx',
        length: 7,
        message: `${fw211.message} on:load`,
        severity: fw211.severity,
        start: { column: 21, line: 5 },
      },
      {
        code: 'FW212',
        fileName: 'execution-triggers.tsx',
        length: 8,
        message: `${fw212.message} on:media`,
        severity: fw212.severity,
        start: { column: 21, line: 6 },
      },
    ]);
  });

  it('ignores malformed on-colon attribute names before trigger validation', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component('execution-triggers', {
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
export const ExecutionTriggers = component('execution-triggers', {
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

  it('requires FW211 justification to be attached to the eager trigger', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      {/* FW211: this explains another trigger. */}
      <button on:click="/c/cart.client.js#Cart$add">Add</button>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW211',
        fileName: 'execution-triggers.tsx',
        length: 7,
        message: `${fw211.message} on:load`,
        severity: fw211.severity,
        start: { column: 21, line: 7 },
      },
    ]);
  });

  it('does not attach FW211 justification from inside a preceding element', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      <p>{/* FW211: paragraph text explains something else. */}</p>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW211',
        fileName: 'execution-triggers.tsx',
        length: 7,
        message: `${fw211.message} on:load`,
        severity: fw211.severity,
        start: { column: 21, line: 6 },
      },
    ]);
  });
});
