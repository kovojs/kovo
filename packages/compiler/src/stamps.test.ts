import { describe, expect, it } from 'vitest';

import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from './index.js';
import { serverRenderLowering } from './emit/server.js';
import { parseComponentModule } from './scan/parse.js';

describe('compiler stamps', () => {
  it('exposes server host stamps as parsed source patches', () => {
    const source = `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  state: () => ({ open: true }),
  render: ({ cart }) => (
    <section class="card" fw-deps='product:p1'>
      {renderOnce(cart.count)}
    </section>
  ),
});
`;
    const model = parseComponentModule('recommendations.tsx', source);
    const lowering = serverRenderLowering([], model);
    const fwDepsStart = source.indexOf("fw-deps='product:p1'");
    const insertPosition = source.indexOf('>', fwDepsStart);

    expect(lowering).toEqual([
      {
        end: fwDepsStart + "fw-deps='product:p1'".length,
        replacement: 'fw-deps="product:p1 cart"',
        start: fwDepsStart,
      },
      {
        end: insertPosition,
        replacement: ' fw-c="recommendations" fw-state="{&quot;open&quot;:true}"',
        start: insertPosition,
      },
    ]);
  });

  it('stamps rendered component markup with declared query dependencies', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
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

    expect(result.files[0]?.source).toContain('<cart-badge fw-deps="cart productPage">');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('stamps fw-c component identity on native render hosts', () => {
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component('order-history', {
  queries: { orderHistory: orderHistoryQuery },
  render: ({ orderHistory }) => (
    <ol>
      <li fw-key="order-1">Order</li>
    </ol>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain('<ol fw-c="order-history" fw-deps="orderHistory">');
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('stamps native host identity from the parsed render host, not tag text', () => {
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component('order-history', {
  render: () => {
    const sample = '<order-history></order-history>';
    return <ol><li fw-key="order-1">Order</li></ol>;
  },
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).toContain('<ol fw-c="order-history">');
    expect(serverSource).toContain("'<order-history></order-history>'");
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('keeps hand-written fw-c stamps on native hosts unchanged in ejected IR', () => {
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component('order-history', {
  render: () => (
    <ol fw-c="order-history">
      <li fw-key="order-1">Order</li>
    </ol>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).toContain('<ol fw-c="order-history">');
    expect(serverSource.match(/fw-c=/g)).toHaveLength(1);
  });

  it('does not stamp query or state declarations from strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  render: () => {
    const sample = 'queries: { cart: cartQuery }, state: () => ({ open: true })';
    // queries: { product: productQuery }, state: () => ({ count: 1 })
    return <cart-badge>Static</cart-badge>;
  },
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).not.toContain('fw-deps=');
    expect(serverSource).not.toContain('fw-state=');
    expect(result.diagnostics).toEqual([]);
  });

  it('stamps the returned host instead of tag text inside render bodies', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
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
      '<cart-badge fw-deps="cart" fw-state="{&quot;open&quot;:true}">',
    );
    expect(serverSource).toContain("'<not-the-host></not-the-host>'");
    expect(serverSource).not.toContain('<not-the-host fw-deps=');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('merges declared query dependencies into existing fw-deps stamps', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      registryFacts: {
        queries: {
          product: 'typeof productQuery',
        },
      },
      source: `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section fw-c="recommendations" fw-deps="product:p1 cart">
      {renderOnce(cart.count)}
    </section>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<section fw-c="recommendations" fw-deps="product:p1 cart">',
    );
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('updates existing fw-deps from parsed attribute spans', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section class="card" fw-deps='product:p1'>
      {renderOnce(cart.count)}
    </section>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<section class="card" fw-deps="product:p1 cart" fw-c="recommendations">',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('validates residual fw-c and fw-deps stamps against known component and query facts', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      registryFacts: {
        queries: {
          product: 'typeof productQuery',
        },
      },
      source: `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section fw-c="recommendations" fw-deps="product:p1 cart">
      <span data-bind="cart.count">{cart.count}</span>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW223',
        fileName: 'recommendations.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 13, line: 6 },
      },
    ]);
  });

  it('reports FW226 for residual stamps naming unknown components or query instances', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section fw-c="unknown-component" fw-deps="cart missingQuery:p1">
      <span data-bind="cart.count">{cart.count}</span>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW223',
        fileName: 'recommendations.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 13, line: 6 },
      },
      {
        code: 'FW226',
        fileName: 'recommendations.tsx',
        message:
          'fw-deps or fw-c names an unknown query instance or component. fw-c="unknown-component"',
        severity: 'error',
        start: { column: 14, line: 5 },
        length: 24,
      },
      {
        code: 'FW226',
        fileName: 'recommendations.tsx',
        message:
          'fw-deps or fw-c names an unknown query instance or component. fw-deps="missingQuery:p1"',
        severity: 'error',
        start: { column: 39, line: 5 },
        length: 30,
      },
    ]);
  });

  it('ignores residual stamp text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => {
    const sample = '<section fw-c="unknown-component" fw-deps="missingQuery:p1"></section>';
    // <section fw-c="other-unknown" fw-deps="otherMissing:p1"></section>
    return (
      <section fw-c="recommendations" fw-deps="cart">
        <span>{renderOnce(cart.count)}</span>
      </section>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW222 and FW223 for hand-written stamps around typed expressions in sugar', () => {
    const redundant = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
    });
    const drift = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.total}</span>,
});
`,
    });

    expect(redundant.diagnostics).toEqual([
      {
        code: 'FW223',
        fileName: 'cart-badge.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 31, line: 4 },
      },
    ]);
    expect(drift.diagnostics).toEqual([
      {
        code: 'FW222',
        fileName: 'cart-badge.tsx',
        length: 22,
        message:
          'Hand-written binding stamp disagrees with the typed expression it wraps. data-bind="cart.count" wraps {cart.total}',
        severity: 'error',
        start: { column: 31, line: 4 },
      },
      {
        code: 'FW311',
        fileName: 'cart-badge.tsx',
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
export const CartBadge = component('cart-badge', {
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
export const CartBadge = component('cart-badge', {
  render: () => (
    <ul data-bind-list="cart.items" fw-key="sku">
      <ul />
      <template fw-stamp>
        <li><span data-bind=".missing">Item</span></li>
      </template>
    </ul>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        {
          code: 'FW302',
          fileName: 'cart-badge.tsx',
          message: 'data-bind path is not present in the declared query shape. cart.items',
          severity: 'error',
          start: { column: 9, line: 4 },
          length: 27,
        },
      ]),
    );
  });
});
