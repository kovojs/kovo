import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

describe('compiler state bindings', () => {
  it('lowers sole text-child state paths to data-bind without a query plan', () => {
    const result = compileComponentModule({
      fileName: 'switch-demo.tsx',
      source: `
export const SwitchDemo = component('switch-demo', {
  state: () => ({ checked: false }),
  render: (_queries, state) => (
    <switch-demo>
      <output>{state.checked}</output>
    </switch-demo>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('<output data-bind="state.checked">{state.checked}</output>');
    expect(result.queryUpdatePlans).toEqual([]);
    expect(result.updateCoverage).toEqual([]);
    expect(clientSource).not.toContain('queryUpdatePlans');
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('wraps mixed text state paths in synthesized data-bind spans', () => {
    const result = compileComponentModule({
      fileName: 'toggle-demo.tsx',
      source: `
export const ToggleDemo = component('toggle-demo', {
  state: () => ({ pressed: false }),
  render: (_queries, state) => (
    <toggle-demo>
      Toggle is {state.pressed}
    </toggle-demo>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain(
      'Toggle is <span data-bind="state.pressed">{state.pressed}</span>',
    );
    expect(result.queryUpdatePlans).toEqual([]);
    expect(result.updateCoverage).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('accepts hand-authored state binding IR for fixpoint validation', () => {
    const result = compileComponentModule({
      fileName: 'counter.tsx',
      queryShapes: { cart: { count: 'number' } },
      source: `
export const Counter = component('counter', {
  state: () => ({ count: 0 }),
  render: (_queries, state) => (
    <counter>
      <output data-bind="state.count">{state.count}</output>
    </counter>
  ),
});
`,
    });

    expect(result.queryUpdatePlans).toEqual([]);
    expect(result.updateCoverage).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers state-only attribute expressions to versioned derive bindings', () => {
    const result = compileComponentModule({
      fileName: 'disclosure-demo.tsx',
      source: `
export const DisclosureDemo = component('disclosure-demo', {
  state: () => ({ open: false }),
  render: (_queries, state) => (
    <disclosure-demo>
      <button aria-expanded={state.open ? 'true' : 'false'}>Toggle</button>
      <section hidden={!state.open}>Panel</section>
    </disclosure-demo>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain(
      'data-bind:aria-expanded="/c/disclosure-demo.client.js?v=',
    );
    expect(serverSource).toContain('#DisclosureDemo$button_aria_expanded_derive');
    expect(serverSource).toContain('data-bind:hidden="/c/disclosure-demo.client.js?v=');
    expect(serverSource).toContain('#DisclosureDemo$section_hidden_derive');
    expect(serverSource).not.toContain('data-derive=');
    expect(serverSource).not.toContain('hidden={!state.open}');
    expect(clientSource).toContain("import { derive } from '@jiso/runtime';");
    expect(clientSource).toContain(
      `export const DisclosureDemo$button_aria_expanded_derive = derive(["state"], (state) => state.open ? 'true' : 'false');`,
    );
    expect(clientSource).toContain(
      `export const DisclosureDemo$section_hidden_derive = derive(["state"], (state) => ((!state.open) ? "" : null));`,
    );
    expect(clientSource).not.toContain('queryUpdatePlans');
    expect(result.queryUpdatePlans).toEqual([]);
    expect(result.updateCoverage).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('rejects query declarations that collide with the reserved state binding root', () => {
    const result = compileComponentModule({
      fileName: 'bad-state-query.tsx',
      source: `
export const BadStateQuery = component('bad-state-query', {
  queries: { state: stateQuery },
  render: () => <bad-state-query />,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW304',
        fileName: 'bad-state-query.tsx',
        message: 'Reserved query name is not allowed. state',
        severity: 'error',
      },
    ]);
  });
});
