import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TouchGraph } from '@jiso/drizzle';
import { createJisoTestHarness } from '@jiso/test/harness';
import {
  fwExplainEndpointFacts,
  fwExplainListField,
  fwExplainMutationAssertionFact,
  fwExplainOptimisticStatuses,
  fwExplainPageAssertionFact,
  fwExplainQueryAssertionFact,
  fwExplainScopeAuditFacts,
  fwExplainSummary,
  fwExplainUpdateConsumerMap,
  fwExplainUpdateConsumers,
  parseFwExplainOutput,
} from '@jiso/test/fw-explain-fixtures';
import { fwCheckOkAssertionFact } from '@jiso/test/fw-check-fixtures';
import {
  graphFragmentTargetForQuery,
  graphInvalidatedByQueries,
  graphMutationUpdateConsumers,
  graphOptimisticStatusMatrix,
  graphPageFact,
} from '@jiso/test/graph-fixtures';
import {
  fwFragmentFacts,
  fwQueryFacts,
  htmlDocumentFacts,
  htmlKeyFacts,
} from '@jiso/test/html-fragment';
import { touchGraphProvenanceFact } from '@jiso/test/touch-graph-fixtures';
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

function commerceFile(name: string, type: string, size: number) {
  return {
    async arrayBuffer() {
      return new ArrayBuffer(size);
    },
    name,
    size,
    type,
  };
}

const projectRootPath = fileURLToPath(new URL('../../..', import.meta.url));

describe('commerce source-truth graph acceptance', () => {
  it('ships graph facts for fw check and explain acceptance', async () => {
    execFileSync('node', ['examples/commerce/scripts/emit-graph.mjs', '--check'], {
      stdio: 'pipe',
    });
    const graphArtifact = JSON.parse(
      readFileSync(new URL('./generated/graph.json', import.meta.url), 'utf8'),
    );
    const starterCart = loadCartQuery(createCommerceDb());
    const cartMeta = commerceCartPageMeta(starterCart);
    const pageHints = htmlDocumentFacts(renderCommercePageHints(starterCart).html);

    expect(graphArtifact).toEqual(commerceGraph);
    expect(createCommerceGraph(starterCart, commerceTouchGraph)).toEqual(commerceGraph);
    expect(graphPageFact(graphArtifact, '/cart').meta).toEqual(cartMeta);
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
    expect(fwCheckOkAssertionFact(fwCheck(graphArtifact))).toEqual({
      exitCode: 0,
      issueCount: 0,
      status: 'ok',
      version: 'fw-check/v1',
    });
    expect(addToCart.registry?.touches).toBeUndefined();
    expect(addToCart.registry?.inferredTouches).toEqual(commerceTouchGraph['cart.addItem'].touches);
    await expect(touchGraphProvenanceFact(projectRootPath, commerceTouchGraph)).resolves.toEqual({
      entries: {
        'cart.addItem': {
          reads: [],
          touches: [
            {
              domain: 'cart',
              keys: null,
              predicate: undefined,
              sitePath: 'examples/commerce/src/app.ts',
              via: 'cart_items',
            },
            {
              domain: 'order',
              keys: null,
              predicate: undefined,
              sitePath: 'examples/commerce/src/app.ts',
              via: 'orders',
            },
            {
              domain: 'product',
              keys: 'arg:productId',
              predicate: 'eq',
              sitePath: 'examples/commerce/src/app.ts',
              via: 'products',
            },
          ],
          unresolved: [],
        },
        'order.receipt': {
          reads: [],
          touches: [
            {
              domain: 'attachment',
              keys: 'arg:orderId',
              predicate: 'eq',
              sitePath: 'examples/commerce/src/app.ts',
              via: 'attachments',
            },
          ],
          unresolved: [],
        },
        'payment.webhook': {
          reads: [],
          touches: [
            {
              domain: 'order',
              keys: 'arg:data.object.id',
              predicate: 'eq',
              sitePath: 'examples/commerce/src/app.ts',
              via: 'orders',
            },
          ],
          unresolved: [],
        },
      },
      siteSummary: {
        count: 5,
        linesArePositive: true,
        paths: ['examples/commerce/src/app.ts'],
      },
      sourceLineMismatches: [],
      unresolvedMutations: [],
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
    expect(unguardedExplain.exitCode).toBe(0);
    expect(parseFwExplainOutput(unguardedExplain.output).subject).toBe('UNGUARDED');
    expect(fwExplainSummary(unguardedExplain.output, 'SUMMARY')).toEqual({ total: '0' });

    const endpointsExplain = fwExplain(commerceGraph, { endpoints: true });
    expect(endpointsExplain.exitCode).toBe(0);
    expect(parseFwExplainOutput(endpointsExplain.output).subject).toBe('ENDPOINTS');
    expect(fwExplainEndpointFacts(endpointsExplain.output)).toEqual([
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
    ]);
    expect(fwExplainSummary(endpointsExplain.output, 'SUMMARY')).toEqual({ total: '3' });

    const unscopedExplain = fwExplain(commerceGraph, { unscoped: true });
    expect(unscopedExplain.exitCode).toBe(0);
    expect(parseFwExplainOutput(unscopedExplain.output).subject).toBe('UNSCOPED');
    expect(fwExplainSummary(unscopedExplain.output, 'SUMMARY')).toEqual({ total: '0' });

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
    expect(unscopedAuditExplain.exitCode).toBe(0);
    expect(fwExplainScopeAuditFacts(unscopedAuditExplain.output, 'UNSCOPED')).toEqual([
      {
        domain: 'attachment',
        reason: 'attachment download filters id plus session user',
        scope: 'unscoped',
        site: 'examples/commerce/src/app.ts:deliberately-unscoped-download',
        target: 'attachments/download',
        targetKind: 'QUERY',
      },
    ]);
    expect(fwExplainSummary(unscopedAuditExplain.output, 'SUMMARY')).toEqual({ total: '1' });
  });

  it('answers cart/add update intent mechanically from fw explain output', () => {
    const mutation = fwExplain(commerceGraph, { kind: 'mutation', target: 'cart/add' });
    const page = fwExplain(commerceGraph, { kind: 'page', target: '/cart' });
    const updates = fwExplainUpdateConsumerMap(mutation.output);
    const pageQueries = fwExplainListField(page.output, 'queries');

    expect(pageQueries).toEqual(['cart', 'productGrid', 'orderHistory']);

    for (const query of pageQueries) {
      const queryExplain = fwExplain(commerceGraph, { kind: 'query', target: query });
      const consumers = fwExplainListField(queryExplain.output, 'consumers');
      const componentConsumers = consumers.filter((consumer) => consumer.startsWith('component:'));

      expect(updates.get(query)).toEqual(expect.arrayContaining(componentConsumers));
      expect(updates.get(query)).toContain('page:/cart');
      expect(consumers).toContain('page:/cart');
      expect(componentConsumers.length).toBeGreaterThan(0);
    }
  });

  it('loads paginated commerce query input through the public harness source of truth', async () => {
    const db = createCommerceDb();
    db.products = new Map([
      ['custom-a', { id: 'custom-a', stock: 3, unitPrice: 100 }],
      ['custom-b', { id: 'custom-b', stock: 4, unitPrice: 200 }],
      ['custom-c', { id: 'custom-c', stock: 5, unitPrice: 300 }],
    ]);
    const harness = createJisoTestHarness({
      db,
      touchGraph: {},
      verification: {
        domainByTable: {
          products: 'product',
        },
      },
    });

    await expect(harness.query(productGridQuery, { after: 'custom-a', limit: 2 })).resolves.toEqual(
      {
        items: [
          { id: 'custom-b', stock: 4, unitPrice: 200 },
          { id: 'custom-c', stock: 5, unitPrice: 300 },
        ],
        nextCursor: null,
      },
    );
    expect(harness.verificationDiagnostics()).toEqual([]);
  });

  it('answers the full commerce mutation-query matrix mechanically from fw explain output', () => {
    const invalidatedBy = graphInvalidatedByQueries(commerceGraph);
    const matrix: Record<string, Record<string, string>> = {};

    for (const mutation of commerceGraph.mutations) {
      const explanation = fwExplain(commerceGraph, {
        kind: 'mutation',
        optimistic: true,
        target: mutation.key,
      });
      const statuses = fwExplainOptimisticStatuses(explanation.output);
      const affectedQueries = [...fwExplainUpdateConsumerMap(explanation.output).keys()];
      const mutationMatrix: Record<string, string> = {};
      matrix[mutation.key] = mutationMatrix;

      for (const query of commerceGraph.queries) {
        const queryInvalidators = invalidatedBy.get(query.query) ?? [];
        const invalidated = affectedQueries.includes(query.query);

        expect(queryInvalidators.includes(mutation.key)).toBe(invalidated);
        if (invalidated) {
          expect(statuses[query.query]).toBeDefined();
          expect(statuses[query.query]).not.toBe('UNHANDLED');
          mutationMatrix[query.query] = statuses[query.query] ?? 'missing';
        } else {
          expect(statuses[query.query]).toBeUndefined();
          mutationMatrix[query.query] = 'no-invalidation';
        }
      }
      expect(fwExplainSummary(explanation.output, 'OPTIMISTIC-SUMMARY').UNHANDLED).toBe('0');
    }

    // SPEC.md §10.4/§16.5: every mutation/query cell either has an explicit
    // optimistic status or is proven not to be invalidated by that mutation.
    expect(matrix).toEqual({
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
    expect(matrix).toEqual(graphOptimisticStatusMatrix(commerceGraph));
  });

  it('accepts the commerce mutation-query matrix through static graph, verifier, and enhanced wire', async () => {
    const addToCartExplanation = fwExplain(commerceGraph, {
      kind: 'mutation',
      optimistic: true,
      target: 'cart/add',
    });
    const uploadReceiptExplanation = fwExplain(commerceGraph, {
      kind: 'mutation',
      optimistic: true,
      target: 'order/receipt',
    });
    const affectedQueries = [...fwExplainUpdateConsumerMap(addToCartExplanation.output).keys()];
    const uploadReceiptAffectedQueries = [
      ...fwExplainUpdateConsumerMap(uploadReceiptExplanation.output).keys(),
    ];
    const statuses = fwExplainOptimisticStatuses(addToCartExplanation.output);
    const db = createCommerceDb();
    const harness = createJisoTestHarness({
      db,
      request: {
        session: { id: 's-commerce-acceptance', user: { id: 'u1' } },
      },
      touchGraph: { 'cart.addItem': commerceTouchGraph['cart.addItem'] } as unknown as TouchGraph,
      verification: {
        domainByTable: {
          cart_items: 'cart',
          orders: 'order',
          products: 'product',
        },
      },
    });
    const verifiedDb = harness.dbHandle();
    verifiedDb.transaction = (run) => run(verifiedDb);
    const receiptHarness = createJisoTestHarness({
      db: createCommerceDb(),
      request: {
        session: { id: 's-commerce-receipt', user: { id: 'u1' } },
      },
      touchGraph: { 'order.receipt': commerceTouchGraph['order.receipt'] } as unknown as TouchGraph,
      verification: {
        domainByTable: {
          attachments: 'attachment',
          cart_items: 'cart',
          orders: 'order',
          products: 'product',
        },
      },
    });

    // SPEC.md §10.4/§11.2: every invalidated query pair must have an explicit
    // optimistic status, and executed writes must stay within the static graph.
    expect(statuses).toEqual({
      cart: 'hand-written',
      orderHistory: 'await-fragment',
      productGrid: 'await-fragment',
    });
    expect(uploadReceiptAffectedQueries).toEqual([]);
    expect(fwExplainListField(uploadReceiptExplanation.output, 'invalidates')).toEqual([]);
    expect(fwExplainUpdateConsumers(uploadReceiptExplanation.output)).toEqual([]);
    await expect(
      harness.exec(
        addToCart,
        commerceCsrfInput(
          { productId: 'p1', quantity: 2 },
          { db: verifiedDb, session: { id: 's-commerce-acceptance', user: { id: 'u1' } } },
        ),
        { touchGraphKey: 'cart.addItem' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      rerunQueries: expect.arrayContaining(affectedQueries),
    });
    expect(harness.verificationDiagnostics()).toEqual([]);
    await expect(
      receiptHarness.exec(
        uploadReceipt,
        commerceCsrfInput(
          {
            orderId: 'order-1',
            receipt: commerceFile('receipt.pdf', 'application/pdf', 2048),
          },
          {
            db: receiptHarness.dbHandle(),
            session: { id: 's-commerce-receipt', user: { id: 'u1' } },
          },
        ),
        { csrf: commerceCsrf, touchGraphKey: 'order.receipt' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        attachmentId: 'attachment-1',
        fileName: 'receipt.pdf',
        orderId: 'order-1',
        size: 2048,
        uploadedBy: 'u1',
      },
    });
    expect(receiptHarness.verificationDiagnostics()).toEqual([]);

    const response = await submitAddToCart(
      { productId: 'p2', quantity: 1 },
      { db: verifiedDb, session: { id: 's-commerce-acceptance-2', user: { id: 'u1' } } },
      {
        'FW-Fragment': 'true',
        'FW-Targets': affectedQueries
          .map((query) => graphFragmentTargetForQuery(commerceGraph, query))
          .join(','),
      },
    );

    expect(response).toMatchObject({
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 200,
    });
    expect(
      fwQueryFacts(response.body)
        .map((query) => query.name)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual([...affectedQueries].sort((a, b) => a.localeCompare(b)));
    expect(
      fwFragmentFacts(response.body)
        .map((fragment) => fragment.target)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(
      affectedQueries
        .map((query) => graphFragmentTargetForQuery(commerceGraph, query))
        .sort((a, b) => a.localeCompare(b)),
    );
    expect(htmlKeyFacts(response.body).map((key) => key.key)).toContain('order-2');
  });
});
