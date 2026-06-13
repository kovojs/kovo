import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { compileComponentModule, deriveAppGraph } from '@jiso/compiler';
import {
  commerceFixtureFile,
  commerceHarnessQueryFact,
  commerceMutationQueryAcceptanceFact,
  commerceUpdateIntentFact,
} from '@jiso/test/commerce-fixtures';
import {
  fwExplainEndpointAssertionFact,
  fwExplainMutationAssertionFact,
  fwExplainPageAssertionFact,
  fwExplainQueryAssertionFact,
  fwExplainScopeAuditAssertionFact,
} from '@jiso/test/fw-explain-fixtures';
import { fwCheckOkAssertionFact } from '@jiso/test/fw-check-fixtures';
import {
  commerceGraphBehaviorFact,
  generatedGraphArtifactAcceptanceProjectFact,
  graphMutationUpdateConsumers,
  graphOptimisticStatusMatrix,
  graphPageFact,
  graphStaticBehaviorFact,
} from '@jiso/test/graph-fixtures';
import { htmlDocumentFacts } from '@jiso/test/html-fragment';
import { fwCheck, fwExplain } from 'fw';

import {
  addToCart,
  commerceCartPageMeta,
  commerceCsrf,
  commerceCsrfInput,
  commerceGraph,
  commerceTouchGraph,
  createCommerceDb,
  loadCartQuery,
  productGridQuery,
  renderCommercePageHints,
  submitAddToCart,
  uploadReceipt,
} from './app.js';
import { createCommerceGraph } from './graph.js';

const projectRootPath = fileURLToPath(new URL('../../..', import.meta.url));

describe('commerce source-truth graph acceptance', () => {
  it('ships graph facts for fw check and explain acceptance', async () => {
    const graphAcceptance = await generatedGraphArtifactAcceptanceProjectFact<typeof commerceGraph>(
      {
        artifactPath: 'examples/commerce/src/generated/graph.json',
        authoredGraph: commerceGraph,
        emitCheck: {
          args: ['scripts/emit-graph.mjs', '--check'],
          command: 'node',
          cwd: join(projectRootPath, 'examples/commerce'),
          env: { ...process.env, CI: '1' },
        },
        fwCheck,
        rootPath: projectRootPath,
      },
    );
    const starterCart = loadCartQuery(createCommerceDb());
    const cartMeta = commerceCartPageMeta(starterCart);
    const pageHints = htmlDocumentFacts(renderCommercePageHints(starterCart).html);

    expect(graphAcceptance.artifactGraph).toEqual(commerceGraph);
    expect(createCommerceGraph(starterCart, commerceTouchGraph)).toEqual(commerceGraph);
    expect(graphPageFact(graphAcceptance.artifactGraph, '/cart').meta).toEqual(cartMeta);
    expect(graphPageFact(commerceGraph, '/cart').meta).toEqual(cartMeta);
    expect(pageHints.title).toBe(cartMeta.title);
    expect(pageHints.metas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: cartMeta.description,
            name: 'description',
          }),
        }),
      ]),
    );
    expect(addToCart.registry?.touches).toBeUndefined();
    expect(addToCart.registry?.inferredTouches).toEqual(commerceTouchGraph['cart.addItem'].touches);
    expect(graphAcceptance.checklist).toEqual({
      authoredGraphMatchesArtifact: true,
      emitCheckClean: true,
      fwCheckOk: true,
      invalidationKeys: ['cart/add'],
      staticBehavior: graphStaticBehaviorFact(commerceGraph),
      touchGraph: {
        entryKeys: ['cart.addItem', 'order.receipt', 'payment.webhook'],
        sourceLineMismatchCount: 0,
        sourceSitePaths: ['examples/commerce/src/app.ts'],
        sourceSitesHavePositiveLines: true,
        touchCountsByMutation: {
          'cart.addItem': 3,
          'order.receipt': 1,
          'payment.webhook': 1,
        },
        unresolvedMutations: [],
      },
    });
    expect(fwCheckOkAssertionFact(fwCheck(commerceGraph))).toEqual({
      exitCode: 0,
      issueCount: 0,
      status: 'ok',
      version: 'fw-check/v1',
    });
    const cartAddExplain = fwExplain(commerceGraph, {
      kind: 'mutation',
      optimistic: true,
      target: 'cart/add',
    });
    const receiptExplain = fwExplain(commerceGraph, {
      kind: 'mutation',
      target: 'order/receipt',
    });
    const receiptOptimisticExplain = fwExplain(commerceGraph, {
      kind: 'mutation',
      optimistic: true,
      target: 'order/receipt',
    });

    expect(fwExplainMutationAssertionFact(cartAddExplain)).toEqual({
      exitCode: 0,
      guards: ['authed', 'rateLimit:session'],
      inputFields: ['productId', 'quantity'],
      invalidates: ['cart', 'product', 'order'],
      manualInvalidates: [],
      optimisticStatuses: {
        cart: 'hand-written',
        orderHistory: 'await-fragment',
        productGrid: 'await-fragment',
      },
      optimisticSummary: {
        UNHANDLED: '0',
        'await-fragment': '2',
        'hand-written': '1',
        total: '3',
      },
      session: 'commerceSession',
      subject: 'MUTATION cart/add',
      updateConsumers: graphMutationUpdateConsumers(commerceGraph, 'cart/add'),
      version: 'fw-explain/v1',
      writes: ['cart', 'product', 'order'],
    });

    expect(fwExplainMutationAssertionFact(receiptExplain)).toEqual({
      enctype: 'multipart/form-data',
      exitCode: 0,
      fileFields: ['receipt'],
      guards: ['authed', 'rateLimit:session'],
      inputFields: ['orderId', 'receipt'],
      invalidates: [],
      manualInvalidates: [],
      session: 'commerceSession',
      subject: 'MUTATION order/receipt',
      updateConsumers: [],
      version: 'fw-explain/v1',
      writes: ['attachment'],
    });
    expect(fwExplainMutationAssertionFact(receiptOptimisticExplain).optimisticSummary).toEqual({
      UNHANDLED: '0',
      'await-fragment': '0',
      'hand-written': '0',
      total: '0',
    });

    const queryExplainExpectations = {
      cart: {
        consumers: ['component:CartBadge', 'page:/cart'],
        domainWrites: ['cart.addItem'],
        reads: ['cart'],
      },
      orderHistory: {
        consumers: ['component:OrderHistory', 'page:/cart'],
        domainWrites: ['cart.addItem', 'payment.webhook'],
        reads: ['order'],
      },
      productGrid: {
        consumers: ['component:ProductGrid', 'page:/cart'],
        domainWrites: ['cart.addItem'],
        reads: ['product'],
      },
    };
    for (const [query, expected] of Object.entries(queryExplainExpectations)) {
      const explanation = fwExplain(commerceGraph, { kind: 'query', target: query });

      expect(fwExplainQueryAssertionFact(explanation)).toEqual({
        consumers: expected.consumers,
        domainWrites: expected.domainWrites,
        exitCode: 0,
        invalidatedBy: ['cart/add'],
        reads: expected.reads,
        subject: `QUERY ${query}`,
        version: 'fw-explain/v1',
      });
    }

    const pageExplain = fwExplain(commerceGraph, { kind: 'page', target: '/cart' });
    expect(fwExplainPageAssertionFact(pageExplain)).toEqual({
      exitCode: 0,
      i18n: ['en-US:cartLabel', 'productStock'],
      meta: 'title=Jiso Commerce (0) description=Browse products and checkout with 0 verifiable cart item. image=-',
      modulepreloads: [],
      prefetch: 'false',
      queries: ['cart', 'productGrid', 'orderHistory'],
      stylesheets: ['/assets/tailwind.css'],
      subject: 'PAGE /cart',
      version: 'fw-explain/v1',
      viewTransitions: [],
    });

    const unguardedExplain = fwExplain(commerceGraph, { unguarded: true });
    expect(fwExplainScopeAuditAssertionFact(unguardedExplain)).toEqual({
      exitCode: 0,
      records: [],
      subject: 'UNGUARDED',
      summary: { total: '0' },
      version: 'fw-explain/v1',
    });

    const endpointsExplain = fwExplain(commerceGraph, { endpoints: true });
    expect(fwExplainEndpointAssertionFact(endpointsExplain)).toEqual({
      endpoints: [
        {
          auth: 'authed',
          csrf: 'checked',
          endpoint: 'attachments/download',
          method: 'GET',
          mount: 'exact',
          path: '/attachments/:id',
          writes: [],
        },
        {
          auth: 'authed',
          csrf: 'checked',
          endpoint: 'orders/export',
          method: 'GET',
          mount: 'exact',
          path: '/exports/orders.csv',
          writes: [],
        },
        {
          auth: 'verifier:stripe:v1:hmac-sha256',
          csrf: 'exempt:payment/stripe webhook verifier stripe:v1:hmac-sha256',
          endpoint: 'payment/stripe',
          method: 'POST',
          mount: 'exact',
          path: '/webhooks/stripe',
          writes: ['order'],
        },
      ],
      exitCode: 0,
      subject: 'ENDPOINTS',
      summary: { total: '3' },
      version: 'fw-explain/v1',
    });

    const unscopedExplain = fwExplain(commerceGraph, { unscoped: true });
    expect(fwExplainScopeAuditAssertionFact(unscopedExplain)).toEqual({
      exitCode: 0,
      records: [],
      subject: 'UNSCOPED',
      summary: { total: '0' },
      version: 'fw-explain/v1',
    });

    const unscopedAuditExplain = fwExplain(
      {
        ...commerceGraph,
        scopeAudits: commerceGraph.scopeAudits.map((fact, index) =>
          index === 0
            ? {
                ...fact,
                scope: 'unscoped',
                site: 'examples/commerce/src/app.ts:deliberately-unscoped-download',
              }
            : fact,
        ),
      },
      { unscoped: true },
    );
    expect(fwExplainScopeAuditAssertionFact(unscopedAuditExplain)).toEqual({
      exitCode: 0,
      records: [
        {
          domain: 'attachment',
          reason: 'attachment download filters id plus session user',
          scope: 'unscoped',
          site: 'examples/commerce/src/app.ts:deliberately-unscoped-download',
          target: 'attachments/download',
          targetKind: 'QUERY',
        },
      ],
      subject: 'UNSCOPED',
      summary: { total: '1' },
      version: 'fw-explain/v1',
    });
  });

  it('answers cart/add update intent mechanically from fw explain output', () => {
    expect(
      commerceUpdateIntentFact({
        fwExplain,
        graph: commerceGraph,
        mutation: 'cart/add',
        page: '/cart',
      }),
    ).toEqual({
      componentConsumersByQuery: {
        cart: ['component:CartBadge'],
        orderHistory: ['component:OrderHistory'],
        productGrid: ['component:ProductGrid'],
      },
      missingComponentConsumers: [],
      missingPageConsumers: [],
      page: '/cart',
      pageQueries: ['cart', 'productGrid', 'orderHistory'],
      updateConsumersByQuery: {
        cart: ['component:CartBadge', 'page:/cart'],
        orderHistory: ['component:OrderHistory', 'page:/cart'],
        productGrid: ['component:ProductGrid', 'page:/cart'],
      },
    });
  });

  it('loads paginated commerce query input through the public harness source of truth', async () => {
    await expect(
      commerceHarnessQueryFact({
        createDb: createCommerceDb,
        input: { after: 'custom-a', limit: 2 },
        query: productGridQuery,
        setupDb(db) {
          db.products = new Map([
            ['custom-a', { id: 'custom-a', stock: 3, unitPrice: 100 }],
            ['custom-b', { id: 'custom-b', stock: 4, unitPrice: 200 }],
            ['custom-c', { id: 'custom-c', stock: 5, unitPrice: 300 }],
          ]);
        },
        verification: {
          domainByTable: {
            products: 'product',
          },
        },
      }),
    ).resolves.toEqual({
      diagnostics: [],
      input: { after: 'custom-a', limit: 2 },
      result: {
        items: [
          { id: 'custom-b', stock: 4, unitPrice: 200 },
          { id: 'custom-c', stock: 5, unitPrice: 300 },
        ],
        nextCursor: null,
      },
    });
  });

  it('answers the full commerce mutation-query matrix mechanically from fw explain output', () => {
    const fact = commerceGraphBehaviorFact({
      compileComponentModule,
      deriveAppGraph,
      fwCheck,
      fwExplain,
      graph: commerceGraph,
    });

    // SPEC.md §10.4/§16.5: every mutation/query cell either has an explicit
    // optimistic status or is proven not to be invalidated by that mutation.
    expect(fact.matrix.staticInvalidationMismatches).toEqual([]);
    expect(fact.matrix.unhandledMutations).toEqual([]);
    expect(fact.matrix.matrix).toEqual({
      'auth/sign-out': {
        cart: 'no-invalidation',
        orderHistory: 'no-invalidation',
        productGrid: 'no-invalidation',
      },
      'cart/add': {
        cart: 'hand-written',
        orderHistory: 'await-fragment',
        productGrid: 'await-fragment',
      },
      'order/receipt': {
        cart: 'no-invalidation',
        orderHistory: 'no-invalidation',
        productGrid: 'no-invalidation',
      },
    });
    expect(fact.matrix.matrix).toEqual(graphOptimisticStatusMatrix(commerceGraph));
  });

  it('accepts the commerce mutation-query matrix through static graph, verifier, and enhanced wire', async () => {
    const fact = await commerceMutationQueryAcceptanceFact({
      addToCart,
      commerceCsrf,
      commerceCsrfInput,
      commerceTouchGraph,
      createDb: createCommerceDb,
      fwExplain,
      graph: commerceGraph,
      receiptFile: commerceFixtureFile('receipt.pdf', 'application/pdf', 2048),
      submitAddToCart,
      uploadReceipt,
    });

    // SPEC.md §10.4/§11.2: every invalidated query pair must have an explicit
    // optimistic status, and executed writes must stay within the static graph.
    expect(fact.optimisticStatuses).toEqual({
      cart: 'hand-written',
      orderHistory: 'await-fragment',
      productGrid: 'await-fragment',
    });
    expect(fact.uploadReceipt.updateQueries).toEqual([]);
    expect(fact.uploadReceipt.invalidates).toEqual([]);
    expect(fact.uploadReceipt.updateConsumers).toEqual([]);
    expect(fact.addToCart.result).toMatchObject({
      ok: true,
      rerunQueries: expect.arrayContaining(fact.addToCart.updateQueries),
    });
    expect(fact.addToCart.diagnostics).toEqual([]);
    expect(fact.uploadReceipt.result).toMatchObject({
      ok: true,
      value: {
        attachmentId: 'attachment-1',
        fileName: 'receipt.pdf',
        orderId: 'order-1',
        size: 2048,
        uploadedBy: 'u1',
      },
    });
    expect(fact.uploadReceipt.diagnostics).toEqual([]);
    expect(fact.fragmentResponse).toMatchObject({
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 200,
    });
    expect(fact.fragmentResponse.queryNames).toEqual(fact.addToCart.updateQueries.toSorted());
    expect(fact.fragmentResponse.fragmentTargets).toEqual(
      fact.fragmentResponse.expectedFragmentTargets,
    );
    expect(fact.fragmentResponse.keyValues).toContain('order-2');
  });
});
