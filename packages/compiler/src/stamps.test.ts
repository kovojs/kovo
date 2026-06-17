import { describe, expect, it } from 'vitest';

import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from './index.js';
import { serverRenderLowering } from './emit/server.js';
import { parseComponentModule } from './scan/parse.js';

describe('compiler stamps', () => {
  it('exposes server host stamps as parsed source patches', () => {
    const source = `
export const Recommendations = component({
  queries: { cart: cartQuery },
  state: () => ({ open: true }),
  render: ({ cart }) => (
    <section class="card" kovo-deps='product:p1'>
      {renderOnce(cart.count)}
    </section>
  ),
});
`;
    const model = parseComponentModule('recommendations.tsx', source);
    const lowering = serverRenderLowering([], model, 'recommendations');
    const kovoDepsStart = source.indexOf("kovo-deps='product:p1'");
    const insertPosition = source.indexOf('>', kovoDepsStart);

    expect(lowering.replacements).toEqual([
      {
        end: kovoDepsStart + "kovo-deps='product:p1'".length,
        replacement: 'kovo-deps="product:p1 cart"',
        start: kovoDepsStart,
      },
      {
        end: insertPosition,
        replacement: ' kovo-c="recommendations" kovo-state="{&quot;open&quot;:true}"',
        start: insertPosition,
      },
    ]);
    expect(lowering.outputContexts).toMatchInlineSnapshot(`
      [
        {
          "context": "attribute",
          "expression": "recommendations",
          "sink": "kovo-c",
          "source": "server-render",
          "writer": "host identity stamp",
        },
        {
          "context": "attribute",
          "expression": "kovo-deps="product:p1 cart"",
          "sink": "kovo-deps",
          "source": "server-render",
          "writer": "host dependency stamp",
        },
        {
          "context": "attribute",
          "expression": "{"open":true}",
          "sink": "kovo-state",
          "source": "server-render",
          "writer": "host state stamp",
        },
      ]
    `);
  });

  it('stamps rendered component markup with declared query dependencies', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery, productPage: productPageQuery },
  render: ({ cart, productPage }) => (
    <cart-badge>
      <span data-bind="cart.count">{cart.count}</span>
      <span>{productPage.title}</span>
    </cart-badge>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain('<cart-badge kovo-deps="cart productPage">');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('stamps kovo-c component identity on native render hosts', () => {
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component({
  queries: { orderHistory: orderHistoryQuery },
  render: ({ orderHistory }) => (
    <ol>
      <li kovo-key="order-1">Order</li>
    </ol>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<ol kovo-c="order-history" kovo-deps="orderHistory">',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('stamps native host identity from the parsed render host, not tag text', () => {
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component({
  render: () => {
    const sample = '<order-history></order-history>';
    return <ol><li kovo-key="order-1">Order</li></ol>;
  },
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).toContain('<ol kovo-c="order-history">');
    expect(serverSource).toContain("'<order-history></order-history>'");
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('keeps hand-written kovo-c stamps on native hosts unchanged in ejected IR', () => {
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component({
  render: () => (
    <ol kovo-c="order-history">
      <li kovo-key="order-1">Order</li>
    </ol>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).toContain('<ol kovo-c="order-history">');
    expect(serverSource.match(/kovo-c=/g)).toHaveLength(1);
  });

  it('does not stamp query or state declarations from strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  render: () => {
    const sample = 'queries: { cart: cartQuery }, state: () => ({ open: true })';
    // queries: { product: productQuery }, state: () => ({ count: 1 })
    return <cart-badge>Static</cart-badge>;
  },
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).not.toContain('kovo-deps=');
    expect(serverSource).not.toContain('kovo-state=');
    expect(result.diagnostics).toEqual([]);
  });

  it('stamps the returned host instead of tag text inside render bodies', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  state: () => ({ open: true }),
  render: ({ cart }) => {
    const sample = '<not-the-host></not-the-host>';
    // <also-not-the-host></also-not-the-host>
    return <cart-badge>{renderOnce(cart.count)}</cart-badge>;
  },
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).toContain(
      '<cart-badge kovo-deps="cart" kovo-state="{&quot;open&quot;:true}">',
    );
    expect(serverSource).toContain("'<not-the-host></not-the-host>'");
    expect(serverSource).not.toContain('<not-the-host kovo-deps=');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('merges declared query dependencies into existing kovo-deps stamps', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      registryFacts: {
        queries: {
          product: 'typeof productQuery',
        },
      },
      source: `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="recommendations" kovo-deps="product:p1 cart">
      {renderOnce(cart.count)}
    </section>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<section kovo-c="recommendations" kovo-deps="product:p1 cart">',
    );
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('updates existing kovo-deps from parsed attribute spans', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section class="card" kovo-deps='product:p1'>
      {renderOnce(cart.count)}
    </section>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<section class="card" kovo-deps="product:p1 cart" kovo-c="recommendations">',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('validates residual kovo-c and kovo-deps stamps against known component and query facts', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      registryFacts: {
        queries: {
          product: 'typeof productQuery',
        },
      },
      source: `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="recommendations" kovo-deps="product:p1 cart">
      <span data-bind="cart.count">{cart.count}</span>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV223',
        fileName: 'recommendations.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 13, line: 6 },
      },
    ]);
  });

  it('reports KV226 for residual stamps naming unknown components or query instances', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="unknown-component" kovo-deps="cart missingQuery:p1">
      <span data-bind="cart.count">{cart.count}</span>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV223',
        fileName: 'recommendations.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 13, line: 6 },
      },
      {
        code: 'KV226',
        fileName: 'recommendations.tsx',
        message:
          'kovo-deps or kovo-c names an unknown query instance or component. kovo-c="unknown-component"',
        severity: 'error',
        start: { column: 14, line: 5 },
        length: 26,
      },
      {
        code: 'KV226',
        fileName: 'recommendations.tsx',
        message:
          'kovo-deps or kovo-c names an unknown query instance or component. kovo-deps="missingQuery:p1"',
        severity: 'error',
        start: { column: 41, line: 5 },
        length: 32,
      },
    ]);
  });

  it('ignores residual stamp text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => {
    const sample = '<section kovo-c="unknown-component" kovo-deps="missingQuery:p1"></section>';
    // <section kovo-c="other-unknown" kovo-deps="otherMissing:p1"></section>
    return (
      <section kovo-c="recommendations" kovo-deps="cart">
        <span>{renderOnce(cart.count)}</span>
      </section>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports KV222 and KV223 for hand-written stamps around typed expressions in sugar', () => {
    const redundant = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
    });
    const drift = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.total}</span>,
});
`,
    });

    expect(redundant.diagnostics).toMatchObject([
      {
        code: 'KV223',
        fileName: 'cart-badge.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 31, line: 4 },
      },
    ]);
    expect(drift.diagnostics).toMatchObject([
      {
        code: 'KV222',
        fileName: 'cart-badge.tsx',
        length: 22,
        message:
          'Hand-written binding stamp disagrees with the typed expression it wraps. data-bind="cart.count" wraps {cart.total}',
        severity: 'error',
        start: { column: 31, line: 4 },
      },
      {
        code: 'KV311',
        fileName: 'cart-badge.tsx',
        help: expect.stringContaining('SPEC §4.9'),
        length: 10,
        message:
          'Query/state-dependent DOM position has no update status. CartBadge cart.total expression',
        severity: 'warn',
        start: { column: 55, line: 4 },
      },
    ]);
  });

  it('ignores binding stamp text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => {
    const sample = '<span data-bind="cart.count">{cart.count}</span>';
    // <span data-bind="cart.total">{cart.count}</span>
    return <span>{renderOnce(cart.count)}</span>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('does not let self-closing same-name children hide list stamp diagnostics', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          items: [{ productId: 'string' }],
        },
      },
      source: `
export const CartBadge = component({
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="sku">
      <ul />
      <template kovo-stamp>
        <li><span data-bind=".missing">Item</span></li>
      </template>
    </ul>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV302',
          fileName: 'cart-badge.tsx',
          message: 'data-bind path is not present in the declared query shape. cart.items',
          severity: 'error',
          start: { column: 9, line: 4 },
          length: 27,
        }),
      ]),
    );
  });
});
