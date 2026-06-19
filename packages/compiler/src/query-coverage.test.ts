import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule, emitQueryPlanBootstrapModule } from './index.js';

describe('compiler query coverage', () => {
  it('warns when a derive reads the wall clock without a declared clock input', () => {
    const result = compileComponentModule({
      fileName: 'message-row.tsx',
      source: `
export const MessageRow$age = derive(['messages'], (messages) =>
  Date.now() - new Date().getTime() - new Date(messages.createdAt).getTime(),
);

export const MessageRow = component({
  queries: { messages: {} },
  render: () => (
    <message-row>
      <time data-derive="messages.MessageRow$age">0</time>
    </message-row>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV315')).toEqual([
      expect.objectContaining({
        code: 'KV315',
        message:
          'Untracked clock read in derive; use a declared clocks input. Date.now in MessageRow$age',
        severity: 'warn',
        start: { column: 3, line: 3 },
      }),
      expect.objectContaining({
        code: 'KV315',
        message:
          'Untracked clock read in derive; use a declared clocks input. new Date in MessageRow$age',
        severity: 'warn',
        start: { column: 16, line: 3 },
      }),
    ]);
  });

  it('reports KV312 when a rendered position reads an undeclared clock input', () => {
    const result = compileComponentModule({
      fileName: 'message-row.tsx',
      source: `
export const MessageRow = component({
  queries: { messages: messagesQuery },
  render: ({ messages, now }) => (
    <message-row>
      <time>{relativeTime(now.ago, messages.createdAt)}</time>
    </message-row>
  ),
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV312',
        message: 'Time-dependent rendered position lacks a declared cadence. now.ago',
        severity: 'error',
        start: { column: 27, line: 6 },
      }),
    );
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV303' }));
  });

  it('accepts rendered now reads that resolve to declared component clocks', () => {
    const result = compileComponentModule({
      fileName: 'message-row.tsx',
      source: `
export const MessageRow = component({
  queries: { messages: messagesQuery },
  clocks: { ago: { every: '30s' } },
  render: ({ messages, now }) => (
    <message-row>
      <time>{relativeTime(now.ago, messages.createdAt)}</time>
    </message-row>
  ),
});
`,
    });

    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV312' }));
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV303' }));
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('reports KV312 for declared component clock cadences that are not tick-driven', () => {
    const result = compileComponentModule({
      fileName: 'message-row.tsx',
      source: `
export const MessageRow = component({
  queries: { messages: messagesQuery },
  clocks: { gate: { at: ({ messages }) => messages.expiresAt } },
  render: ({ now }) => <time>{formatRelative(now.gate)}</time>,
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV312',
        message:
          'Time-dependent rendered position lacks a declared cadence. now.gate unsupported cadence',
        severity: 'error',
      }),
    );
  });

  it('reports KV312 when rendered volatile-time query fields have no refresh binding', () => {
    const result = compileComponentModule({
      fileName: 'subscription-row.tsx',
      queryShapes: {
        sub: {
          serverNow: { kind: 'volatile-time', shape: 'string' },
        },
      },
      source: `
export const SubscriptionRow = component({
  queries: { sub: subscriptionQuery },
  render: ({ sub }) => <time>{formatTime(sub.serverNow)}</time>,
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV312',
        message: 'Time-dependent rendered position lacks a declared cadence. sub.serverNow',
        severity: 'error',
      }),
    );
  });

  it('accepts rendered volatile-time query fields with a refresh binding', () => {
    const result = compileComponentModule({
      fileName: 'subscription-row.tsx',
      queryShapes: {
        sub: {
          serverNow: { kind: 'volatile-time', shape: 'string' },
        },
      },
      source: `
export const SubscriptionRow = component({
  queries: { sub: subscriptionQuery.refresh({ every: '30s' }) },
  render: ({ sub }) => <time>{formatTime(sub.serverNow)}</time>,
});
`,
    });

    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV312' }));
  });

  it('reports KV312 when rendered fields come from a volatile-time rowset', () => {
    const result = compileComponentModule({
      fileName: 'subscription-row.tsx',
      queryShapes: {
        sub: {
          kind: 'volatile-time',
          shape: {
            name: 'string',
          },
        },
      },
      source: `
export const SubscriptionRow = component({
  queries: { sub: subscriptionQuery },
  render: ({ sub }) => <span>{sub.name}</span>,
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV312',
        message: 'Time-dependent rendered position lacks a declared cadence. sub.name',
        severity: 'error',
      }),
    );
  });

  it('accepts rendered volatile-time rowset fields with a refresh binding', () => {
    const result = compileComponentModule({
      fileName: 'subscription-row.tsx',
      queryShapes: {
        sub: {
          kind: 'volatile-time',
          shape: {
            name: 'string',
          },
        },
      },
      source: `
export const SubscriptionRow = component({
  queries: { sub: subscriptionQuery.refresh({ every: '30s' }) },
  render: ({ sub }) => <span>{sub.name}</span>,
});
`,
    });

    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV312' }));
  });

  it('does not treat event-handler clock arguments as rendered positions', () => {
    const result = compileComponentModule({
      fileName: 'message-row.tsx',
      source: `
export const MessageRow = component({
  render: ({ now }) => (
    <message-row>
      <button onClick={() => track(now.ago)}>Track</button>
    </message-row>
  ),
});
`,
    });

    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV312' }));
  });

  it('accepts renderOnce as the explicit clock-freeze escape for rendered positions', () => {
    const result = compileComponentModule({
      fileName: 'message-row.tsx',
      source: `
export const MessageRow = component({
  render: ({ now }) => (
    <message-row>
      <time>{renderOnce(formatPublishTime(now.pub))}</time>
    </message-row>
  ),
});
`,
    });

    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV312' }));
  });

  it('emits declared every clocks as shared browser tick-bus plans for now derives', () => {
    const result = compileComponentModule({
      fileName: 'clock-label.tsx',
      source: `
export const ClockLabel$value = derive(['now'], (now) => now.ago.toISOString());

export const ClockLabel = component({
  clocks: { ago: { every: '1s' }, pub: { renderOnce: true } },
  render: () => <time data-derive="now.ClockLabel$value">initial</time>,
});
`,
    });
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.queryUpdatePlans).toEqual([
      expect.objectContaining({
        componentName: 'ClockLabel',
        derives: [expect.objectContaining({ input: 'now', name: 'ClockLabel$value' })],
        query: 'now',
      }),
    ]);
    expect(result.componentGraphFacts[0]?.clocks).toEqual([
      { cadence: "every='1s'", name: 'ago' },
      { cadence: 'renderOnce', name: 'pub' },
    ]);
    expect(clientSource).toContain(
      "import { applyCompiledQueryUpdatePlan, derive, installClockUpdatePlans } from '@kovojs/browser/generated';",
    );
    expect(clientSource).toContain('export const ClockLabel$clockUpdatePlans = [{');
    expect(clientSource).toContain('clocks: { "ago": { every: \'1s\' } }');
    expect(clientSource).not.toContain('"pub"');
    expect(clientSource).toContain('return ClockLabel$queryUpdatePlans.now(root, now, context);');
    expect(clientSource).toContain('export function installClockLabelClockUpdates(root)');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('emits store-backed clock plans for derives that mix now and query inputs', () => {
    const result = compileComponentModule({
      fileName: 'clock-label.tsx',
      source: `
export const ClockLabel$value = derive(['now', 'cart'], (now, cart) =>
  formatRelative(now.ago, cart.updatedAt),
);

export const ClockLabel = component({
  queries: { cart: cartQuery },
  clocks: { ago: { every: '1s' } },
  render: () => <time data-derive="now.ClockLabel$value">initial</time>,
});
`,
    });
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.queryUpdatePlans.map((plan) => plan.query).sort()).toEqual(['cart', 'now']);
    expect(clientSource).toContain(
      `export const ClockLabel$value = derive(["now","cart"], (now, cart) => formatRelative(now.ago, cart.updatedAt));`,
    );
    expect(clientSource).toContain(
      'function kovoDeriveValues(inputs, currentInput, currentValue, context)',
    );
    expect(clientSource).toContain('context?.queryStore?.get(input)');
    expect(clientSource).toContain('return ClockLabel$queryUpdatePlans.now(root, now, context);');
    expect(clientSource).toContain(
      'return applyCompiledQueryUpdatePlan(root, "cart", value, { bindings: true, derives: [{ name: "ClockLabel$value", selector: "[data-derive=\\"now.ClockLabel$value\\"]", select(value, root, context) { return ClockLabel$value.run(...kovoDeriveValues(["now","cart"], "cart", value, context)); } }]',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers inline text expressions that mix now and query inputs into clock-backed derives', () => {
    const result = compileComponentModule({
      fileName: 'clock-label.tsx',
      source: `
export const ClockLabel = component({
  queries: { cart: cartQuery },
  clocks: { ago: { every: '1s' } },
  render: ({ cart, now }) => <time>{formatRelative(now.ago, cart.updatedAt)}</time>,
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(serverSource).toContain('data-derive="now.ClockLabel$time_text_derive"');
    expect(result.queryUpdatePlans.map((plan) => plan.query).sort()).toEqual(['cart', 'now']);
    expect(result.updateCoverage).not.toContainEqual(
      expect.objectContaining({ status: 'UNHANDLED' }),
    );
    expect(clientSource).toContain(
      'export const ClockLabel$time_text_derive = derive(["now","cart"], (now, cart) => formatRelative(now.ago, cart.updatedAt));',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers inline attribute expressions that mix now and query inputs into clock-backed derives', () => {
    const result = compileComponentModule({
      fileName: 'clock-label.tsx',
      source: `
export const ClockLabel = component({
  queries: { cart: cartQuery },
  clocks: { ago: { every: '1s' } },
  render: ({ cart, now }) => (
    <time title={formatRelative(now.ago, cart.updatedAt)}>Updated</time>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(serverSource).toContain('data-derive="now.ClockLabel$time_title_derive"');
    expect(serverSource).toContain('data-derive-attr="title"');
    expect(result.queryUpdatePlans.map((plan) => plan.query).sort()).toEqual(['cart', 'now']);
    expect(result.updateCoverage).not.toContainEqual(
      expect.objectContaining({ status: 'UNHANDLED' }),
    );
    expect(clientSource).toContain(
      'export const ClockLabel$time_title_derive = derive(["now","cart"], (now, cart) => formatRelative(now.ago, cart.updatedAt));',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('reports KV311 for clock expressions that still mix per-element state', () => {
    const result = compileComponentModule({
      fileName: 'clock-label.tsx',
      source: `
export const ClockLabel = component({
  state: () => ({ open: false }),
  clocks: { ago: { every: '1s' } },
  render: (_queries, state, { now }) => (
    <time>{state.open ? formatRelative(now.ago) : 'closed'}</time>
  ),
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV311',
        message:
          'Query/state-dependent DOM position has no update status. ClockLabel state.open expression',
        severity: 'warn',
      }),
    );
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV312' }));
  });

  it('lowers inline attribute expressions into compiled query update stamps', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <button disabled={cart.count === 0}>Checkout</button>
    </cart-badge>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain(
      'export const CartBadge$button_disabled_derive = derive(["cart"], (cart) => cart.count === 0);',
    );
    expect(serverSource).toContain(
      '<button data-derive="cart.CartBadge$button_disabled_derive" data-derive-attr="disabled">Checkout</button>',
    );
    expect(serverSource).not.toContain('disabled={cart.count === 0}');
    expect(result.queryUpdatePlans).toMatchInlineSnapshot(`
      [
        {
          "componentName": "CartBadge",
          "outputContexts": [
            {
              "context": "boolean-attribute",
              "expression": "cart.count === 0",
              "sink": "disabled",
              "source": "client-query",
              "writer": "query attribute stamp",
            },
          ],
          "paths": [],
          "query": "cart",
          "stamps": [
            {
              "attr": "disabled",
              "derive": {
                "exportName": "CartBadge$button_disabled_derive",
                "expression": "cart.count === 0",
                "input": "cart",
                "name": "CartBadge$button_disabled_derive",
                "param": "cart",
                "selector": "[data-derive="cart.CartBadge$button_disabled_derive"]",
              },
              "selector": "[data-derive="cart.CartBadge$button_disabled_derive"]",
            },
          ],
        },
      ]
    `);
    expect(clientSource).toContain(
      "import { applyCompiledQueryUpdatePlan, derive } from '@kovojs/browser/generated';",
    );
    expect(clientSource).toContain(
      'export const CartBadge$button_disabled_derive = derive(["cart"], (cart) => cart.count === 0);',
    );
    expect(clientSource).toContain(
      'stamps: [{ attr: "disabled", selector: "[data-derive=\\"cart.CartBadge$button_disabled_derive\\"]", select(value, root, context) { return CartBadge$button_disabled_derive.run(value); } }]',
    );
    expect(result.updateCoverage).not.toContainEqual(
      expect.objectContaining({ query: 'cart.count', status: 'UNHANDLED' }),
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers multiple derivable query attributes on one element', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <button aria-expanded={cart.open ? 'true' : 'false'} aria-busy={cart.loading ? 'true' : 'false'}>Checkout</button>
    </cart-badge>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain(
      'data-bind:aria-expanded="cart.CartBadge$button_aria_expanded_derive"',
    );
    expect(serverSource).toContain('data-bind:aria-busy="cart.CartBadge$button_aria_busy_derive"');
    expect(serverSource).not.toContain('aria-expanded={cart.open');
    expect(serverSource).not.toContain('aria-busy={cart.loading');
    expect(result.queryUpdatePlans[0]?.stamps?.map((stamp) => stamp.attr).sort()).toEqual([
      'aria-busy',
      'aria-expanded',
    ]);
  });

  it('does not lower event handler expressions into inline query derives', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <button onClick={() => track(cart.count)}>Checkout</button>
    </cart-badge>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('on:click=');
    expect(serverSource).toContain('data-p-count="{cart.count}"');
    expect(serverSource).not.toContain('data-derive=');
    expect(result.queryUpdatePlans).toEqual([]);
  });

  it('does not derive query stamps from string literals inside inline expressions', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: { cart: { count: 'number' } },
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <button title={"cart.count"}>Checkout</button>
      <span>{"cart.count"}</span>
      <output>{cart.count}</output>
    </cart-badge>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('<button title={"cart.count"}>Checkout</button>');
    expect(serverSource).toContain('<span>{"cart.count"}</span>');
    expect(serverSource).toContain('<output data-bind="cart.count">{cart.count}</output>');
    expect(serverSource).not.toContain('button_title_derive');
    expect(result.queryUpdatePlans).toMatchInlineSnapshot(`
      [
        {
          "componentName": "CartBadge",
          "outputContexts": [
            {
              "context": "text",
              "expression": "cart.count",
              "sink": "textContent",
              "source": "client-query",
              "writer": "query text binding",
            },
          ],
          "paths": [
            "cart.count",
          ],
          "query": "cart",
        },
      ]
    `);
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('derives data-bind stamps for sole text-child query expressions', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: { cart: { count: 'number' } },
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <span>{cart.count}</span>
    </cart-badge>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('<span data-bind="cart.count">{cart.count}</span>');
    expect(result.queryUpdatePlans).toMatchInlineSnapshot(`
      [
        {
          "componentName": "CartBadge",
          "outputContexts": [
            {
              "context": "text",
              "expression": "cart.count",
              "sink": "textContent",
              "source": "client-query",
              "writer": "query text binding",
            },
          ],
          "paths": [
            "cart.count",
          ],
          "query": "cart",
        },
      ]
    `);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartBadge',
        detail: 'data-bind',
        position: 'binding',
        query: 'cart.count',
        status: 'plan',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(clientSource).toContain(
      'return applyCompiledQueryUpdatePlan(root, "cart", value, { bindings: true, derives: [], stamps: [], templateStamps: [] }, { queryStore: context.queryStore });',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('wraps mixed text query expressions in synthesized data-bind spans', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: { cart: { count: 'number' } },
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      Total: {cart.count} items
    </cart-badge>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('Total: <span data-bind="cart.count">{cart.count}</span> items');
    expect(result.queryUpdatePlans).toMatchInlineSnapshot(`
      [
        {
          "componentName": "CartBadge",
          "outputContexts": [
            {
              "context": "text",
              "expression": "cart.count",
              "sink": "textContent",
              "source": "client-query",
              "writer": "query text binding",
            },
          ],
          "paths": [
            "cart.count",
          ],
          "query": "cart",
        },
      ]
    `);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartBadge',
        detail: 'data-bind',
        position: 'binding',
        query: 'cart.count',
        status: 'plan',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('classifies query-dependent render positions for KV311 coverage', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: {}, product: {} },
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">{cart.count}</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <span>{renderOnce(cart.currency)}</span>
      <strong className={cart.discount}>Discount</strong>
      <em className={product.name}>Product</em>
    </cart-badge>
  ),
});
`,
    });

    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartBadge',
        detail: 'data-bind',
        position: 'binding',
        query: 'cart.count',
        status: 'plan',
      },
      {
        componentName: 'CartBadge',
        detail: 'data-bind:hidden',
        position: 'attribute',
        query: 'cart.empty',
        status: 'plan',
      },
      {
        componentName: 'CartBadge',
        detail: 'declared renderOnce',
        position: 'expression',
        query: 'cart.currency',
        status: 'renderOnce',
      },
      {
        componentName: 'CartBadge',
        detail: 'inferred query-backed server refresh target',
        position: 'expression',
        query: 'cart.discount',
        status: 'fragment',
      },
      {
        componentName: 'CartBadge',
        detail: 'inferred query-backed server refresh target',
        position: 'expression',
        query: 'product.name',
        status: 'fragment',
      },
    ]);
    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV223',
        fileName: 'cart-badge.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 13, line: 6 },
      },
    ]);
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('reports KV311 positions in author coordinates after inline derive prepends exports', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  render: () => (
    <cart-badge>
      <button title={cart.count === 0 ? 'enabled checkout' : 'disabled checkout'}>Checkout</button>


      <strong className={cart.discount}>Discount</strong>
    </cart-badge>
  ),
});
`,
    });

    expect(result.diagnostics).toContainEqual({
      code: 'KV311',
      fileName: 'cart-badge.tsx',
      help: expect.stringContaining('SPEC §4.9'),
      length: 13,
      message:
        'Query/state-dependent DOM position has no update status. CartBadge cart.discount expression',
      severity: 'warn',
      start: { column: 26, line: 10 },
    });
  });

  it('reports KV311 for compound query expressions in lowerer-skipped positions', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  render: () => (
    <cart-badge>
      <strong className={cart.count > 5 ? 'full' : 'empty'}>Cart</strong>
    </cart-badge>
  ),
});
`,
    });

    expect(result.updateCoverage).toContainEqual(
      expect.objectContaining({
        componentName: 'CartBadge',
        detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
        position: 'expression',
        query: 'cart.count',
        status: 'UNHANDLED',
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV311',
        message:
          'Query/state-dependent DOM position has no update status. CartBadge cart.count expression',
      }),
    );
  });

  it('classifies fragment-target query expressions as fragment-covered without KV311', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: {} },
  render: () => (
    <cart-row className={cart.count > 5 ? 'full' : 'empty'}>Cart</cart-row>
  ),
});
`,
    });

    expect(result.updateCoverage).toContainEqual({
      componentName: 'CartRow',
      detail: 'inferred query-backed server refresh target',
      position: 'expression',
      query: 'cart.count',
      status: 'fragment',
    });
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
  });

  it('force-disables inferred server refresh targets with disableServerRefresh', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  render: () => (
    <cart-row className={cart.count > 5 ? 'full' : 'empty'}>Cart</cart-row>
  ),
});
`,
    });

    expect(result.componentGraphFacts).toEqual([
      {
        domName: 'cart-row',
        exportName: 'CartRow',
        name: 'cart-row/cart-row',
        queries: ['cart'],
      },
    ]);
    expect(result.files[0]?.source).not.toContain('kovo-fragment-target=');
    expect(result.updateCoverage).toContainEqual(
      expect.objectContaining({
        componentName: 'CartRow',
        query: 'cart.count',
        status: 'UNHANDLED',
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV311',
        help: expect.stringContaining('disableServerRefresh: true'),
      }),
    );
  });

  it('does not let same-path plan coverage hide disabled-refresh expressions', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  render: () => (
    <cart-row>
      <span>{cart.count}</span>
      <strong className={cart.count > 0 ? 'hot' : 'cold'}>Cart</strong>
    </cart-row>
  ),
});
`,
    });

    expect(result.updateCoverage).toContainEqual(
      expect.objectContaining({
        componentName: 'CartRow',
        detail: 'data-bind',
        position: 'binding',
        query: 'cart.count',
        status: 'plan',
      }),
    );
    expect(result.updateCoverage).toContainEqual(
      expect.objectContaining({
        componentName: 'CartRow',
        detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
        position: 'expression',
        query: 'cart.count',
        status: 'UNHANDLED',
      }),
    );
    expect(
      result.updateCoverage.filter(
        (fact) => fact.query === 'cart.count' && fact.status === 'UNHANDLED',
      ),
    ).toHaveLength(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV311',
        help: expect.stringContaining('disableServerRefresh: true'),
        message:
          'Query/state-dependent DOM position has no update status. CartRow cart.count expression',
      }),
    );
  });

  it('does not classify fragment-target state expressions as fragment-covered', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  state: () => ({ open: false }),
  render: (_queries, state) => (
    <cart-row className={state.open ? 'open' : 'closed'}>Cart</cart-row>
  ),
});
`,
    });

    expect(result.updateCoverage).toContainEqual(
      expect.objectContaining({
        componentName: 'CartRow',
        query: 'state.open',
        source: 'state',
        status: 'UNHANDLED',
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV311',
        message:
          'Query/state-dependent DOM position has no update status. CartRow state.open expression',
      }),
    );
  });

  it('reports KV311 positions in author coordinates after navigation and derive lowerings', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  routes: { cart: '/cart' },
  render: () => (
    <cart-badge>
      <Link to="cart">Cart</Link>
      <button title={cart.count === 0 ? 'enabled checkout' : 'disabled checkout'}>Checkout</button>


      <strong className={cart.discount}>Discount</strong>
    </cart-badge>
  ),
});
`,
    });

    expect(result.diagnostics).toContainEqual({
      code: 'KV311',
      fileName: 'cart-badge.tsx',
      help: expect.stringContaining('SPEC §4.9'),
      length: 13,
      message:
        'Query/state-dependent DOM position has no update status. CartBadge cart.discount expression',
      severity: 'warn',
      start: { column: 26, line: 12 },
    });
  });

  it('uses JSX element spans for template stamp placeholders instead of HTML regexes', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="productId">
      <template kovo-stamp>
        <li>
          <span data-bind=".qty">{'<span data-bind=".qty">wrong</span>'}</span>
          <span data-bind=".name">Item</span>
        </li>
      </template>
    </ul>
  ),
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(result.queryUpdatePlans[0]?.templateStamps?.[0]?.itemBindingPlaceholders).toEqual([
      {
        path: '.name',
        readPath: 'name',
        readSegments: [{ name: 'name', optional: false }],
        templateEnd: 123,
        templateStart: 119,
        value: 'Item',
      },
      {
        path: '.qty',
        readPath: 'qty',
        readSegments: [{ name: 'qty', optional: false }],
        templateEnd: 77,
        templateStart: 38,
        value: `{'<span data-bind=".qty">wrong</span>'}`,
      },
    ]);
    expect(clientSource).toContain('kovoEscapeHtml(read(["qty"]))');
    expect(clientSource).not.toContain('html.replace');
  });

  it('classifies query-dependent render positions as isomorphic when declared', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  isomorphic: true,
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <strong className={cart.discount}>Discount</strong>
    </cart-badge>
  ),
});
`,
    });

    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartBadge',
        detail: 'declared isomorphic island',
        position: 'expression',
        query: 'cart.discount',
        status: 'isomorphic',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('ignores query declarations inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
const sample = 'queries: { fake: fakeQuery } <span>{fake.count}</span>';
// queries: { otherFake: otherFakeQuery } <span>{otherFake.count}</span>
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span>{renderOnce(cart.count)}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores query expressions inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
const sample = '<strong>{cart.discount}</strong><span>{renderOnce(cart.currency)}</span>';
// <em>{cart.total}</em>
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span>{renderOnce(cart.count)}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores query-looking text inside renderOnce string literals', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span>{renderOnce(cart.label ?? "cart.discount")}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartBadge',
        detail: 'declared renderOnce',
        position: 'expression',
        query: 'cart.label',
        status: 'renderOnce',
      },
    ]);
  });

  it('classifies renderOnce coverage from parsed call argument facts', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery, product: productQuery },
  render: ({ cart, product }) => (
    <span>{renderOnce(format(cart.count), "cart.discount", product.name)}</span>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartBadge',
        detail: 'declared renderOnce',
        position: 'expression',
        query: 'cart.count',
        status: 'renderOnce',
      },
      {
        componentName: 'CartBadge',
        detail: 'declared renderOnce',
        position: 'expression',
        query: 'product.name',
        status: 'renderOnce',
      },
    ]);
  });

  it('emits an app bootstrap that wires compiled query plans into the loader', () => {
    const bootstrap = emitQueryPlanBootstrapModule([
      {
        clockExportName: 'CartBadge$clockUpdatePlans',
        exportName: 'CartBadge$queryUpdatePlans',
        importPath: '../components/cart/cart-badge.client.js',
      },
      {
        exportName: 'CartPanel$queryUpdatePlans',
        importPath: '../components/cart/cart-panel.client.js',
      },
    ]);

    expect(bootstrap.fileName).toBe('generated/app.client.js');
    expect(bootstrap.source).toContain(
      "import { applyDeferredStreamResponseToRuntime, createQueryStore, installKovoLoader } from '@kovojs/browser/generated';",
    );
    expect(bootstrap.source).toContain(
      'import { CartBadge$queryUpdatePlans, CartBadge$clockUpdatePlans } from "../components/cart/cart-badge.client.js";',
    );
    expect(bootstrap.source).toContain(
      'import { CartPanel$queryUpdatePlans } from "../components/cart/cart-panel.client.js";',
    );
    expect(bootstrap.source).toContain('const queryPlans = {');
    expect(bootstrap.source).toContain('...CartBadge$queryUpdatePlans,');
    expect(bootstrap.source).toContain('...CartPanel$queryUpdatePlans,');
    expect(bootstrap.source).toContain('const clockUpdatePlans = [');
    expect(bootstrap.source).toContain('...CartBadge$clockUpdatePlans,');
    expect(bootstrap.source).toContain('installKovoLoader({');
    expect(bootstrap.source).toContain('clockUpdatePlans,');
    expect(bootstrap.source).toContain('queryStore: store');
    expect(bootstrap.source).toContain('enhancedMutations: {');
    expect(bootstrap.source).toContain('queryPlans,');
    expect(bootstrap.source).toContain('export function applyKovoDeferredStreamResponse');
    expect(bootstrap.source).toContain('return applyDeferredStreamResponseToRuntime({');
    expect(bootstrap.source).toContain('queryPlans,');
    expect(bootstrap.source).toContain('store,');
  });
});
