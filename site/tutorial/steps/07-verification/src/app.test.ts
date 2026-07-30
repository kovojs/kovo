import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { compileRouteModule } from '@kovojs/compiler';
import { renderRouteHtml } from '@kovojs/server/rendering';
import { mutationCsrfTokenForTesting as csrfToken } from '@kovojs/test/csrf';
import { accessFactsFromApp } from '../../../../../packages/server/src/internal/execution.js';
import { createApp } from '../../../../../packages/server/src/app.js';
import { renderRoutePageResponse } from '../../../../../packages/server/src/internal/route.js';
import {
  componentLiveTargetRenderer,
  renderMutationEndpointResponse,
} from '../../../../../packages/server/src/internal/wire.js';
import {
  createLiveTargetAttestation,
  type MutationEndpointRequest,
} from '../../../../../packages/server/src/mutation-wire.js';
import { createLiveTargetTestAuthority } from '../../../../../packages/server/src/test-fixtures.js';
import { encodeTutorialMutationHeaders } from '../../../mutation-wire-test-headers.js';
import { kovoCheck, kovoExplain } from '@kovojs/cli';
import { readTempCommerceGraph } from '../../../../../scripts/commerce-graph.mjs';

import {
  addToCart,
  homeRoute,
  predictCart,
  ProductList,
  renderAddToCartError,
  renderAddToCartForm,
  shopCsrf,
  shopGraph,
  type AddToCartFailure,
  type ShopRequest,
} from './app.js';
import { CartBadge } from './components/cart-badge.js';
import { OrderHistory } from './components/order-history.js';
import { createShopDb, createShopRequest } from './db.js';
import { cart, order, product } from './domains.js';
import { cartQuery, orderHistoryQuery, productsQuery } from './queries.js';

type TutorialMutationHeaders = Record<string, readonly string[] | string | undefined>;
type AddToCartRequest = Parameters<typeof addToCart.handler>[1];

const tutorialLiveTargetAuthority = createLiveTargetTestAuthority<AddToCartRequest>(
  'tutorial-step-07-test-build',
  shopCsrf,
);
const tutorialWireCsrf = tutorialLiveTargetAuthority.app.csrf;

const tutorialAccessApp = createApp({
  egress: {
    enabled: false,
    justification: 'tutorial verification fixture performs no outbound I/O',
  },
  mutations: [addToCart],
  queries: [cartQuery, productsQuery, orderHistoryQuery],
  routes: [homeRoute],
});
const tutorialAccessFacts = accessFactsFromApp(tutorialAccessApp);

// Tutorial step 07: the whole behavior surface is checkable without a
// browser — kovo check over the app graph, kovo explain as the queryable
// dependency graph, the test harness verifying observed writes against the
// declared touches, and behavior parity with the reference commerce app
// (SPEC.md sections 5.3, 11.2, 11.4, 16).

function shopRequest(db = createShopDb()): ShopRequest {
  return createShopRequest(db);
}

function formInput(request: ShopRequest, fields: Record<string, string>) {
  return { ...fields, 'kovo-csrf': csrfToken(request, shopCsrf, { mutation: addToCart }) };
}

function submitAddToCart(
  rawInput: unknown,
  request: ShopRequest,
  headers: TutorialMutationHeaders,
) {
  const productId = productIdFromRawInput(rawInput);
  const endpointRequest: MutationEndpointRequest<
    AddToCartRequest,
    { productId: string; quantity: number }
  > = {
    buildToken: 'tutorial-step-07-test-build',
    ...(tutorialWireCsrf === undefined ? {} : { csrf: tutorialWireCsrf }),
    headers: withAttestedLiveTargets(headers, request),
    liveTargetRenderers: successLiveTargetRenderers(),
    liveTargetAttestationAuthority: tutorialLiveTargetAuthority.authority,
    liveTargetAudience: tutorialLiveTargetAuthority.audience,
    rawInput,
    redirectTo: '/',
    renderFailureFragment: (failure) => renderAddToCartFailureFragment(request, rawInput, failure),
    renderFailurePage: (failure) =>
      renderShopPageForTest(request, { failure, productId }, rawInput),
    // This internal wire helper sees the post-guard handler request type; the
    // public dispatcher admits the base request and runs the guard first.
    request: request as AddToCartRequest,
  };
  return renderMutationEndpointResponse(addToCart, endpointRequest);
}

function successLiveTargetRenderers() {
  return [
    componentLiveTargetRenderer<NonNullable<Parameters<typeof CartBadge>[0]>, AddToCartRequest>({
      component: CartBadge,
      componentId: 'components/cart-badge/cart-badge',
    }),
    componentLiveTargetRenderer<NonNullable<Parameters<typeof ProductList>[0]>, AddToCartRequest>({
      component: ProductList,
      componentId: 'components/product-list/product-list',
    }),
    componentLiveTargetRenderer<NonNullable<Parameters<typeof OrderHistory>[0]>, AddToCartRequest>({
      component: OrderHistory,
      componentId: 'components/order-history/order-history',
    }),
  ];
}

function withAttestedLiveTargets(
  headers: TutorialMutationHeaders,
  request: ShopRequest,
): TutorialMutationHeaders {
  return encodeTutorialMutationHeaders(headers, ({ component, props, target }) =>
    createLiveTargetAttestation(
      { component, props, target },
      {
        buildToken: tutorialLiveTargetAuthority.audience,
        ...(tutorialWireCsrf === undefined ? {} : { csrf: tutorialWireCsrf }),
        request,
      },
    ),
  );
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

async function renderShopPageForTest(
  request: ShopRequest,
  failure?: { failure: AddToCartFailure; productId?: string | undefined },
  rawInput?: unknown,
): Promise<string> {
  const response = await renderRoutePageResponse(homeRoute, {}, request, renderRouteHtml, {
    attestationAuthority: tutorialLiveTargetAuthority.authority,
    ...(tutorialWireCsrf === undefined ? {} : { csrf: tutorialWireCsrf }),
    ...(failure === undefined
      ? {}
      : {
          mutationFailure: {
            failure: failure.failure,
            input: rawInput,
            mutationKey: addToCart.key,
          },
        }),
  });
  if (typeof response.body !== 'string') throw new Error('expected a string page body');
  return response.body;
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

const verifiedShopGraph = {
  ...shopGraph,
  access: tutorialAccessFacts,
  components: shopGraph.components.map((component) => ({
    ...component,
    queries: component.queries.map((query) => tutorialQueryKey(query)),
  })),
  mutations: shopGraph.mutations.map((mutation) =>
    mutation.key === addToCart.key
      ? {
          ...mutation,
          invalidates: [cartQuery.key, productsQuery.key, orderHistoryQuery.key],
        }
      : mutation,
  ),
  optimistic: shopGraph.optimistic.map((entry) => ({
    ...entry,
    query: tutorialQueryKey(entry.query),
  })),
  pages: shopGraph.pages.map((page) => ({
    ...page,
    queries: page.queries.map((query) => tutorialQueryKey(query)),
  })),
  queries: shopGraph.queries.map((query) => ({
    ...query,
    query: tutorialQueryKey(query.query),
  })),
  updateCoverage: [
    {
      component: 'CartBadge',
      position: 'text',
      query: cartQuery.key,
      status: 'plan',
    },
  ],
};

function tutorialQueryKey(query: string): string {
  if (query === 'cart') return cartQuery.key;
  if (query === 'products') return productsQuery.key;
  if (query === 'orderHistory') return orderHistoryQuery.key;
  return query;
}

describe('tutorial step 07 — testing & verification', () => {
  // snippet:kovo-check-test
  it('passes kovo check with no unhandled optimistic pair', () => {
    expect(kovoCheck(verifiedShopGraph)).toEqual({
      exitCode: 0,
      output: [
        'kovo-check/v1',
        `COVERAGE component=CartBadge query=${cartQuery.key} position="text" status=plan`,
        '',
      ].join('\n'),
    });
  });
  // /snippet

  // snippet:kovo-explain-test
  it('explains the addToCart mutation as a stable, diffable artifact', () => {
    const explanation = kovoExplain(verifiedShopGraph, {
      view: 'mutation',
      optimistic: true,
      target: addToCart.key,
    });

    expect(explanation.exitCode).toBe(0);
    expect(explainLine(explanation.output, 'writes: ')).toBe('cart,product,order');
    expect(explainLine(explanation.output, 'invalidates: ')).toBe(
      `${cartQuery.key},${productsQuery.key},${orderHistoryQuery.key}`,
    );
    expect(optimisticStatuses(explanation.output)).toEqual(
      new Map([
        [cartQuery.key, 'hand-written'],
        [productsQuery.key, 'await-fragment'],
        [orderHistoryQuery.key, 'await-fragment'],
      ]),
    );
    expect(explainLine(explanation.output, 'OPTIMISTIC-SUMMARY ')).toContain('UNHANDLED=0');
  });
  // /snippet

  // snippet:intent-test
  it('answers "what updates when addToCart commits" mechanically', () => {
    const mutationExplain = kovoExplain(verifiedShopGraph, {
      view: 'mutation',
      target: addToCart.key,
    });
    const pageExplain = kovoExplain(verifiedShopGraph, { view: 'page', target: '/' });
    const pageQueries = explainList(explainLine(pageExplain.output, 'queries: '));

    expect(pageQueries).toEqual([cartQuery.key, productsQuery.key, orderHistoryQuery.key]);

    // Set operations over printed graphs: every query this page renders is
    // updated by addToCart, and each names its consuming component.
    const updates = explainLine(mutationExplain.output, 'updates: ');
    for (const query of pageQueries) {
      const queryExplain = kovoExplain(verifiedShopGraph, { view: 'query', target: query });
      const consumers = explainList(explainLine(queryExplain.output, 'consumers: '));

      expect(updates).toContain(`${query}->`);
      expect(consumers.some((consumer) => consumer.startsWith('component:'))).toBe(true);
      expect(explainList(explainLine(queryExplain.output, 'invalidated-by: '))).toContain(
        addToCart.key,
      );
    }
  });
  // /snippet

  it('reports a complete producer-owned access posture with no missing decisions', () => {
    expect(
      tutorialAccessFacts.map(({ decision, kind, name }) => ({ decision, kind, name })),
    ).toEqual([
      { decision: 'guard', kind: 'mutation', name: addToCart.key },
      { decision: 'public', kind: 'page', name: '/' },
      { decision: 'guard', kind: 'query', name: cartQuery.key },
      { decision: 'guard', kind: 'query', name: orderHistoryQuery.key },
      { decision: 'public', kind: 'query', name: productsQuery.key },
    ]);
    expect(kovoExplain(verifiedShopGraph, { view: 'unguarded' })).toEqual({
      exitCode: 0,
      output: 'kovo-explain/v1\nUNGUARDED\nSUMMARY total=0\n',
    });
  });

  it('enrolls the direct authored route TSX in compiler-owned page facts', () => {
    const fileName = 'site/tutorial/steps/07-verification/src/app.tsx';
    const result = compileRouteModule({
      fileName,
      source: readFileSync(new URL('./app.tsx', import.meta.url), 'utf8'),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.routePageFacts).toMatchObject([
      {
        access: { kind: 'public', reason: 'tutorial storefront browsing' },
        route: '/',
      },
    ]);
    expect(result.routePageFacts[0]?.components.map((component) => component.localName)).toEqual([
      'CartBadge',
      'ProductList',
      'OrderHistory',
    ]);
  });

  // snippet:principal-isolation-test
  it('guards and scopes cart and order history to the authenticated principal', async () => {
    const db = createShopDb();
    db.cartItems.push(
      {
        productId: 'p1',
        qty: 4,
        unitPrice: 1499,
        userId: 'victim',
      },
      {
        productId: 'p2',
        qty: 1,
        unitPrice: 2599,
        userId: 'attacker',
      },
    );
    db.orders.push(
      {
        id: 'order-victim',
        productId: 'p1',
        qty: 1,
        total: 1499,
        userId: 'victim',
      },
      {
        id: 'order-attacker',
        productId: 'p2',
        qty: 1,
        total: 2599,
        userId: 'attacker',
      },
    );

    const attackerRequest = createShopRequest(db, {
      id: 's-attacker',
      user: { id: 'attacker' },
    });
    const attackerPage = await renderShopPageForTest(attackerRequest);
    expect(attackerPage).toContain('<cart-badge');
    expect(attackerPage).toContain('kovo-key="order-attacker"');
    expect(attackerPage).not.toContain('order-victim');

    const anonymousPage = await renderShopPageForTest(
      createShopRequest(db, { id: 's-anonymous', user: null }),
    );
    expect(anonymousPage).toContain('Pour-over kettle');
    expect(anonymousPage).not.toContain('<cart-badge');
    expect(anonymousPage).not.toContain('order-attacker');
  });
  // /snippet

  // snippet:parity-test
  it('matches the reference commerce app: wire vocabulary and optimistic statuses', async () => {
    // The on-demand graph artifact of examples/commerce — the
    // rules/v1-acceptance.md acceptance target this tutorial has been building
    // toward without checking in generated output.
    interface TutorialGraphComparison {
      mutations: Array<{ inputFields: string[]; key: string; writes: string[] }>;
      optimistic: Array<{ mutation: string; query: string; status: string }>;
    }

    const compareStrings = (left: string, right: string) => left.localeCompare(right);
    const commerceGraph = readTempCommerceGraph() as TutorialGraphComparison;
    const commerceCartAdd = commerceGraph.mutations.find((entry) => entry.key === 'cart/add');
    const shopCartAdd = shopGraph.mutations.find((entry) => entry.key === addToCart.key);

    // The tutorial now lets the compiler derive the mutation key from the
    // exported binding and module path; the no-JS form action follows that key.
    const shopPage = await renderShopPageForTest(shopRequest());
    expect(shopPage).toContain(`action="/_m/${addToCart.key}"`);
    expect(shopPage).toContain('name="kovo-form-key" value="p1"');

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
    const mutationKeyMap: Record<string, string> = {
      [addToCart.key]: 'cart/add',
    };
    const pairKey = (entry: { mutation: string; query: string }) =>
      `${entry.mutation} ${entry.query}`;
    const shopPairs = shopGraph.optimistic.map((entry) =>
      pairKey({
        mutation: mutationKeyMap[entry.mutation] ?? entry.mutation,
        query: queryNameMap[entry.query] ?? entry.query,
      }),
    );
    const commercePairs = commerceGraph.optimistic
      .filter((entry) => entry.mutation === 'cart/add')
      .map(pairKey);
    // Both apps cover exactly the same three normalized (mutation x query) pairs.
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
        'Kovo-Targets': `cart-badge=${cartQuery.key}; product-list=${productsQuery.key}; order-history=${orderHistoryQuery.key}`,
      },
    );
    expect(success.headers['Content-Type']).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    expect(success.body).toContain(`<kovo-query name="${cartQuery.key}">{"count":2}</kovo-query>`);
    expect(success.body).toContain('<kovo-fragment target="order-history">');
    expect(success.body).toContain('kovo-key="order-1"');
    expect(success.headers['Kovo-Changes']).toBe(
      `[{"domain":"${cart.key}"},{"domain":"${order.key}"},{"domain":"${product.key}"}]`,
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
  }, 120_000);
  // /snippet

  it('proves the prediction still commutes with the committed transform', () => {
    expect(predictCart({ count: 2 }, { productId: 'p1', quantity: 1 })).toEqual({ count: 3 });
  });

  it('rejects unauthenticated requests through the declared guard chain', async () => {
    const db = createShopDb();
    const response = await submitAddToCart(
      { productId: 'p1', quantity: '1', 'kovo-csrf': 'irrelevant' },
      createShopRequest(db, { id: 's-anon', user: null }),
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
