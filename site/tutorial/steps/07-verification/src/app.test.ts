import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { csrfToken } from '@jiso/server';
import { createJisoTestHarness, type JisoTestHarnessOptions } from '@jiso/test';
import { fwCheck, fwExplain } from 'fw';

import {
  addToCart,
  addToCartOptimistic,
  renderShopPage,
  shopCsrf,
  shopGraph,
  shopTouchGraph,
  submitAddToCart,
  type ShopRequest,
} from './app.js';
import { createShopDb, type ShopDb } from './db.js';

// Tutorial step 07: the whole behavior surface is checkable without a
// browser — fw check over the app graph, fw explain as the queryable
// dependency graph, the test harness verifying observed writes against the
// declared touches, and behavior parity with the reference commerce app
// (SPEC.md sections 5.3, 11.2, 11.4, 16).

type ShopTouchGraph = NonNullable<JisoTestHarnessOptions<ShopDb>['touchGraph']>;

function shopRequest(db = createShopDb()): ShopRequest {
  return { db, session: { id: 's1', user: { id: 'u1' } } };
}

function formInput(request: ShopRequest, fields: Record<string, string>) {
  return { ...fields, 'fw-csrf': csrfToken(request, shopCsrf) };
}

function explainLine(output: string, prefix: string): string {
  const line = output.split('\n').find((item) => item.startsWith(prefix));
  if (!line) throw new Error(`missing fw explain line: ${prefix}`);
  return line.slice(prefix.length);
}

function explainList(value: string): string[] {
  return value === '-' ? [] : value.split(',');
}

function optimisticStatuses(output: string): Map<string, string> {
  return new Map(
    output
      .split('\n')
      .filter((line) => line.startsWith('OPTIMISTIC '))
      .map((line) => {
        const [, query, status] = line.split(' ');
        return [query ?? '', status ?? ''] as const;
      }),
  );
}

describe('tutorial step 07 — testing & verification', () => {
  // snippet:fw-check-test
  it('passes fw check with no unhandled optimistic pair', () => {
    expect(fwCheck(shopGraph)).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });
  // /snippet

  // snippet:fw-explain-test
  it('explains the cart/add mutation as a stable, diffable artifact', () => {
    const explanation = fwExplain(shopGraph, {
      kind: 'mutation',
      optimistic: true,
      target: 'cart/add',
    });

    expect(explanation.exitCode).toBe(0);
    expect(explainLine(explanation.output, 'writes: ')).toBe('cart,product,order');
    expect(explainLine(explanation.output, 'invalidates: ')).toBe('cart,product,order');
    expect(optimisticStatuses(explanation.output)).toEqual(
      new Map([
        ['cart', 'hand-written'],
        ['products', 'await-fragment'],
        ['orderHistory', 'await-fragment'],
      ]),
    );
    expect(explainLine(explanation.output, 'OPTIMISTIC-SUMMARY ')).toContain('UNHANDLED=0');
  });
  // /snippet

  // snippet:intent-test
  it('answers "what updates when cart/add commits" mechanically', () => {
    const mutationExplain = fwExplain(shopGraph, { kind: 'mutation', target: 'cart/add' });
    const pageExplain = fwExplain(shopGraph, { kind: 'page', target: '/' });
    const pageQueries = explainList(explainLine(pageExplain.output, 'queries: '));

    expect(pageQueries).toEqual(['cart', 'products', 'orderHistory']);

    // Set operations over printed graphs: every query this page renders is
    // updated by cart/add, and each names its consuming component.
    const updates = explainLine(mutationExplain.output, 'updates: ');
    for (const query of pageQueries) {
      const queryExplain = fwExplain(shopGraph, { kind: 'query', target: query });
      const consumers = explainList(explainLine(queryExplain.output, 'consumers: '));

      expect(updates).toContain(`${query}->`);
      expect(consumers.some((consumer) => consumer.startsWith('component:'))).toBe(true);
      expect(explainList(explainLine(queryExplain.output, 'invalidated-by: '))).toContain(
        'cart/add',
      );
    }
  });
  // /snippet

  it('reports zero unguarded mutations, routes, and queries', () => {
    expect(fwExplain(shopGraph, { unguarded: true })).toEqual({
      exitCode: 0,
      output: 'fw-explain/v1\nUNGUARDED\nSUMMARY total=0\n',
    });
  });

  // snippet:harness-test
  it('executes addToCart through the harness with write verification on', async () => {
    const shopDb = createShopDb();
    const harness = createJisoTestHarness({
      db: shopDb,
      pages: {
        '/': () => renderShopPage(shopDb),
      },
      request: {
        session: { id: 's1', user: { id: 'u1' } },
      },
      touchGraph: shopTouchGraph as unknown as ShopTouchGraph,
      verification: {
        domainByTable: {
          cart_items: 'cart',
          orders: 'order',
          products: 'product',
        },
      },
    });
    // The verifier observes writes through the wrapped handle, so the test
    // runs the handler against it directly instead of a cloned transaction
    // draft (the examples/commerce acceptance-test pattern).
    const verifiedDb = harness.dbHandle();
    verifiedDb.transaction = (run) => run(verifiedDb);
    const request = { db: verifiedDb, session: { id: 's1', user: { id: 'u1' } } };

    await expect(
      harness.exec(addToCart, formInput(request, { productId: 'p1', quantity: '2' }), {
        touchGraphKey: 'cart.addItem',
      }),
    ).resolves.toMatchObject({
      changes: [
        { domain: 'cart', input: { productId: 'p1', quantity: 2 } },
        { domain: 'order', input: { productId: 'p1', quantity: 2 } },
        { domain: 'product', input: { productId: 'p1', quantity: 2 }, keys: ['p1'] },
      ],
      ok: true,
      rerunQueries: ['cart', 'products', 'orderHistory'],
    });
    // Observed writes ⊆ declared touches — the SPEC.md §11.2 invariant.
    expect(harness.verificationDiagnostics()).toEqual([]);
    await expect(
      harness
        .page('/')
        .then((page: { fragment(target: string): string }) => page.fragment('cart-badge')),
    ).resolves.toContain('data-bind="cart.count"');
  });
  // /snippet

  // snippet:parity-test
  it('matches the reference commerce app: wire vocabulary and optimistic statuses', async () => {
    // The committed graph artifact of examples/commerce — the SPEC.md §16
    // acceptance target this tutorial has been building toward.
    const commerceGraph = JSON.parse(
      readFileSync(
        new URL('../../../../../examples/commerce/src/generated/graph.json', import.meta.url),
        'utf8',
      ),
    ) as {
      mutations: { inputFields: string[]; key: string; writes: string[] }[];
      optimistic: { mutation: string; query: string; status: string }[];
    };
    const commerceCartAdd = commerceGraph.mutations.find((entry) => entry.key === 'cart/add');
    const shopCartAdd = shopGraph.mutations.find((entry) => entry.key === 'cart/add');

    // Same mutation key — and therefore the same named POST: /_m/cart/add.
    expect(addToCart.key).toBe('cart/add');
    expect(renderShopPage()).toContain('action="/_m/cart/add"');

    // Same input field vocabulary and write set.
    expect(shopCartAdd?.inputFields).toEqual(commerceCartAdd?.inputFields);
    expect([...(shopCartAdd?.writes ?? [])].sort()).toEqual(
      [...(commerceCartAdd?.writes ?? [])].sort(),
    );

    // Same optimistic statuses per pair (the list query is named productGrid
    // in commerce, products here).
    const queryNameMap: Record<string, string> = {
      cart: 'cart',
      orderHistory: 'orderHistory',
      products: 'productGrid',
    };
    const shopStatuses = shopGraph.optimistic.map((entry) => ({
      mutation: entry.mutation,
      query: queryNameMap[entry.query],
      status: entry.status,
    }));
    const commerceStatuses = commerceGraph.optimistic.filter(
      (entry) => entry.mutation === 'cart/add',
    );
    expect(shopStatuses).toEqual(expect.arrayContaining(commerceStatuses));
    expect(commerceStatuses).toEqual(expect.arrayContaining(shopStatuses));

    // Same enhanced wire: fw-query truth plus fragments, same failure code.
    const request = shopRequest();
    const success = await submitAddToCart(
      formInput(request, { productId: 'p1', quantity: '2' }),
      request,
      { 'FW-Fragment': 'true', 'FW-Targets': 'cart-badge,product-list,order-history' },
    );
    expect(success.headers['Content-Type']).toBe('text/vnd.jiso.fragment+html; charset=utf-8');
    expect(success.body).toContain('<fw-query name="cart">{"count":2}</fw-query>');
    expect(success.body).toContain('<fw-fragment target="order-history">');
    expect(success.body).toContain('fw-key="order-1"');
    expect(success.headers['FW-Changes']).toBe(
      '[{"domain":"cart"},{"domain":"order"},{"domain":"product","keys":["p1"]}]',
    );

    const failure = await submitAddToCart(
      formInput(request, { productId: 'p2', quantity: '3' }),
      request,
      { 'FW-Fragment': 'true', 'FW-Targets': 'product-form:p2' },
    );
    expect(failure.status).toBe(422);
    expect(failure.body).toContain('data-error-code="OUT_OF_STOCK"');
  });
  // /snippet

  it('proves the prediction still commutes with the committed transform', () => {
    expect(
      addToCartOptimistic.transforms.cart({ count: 2 }, { productId: 'p1', quantity: 1 }),
    ).toEqual({ count: 3 });
    expect(Object.keys(addToCartOptimistic.transforms).sort()).toEqual([
      'cart',
      'orderHistory',
      'products',
    ]);
  });

  it('rejects unauthenticated requests through the declared guard chain', async () => {
    const db = createShopDb();
    const response = await submitAddToCart(
      { productId: 'p1', quantity: '1', 'fw-csrf': 'irrelevant' },
      { db, session: { id: 's-anon', user: null } },
      { 'FW-Fragment': 'true', 'FW-Targets': 'product-form:p1' },
    );

    expect(response.status).toBe(422);
    expect(db.cartItems).toEqual([]);
  });
});
