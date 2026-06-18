import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { csrfToken } from '@kovojs/server';
import {
  renderMutationEndpointResponse,
  type MutationWireHeaderSource,
} from '@kovojs/server/internal/wire';
import { createKovoTestHarness, type KovoTestHarnessOptions } from '@kovojs/test/harness';
import { kovoCheck, kovoExplain } from '@kovojs/cli';

import {
  addToCart,
  addToCartOptimistic,
  renderAddToCartError,
  renderAddToCartForm,
  renderShopPage,
  shopCsrf,
  shopGraph,
  shopTouchGraph,
  type AddToCartFailure,
  type ShopRequest,
} from './app.js';
import { createShopDb, type ShopDb } from './db.js';

// Tutorial step 07: the whole behavior surface is checkable without a
// browser — kovo check over the app graph, kovo explain as the queryable
// dependency graph, the test harness verifying observed writes against the
// declared touches, and behavior parity with the reference commerce app
// (SPEC.md sections 5.3, 11.2, 11.4, 16).

type ShopTouchGraph = NonNullable<KovoTestHarnessOptions<ShopDb>['touchGraph']>;

function shopRequest(db = createShopDb()): ShopRequest {
  return { db, session: { id: 's1', user: { id: 'u1' } } };
}

function formInput(request: ShopRequest, fields: Record<string, string>) {
  return { ...fields, 'kovo-csrf': csrfToken(request, shopCsrf) };
}

function submitAddToCart(
  rawInput: unknown,
  request: ShopRequest,
  headers: MutationWireHeaderSource,
) {
  const productId = productIdFromRawInput(rawInput);
  return renderMutationEndpointResponse(addToCart, {
    headers,
    rawInput,
    redirectTo: '/',
    renderFailureFragment: (failure) => renderAddToCartFailureFragment(request, rawInput, failure),
    renderFailurePage: (failure) => renderShopPage(request.db, { failure, productId }, request),
    request,
  });
}

function renderAddToCartFailureFragment(
  request: ShopRequest,
  rawInput: unknown,
  failure: AddToCartFailure,
) {
  const productId = productIdFromRawInput(rawInput);
  const product = productId ? request.db.products.get(productId) : undefined;

  if (!product) return renderAddToCartError(failure);

  return renderAddToCartForm(product, failure, request);
}

function productIdFromRawInput(rawInput: unknown): string | undefined {
  if (typeof rawInput !== 'object' || rawInput === null || !('productId' in rawInput)) {
    return undefined;
  }
  const productId = rawInput.productId;
  return typeof productId === 'string' ? productId : undefined;
}

function explainLine(output: string, prefix: string): string {
  const line = output.split('\n').find((item) => item.startsWith(prefix));
  if (!line) throw new Error(`missing kovo explain line: ${prefix}`);
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
  // snippet:kovo-check-test
  it('passes kovo check with no unhandled optimistic pair', () => {
    expect(kovoCheck(shopGraph)).toEqual({
      exitCode: 0,
      output: 'kovo-check/v1\nOK\n',
    });
  });
  // /snippet

  // snippet:kovo-explain-test
  it('explains the cart/add mutation as a stable, diffable artifact', () => {
    const explanation = kovoExplain(shopGraph, {
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
    const mutationExplain = kovoExplain(shopGraph, { kind: 'mutation', target: 'cart/add' });
    const pageExplain = kovoExplain(shopGraph, { kind: 'page', target: '/' });
    const pageQueries = explainList(explainLine(pageExplain.output, 'queries: '));

    expect(pageQueries).toEqual(['cart', 'products', 'orderHistory']);

    // Set operations over printed graphs: every query this page renders is
    // updated by cart/add, and each names its consuming component.
    const updates = explainLine(mutationExplain.output, 'updates: ');
    for (const query of pageQueries) {
      const queryExplain = kovoExplain(shopGraph, { kind: 'query', target: query });
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
    expect(kovoExplain(shopGraph, { unguarded: true })).toEqual({
      exitCode: 0,
      output: 'kovo-explain/v1\nUNGUARDED\nSUMMARY total=0\n',
    });
  });

  // snippet:harness-test
  it('executes addToCart through the harness with write verification on', async () => {
    const shopDb = createShopDb();
    const harness = createKovoTestHarness({
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
    // The committed graph artifact of examples/commerce — the rules/v1-acceptance.md
    // acceptance target this tutorial has been building toward.
    interface TutorialGraphComparison {
      mutations: Array<{ inputFields: string[]; key: string; writes: string[] }>;
      optimistic: Array<{ mutation: string; query: string; status: string }>;
    }

    const compareStrings = (left: string, right: string) => left.localeCompare(right);
    const commerceGraph = JSON.parse(
      readFileSync(
        new URL('../../../../../examples/commerce/src/generated/graph.json', import.meta.url),
        'utf8',
      ),
    ) as TutorialGraphComparison;
    const commerceCartAdd = commerceGraph.mutations.find((entry) => entry.key === 'cart/add');
    const shopCartAdd = shopGraph.mutations.find((entry) => entry.key === 'cart/add');

    // Same mutation key — and therefore the same named POST: /_m/cart/add.
    expect(addToCart.key).toBe('cart/add');
    expect(renderShopPage()).toContain('action="/_m/cart/add"');
    expect(renderShopPage()).toContain('kovo-fragment-target="add-to-cart:p1"');

    // Same input field vocabulary and write set.
    expect(shopCartAdd?.inputFields).toEqual(commerceCartAdd?.inputFields);
    expect([...(shopCartAdd?.writes ?? [])].sort(compareStrings)).toEqual(
      [...(commerceCartAdd?.writes ?? [])].sort(compareStrings),
    );

    // Same optimistic COVERAGE per pair (the list query is named productGrid in
    // commerce, products here). The tutorial teaches v1 hand-written/await-fragment
    // optimism; the reference commerce app has since adopted v2 derived optimism
    // (SPEC.md §10.5). Both cover exactly the same (mutation × query) pairs with an
    // explicit, non-UNHANDLED status — that coverage parity is the invariant here,
    // not the v1-vs-v2 status string.
    const queryNameMap: Record<string, string> = {
      cart: 'cart',
      orderHistory: 'orderHistory',
      products: 'productGrid',
    };
    const pairKey = (entry: { mutation: string; query: string }) =>
      `${entry.mutation} ${entry.query}`;
    const shopPairs = shopGraph.optimistic.map((entry) =>
      pairKey({ mutation: entry.mutation, query: queryNameMap[entry.query] ?? entry.query }),
    );
    const commercePairs = commerceGraph.optimistic
      .filter((entry) => entry.mutation === 'cart/add')
      .map(pairKey);
    // Both apps cover exactly the same three cart/add (mutation × query) pairs.
    expect([...shopPairs].sort(compareStrings)).toEqual([...commercePairs].sort(compareStrings));
    expect(shopPairs).toHaveLength(3);
    // No pair is UNHANDLED on either side (commerce derived, shop hand-written/await).
    expect(commerceGraph.optimistic.every((entry) => entry.status !== 'UNHANDLED')).toBe(true);

    // Same enhanced wire: kovo-query truth plus fragments, same failure code.
    const request = shopRequest();
    const success = await submitAddToCart(
      formInput(request, { productId: 'p1', quantity: '2' }),
      request,
      {
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets':
          'cart-badge#components/cart-badge/cart-badge:{}; product-list#components/product-list/product-list:{}; order-history#components/order-history/order-history:{}',
        'Kovo-Targets': 'cart-badge=cart; product-list=products; order-history=orderHistory',
      },
    );
    expect(success.headers['Content-Type']).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    expect(success.body).toContain('<kovo-query name="cart">{"count":2}</kovo-query>');
    expect(success.body).toContain('<kovo-fragment target="order-history">');
    expect(success.body).toContain('kovo-key="order-1"');
    expect(success.headers['Kovo-Changes']).toBe(
      '[{"domain":"cart"},{"domain":"order"},{"domain":"product","keys":["p1"]}]',
    );

    const failure = await submitAddToCart(
      formInput(request, { productId: 'p2', quantity: '3' }),
      request,
      {
        'Kovo-Form-Target': 'add-to-cart:p2',
        'Kovo-Fragment': 'true',
        'Kovo-Targets': 'add-to-cart:p2',
      },
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
      { productId: 'p1', quantity: '1', 'kovo-csrf': 'irrelevant' },
      { db, session: { id: 's-anon', user: null } },
      {
        'Kovo-Form-Target': 'add-to-cart:p1',
        'Kovo-Fragment': 'true',
        'Kovo-Targets': 'add-to-cart:p1',
      },
    );

    expect(response.status).toBe(422);
    expect(db.cartItems).toEqual([]);
  });
});
