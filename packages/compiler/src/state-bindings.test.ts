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
});
