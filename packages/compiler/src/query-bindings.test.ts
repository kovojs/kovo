import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';
import { queryShapeFactDiagnostics, queryShapesFromFacts } from './internal.js';

describe('compiler query binding diagnostics', () => {
  it('accepts data-bind paths present in declared query shapes', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          count: 'number',
          empty: 'boolean',
          items: [{ productId: 'string', qty: 'number' }],
        },
      },
      source: `
export const CartBadge = component({
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">2</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <span data-bind="cart.items.productId">p1</span>
    </cart-badge>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('validates data-bind paths against generated query shape facts', () => {
    const queryShapeFacts = [
      {
        query: 'cart',
        shape: {
          count: 'number',
          empty: 'boolean',
          items: [{ productId: 'string', qty: 'number' }],
        },
        source: 'generated/queries/cart.shape.ts',
      },
    ] as const;
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapeFacts,
      source: `
export const CartBadge = component({
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">2</span>
      <button data-bind:aria-label="cart.empty">Checkout</button>
      <span data-bind="cart.items.productId">p1</span>
    </cart-badge>
  ),
});
`,
    });

    expect(queryShapesFromFacts(queryShapeFacts)).toEqual({
      cart: {
        count: 'number',
        empty: 'boolean',
        items: [{ productId: 'string', qty: 'number' }],
      },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('reports KV240 when duplicate query-shape facts have different shapes', () => {
    const queryShapeFacts = [
      {
        query: 'cart',
        shape: {
          count: 'number',
        },
        source: 'generated/queries/cart.shape.ts',
      },
      {
        query: 'cart',
        shape: {
          total: 'number',
        },
        source: 'generated/queries/cart-refresh.shape.ts',
      },
    ] as const;
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapeFacts,
      source: `
export const CartBadge = component({
  render: () => <span data-bind="cart.count">2</span>,
});
`,
    });

    expect(queryShapesFromFacts(queryShapeFacts)).toEqual({
      cart: {
        count: 'number',
      },
    });
    expect(result.diagnostics).toMatchInlineSnapshot(`
      [
        {
          "code": "KV240",
          "fileName": "cart-badge.tsx",
          "help": "Would lower to: one query-shape fact per query name for server render, client updates, and binding validation.
      Blocked reason: duplicate query-shape facts would make graph indexing silently choose one shape for all generated bindings.
      Fixes: emit exactly one query-shape fact per query name, or rename one query so generated binding metadata has a single source of truth.
      SPEC §4.8 query binding validation depends on one stable shape per query; duplicate facts would otherwise silently last-write-wins during graph indexing.",
          "message": "Duplicate query-shape fact for one query name. query="cart" sources=generated/queries/cart-refresh.shape.ts, generated/queries/cart.shape.ts",
          "severity": "error",
        },
      ]
    `);
  });

  it('reports KV240 when duplicate query-shape facts have the same shape', () => {
    const queryShapeFacts = [
      {
        query: 'cart',
        shape: {
          count: 'number',
        },
        source: 'generated/queries/cart.shape.ts',
      },
      {
        query: 'cart',
        shape: {
          count: 'number',
        },
        source: 'generated/queries/cart-copy.shape.ts',
      },
    ] as const;

    expect(queryShapeFactDiagnostics('cart-badge.tsx', queryShapeFacts)).toMatchInlineSnapshot(`
      [
        {
          "code": "KV240",
          "fileName": "cart-badge.tsx",
          "help": "Would lower to: one query-shape fact per query name for server render, client updates, and binding validation.
      Blocked reason: duplicate query-shape facts would make graph indexing silently choose one shape for all generated bindings.
      Fixes: emit exactly one query-shape fact per query name, or rename one query so generated binding metadata has a single source of truth.
      SPEC §4.8 query binding validation depends on one stable shape per query; duplicate facts would otherwise silently last-write-wins during graph indexing.",
          "message": "Duplicate query-shape fact for one query name. query="cart" sources=generated/queries/cart-copy.shape.ts, generated/queries/cart.shape.ts",
          "severity": "error",
        },
      ]
    `);
  });

  it('accepts distinct query-shape fact names', () => {
    const queryShapeFacts = [
      {
        query: 'cart',
        shape: {
          count: 'number',
        },
        source: 'generated/queries/cart.shape.ts',
      },
      {
        query: 'productGrid',
        shape: {
          items: [{ id: 'string' }],
        },
        source: 'generated/queries/product-grid.shape.ts',
      },
    ] as const;

    expect(queryShapeFactDiagnostics('cart-badge.tsx', queryShapeFacts)).toEqual([]);
    expect(queryShapesFromFacts(queryShapeFacts)).toEqual({
      cart: {
        count: 'number',
      },
      productGrid: {
        items: [{ id: 'string' }],
      },
    });
  });

  it('accepts optional binding path segments through nullable query shape metadata', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      queryShapeFacts: [
        {
          query: 'product',
          shape: {
            details: {
              kind: 'nullable',
              shape: {
                name: 'string',
              },
            },
            inventory: {
              kind: 'optional',
              shape: {
                stock: 'number',
              },
            },
          },
          source: 'generated/queries/product.shape.ts',
        },
      ],
      source: `
export const ProductCard = component({
  render: () => (
    <article>
      <span data-bind="product.details?.name">Coffee</span>
      <span data-bind="product.inventory?.stock">12</span>
    </article>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports KV227 when binding paths traverse nullable query shape metadata without optional segments', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      queryShapeFacts: [
        {
          query: 'product',
          shape: {
            details: {
              kind: 'nullable',
              shape: {
                name: 'string',
              },
            },
          },
          source: 'generated/queries/product.shape.ts',
        },
      ],
      source: `
export const ProductCard = component({
  render: () => <span data-bind="product.details.name">Coffee</span>,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV227',
        fileName: 'product-card.tsx',
        help: expect.stringContaining(
          'Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.',
        ),
        length: 32,
        message:
          'Binding path traverses a nullable segment without ?. product.details.name (segment: details)',
        severity: 'error',
        start: { column: 23, line: 3 },
      },
    ]);
  });

  it('lowers optional query traversal sugar to optional data-bind path segments', () => {
    const result = compileComponentModule({
      fileName: 'deal-card.tsx',
      queryShapes: {
        deal: {
          contact: {
            kind: 'nullable',
            shape: {
              name: 'string',
            },
          },
        },
      },
      source: `
export const DealCard = component({
  queries: { deal: {} },
  render: () => (
    <deal-card>
      <span>{deal.contact?.name}</span>
    </deal-card>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<span data-bind="deal.contact?.name">{escapeText(deal.contact?.name)}</span>',
    );
    expect(result.queryUpdatePlans).toMatchInlineSnapshot(`
      [
        {
          "componentName": "DealCard",
          "outputContexts": [
            {
              "context": "text",
              "expression": "deal.contact?.name",
              "sink": "textContent",
              "source": "client-query",
              "writer": "query text binding",
            },
          ],
          "paths": [
            "deal.contact?.name",
          ],
          "query": "deal",
        },
      ]
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports KV302 for absent paths under nullable query shape metadata', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      queryShapeFacts: [
        {
          query: 'product',
          shape: {
            details: {
              kind: 'nullable',
              shape: {
                name: 'string',
              },
            },
          },
          source: 'generated/queries/product.shape.ts',
        },
      ],
      source: `
export const ProductCard = component({
  render: () => <span data-bind="product.details.price">0</span>,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV302',
        fileName: 'product-card.tsx',
        length: 33,
        message: 'data-bind path is not present in the declared query shape. product.details.price',
        severity: 'error',
        start: { column: 23, line: 3 },
      },
    ]);
  });

  it('reports KV302 when data-bind paths are absent from declared query shapes', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          count: 'number',
        },
      },
      source: `
export const CartBadge = component({
  render: () => <span data-bind="cart.total">2</span>,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV302',
        fileName: 'cart-badge.tsx',
        length: 22,
        message: 'data-bind path is not present in the declared query shape. cart.total',
        severity: 'error',
        start: { column: 23, line: 3 },
      },
    ]);
  });

  it('reports KV302 when generated query shape facts no longer contain a binding path', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapeFacts: [
        {
          query: 'cart',
          shape: {
            itemCount: 'number',
          },
          source: 'generated/queries/cart.shape.ts',
        },
      ],
      source: `
export const CartBadge = component({
  render: () => <span data-bind="cart.count">2</span>,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV302',
        fileName: 'cart-badge.tsx',
        length: 22,
        message: 'data-bind path is not present in the declared query shape. cart.count',
        severity: 'error',
        start: { column: 23, line: 3 },
      },
    ]);
  });

  it('ignores data-bind text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          count: 'number',
        },
      },
      source: `
export const CartBadge = component({
  render: () => {
    const sample = '<span data-bind="cart.missing">0</span>';
    // <span data-bind="cart.otherMissing">0</span>
    return <span data-bind="cart.count">2</span>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('validates ejected list stamps against array element query shapes', () => {
    const valid = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          items: [{ name: 'string', productId: 'string', qty: 'number' }],
        },
      },
      source: `
export const CartBadge = component({
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="productId">
      <template kovo-stamp>
        <li><span data-bind=".qty">0</span> × <span data-bind=".name">Item</span></li>
      </template>
    </ul>
  ),
});
`,
    });
    const invalid = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          items: [{ name: 'string', productId: 'string' }],
        },
      },
      source: `
export const CartBadge = component({
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="sku">
      <template kovo-stamp>
        <li><span data-bind=".missing">0</span></li>
      </template>
    </ul>
  ),
});
`,
    });

    expect(valid.diagnostics).toEqual([]);
    expect(invalid.diagnostics).toMatchObject([
      {
        code: 'KV302',
        fileName: 'cart-badge.tsx',
        message: 'data-bind path is not present in the declared query shape. cart.items',
        severity: 'error',
        start: { column: 9, line: 4 },
        length: 27,
      },
    ]);
  });

  it('ignores data-bind-list text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          items: [{ name: 'string', productId: 'string' }],
        },
      },
      source: `
export const CartBadge = component({
  render: () => {
    const sample = '<ul data-bind-list="cart.missing" kovo-key="id"><template kovo-stamp><li><span data-bind=".name">Item</span></li></template></ul>';
    // <ul data-bind-list="cart.otherMissing" kovo-key="id"><template kovo-stamp><li><span data-bind=".name">Item</span></li></template></ul>
    return (
      <ul data-bind-list="cart.items" kovo-key="productId">
        <template kovo-stamp>
          <li><span data-bind=".name">Item</span></li>
        </template>
      </ul>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });
});
