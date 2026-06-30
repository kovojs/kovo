import type {
  ProjectQueryBehaviorFact,
  ProjectSourceFixture,
  ProjectTouchGraphBehaviorFact,
  ProjectTouchGraphTouchFact,
} from './source-fixtures.ts';

export interface OracleSchemaTableColumnFixture {
  builder: string;
  name: string;
}

export interface OracleSchemaTableFixtureOptions {
  annotation?: string;
  columns: readonly OracleSchemaTableColumnFixture[];
  exportName: string;
  tableName: string;
}

export interface OracleComponentFixture {
  exportName: string;
  fileName: string;
  fragmentTarget: string;
  queryPlanExportName: string;
  queryShapes: {
    cart: {
      count: 'number';
      empty: 'boolean';
      items: readonly [{ name: 'string'; productId: 'string'; qty: 'number' }];
    };
    product: {
      stock: 'number';
    };
  };
  registryFacts: {
    queries: {
      cart: 'typeof cartQuery';
      product: 'typeof productQuery';
    };
    routes: readonly ['/oracle'];
  };
  source: string;
}

export interface OracleRuntimeFixture {
  body: string;
  cartValue: {
    count: number;
    empty: boolean;
    items: Array<{ name: string; productId: string; qty: number }>;
  };
  expectedAppliedFragments: string[];
  expectedTemplateItems: Array<{ html: string; key: string }>;
  fragmentHtml: string;
  productValue: {
    stock: number;
  };
}

export interface OracleGraphFixture {
  componentGraphFacts: Array<{
    fragments: string[];
    name: string;
    queries: string[];
  }>;
  domainByTable: Record<string, string>;
  keyByTable: Record<string, string>;
  queryFacts: ProjectQueryBehaviorFact[];
  touchGraph: Record<string, ProjectTouchGraphBehaviorFact>;
}

export interface OracleBetterAuthFixture {
  credentialTouches: {
    signInEmail: readonly ['session'];
    signOut: readonly ['session'];
    signUpEmail: readonly ['account', 'session', 'user'];
  };
  generatedSchemaSourceSnippets: readonly string[];
}

export interface CrossPackageOracleFixture {
  betterAuth: OracleBetterAuthFixture;
  component: OracleComponentFixture;
  drizzleProject: {
    files: ProjectSourceFixture[];
  };
  graph: OracleGraphFixture;
  runtime: OracleRuntimeFixture;
}

export function oracleSchemaTableFixture(
  options: OracleSchemaTableFixtureOptions,
): ProjectSourceFixture {
  const columns = options.columns
    .map((column) => `    ${column.name}: ${column.builder},`)
    .join('\n');

  return {
    fileName: `${options.exportName}.schema.ts`,
    source: [
      "import { kovo } from '@kovojs/drizzle';",
      "import { integer, pgTable, text } from 'drizzle-orm/pg-core';",
      '',
      `export const ${options.exportName} = pgTable(`,
      `  '${options.tableName}',`,
      '  {',
      columns,
      `  }${options.annotation ? `, ${options.annotation}` : ''},`,
      ');',
      '',
    ].join('\n'),
  };
}

export function crossPackageOracleFixture(): CrossPackageOracleFixture {
  const component: OracleComponentFixture = {
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
      product: {
        stock: 'number',
      },
    },
    registryFacts: {
      queries: {
        cart: 'typeof cartQuery',
        product: 'typeof productQuery',
      },
      routes: ['/oracle'],
    },
    source: [
      "import { component } from '@kovojs/core';",
      '',
      'export const CartOracle = component({',
      '  queries: { cart: cartQuery, product: productQuery },',
      '  render: ({ cart, product }) => (',
      '    <cart-oracle>',
      '      <span>{cart.count}</span>',
      '      <button hidden={cart.empty}>Checkout</button>',
      '      <span data-bind:aria-label="product.stock">Stock</span>',
      '      <ul data-bind-list="cart.items" kovo-key="productId">',
      '        <template kovo-stamp>',
      '          <li><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li>',
      '        </template>',
      '      </ul>',
      '    </cart-oracle>',
      '  ),',
      '});',
      '',
    ].join('\n'),
  };

  const runtime: OracleRuntimeFixture = {
    body: [
      '<kovo-query name="cart">{"count":2,"empty":false,"items":[{"productId":"p1","name":"Coffee","qty":1},{"productId":"p2","name":"Tea","qty":3}]}</kovo-query>',
      '<kovo-query name="product">{"stock":7}</kovo-query>',
      `<kovo-fragment target="${component.fragmentTarget}" mode="append"><aside kovo-c="cart-oracle">updated</aside></kovo-fragment>`,
    ].join(''),
    cartValue: {
      count: 2,
      empty: false,
      items: [
        { name: 'Coffee', productId: 'p1', qty: 1 },
        { name: 'Tea', productId: 'p2', qty: 3 },
      ],
    },
    expectedAppliedFragments: [component.fragmentTarget],
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
    productValue: {
      stock: 7,
    },
  };

  const touchCart: ProjectTouchGraphTouchFact = {
    domain: 'cart',
    keys: null,
    site: 'conformance/oracles/domain.ts:6',
    via: 'cart_items',
  };
  const touchProduct: ProjectTouchGraphTouchFact = {
    domain: 'product',
    keys: 'arg:productId',
    site: 'conformance/oracles/domain.ts:7',
    via: 'products',
  };

  return {
    betterAuth: {
      credentialTouches: {
        signInEmail: ['session'],
        signOut: ['session'],
        signUpEmail: ['account', 'session', 'user'],
      },
      generatedSchemaSourceSnippets: [
        'export const account = pgTable(',
        'export const session = pgTable(',
        'export const user = pgTable(',
        'export const verification = pgTable(',
      ],
    },
    component,
    drizzleProject: {
      files: [
        {
          fileName: 'conformance/oracles/schema.ts',
          source: [
            "import { kovo } from '@kovojs/drizzle';",
            "import { integer, pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            "export const cartItems = pgTable('cart_items', {",
            "  cartId: text('cart_id').notNull(),",
            "  productId: text('product_id').notNull(),",
            "  qty: integer('qty').notNull(),",
            "}, kovo({ domain: 'cart', key: 'cartId' }));",
            '',
            "export const products = pgTable('products', {",
            "  id: text('id').primaryKey(),",
            "  stock: integer('stock').notNull(),",
            "}, kovo({ domain: 'product', key: 'id' }));",
            '',
          ].join('\n'),
        },
        {
          fileName: 'conformance/oracles/queries.ts',
          source: [
            "import type { PgAsyncDatabase } from 'drizzle-orm/pg-core';",
            "import { eq } from 'drizzle-orm';",
            "import { cartItems, products } from './schema';",
            '',
            "export const cartOracleQuery = query('cart/oracle', {",
            '  args: s.object({ cartId: s.string() }),',
            '  load(input, db: PgAsyncDatabase<any, any>) {',
            '    return db',
            '      .select({',
            '        productId: cartItems.productId,',
            '        qty: cartItems.qty,',
            '        stock: products.stock,',
            '      })',
            '      .from(cartItems)',
            '      .innerJoin(products, eq(products.id, cartItems.productId))',
            '      .where(eq(cartItems.cartId, input.cartId));',
            '  },',
            '});',
            '',
          ].join('\n'),
        },
        {
          fileName: 'conformance/oracles/domain.ts',
          source: [
            "import type { PgAsyncDatabase } from 'drizzle-orm/pg-core';",
            "import { eq, sql } from 'drizzle-orm';",
            "import { cartItems, products } from './schema';",
            '',
            'export async function addToCart(db: PgAsyncDatabase<any, any>, productId: string, cartId: string) {',
            '  await db.insert(cartItems).values({ cartId, productId, qty: 1 });',
            '  await db',
            '    .update(products)',
            '    .set({ stock: sql`${products.stock} - 1` })',
            '    .where(eq(products.id, productId));',
            '}',
            '',
          ].join('\n'),
        },
      ],
    },
    graph: {
      componentGraphFacts: [
        {
          fragments: [component.fragmentTarget],
          name: component.fragmentTarget,
          queries: ['cart', 'product'],
        },
      ],
      domainByTable: {
        cart_items: 'cart',
        products: 'product',
      },
      keyByTable: {
        products: 'id',
      },
      queryFacts: [
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
      ],
      touchGraph: {
        addToCart: {
          reads: [],
          touches: [touchCart, touchProduct],
          unresolved: [],
        },
      },
    },
    runtime,
  };
}
