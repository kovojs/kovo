import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { compileComponentModule, deriveAppGraph } from '@kovojs/compiler';
import {
  commerceHarnessQueryFact,
  commerceMutationQueryAcceptanceFact,
  commerceUpdateIntentFact,
} from '@kovojs/conformance-fixtures/commerce-fixtures';
import {
  kovoExplainEndpointAssertionFact,
  kovoExplainMutationAssertionFact,
  kovoExplainPageAssertionFact,
  kovoExplainQueryAssertionFact,
  kovoExplainScopeAuditAssertionFact,
} from '@kovojs/conformance-fixtures/kovo-explain-fixtures';
import { kovoCheckOkAssertionFact } from '@kovojs/conformance-fixtures/kovo-check-fixtures';
import {
  commerceGraphBehaviorFact,
  generatedGraphArtifactAcceptanceProjectFact,
  graphMutationUpdateConsumers,
  graphOptimisticStatusMatrix,
  graphPageFact,
  graphStaticBehaviorFact,
} from '@kovojs/conformance-fixtures/graph-fixtures';
import { htmlDocumentFacts } from '@kovojs/test/html-fragment';
import { kovoCheck, kovoExplain } from 'kovo';

import {
  addToCart,
  commerceCartPageMeta,
  commerceCsrf,
  commerceCsrfInput,
  commerceGraph,
  commerceQueryDomains,
  commerceTouchGraph,
  createCommerceDb,
  loadCartQuery,
  productGridQuery,
  renderCommercePageHints,
  submitAddToCart,
} from './app.js';
import { resetProducts } from './app-test-helpers.js';
import { createCommerceGraph } from './graph.js';

const projectRootPath = fileURLToPath(new URL('../../..', import.meta.url));

describe('commerce source-truth graph acceptance', () => {
  it('ships graph facts for kovo check and explain acceptance', async () => {
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
        kovoCheck,
        rootPath: projectRootPath,
      },
    );
    const starterCart = await loadCartQuery(createCommerceDb());
    const cartMeta = commerceCartPageMeta(starterCart);
    const pageHints = htmlDocumentFacts(renderCommercePageHints(starterCart).html);

    expect(graphAcceptance.artifactGraph).toEqual(commerceGraph);
    expect(createCommerceGraph(starterCart, commerceTouchGraph, commerceQueryDomains)).toEqual(
      commerceGraph,
    );
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
      kovoCheckOk: true,
      invalidationKeys: ['cart/add'],
      staticBehavior: graphStaticBehaviorFact(commerceGraph),
      touchGraph: {
        entryKeys: ['cart.addItem'],
        sourceLineMismatchCount: 0,
        sourceSitePaths: ['examples/commerce/src/app.ts'],
        sourceSitesHavePositiveLines: true,
        touchCountsByMutation: {
          'cart.addItem': 3,
        },
        unresolvedMutations: [],
      },
    });
    expect(kovoCheckOkAssertionFact(kovoCheck(commerceGraph))).toEqual({
      exitCode: 0,
      issueCount: 0,
      status: 'ok',
      version: 'kovo-check/v1',
    });

    const cartAddExplain = kovoExplain(commerceGraph, {
      kind: 'mutation',
      optimistic: true,
      target: 'cart/add',
    });
    expect(kovoExplainMutationAssertionFact(cartAddExplain)).toEqual({
      exitCode: 0,
      guards: ['authed', 'rateLimit:session'],
      inputFields: ['productId', 'quantity'],
      invalidates: ['cart', 'product', 'order'],
      manualInvalidates: [],
      optimisticStatuses: {
        cart: 'derived',
        orderHistory: 'derived',
        productGrid: 'derived',
      },
      optimisticSummary: {
        PUNTED: '0',
        UNHANDLED: '0',
        'await-fragment': '0',
        derived: '3',
        'hand-written': '0',
        total: '3',
      },
      session: 'commerceSession',
      subject: 'MUTATION cart/add',
      updateConsumers: graphMutationUpdateConsumers(commerceGraph, 'cart/add'),
      version: 'kovo-explain/v1',
      writes: ['cart', 'product', 'order'],
    });

    const queryExplainExpectations = {
      cart: {
        consumers: ['component:CartBadge', 'page:/cart'],
        domainWrites: ['cart.addItem'],
        reads: ['cart'],
      },
      orderHistory: {
        consumers: ['component:OrderHistory', 'page:/cart'],
        domainWrites: ['cart.addItem'],
        reads: ['order'],
      },
      productGrid: {
        consumers: ['component:ProductGrid', 'page:/cart'],
        domainWrites: ['cart.addItem'],
        reads: ['product'],
      },
    };
    for (const [query, expected] of Object.entries(queryExplainExpectations)) {
      const explanation = kovoExplain(commerceGraph, { kind: 'query', target: query });

      expect(kovoExplainQueryAssertionFact(explanation)).toEqual({
        consumers: expected.consumers,
        domainWrites: expected.domainWrites,
        exitCode: 0,
        invalidatedBy: ['cart/add'],
        reads: expected.reads,
        subject: `QUERY ${query}`,
        version: 'kovo-explain/v1',
      });
    }

    const pageExplain = kovoExplain(commerceGraph, { kind: 'page', target: '/cart' });
    expect(kovoExplainPageAssertionFact(pageExplain)).toEqual({
      exitCode: 0,
      i18n: ['en-US:cartLabel', 'productStock'],
      meta: 'title=Kovo Commerce (0) description=Browse products and checkout with 0 verifiable cart item. image=-',
      modulepreloads: [],
      prefetch: 'false',
      queries: ['cart', 'productGrid', 'orderHistory'],
      stylesheets: ['/assets/styles.css'],
      subject: 'PAGE /cart',
      version: 'kovo-explain/v1',
      viewTransitions: [],
    });

    expect(kovoExplainScopeAuditAssertionFact(kovoExplain(commerceGraph, { unguarded: true }))).toEqual({
      exitCode: 0,
      records: [],
      subject: 'UNGUARDED',
      summary: { total: '0' },
      version: 'kovo-explain/v1',
    });
    expect(kovoExplainEndpointAssertionFact(kovoExplain(commerceGraph, { endpoints: true }))).toEqual({
      endpoints: [],
      exitCode: 0,
      subject: 'ENDPOINTS',
      summary: { total: '0' },
      version: 'kovo-explain/v1',
    });
    expect(kovoExplainScopeAuditAssertionFact(kovoExplain(commerceGraph, { unscoped: true }))).toEqual({
      exitCode: 0,
      records: [],
      subject: 'UNSCOPED',
      summary: { total: '0' },
      version: 'kovo-explain/v1',
    });
  });

  it('answers cart/add update intent mechanically from kovo explain output', () => {
    expect(
      commerceUpdateIntentFact({
        kovoExplain,
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
        async setupDb(db) {
          await resetProducts(db, [
            { id: 'custom-a', stock: 3, unitPrice: 100 },
            { id: 'custom-b', stock: 4, unitPrice: 200 },
            { id: 'custom-c', stock: 5, unitPrice: 300 },
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
          {
            id: 'custom-b',
            name: 'Sample Product',
            category: 'General',
            emoji: '📦',
            stock: 4,
            unitPrice: 200,
          },
          {
            id: 'custom-c',
            name: 'Sample Product',
            category: 'General',
            emoji: '📦',
            stock: 5,
            unitPrice: 300,
          },
        ],
        nextCursor: null,
      },
    });
  });

  it('answers the full commerce mutation-query matrix mechanically from kovo explain output', () => {
    const fact = commerceGraphBehaviorFact({
      compileComponentModule,
      deriveAppGraph,
      kovoCheck,
      kovoExplain,
      graph: commerceGraph,
    });

    expect(fact.matrix.staticInvalidationMismatches).toEqual([]);
    expect(fact.matrix.unhandledMutations).toEqual([]);
    expect(fact.matrix.matrix).toEqual({
      'auth/sign-out': {
        cart: 'no-invalidation',
        orderHistory: 'no-invalidation',
        productGrid: 'no-invalidation',
      },
      'cart/add': {
        cart: 'derived',
        orderHistory: 'derived',
        productGrid: 'derived',
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
      kovoExplain,
      graph: commerceGraph,
      submitAddToCart,
    });

    expect(fact.optimisticStatuses).toEqual({
      cart: 'derived',
      orderHistory: 'derived',
      productGrid: 'derived',
    });
    expect(fact.addToCart.result).toMatchObject({ ok: true });
    expect(fact.fragmentResponse.queryNames).toEqual(
      expect.arrayContaining(fact.addToCart.updateQueries),
    );
    expect(fact.addToCart.diagnostics).toEqual([]);
    expect(fact.fragmentResponse).toMatchObject({
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
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
