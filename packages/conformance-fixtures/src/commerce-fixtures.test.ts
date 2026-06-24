import { describe, expect, it } from 'vitest';
import { domain, mutation, query, s, publicAccess } from '@kovojs/server';
import type { QueryLoadContext } from '@kovojs/server';

import {
  commerceDeclaredQueriesHarnessFact,
  commerceFixtureFile,
  commerceHarnessQueryFact,
  commerceMutationQueryAcceptanceFact,
  commerceUpdateIntentFact,
} from './commerce-fixtures.ts';

interface FixtureDb {
  writes: Array<{ row: Record<string, unknown>; table: string }>;
  write(table: string, row: Record<string, unknown>): void;
}

function createDb(): FixtureDb {
  return {
    writes: [],
    write(table, row) {
      this.writes.push({ row, table });
    },
  };
}

const graph = {
  components: [
    { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
    { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
  ],
};

const cart = domain('cart');
const product = domain('product');
const cartQuery = query('cart', {
  access: publicAccess('test fixture'),
  load: () => ({ count: 1 }),
  reads: [cart],
});
const productGridQuery = query('productGrid', {
  access: publicAccess('test fixture'),
  load: (input: unknown, context?: QueryLoadContext<unknown>) => {
    const pageInput = input as { after?: string; limit?: number };
    const db = (context?.request as { db?: FixtureDb } | undefined)?.db;

    return {
      items:
        pageInput.after === 'fixture-a'
          ? [
              { id: 'fixture-b', stock: 4 },
              { id: 'fixture-c', stock: 5 },
            ].slice(0, pageInput.limit ?? 2)
          : (db?.writes.map((write) => ({ id: write.row.productId, stock: 1 })) ?? []),
      nextCursor: null,
    };
  },
  reads: [product],
});

const addToCart = mutation('cart/add', {
  access: publicAccess('test fixture'),
  csrf: false,
  handler(input: { productId: string; quantity: number }, request: { db: FixtureDb }) {
    request.db.write('cart_items', { productId: input.productId, qty: input.quantity });
    request.db.write('products', { id: input.productId });
    return { count: input.quantity };
  },
  input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
  registry: {
    queries: [cartQuery, productGridQuery],
    touches: [cart, product],
  },
});

const kovoExplain = (
  _graph: typeof graph,
  options:
    | { kind: 'mutation'; optimistic?: boolean; target: string }
    | { kind: 'page'; target: string }
    | { kind: 'query'; target: string },
) => {
  if (options.kind === 'page') {
    return {
      exitCode: 0,
      output: ['kovo-explain/v1', 'PAGE /cart', 'queries: cart,productGrid'].join('\n'),
    };
  }
  if (options.kind === 'query' && options.target === 'cart') {
    return {
      exitCode: 0,
      output: ['kovo-explain/v1', 'QUERY cart', 'consumers: component:CartBadge,page:/cart'].join(
        '\n',
      ),
    };
  }
  if (options.kind === 'query') {
    return {
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'QUERY productGrid',
        'consumers: component:ProductGrid,page:/cart',
      ].join('\n'),
    };
  }

  if (options.target === 'cart/add') {
    return {
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'MUTATION cart/add',
        'invalidates: cart,productGrid',
        'updates: cart->component:CartBadge,page:/cart; productGrid->component:ProductGrid,page:/cart',
        'OPTIMISTIC cart hand-written',
        'OPTIMISTIC productGrid await-fragment',
        'OPTIMISTIC-SUMMARY total=2 derived=0 hand-written=1 await-fragment=1 UNHANDLED=0 PUNTED=0',
      ].join('\n'),
    };
  }

  throw new Error(`Unexpected explain target: ${options.target}`);
};

describe('@kovojs/test commerce fixture facts', () => {
  it('projects cart page update intent without local kovo-explain map mechanics', () => {
    expect(
      commerceUpdateIntentFact({
        kovoExplain,
        graph,
        mutation: 'cart/add',
        page: '/cart',
      }),
    ).toEqual({
      componentConsumersByQuery: {
        cart: ['component:CartBadge'],
        productGrid: ['component:ProductGrid'],
      },
      missingComponentConsumers: [],
      missingPageConsumers: [],
      page: '/cart',
      pageQueries: ['cart', 'productGrid'],
      updateConsumersByQuery: {
        cart: ['component:CartBadge', 'page:/cart'],
        productGrid: ['component:ProductGrid', 'page:/cart'],
      },
    });
  });

  it('runs commerce query facts through the public harness verification seam', async () => {
    await expect(
      commerceHarnessQueryFact({
        createDb,
        input: { after: 'fixture-a', limit: 2 },
        query: productGridQuery,
        setupDb(db) {
          db.write('products', { productId: 'seeded' });
        },
        verification: { domainByTable: { products: 'product' } },
      }),
    ).resolves.toEqual({
      diagnostics: [],
      input: { after: 'fixture-a', limit: 2 },
      result: {
        items: [
          { id: 'fixture-b', stock: 4 },
          { id: 'fixture-c', stock: 5 },
        ],
        nextCursor: null,
      },
    });
  });

  it('runs declared commerce query maps through one public harness verifier seam', async () => {
    await expect(
      commerceDeclaredQueriesHarnessFact({
        createDb,
        inputs: { productGrid: { after: 'fixture-a', limit: 2 } },
        queries: {
          cart: cartQuery,
          productGrid: productGridQuery,
        },
        setupDb(db) {
          db.write('products', { productId: 'seeded' });
        },
        verification: { domainByTable: { products: 'product' } },
      }),
    ).resolves.toEqual({
      cart: {
        diagnostics: [],
        result: { count: 1 },
      },
      productGrid: {
        diagnostics: [],
        result: {
          items: [
            { id: 'fixture-b', stock: 4 },
            { id: 'fixture-c', stock: 5 },
          ],
          nextCursor: null,
        },
      },
    });
  });

  it('creates commerce file fixtures with deterministic metadata and bytes', async () => {
    const file = commerceFixtureFile('receipt.pdf', 'application/pdf', 2048);

    await expect(file.arrayBuffer()).resolves.toHaveProperty('byteLength', 2048);
    expect(file).toMatchObject({
      name: 'receipt.pdf',
      size: 2048,
      type: 'application/pdf',
    });
  });

  it('projects mutation-query acceptance through graph, harness, verifier, and fragment facts', async () => {
    const fact = await commerceMutationQueryAcceptanceFact({
      addToCart,
      commerceCsrf: {},
      commerceCsrfInput: (input) => input,
      commerceTouchGraph: {
        'cart.addItem': {
          reads: [],
          touches: [
            { domain: 'cart', site: 'fixture.ts:1', via: 'cart_items' },
            { domain: 'product', site: 'fixture.ts:2', via: 'products' },
          ],
          unresolved: [],
        },
      },
      createDb,
      kovoExplain,
      graph,
      submitAddToCart: async () => ({
        body: [
          '<kovo-query name="cart">{"count":2}</kovo-query>',
          '<kovo-query name="productGrid">{"items":[]}</kovo-query>',
          '<kovo-fragment target="cart-badge"><span kovo-key="order-2">2</span></kovo-fragment>',
          '<kovo-fragment target="product-grid"></kovo-fragment>',
        ].join(''),
        headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8' },
        status: 200,
      }),
    });

    expect(fact.optimisticStatuses).toEqual({
      cart: 'hand-written',
      productGrid: 'await-fragment',
    });
    expect(fact.addToCart.updateQueries).toEqual(['cart', 'productGrid']);
    expect(fact.addToCart.diagnostics).toEqual([]);
    expect(fact.fragmentResponse).toEqual({
      expectedFragmentTargets: ['cart-badge', 'product-grid'],
      fragmentTargets: ['cart-badge', 'product-grid'],
      headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8' },
      keyValues: ['order-2'],
      queryNames: ['cart', 'productGrid'],
      status: 200,
    });
  });
});
