import { describe, expect, it } from 'vitest';

import { collectStateDeriveReferenceFacts } from './compile.js';
import { assertFixpoint, compileComponentModule } from './index.js';
import { lowerStructuralJsx } from './lower/structural-jsx.js';
import { parseComponentModule } from './scan/parse.js';
import { applySourceReplacements } from './shared.js';

describe('compiler state bindings', () => {
  it('lowers sole text-child state paths to data-bind without a query plan', () => {
    const result = compileComponentModule({
      fileName: 'switch-demo.tsx',
      source: `
export const SwitchDemo = component({
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

    expect(serverSource).toContain(
      '<output data-bind="state.checked">{escapeText(state.checked)}</output>',
    );
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
export const ToggleDemo = component({
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
      'Toggle is <span data-bind="state.pressed">{escapeText(state.pressed)}</span>',
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
export const AccordionDemo = component({
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

    expect(serverSource).toContain('data-bind="/c/__v/');
    expect(serverSource).toContain('/accordion-demo.client.js#');
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
export const Counter = component({
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
export const ProfileCard = component({
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
export const BadProfileCard = component({
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
    expect(invalid.diagnostics).toMatchObject([
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

  it('validates multi-component state bindings against each declaring component state shape', () => {
    const twoComponents = compileComponentModule({
      fileName: 'settings-controls.tsx',
      source: `
export const ToggleControl = component({
  state: () => ({ enabled: false }),
  render: (_queries, state) => (
    <toggle-control>
      <output data-bind="state.enabled">{state.enabled}</output>
    </toggle-control>
  ),
});

export const FilterControl = component({
  state: () => ({ query: '' }),
  render: (_queries, state) => (
    <filter-control>
      <output data-bind="state.query">{state.query}</output>
    </filter-control>
  ),
});
`,
    });
    const threeComponents = compileComponentModule({
      fileName: 'dashboard-controls.tsx',
      source: `
export const CounterControl = component({
  state: () => ({ count: 0 }),
  render: (_queries, state) => (
    <counter-control>
      <output data-bind="state.count">{state.count}</output>
    </counter-control>
  ),
});

export const SearchControl = component({
  state: () => ({ term: '' }),
  render: (_queries, state) => (
    <search-control>
      <output data-bind="state.term">{state.term}</output>
    </search-control>
  ),
});

export const ModeControl = component({
  state: () => ({ mode: 'list' }),
  render: (_queries, state) => (
    <mode-control>
      <output data-bind="state.mode">{state.mode}</output>
    </mode-control>
  ),
});
`,
    });

    expect(twoComponents.diagnostics).toEqual([]);
    expect(threeComponents.diagnostics).toEqual([]);
  });

  it('reports KV302 for a missing state key in a later component', () => {
    const result = compileComponentModule({
      fileName: 'bad-settings-controls.tsx',
      source: `
export const ToggleControl = component({
  state: () => ({ enabled: false }),
  render: (_queries, state) => (
    <toggle-control>
      <output data-bind="state.enabled">{state.enabled}</output>
    </toggle-control>
  ),
});

export const FilterControl = component({
  state: () => ({ query: '' }),
  render: () => (
    <filter-control>
      <output data-bind="state.enabled">Missing</output>
    </filter-control>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV302',
        fileName: 'bad-settings-controls.tsx',
        message: 'data-bind path is not present in the declared query shape. state.enabled',
        severity: 'error',
        start: { column: 15, line: 15 },
      },
    ]);
  });

  it('validates state bindings through wrapped state return object literals', () => {
    const result = compileComponentModule({
      fileName: 'satisfies-state.tsx',
      source: `
import { type JsonValue } from '@kovojs/core';

export const SatisfiesState = component({
  state: () => ({ open: false }) satisfies JsonValue,
  render: (_queries, state) => (
    <satisfies-state>
      <output data-bind="state.open">{state.open}</output>
    </satisfies-state>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'SatisfiesState',
        detail: 'data-bind',
        position: 'binding',
        query: 'state.open',
        source: 'state',
        status: 'plan',
      },
    ]);
  });

  it('lowers state-only attribute expressions to versioned derive bindings', () => {
    const result = compileComponentModule({
      fileName: 'disclosure-demo.tsx',
      source: `
export const DisclosureDemo = component({
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

    expect(serverSource).toContain('data-bind:aria-expanded="/c/__v/');
    expect(serverSource).toContain('#DisclosureDemo$button_aria_expanded_derive');
    expect(serverSource).toContain('data-bind:hidden="/c/__v/');
    expect(serverSource).toContain('/disclosure-demo.client.js#');
    expect(serverSource).toContain('#DisclosureDemo$section_hidden_derive');
    expect(serverSource).not.toContain('data-derive=');
    expect(serverSource).toContain("aria-expanded={state.open ? 'true' : 'false'}");
    expect(serverSource).toContain('hidden={!state.open}');
    expect(clientSource).toContain("import { derive } from '@kovojs/browser/generated';");
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

  it('stamps same-element state conditional text when reactive attributes also derive', () => {
    const result = compileComponentModule({
      fileName: 'priority-toggle.tsx',
      source: `
export const PriorityToggle = component({
  state: () => ({ urgentOnly: false }),
  render: (_queries, state) => (
    <priority-toggle>
      <button
        aria-pressed={state.urgentOnly ? 'true' : 'false'}
        data-state={state.urgentOnly ? 'urgent' : 'all'}
      >
        {state.urgentOnly ? 'all' : 'urgent'}
      </button>
    </priority-toggle>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-bind="/c/__v/');
    expect(serverSource).toContain('#PriorityToggle$button_text_derive');
    expect(serverSource).toContain('data-bind:aria-pressed="/c/__v/');
    expect(serverSource).toContain('#PriorityToggle$button_aria_pressed_derive');
    expect(serverSource).toContain('data-bind:data-state="/c/__v/');
    expect(serverSource).toContain('#PriorityToggle$button_data_state_derive');
    expect(clientSource).toContain(
      `export const PriorityToggle$button_text_derive = derive(["state"], (state) => state.urgentOnly ? 'all' : 'urgent');`,
    );
    expect(result.updateCoverage).toEqual(
      expect.arrayContaining([
        {
          componentName: 'PriorityToggle',
          detail: 'data-bind',
          position: 'binding',
          query: 'state.PriorityToggle$button_text_derive',
          source: 'state',
          status: 'plan',
        },
        {
          componentName: 'PriorityToggle',
          detail: 'data-bind:aria-pressed',
          position: 'attribute',
          query: 'state.PriorityToggle$button_aria_pressed_derive',
          source: 'state',
          status: 'plan',
        },
        {
          componentName: 'PriorityToggle',
          detail: 'data-bind:data-state',
          position: 'attribute',
          query: 'state.PriorityToggle$button_data_state_derive',
          source: 'state',
          status: 'plan',
        },
      ]),
    );
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('collects typed state derive reference facts before terminal URL versioning', () => {
    const fileName = 'disclosure-demo.tsx';
    const source = `
export const DisclosureDemo = component({
  state: () => ({ open: false }),
  render: (_queries, state) => (
    <disclosure-demo>
      <button aria-expanded={state.open ? 'true' : 'false'}>Toggle</button>
      <section hidden={!state.open}>Panel</section>
    </disclosure-demo>
  ),
});
`;
    const model = parseComponentModule(fileName, source);
    const structural = lowerStructuralJsx(model, 'DisclosureDemo', { fileName, source });
    const loweredSource = applySourceReplacements(source, structural.replacements);
    const loweredModel = parseComponentModule(fileName, loweredSource);
    const references = collectStateDeriveReferenceFacts(
      loweredModel,
      structural.stateDerives,
      '/c/__v/HASH/disclosure-demo.client.js',
    );

    expect(references.map(({ target: _target, ...reference }) => reference)).toMatchInlineSnapshot(`
      [
        {
          "attr": "data-bind:aria-expanded",
          "clientHref": "/c/__v/HASH/disclosure-demo.client.js",
          "exportName": "DisclosureDemo$button_aria_expanded_derive",
          "placeholder": "state.DisclosureDemo$button_aria_expanded_derive",
          "value": "/c/__v/HASH/disclosure-demo.client.js#DisclosureDemo$button_aria_expanded_derive",
          "writer": "state derive URL versioning",
        },
        {
          "attr": "data-bind:hidden",
          "clientHref": "/c/__v/HASH/disclosure-demo.client.js",
          "exportName": "DisclosureDemo$section_hidden_derive",
          "placeholder": "state.DisclosureDemo$section_hidden_derive",
          "value": "/c/__v/HASH/disclosure-demo.client.js#DisclosureDemo$section_hidden_derive",
          "writer": "state derive URL versioning",
        },
      ]
    `);
  });

  it('reports unhandled state and mixed query/state render expressions as KV311', () => {
    const result = compileComponentModule({
      fileName: 'mixed-state.tsx',
      source: `
export const MixedState = component({
  queries: { cart: {} },
  disableServerRefresh: true,
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
        sourceSpan: { length: 50, start: 268 },
        status: 'UNHANDLED',
      },
      {
        componentName: 'MixedState',
        detail: 'state expression has no data-bind, renderOnce, or isomorphic status',
        position: 'expression',
        query: 'state.open',
        source: 'state',
        sourceSpan: { length: 30, start: 202 },
        status: 'UNHANDLED',
      },
      {
        componentName: 'MixedState',
        detail: 'state expression has no data-bind, renderOnce, or isomorphic status',
        position: 'expression',
        query: 'state.open',
        source: 'state',
        sourceSpan: { length: 50, start: 268 },
        status: 'UNHANDLED',
      },
    ]);
    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV311',
        fileName: 'mixed-state.tsx',
        help: expect.stringContaining('SPEC §4.9'),
        length: 50,
        message:
          'Query/state-dependent DOM position has no update status. MixedState cart.count expression',
        severity: 'warn',
        start: { column: 22, line: 9 },
      },
      {
        code: 'KV311',
        fileName: 'mixed-state.tsx',
        help: expect.stringContaining('SPEC §4.9'),
        length: 30,
        message:
          'Query/state-dependent DOM position has no update status. MixedState state.open expression',
        severity: 'warn',
        start: { column: 24, line: 8 },
      },
      {
        code: 'KV311',
        fileName: 'mixed-state.tsx',
        help: expect.stringContaining('SPEC §4.9'),
        length: 50,
        message:
          'Query/state-dependent DOM position has no update status. MixedState state.open expression',
        severity: 'warn',
        start: { column: 22, line: 9 },
      },
    ]);
  });

  it('lowers render-local const aliases of state expressions to client derives', () => {
    const result = compileComponentModule({
      fileName: 'state-alias.tsx',
      source: `
export const StateAlias = component({
  state: () => ({ query: 'ready' }),
  render: (_queries, state) => {
    const upper = state.query.toUpperCase();
    return (
      <state-alias>
        <p>{upper}</p>
      </state-alias>
    );
  },
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-bind="/c/__v/');
    expect(serverSource).toContain('#StateAlias$p_text_derive');
    expect(clientSource).toContain(
      'export const StateAlias$p_text_derive = derive(["state"], (state) => (state.query.toUpperCase()));',
    );
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('lowers destructured state aliases to canonical state-path derives', () => {
    const result = compileComponentModule({
      fileName: 'state-destructure-alias.tsx',
      source: `
export const StateDestructureAlias = component({
  state: () => ({ count: 1 }),
  render: (_queries, state) => {
    const { count } = state;
    return <state-destructure-alias><p>{count + 1}</p></state-destructure-alias>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain(
      'export const StateDestructureAlias$p_text_derive = derive(["state"], (state) => (state.count) + 1);',
    );
    expect(clientSource).not.toContain('=> count');
    expect(
      evaluateStateDerive(clientSource, 'StateDestructureAlias$p_text_derive', { count: 2 }),
    ).toBe(3);
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('lowers chained state aliases to canonical state-path derives', () => {
    const result = compileComponentModule({
      fileName: 'state-chained-alias.tsx',
      source: `
export const StateChainedAlias = component({
  state: () => ({ count: 1 }),
  render: (_queries, state) => {
    const direct = state.count;
    const chained = direct;
    return <state-chained-alias><p>{chained + 1}</p></state-chained-alias>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain(
      'export const StateChainedAlias$p_text_derive = derive(["state"], (state) => (state.count) + 1);',
    );
    expect(clientSource).not.toContain('chained');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('lowers chained destructured state aliases to canonical state-path derives', () => {
    const result = compileComponentModule({
      fileName: 'state-chained-destructure-alias.tsx',
      source: `
export const StateChainedDestructureAlias = component({
  state: () => ({ count: 1 }),
  render: (_queries, state) => {
    const { count } = state;
    const direct = count;
    const chained = direct;
    return <state-chained-destructure-alias><p>{chained + 1}</p></state-chained-destructure-alias>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain(
      'export const StateChainedDestructureAlias$p_text_derive = derive(["state"], (state) => (state.count) + 1);',
    );
    expect(clientSource).not.toContain('chained');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('lowers nested and computed state destructuring aliases to canonical state-path derives', () => {
    const result = compileComponentModule({
      fileName: 'state-nested-computed-alias.tsx',
      source: `
export const StateNestedComputedAlias = component({
  state: () => ({ profile: { name: 'Ada' }, count: 1 }),
  render: (_queries, state) => {
    const { profile: { name }, ['count']: total } = state;
    return <state-nested-computed-alias><p>{name + ':' + total}</p></state-nested-computed-alias>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain(
      `export const StateNestedComputedAlias$p_text_derive = derive(["state"], (state) => (state.profile.name) + ':' + (state.count));`,
    );
    expect(clientSource).not.toContain('=> name');
    expect(clientSource).not.toContain('total');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('lowers array-destructured state aliases to reactive derives', () => {
    const result = compileComponentModule({
      fileName: 'state-array-alias.tsx',
      source: `
export const StateArrayAlias = component({
  state: () => ({ items: ['first', 'second'] }),
  render: (_queries, state) => {
    const [firstItem] = state.items;
    return <state-array-alias><p>{firstItem.toUpperCase()}</p></state-array-alias>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain(
      'export const StateArrayAlias$p_text_derive = derive(["state"], (state) => (state.items[0]).toUpperCase());',
    );
    expect(clientSource).not.toContain('firstItem');
    expect(
      evaluateStateDerive(clientSource, 'StateArrayAlias$p_text_derive', { items: ['ok'] }),
    ).toBe('OK');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('lowers nested array state destructuring aliases to canonical state-path derives', () => {
    const result = compileComponentModule({
      fileName: 'state-nested-array-alias.tsx',
      source: `
export const StateNestedArrayAlias = component({
  state: () => ({ groups: [[{ label: 'first' }]] }),
  render: (_queries, state) => {
    const { groups: [[firstItem]] } = state;
    return <state-nested-array-alias><p>{firstItem.label}</p></state-nested-array-alias>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain(
      'export const StateNestedArrayAlias$p_text_derive = derive(["state"], (state) => (state.groups[0][0]).label);',
    );
    expect(clientSource).not.toContain('firstItem');
    expect(
      evaluateStateDerive(clientSource, 'StateNestedArrayAlias$p_text_derive', {
        groups: [[{ label: 'updated' }]],
      }),
    ).toBe('updated');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('lowers transitive element-access state aliases to canonical state-path derives', () => {
    const result = compileComponentModule({
      fileName: 'state-transitive-element-alias.tsx',
      source: `
export const StateTransitiveElementAlias = component({
  state: () => ({ items: [{ label: 'first' }] }),
  render: (_queries, state) => {
    const first = state.items[0];
    const label = first.label;
    return <state-transitive-element-alias><p>{label}</p></state-transitive-element-alias>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain(
      'export const StateTransitiveElementAlias$p_text_derive = derive(["state"], (state) => ((state.items[0]).label));',
    );
    expect(clientSource).not.toContain('first.label');
    expect(clientSource).not.toContain('=> label');
    expect(
      evaluateStateDerive(clientSource, 'StateTransitiveElementAlias$p_text_derive', {
        items: [{ label: 'updated' }],
      }),
    ).toBe('updated');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('lowers destructuring from element-access state aliases to canonical state-path derives', () => {
    const result = compileComponentModule({
      fileName: 'state-element-destructure-alias.tsx',
      source: `
export const StateElementDestructureAlias = component({
  state: () => ({ items: [{ label: 'first' }] }),
  render: (_queries, state) => {
    const { label } = state.items[0];
    return <state-element-destructure-alias><p>{label}</p></state-element-destructure-alias>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain(
      'export const StateElementDestructureAlias$p_text_derive = derive(["state"], (state) => (state.items[0].label));',
    );
    expect(clientSource).not.toContain('=> label');
    expect(
      evaluateStateDerive(clientSource, 'StateElementDestructureAlias$p_text_derive', {
        items: [{ label: 'updated' }],
      }),
    ).toBe('updated');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('does not rewrite property names while lowering alias-based derives', () => {
    const result = compileComponentModule({
      fileName: 'state-alias-property-name.tsx',
      source: `
export const StateAliasPropertyName = component({
  state: () => ({ name: 'Ada', profile: { name: 'Lovelace' } }),
  render: (_queries, state) => {
    const name = state.name;
    return <state-alias-property-name><p>{name + ':' + state.profile.name}</p></state-alias-property-name>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain(
      `export const StateAliasPropertyName$p_text_derive = derive(["state"], (state) => (state.name) + ':' + state.profile.name);`,
    );
    expect(clientSource).not.toContain('state.profile.(state.name)');
    expect(
      evaluateStateDerive(clientSource, 'StateAliasPropertyName$p_text_derive', {
        name: 'Grace',
        profile: { name: 'Hopper' },
      }),
    ).toBe('Grace:Hopper');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('rewrites aliases in ternary branches while lowering state derives', () => {
    const result = compileComponentModule({
      fileName: 'state-alias-ternary.tsx',
      source: `
export const StateAliasTernary = component({
  state: () => ({ active: true, label: 'ready' }),
  render: (_queries, state) => {
    const label = state.label;
    return <state-alias-ternary><p>{state.active ? label : 'idle'}</p></state-alias-ternary>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain(
      `export const StateAliasTernary$p_text_derive = derive(["state"], (state) => state.active ? (state.label) : 'idle');`,
    );
    expect(clientSource).not.toContain('? label :');
    expect(
      evaluateStateDerive(clientSource, 'StateAliasTernary$p_text_derive', {
        active: true,
        label: 'updated',
      }),
    ).toBe('updated');
    expect(
      evaluateStateDerive(clientSource, 'StateAliasTernary$p_text_derive', {
        active: false,
        label: 'updated',
      }),
    ).toBe('idle');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('fails closed with KV311 for unprovable state destructuring aliases', () => {
    const dynamic = compileComponentModule({
      fileName: 'state-dynamic-destructure-alias.tsx',
      source: `
export const StateDynamicDestructureAlias = component({
  state: () => ({ profile: { name: 'Ada' } }),
  render: (_queries, state) => {
    const field = 'name';
    const { [field]: value } = state.profile;
    return <state-dynamic-destructure-alias><p>{value}</p></state-dynamic-destructure-alias>;
  },
});
`,
    });
    const rest = compileComponentModule({
      fileName: 'state-rest-destructure-alias.tsx',
      source: `
export const StateRestDestructureAlias = component({
  state: () => ({ items: ['first', 'second'] }),
  render: (_queries, state) => {
    const [first, ...rest] = state.items;
    return <state-rest-destructure-alias><p>{rest.length}</p></state-rest-destructure-alias>;
  },
});
`,
    });
    const defaults = compileComponentModule({
      fileName: 'state-default-destructure-alias.tsx',
      source: `
export const StateDefaultDestructureAlias = component({
  state: () => ({ count: undefined }),
  render: (_queries, state) => {
    const { count = 5 } = state;
    return <state-default-destructure-alias><p>{count}</p></state-default-destructure-alias>;
  },
});
`,
    });

    expect(dynamic.files[1]?.source ?? '').not.toContain('value');
    expect(dynamic.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV311',
          message: expect.stringContaining('StateDynamicDestructureAlias state.profile expression'),
        }),
      ]),
    );
    expect(rest.files[1]?.source ?? '').not.toContain('rest.length');
    expect(rest.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV311',
          message: expect.stringContaining('StateRestDestructureAlias state.items expression'),
        }),
      ]),
    );
    expect(defaults.files[1]?.source ?? '').not.toContain('state.count');
    expect(defaults.files[1]?.source ?? '').not.toContain('count = 5');
    expect(defaults.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV311',
          message: expect.stringContaining('StateDefaultDestructureAlias state.count expression'),
        }),
      ]),
    );
  });

  it('fails closed with KV311 for dynamic element-access state aliases', () => {
    const result = compileComponentModule({
      fileName: 'state-dynamic-element-alias.tsx',
      source: `
export const StateDynamicElementAlias = component({
  state: () => ({ items: [{ label: 'first' }] }),
  render: (_queries, state) => {
    const index = 0;
    const item = state.items[index];
    return <state-dynamic-element-alias><p>{item.label}</p></state-dynamic-element-alias>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).not.toContain('state.items[index]');
    expect(clientSource).not.toContain('item.label');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV311',
          message: expect.stringContaining('StateDynamicElementAlias state.items expression'),
        }),
      ]),
    );
  });

  it('fails closed with KV311 instead of emitting unbound helper-dependent state derives', () => {
    const result = compileComponentModule({
      fileName: 'state-helper-alias.tsx',
      source: `
const format = (value) => String(value);

export const StateHelperAlias = component({
  state: () => ({ count: 1 }),
  render: (_queries, state) => {
    const label = format(state.count);
    return <state-helper-alias><p>{label}</p><span>{format(state.count)}</span></state-helper-alias>;
  },
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).not.toContain('format(state.count)');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV311',
          message: expect.stringContaining('StateHelperAlias state.count expression'),
        }),
      ]),
    );
  });

  it('fails closed with KV311 for imported or unbound module helpers in state derives', () => {
    const imported = compileComponentModule({
      fileName: 'state-imported-helper.tsx',
      source: `
import { format } from './format';

export const StateImportedHelper = component({
  state: () => ({ count: 1 }),
  render: (_queries, state) => (
    <state-imported-helper><p>{format(state.count)}</p></state-imported-helper>
  ),
});
`,
    });
    const unbound = compileComponentModule({
      fileName: 'state-unbound-helper.tsx',
      source: `
export const StateUnboundHelper = component({
  state: () => ({ count: 1 }),
  render: (_queries, state) => (
    <state-unbound-helper><p>{formatMissing(state.count)}</p></state-unbound-helper>
  ),
});
`,
    });

    expect(imported.files[1]?.source ?? '').not.toContain('format(state.count)');
    expect(unbound.files[1]?.source ?? '').not.toContain('formatMissing(state.count)');
    expect(imported.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV311',
          message: expect.stringContaining('StateImportedHelper state.count expression'),
        }),
      ]),
    );
    expect(unbound.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV311',
          message: expect.stringContaining('StateUnboundHelper state.count expression'),
        }),
      ]),
    );
  });

  it('classifies renderOnce state reads without emitting a runtime state plan', () => {
    const result = compileComponentModule({
      fileName: 'state-once.tsx',
      source: `
export const StateOnce = component({
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
export const BadStateQuery = component({
  queries: { state: stateQuery },
  render: () => <bad-state-query />,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV304',
        fileName: 'bad-state-query.tsx',
        message: 'Reserved query name is not allowed. state',
        severity: 'error',
      },
    ]);
  });
});

function evaluateStateDerive(
  clientSource: string,
  exportName: string,
  state: Record<string, unknown>,
): unknown {
  const escapedName = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `export const ${escapedName} = derive\\(\\["state"\\], \\(state\\) => ([\\s\\S]*?)\\);`,
  ).exec(clientSource);
  expect(match?.[1]).toBeDefined();
  return Function('state', `return (${match?.[1]});`)(state);
}
