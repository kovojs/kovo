import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

// SPEC.md §4.8 data-bind-prop: for the closed property-authoritative allowlist
// (checked/indeterminate/value/scrollTop/scrollLeft/selected/open), the compiler
// emits the SSR attribute + the companion data-bind:<attr> + a data-bind-prop:
// <prop> live-property stamp. Everything else stays on data-bind:* only.
describe('compiler data-bind-prop emission', () => {
  it('emits data-bind-prop for allowlisted state-bound attributes only', () => {
    const result = compileComponentModule({
      fileName: 'scroll-demo.tsx',
      source: `
export const ScrollDemo = component({
  state: () => ({ top: 0, on: false }),
  render: (_queries, state) => (
    <scroll-demo>
      <div scrollTop={state.top} />
      <input checked={state.on} disabled={state.on} type="checkbox" />
    </scroll-demo>
  ),
});
`,
    });
    const server = result.files[0]?.source ?? '';

    expect(result.diagnostics).toEqual([]);

    // scrollTop: property-authoritative → both data-bind:* and data-bind-prop:*.
    expect(server).toContain('data-bind:scrollTop=');
    expect(server).toContain('data-bind-prop:scrollTop=');

    // checked: property-authoritative → both, plus the SSR attribute survives.
    expect(server).toContain('data-bind:checked=');
    expect(server).toContain('data-bind-prop:checked=');

    // disabled: NOT property-authoritative → data-bind only, never data-bind-prop.
    expect(server).toContain('data-bind:disabled=');
    expect(server).not.toContain('data-bind-prop:disabled');

    // The companion stamps point at the same derive reference.
    const checkedBind = /data-bind:checked="([^"]+)"/.exec(server)?.[1];
    const checkedProp = /data-bind-prop:checked="([^"]+)"/.exec(server)?.[1];
    expect(checkedProp).toBe(checkedBind);

    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('emits a property-only data-bind-prop:indeterminate (no SSR attribute)', () => {
    const result = compileComponentModule({
      fileName: 'indeterminate-demo.tsx',
      source: `
export const IndeterminateDemo = component({
  state: () => ({ on: false }),
  render: (_queries, state) => (
    <indeterminate-demo>
      <input indeterminate={state.on} type="checkbox" />
    </indeterminate-demo>
  ),
});
`,
    });
    const server = result.files[0]?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    expect(server).toContain('data-bind-prop:indeterminate=');
    expect(() => assertFixpoint(result)).not.toThrow();
  });
});
