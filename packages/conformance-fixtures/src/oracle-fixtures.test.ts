import { describe, expect, it } from 'vitest';

import { crossPackageOracleFixture, oracleSchemaTableFixture } from './oracle-fixtures.js';

describe('oracle fixtures', () => {
  it('builds schema table source fixtures with Kovo annotations', () => {
    expect(
      oracleSchemaTableFixture({
        annotation: "kovo({ domain: 'product', key: 'id' })",
        columns: [
          { builder: "text('id').primaryKey()", name: 'id' },
          { builder: "integer('stock').notNull()", name: 'stock' },
        ],
        exportName: 'products',
        tableName: 'products',
      }),
    ).toEqual({
      fileName: 'products.schema.ts',
      source: [
        "import { kovo } from '@kovojs/drizzle';",
        "import { integer, pgTable, text } from 'drizzle-orm/pg-core';",
        '',
        'export const products = pgTable(',
        "  'products',",
        '  {',
        "    id: text('id').primaryKey(),",
        "    stock: integer('stock').notNull(),",
        "  }, kovo({ domain: 'product', key: 'id' }),",
        ');',
        '',
      ].join('\n'),
    });
  });

  it('projects one cross-package oracle fixture across compiler, browser, data, and auth seams', () => {
    const fixture = crossPackageOracleFixture();

    expect(fixture.component).toMatchObject({
      exportName: 'CartOracle',
      fileName: 'conformance/oracles/cart-oracle.tsx',
      fragmentTarget: 'conformance/oracles/cart-oracle/cart-oracle',
      queryPlanExportName: 'CartOracle$queryUpdatePlans',
      queryShapes: {
        cart: {
          count: 'number',
          empty: 'boolean',
          items: [{ name: 'string', productId: 'string', qty: 'number' }],
        },
        product: { stock: 'number' },
      },
      registryFacts: {
        queries: {
          cart: 'typeof cartQuery',
          product: 'typeof productQuery',
        },
        routes: ['/oracle'],
      },
    });
    expect(fixture.component.source).toContain(
      'queries: { cart: cartQuery, product: productQuery }',
    );
    expect(fixture.component.source).toContain('data-bind-list="cart.items"');

    expect(fixture.runtime).toEqual({
      body: expect.stringContaining('<kovo-query name="cart">'),
      cartValue: {
        count: 2,
        empty: false,
        items: [
          { name: 'Coffee', productId: 'p1', qty: 1 },
          { name: 'Tea', productId: 'p2', qty: 3 },
        ],
      },
      expectedAppliedFragments: ['conformance/oracles/cart-oracle/cart-oracle'],
      expectedTemplateItems: [
        {
          html: '<li><span data-bind=".qty">1</span> x <span data-bind=".name">Coffee</span></li>',
          key: 'p1',
        },
        {
          html: '<li><span data-bind=".qty">3</span> x <span data-bind=".name">Tea</span></li>',
          key: 'p2',
        },
      ],
      fragmentHtml: '<aside kovo-c="cart-oracle">updated</aside>',
      productValue: { stock: 7 },
    });

    expect(fixture.graph.componentGraphFacts).toEqual([
      {
        fragments: ['conformance/oracles/cart-oracle/cart-oracle'],
        name: 'conformance/oracles/cart-oracle/cart-oracle',
        queries: ['cart', 'cartQuery', 'product', 'productQuery'],
      },
    ]);
    expect(fixture.graph.queryFacts).toEqual([
      {
        query: 'cart/oracle',
        reads: ['cart', 'product'],
        shape: {
          productId: 'string',
          qty: 'number',
          stock: 'number',
        },
        site: 'conformance/oracles/queries.ts:5',
      },
    ]);
    expect(fixture.graph.touchGraph).toEqual({
      addToCart: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'conformance/oracles/domain.ts:6',
            via: 'cart_items',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            site: 'conformance/oracles/domain.ts:7',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    });

    expect(fixture.drizzleProject.files).toHaveLength(3);
    expect(fixture.drizzleProject.files[1]?.source).toContain(
      "export const cartOracleQuery = query('cart/oracle'",
    );
    expect(fixture.drizzleProject.files[2]?.source).toContain('await db.insert(cartItems)');

    expect(fixture.betterAuth.credentialTouches).toEqual({
      signInEmail: ['session'],
      signOut: ['session'],
      signUpEmail: ['account', 'session', 'user'],
    });
    expect(fixture.betterAuth.generatedSchemaSourceSnippets).toEqual([
      'export const account = pgTable(',
      'export const session = pgTable(',
      'export const user = pgTable(',
      'export const verification = pgTable(',
    ]);
  });
});
