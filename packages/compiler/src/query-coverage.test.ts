import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule, emitQueryPlanBootstrapModule } from './index.js';

describe('compiler query coverage', () => {
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
      "import { applyCompiledQueryUpdatePlan, derive } from '@kovojs/runtime/generated';",
    );
    expect(clientSource).toContain(
      'export const CartBadge$button_disabled_derive = derive(["cart"], (cart) => cart.count === 0);',
    );
    expect(clientSource).toContain(
      'stamps: [{ attr: "disabled", selector: "[data-derive=\\"cart.CartBadge$button_disabled_derive\\"]", select(value) { return CartBadge$button_disabled_derive.run(value); } }]',
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
      'return applyCompiledQueryUpdatePlan(root, "cart", value, { bindings: true, derives: [], stamps: [], templateStamps: [] });',
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
      "import { applyDeferredStreamResponseToRuntime, createQueryStore, installKovoLoader } from '@kovojs/runtime/generated';",
    );
    expect(bootstrap.source).toContain(
      'import { CartBadge$queryUpdatePlans } from "../components/cart/cart-badge.client.js";',
    );
    expect(bootstrap.source).toContain(
      'import { CartPanel$queryUpdatePlans } from "../components/cart/cart-panel.client.js";',
    );
    expect(bootstrap.source).toContain('const queryPlans = {');
    expect(bootstrap.source).toContain('...CartBadge$queryUpdatePlans,');
    expect(bootstrap.source).toContain('...CartPanel$queryUpdatePlans,');
    expect(bootstrap.source).toContain('installKovoLoader({');
    expect(bootstrap.source).toContain('queryStore: store');
    expect(bootstrap.source).toContain('enhancedMutations: {');
    expect(bootstrap.source).toContain('queryPlans,');
    expect(bootstrap.source).toContain('export function applyKovoDeferredStreamResponse');
    expect(bootstrap.source).toContain('return applyDeferredStreamResponseToRuntime({');
    expect(bootstrap.source).toContain('queryPlans,');
    expect(bootstrap.source).toContain('store,');
  });
});
