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
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'SwitchDemo',
        detail: 'data-bind',
        position: 'binding',
        query: 'state.checked',
        source: 'state',
        status: 'plan',
      },
    ]);
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
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'ToggleDemo',
        detail: 'data-bind',
        position: 'binding',
        query: 'state.pressed',
        source: 'state',
        status: 'plan',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers state-only text expressions to versioned derive bindings', () => {
    const result = compileComponentModule({
      fileName: 'accordion-demo.tsx',
      source: `
export const AccordionDemo = component('accordion-demo', {
  state: () => ({ value: '' }),
  render: (_queries, state) => (
    <accordion-demo>
      <output>{state.value || 'none'}</output>
    </accordion-demo>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-bind="/c/accordion-demo.client.js?v=');
    expect(serverSource).toContain('#AccordionDemo$output_text_derive');
    expect(clientSource).toContain(
      `export const AccordionDemo$output_text_derive = derive(["state"], (state) => state.value || 'none');`,
    );
    expect(result.queryUpdatePlans).toEqual([]);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'AccordionDemo',
        detail: 'data-bind',
        position: 'binding',
        query: 'state.AccordionDemo$output_text_derive',
        source: 'state',
        status: 'plan',
      },
    ]);
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
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'Counter',
        detail: 'data-bind',
        position: 'binding',
        query: 'state.count',
        source: 'state',
        status: 'plan',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('validates state bindings against declared top-level state keys', () => {
    const valid = compileComponentModule({
      fileName: 'profile-card.tsx',
      source: `
export const ProfileCard = component('profile-card', {
  state: () => ({ profile: { name: 'Ada' } }),
  render: (_queries, state) => (
    <profile-card>
      <output data-bind="state.profile.name">{state.profile.name}</output>
    </profile-card>
  ),
});
`,
    });
    const invalid = compileComponentModule({
      fileName: 'bad-profile-card.tsx',
      source: `
export const BadProfileCard = component('bad-profile-card', {
  state: () => ({ profile: { name: 'Ada' } }),
  render: () => (
    <bad-profile-card>
      <output data-bind="state.doesNotExist">Missing</output>
    </bad-profile-card>
  ),
});
`,
    });

    expect(valid.diagnostics).toEqual([]);
    expect(invalid.diagnostics).toEqual([
      {
        code: 'KV302',
        fileName: 'bad-profile-card.tsx',
        length: 30,
        message: 'data-bind path is not present in the declared query shape. state.doesNotExist',
        severity: 'error',
        start: { column: 15, line: 6 },
      },
    ]);
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

    expect(serverSource).toContain('data-bind:aria-expanded="/c/disclosure-demo.client.js?v=');
    expect(serverSource).toContain('#DisclosureDemo$button_aria_expanded_derive');
    expect(serverSource).toContain('data-bind:hidden="/c/disclosure-demo.client.js?v=');
    expect(serverSource).toContain('#DisclosureDemo$section_hidden_derive');
    expect(serverSource).not.toContain('data-derive=');
    expect(serverSource).toContain("aria-expanded={state.open ? 'true' : 'false'}");
    expect(serverSource).toContain('hidden={!state.open}');
    expect(clientSource).toContain("import { derive } from '@kovojs/runtime';");
    expect(clientSource).toContain(
      `export const DisclosureDemo$button_aria_expanded_derive = derive(["state"], (state) => state.open ? 'true' : 'false');`,
    );
    expect(clientSource).toContain(
      `export const DisclosureDemo$section_hidden_derive = derive(["state"], (state) => ((!state.open) ? "" : null));`,
    );
    expect(clientSource).not.toContain('queryUpdatePlans');
    expect(result.queryUpdatePlans).toEqual([]);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'DisclosureDemo',
        detail: 'data-bind:aria-expanded',
        position: 'attribute',
        query: 'state.DisclosureDemo$button_aria_expanded_derive',
        source: 'state',
        status: 'plan',
      },
      {
        componentName: 'DisclosureDemo',
        detail: 'data-bind:hidden',
        position: 'attribute',
        query: 'state.DisclosureDemo$section_hidden_derive',
        source: 'state',
        status: 'plan',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('reports unhandled state and mixed query/state render expressions as KV311', () => {
    const result = compileComponentModule({
      fileName: 'mixed-state.tsx',
      source: `
export const MixedState = component('mixed-state', {
  queries: { cart: {} },
  state: () => ({ open: false }),
  render: (_queries, state) => (
    <mixed-state>
      <span className={state.open ? 'open' : 'closed'}>State</span>
      <button title={state.open && cart.count > 0 ? 'ready' : 'waiting'}>Checkout</button>
    </mixed-state>
  ),
});
`,
    });

    expect(result.updateCoverage).toEqual([
      {
        componentName: 'MixedState',
        detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
        position: 'expression',
        query: 'cart.count',
        sourceSpan: { length: 50, start: 253 },
        status: 'UNHANDLED',
      },
      {
        componentName: 'MixedState',
        detail: 'state expression has no data-bind, renderOnce, or isomorphic status',
        position: 'expression',
        query: 'state.open',
        source: 'state',
        sourceSpan: { length: 30, start: 187 },
        status: 'UNHANDLED',
      },
      {
        componentName: 'MixedState',
        detail: 'state expression has no data-bind, renderOnce, or isomorphic status',
        position: 'expression',
        query: 'state.open',
        source: 'state',
        sourceSpan: { length: 50, start: 253 },
        status: 'UNHANDLED',
      },
    ]);
    expect(result.diagnostics).toEqual([
      {
        code: 'KV311',
        fileName: 'mixed-state.tsx',
        length: 50,
        message:
          'Query/state-dependent DOM position has no update status. MixedState cart.count expression',
        severity: 'warn',
        start: { column: 22, line: 8 },
      },
      {
        code: 'KV311',
        fileName: 'mixed-state.tsx',
        length: 30,
        message:
          'Query/state-dependent DOM position has no update status. MixedState state.open expression',
        severity: 'warn',
        start: { column: 24, line: 7 },
      },
      {
        code: 'KV311',
        fileName: 'mixed-state.tsx',
        length: 50,
        message:
          'Query/state-dependent DOM position has no update status. MixedState state.open expression',
        severity: 'warn',
        start: { column: 22, line: 8 },
      },
    ]);
  });

  it('classifies renderOnce state reads without emitting a runtime state plan', () => {
    const result = compileComponentModule({
      fileName: 'state-once.tsx',
      source: `
export const StateOnce = component('state-once', {
  state: () => ({ tone: 'calm' }),
  render: (_queries, state) => (
    <state-once>
      <span className={renderOnce(state.tone)}>Tone</span>
    </state-once>
  ),
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(result.queryUpdatePlans).toEqual([]);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'StateOnce',
        detail: 'declared renderOnce',
        position: 'expression',
        query: 'state.tone',
        source: 'state',
        status: 'renderOnce',
      },
    ]);
    expect(clientSource).not.toContain('statePlans');
    expect(result.diagnostics).toEqual([]);
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
        code: 'KV304',
        fileName: 'bad-state-query.tsx',
        message: 'Reserved query name is not allowed. state',
        severity: 'error',
      },
    ]);
  });
});
