import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

const kv211 = diagnosticDefinitions.KV211;
const kv212 = diagnosticDefinitions.KV212;

describe('execution trigger validation', () => {
  it('versions same-module idle and visible trigger URLs with the client module version', () => {
    const result = compileComponentModule({
      fileName: 'components/search.tsx',
      source: `
import { component } from '@kovojs/core';

export const Search = component({
  render: () => (
    <section>
      <search-index onIdle={() => {}}></search-index>
      <sales-chart onVisible={() => {}}></sales-chart>
    </section>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(serverSource).toMatch(
      /on:idle="\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{64}\/components\/search\.client\.js#Search\$search-index_idle"/,
    );
    expect(serverSource).toMatch(
      /on:visible="\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{64}\/components\/search\.client\.js#Search\$sales-chart_visible"/,
    );
    expect(serverSource).not.toContain('on:idle="/c/components/search.client.js');
    expect(serverSource).not.toContain('on:visible="/c/components/search.client.js');
  });

  it('accepts known delegated events and declared execution triggers', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component({
  render: () => (
    <section>
      <button onClick={() => {}}>Add</button>
      <search-index onIdle={() => {}}></search-index>
      <sales-chart onVisible={() => {}}></sales-chart>
      {/* KV211: stock ticker intentionally starts at parse for market-open pages. */}
      <stock-ticker onLoad={() => {}}></stock-ticker>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV211')).toEqual([]);
  });

  it('pins typed events to the exact runtime-installed delegation vocabulary', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const RuntimeEvents = component({
  render: () => (
    <section>
      <output onAnimationEnd={() => {}}>Animation</output>
      <output onBeforeToggle={() => {}}>Toggle</output>
      <output onCancel={() => {}}>Cancel</output>
      <output onPaste={() => {}}>Paste</output>
      <output onPointerEnter={() => {}}>Enter</output>
      <output onScroll={() => {}}>Scroll</output>
      <output onDblClick={() => {}}>Not installed</output>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV212')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('on:dblclick') }),
    ]);
  });

  it('reports KV211 and KV212 for unjustified eager execution and unknown triggers', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component({
  render: () => (
    <section>
      <stock-ticker onLoad={() => {}}></stock-ticker>
      <video-player onMedia={() => {}}></video-player>
    </section>
  ),
});
`,
    });

    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'KV211' || diagnostic.code === 'KV212',
      ),
    ).toMatchObject([
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

  it('closes malformed app-authored on-colon lowered attributes before trigger validation', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component({
  render: () => (
    <section>
      <button on:Click="/c/cart.client.js#Cart$add">Add</button>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'KV235', message: expect.stringContaining('on:Click') }),
    ]);
  });

  it('ignores execution trigger text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component({
  render: () => {
    const sample = '<stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>';
    // <video-player on:media="/c/video.client.js#Video$mount"></video-player>
    return <button onClick={() => {}}>Add</button>;
  },
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });

  it('requires KV211 justification to be attached to the eager trigger', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component({
  render: () => (
    <section>
      {/* KV211: this explains another trigger. */}
      <button onClick={() => {}}>Add</button>
      <stock-ticker onLoad={() => {}}></stock-ticker>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV211')).toMatchObject([
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
      <stock-ticker onLoad={() => {}}></stock-ticker>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV211')).toMatchObject([
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
