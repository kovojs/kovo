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
        replacement:
          ' kovo-c="recommendations" kovo-fragment-target="recommendations" kovo-state="{&quot;open&quot;:true}"',
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
          "expression": "product:p1 cart",
          "sink": "kovo-deps",
          "source": "server-render",
          "writer": "host dependency stamp",
        },
        {
          "context": "attribute",
          "expression": "recommendations",
          "sink": "kovo-fragment-target",
          "source": "server-render",
          "writer": "host fragment target stamp",
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
    expect(lowering.stampWrites).toMatchInlineSnapshot(`
      [
        {
          "attr": "kovo-c",
          "mode": "insert",
          "value": "recommendations",
          "writer": "host identity stamp",
        },
        {
          "attr": "kovo-deps",
          "mode": "replace",
          "value": "product:p1 cart",
          "writer": "host dependency stamp",
        },
        {
          "attr": "kovo-fragment-target",
          "mode": "insert",
          "value": "recommendations",
          "writer": "host fragment target stamp",
        },
        {
          "attr": "kovo-state",
          "mode": "insert",
          "value": "{"open":true}",
          "writer": "host state stamp",
        },
      ]
    `);
    expect(lowering.diagnostics).toEqual([]);
  });

  it('reports author conflicts with terminal server and handler stamp writers', () => {
    const result = compileComponentModule({
      fileName: 'stamp-conflict.tsx',
      registryFacts: { components: ['other-widget'] },
      source: `
export const StampConflict = component({
  queries: { item: itemQuery },
  state: () => ({ open: true }),
  render: ({ item }) => (
    <section kovo-c="other-widget" kovo-state="{&quot;open&quot;:false}">
      <button data-p-id="author" onClick={() => save(item.id)}>Save</button>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV231')).toMatchInlineSnapshot(`
      [
        {
          "code": "KV231",
          "fileName": "stamp-conflict.tsx",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "length": 18,
          "message": "Unmergeable attribute conflict in primitive composition. data-p-id (writers: author JSX, event handler param lowering)",
          "severity": "error",
          "start": {
            "column": 15,
            "line": 7,
          },
        },
        {
          "code": "KV231",
          "fileName": "stamp-conflict.tsx",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "length": 21,
          "message": "Unmergeable attribute conflict in primitive composition. kovo-c (writers: author JSX, host identity stamp)",
          "severity": "error",
          "start": {
            "column": 14,
            "line": 6,
          },
        },
        {
          "code": "KV231",
          "fileName": "stamp-conflict.tsx",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "length": 37,
          "message": "Unmergeable attribute conflict in primitive composition. kovo-state (writers: author JSX, host state stamp)",
          "severity": "error",
          "start": {
            "column": 36,
            "line": 6,
          },
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

    expect(result.files[0]?.source).toContain(
      '<cart-badge kovo-deps="cart productPage" kovo-fragment-target="cart-badge">',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lints hand-written fragment target hooks on inferred query roots', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <cart-badge kovo-fragment-target="cart-badge">
      {cart.count}
    </cart-badge>
  ),
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV223',
        help: expect.stringContaining('kovo-fragment-target hook'),
        message:
          'Redundant hand-written fragment target stamp in sugar; the compiler derives it. kovo-fragment-target',
        severity: 'lint',
      }),
    );
    expect(result.files[0]?.source.match(/kovo-fragment-target=/g)).toHaveLength(1);
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
      '<ol kovo-c="order-history" kovo-deps="orderHistory" kovo-fragment-target="order-history">',
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
      '<cart-badge kovo-deps="cart" kovo-fragment-target="cart-badge" kovo-state="{&quot;open&quot;:true}">',
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
      '<section kovo-c="recommendations" kovo-deps="product:p1 cart" kovo-fragment-target="recommendations">',
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
      '<section class="card" kovo-deps="product:p1 cart" kovo-c="recommendations" kovo-fragment-target="recommendations">',
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
        code: 'KV231',
        fileName: 'recommendations.tsx',
        length: 26,
        message:
          'Unmergeable attribute conflict in primitive composition. kovo-c (writers: author JSX, host identity stamp)',
        severity: 'error',
        start: { column: 14, line: 5 },
      },
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
