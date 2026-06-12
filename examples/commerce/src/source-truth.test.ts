import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import type { TouchGraph } from '@jiso/drizzle';
import { createJisoTestHarness } from '@jiso/test';
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

function lineNumberFor(source: string, needle: string): number {
  const index = source.indexOf(needle);
  expect(index).not.toBe(-1);
  return source.slice(0, index).split('\n').length;
}

function explainLine(output: string, prefix: string) {
  const line = output.split('\n').find((item) => item.startsWith(prefix));

  if (!line) {
    throw new Error(`Missing fw explain line: ${prefix}`);
  }

  return line.slice(prefix.length);
}

function explainList(value: string) {
  return value === '-' ? [] : value.split(',');
}

function mutationUpdateConsumers(output: string) {
  const updates = explainLine(output, 'updates: ');

  if (updates === '-') {
    return new Map<string, string[]>();
  }

  const result = new Map<string, string[]>();
  for (const entry of updates.split('; ')) {
    const [query, consumers = ''] = entry.split('->');
    if (!query) {
      throw new Error(`Malformed fw explain update entry: ${entry}`);
    }

    result.set(query, explainList(consumers));
  }

  return result;
}

function optimisticStatuses(output: string) {
  return new Map(
    output
      .split('\n')
      .filter((line) => line.startsWith('OPTIMISTIC '))
      .map((line) => {
        const [, query, status] = line.split(' ');

        return [query, status] as const;
      }),
  );
}

function queryChunkNames(html: string) {
  return [...html.matchAll(/<fw-query name="([^"]+)">/g)].map((match) => {
    const name = match[1];
    if (!name) {
      throw new Error(`Malformed fw-query chunk: ${match[0]}`);
    }

    return name;
  });
}

function fragmentTargetForQuery(query: string) {
  const component = commerceGraph.components.find((item) => item.queries.includes(query));
  const fragment = component?.fragments[0];

  if (!fragment) {
    throw new Error(`Missing commerce fragment target for query ${query}`);
  }

  return fragment;
}

function invalidatedByQueries() {
  return new Map(
    commerceGraph.queries.map((query) => {
      const explanation = fwExplain(commerceGraph, { kind: 'query', target: query.query });

      return [query.query, explainList(explainLine(explanation.output, 'invalidated-by: '))];
    }),
  );
}

function cartPageGraph(graph: { pages?: { route?: string; meta?: unknown }[] }) {
  const page = graph.pages?.find((item) => item.route === '/cart');
  if (!page) throw new Error('Missing /cart page graph fact');
  return page;
}

describe('commerce source-truth graph acceptance', () => {
  it('ships graph facts for fw check and explain acceptance', () => {
    execFileSync('node', ['examples/commerce/scripts/emit-graph.mjs', '--check'], {
      stdio: 'pipe',
    });
    const emitGraphScript = readFileSync(
      new URL('../scripts/emit-graph.mjs', import.meta.url),
      'utf8',
    );
    const graphArtifact = JSON.parse(
      readFileSync(new URL('./generated/graph.json', import.meta.url), 'utf8'),
    );
    const commerceSource = readFileSync(new URL('./app.ts', import.meta.url), 'utf8');
    const starterCart = loadCartQuery(createCommerceDb());
    const cartMeta = commerceCartPageMeta(starterCart);
    const cartItemsLine = lineNumberFor(commerceSource, "request.db.write('cart_items'");
    const ordersLine = lineNumberFor(commerceSource, "request.db.write('orders'");
    const productsLine = lineNumberFor(commerceSource, "request.db.write('products'");
    const attachmentsLine = lineNumberFor(commerceSource, "request.db.write('attachments'");
    const paymentOrdersLine = lineNumberFor(commerceSource, "tx.write('orders'");

    expect(emitGraphScript).toContain("await import('@jiso/compiler/graph');");
    expect(emitGraphScript).not.toContain('const deriveAppGraph = ({ graph }) => ({ graph })');
    expect(graphArtifact).toEqual(commerceGraph);
    expect(cartPageGraph(graphArtifact).meta).toEqual(cartMeta);
    expect(cartPageGraph(commerceGraph).meta).toEqual(cartMeta);
    expect(renderCommercePageHints(starterCart).html).toContain(`<title>${cartMeta.title}</title>`);
    expect(renderCommercePageHints(starterCart).html).toContain(
      `<meta name="description" content="${cartMeta.description}">`,
    );
    expect(fwCheck(graphArtifact).output).toBe('fw-check/v1\nOK\n');
    expect(addToCart.registry?.touches).toBeUndefined();
    expect(addToCart.registry?.inferredTouches).toEqual(commerceTouchGraph['cart.addItem'].touches);
    expect(commerceTouchGraph).toEqual({
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: `examples/commerce/src/app.ts:${cartItemsLine}`,
            via: 'cart_items',
          },
          {
            domain: 'order',
            keys: null,
            site: `examples/commerce/src/app.ts:${ordersLine}`,
            via: 'orders',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            predicate: 'eq',
            site: `examples/commerce/src/app.ts:${productsLine}`,
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
            site: `examples/commerce/src/app.ts:${attachmentsLine}`,
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
            site: `examples/commerce/src/app.ts:${paymentOrdersLine}`,
            via: 'orders',
          },
        ],
        unresolved: [],
      },
    });
    expect(fwCheck(commerceGraph)).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
    expect(fwCheck(commerceGraph).output).not.toContain('FW310');

    expect(
      fwExplain(commerceGraph, { kind: 'mutation', optimistic: true, target: 'cart/add' }),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION cart/add',
        'guards: authed,rateLimit:session',
        'session: commerceSession',
        'input-fields: productId,quantity',
        'writes: cart,product,order',
        'invalidates: cart,product,order',
        'manual-invalidates: -',
        'updates: cart->component:CartBadge,page:/cart; orderHistory->component:OrderHistory,page:/cart; productGrid->component:ProductGrid,page:/cart',
        'OPTIMISTIC cart hand-written',
        'OPTIMISTIC productGrid await-fragment',
        'OPTIMISTIC orderHistory await-fragment',
        'OPTIMISTIC-SUMMARY total=3 hand-written=1 await-fragment=2 UNHANDLED=0',
        '',
      ].join('\n'),
    });
    expect(fwExplain(commerceGraph, { kind: 'mutation', target: 'order/receipt' })).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION order/receipt',
        'guards: authed,rateLimit:session',
        'session: commerceSession',
        'enctype: multipart/form-data',
        'input-fields: orderId,receipt',
        'file-fields: receipt',
        'writes: attachment',
        'invalidates: -',
        'manual-invalidates: -',
        'updates: -',
        '',
      ].join('\n'),
    });
    expect(
      fwExplain(commerceGraph, { kind: 'mutation', optimistic: true, target: 'order/receipt' }),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION order/receipt',
        'guards: authed,rateLimit:session',
        'session: commerceSession',
        'enctype: multipart/form-data',
        'input-fields: orderId,receipt',
        'file-fields: receipt',
        'writes: attachment',
        'invalidates: -',
        'manual-invalidates: -',
        'updates: -',
        'OPTIMISTIC-SUMMARY total=0 hand-written=0 await-fragment=0 UNHANDLED=0',
        '',
      ].join('\n'),
    });
    expect(fwExplain(commerceGraph, { kind: 'query', target: 'cart' })).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge,page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
    });
    expect(fwExplain(commerceGraph, { kind: 'query', target: 'productGrid' })).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nQUERY productGrid\nreads: product\nconsumers: component:ProductGrid,page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
    });
    expect(fwExplain(commerceGraph, { kind: 'query', target: 'orderHistory' })).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nQUERY orderHistory\nreads: order\nconsumers: component:OrderHistory,page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem,payment.webhook\n',
    });
    expect(fwExplain(commerceGraph, { kind: 'page', target: '/cart' })).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'PAGE /cart',
        'prefetch: false',
        'meta: title=Jiso Commerce (0) description=Browse products and checkout with 0 verifiable cart item. image=-',
        'i18n: en-US:cartLabel,productStock',
        'modulepreloads: -',
        'stylesheets: /assets/tailwind.css',
        'queries: cart,productGrid,orderHistory',
        'view-transitions: -',
        '',
      ].join('\n'),
    });
    expect(fwExplain(commerceGraph, { unguarded: true })).toEqual({
      exitCode: 0,
      output: 'fw-explain/v1\nUNGUARDED\nSUMMARY total=0\n',
    });
    expect(fwExplain(commerceGraph, { endpoints: true })).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'ENDPOINTS',
        'ENDPOINT attachments/download method=GET path=/attachments/:id mount=exact auth=authed csrf=checked writes=-',
        'ENDPOINT orders/export method=GET path=/exports/orders.csv mount=exact auth=authed csrf=checked writes=-',
        'ENDPOINT payment/stripe method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe:v1:hmac-sha256 csrf=exempt:payment/stripe webhook verifier stripe:v1:hmac-sha256 writes=order',
        'SUMMARY total=3',
        '',
      ].join('\n'),
    });
    expect(fwExplain(commerceGraph, { unscoped: true })).toEqual({
      exitCode: 0,
      output: 'fw-explain/v1\nUNSCOPED\nSUMMARY total=0\n',
    });
    expect(
      fwExplain(
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
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'UNSCOPED',
        'UNSCOPED QUERY attachments/download domain=attachment scope=unscoped site=examples/commerce/src/app.ts:deliberately-unscoped-download attachment download filters id plus session user',
        'SUMMARY total=1',
        '',
      ].join('\n'),
    });
  });

  it('answers cart/add update intent mechanically from fw explain output', () => {
    const mutation = fwExplain(commerceGraph, { kind: 'mutation', target: 'cart/add' });
    const page = fwExplain(commerceGraph, { kind: 'page', target: '/cart' });
    const updates = mutationUpdateConsumers(mutation.output);
    const pageQueries = explainList(explainLine(page.output, 'queries: '));

    expect(pageQueries).toEqual(['cart', 'productGrid', 'orderHistory']);

    for (const query of pageQueries) {
      const queryExplain = fwExplain(commerceGraph, { kind: 'query', target: query });
      const consumers = explainList(explainLine(queryExplain.output, 'consumers: '));
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
    const invalidatedBy = invalidatedByQueries();
    const matrix: Record<string, Record<string, string>> = {};

    for (const mutation of commerceGraph.mutations) {
      const explanation = fwExplain(commerceGraph, {
        kind: 'mutation',
        optimistic: true,
        target: mutation.key,
      });
      const statuses = optimisticStatuses(explanation.output);
      const affectedQueries = [...mutationUpdateConsumers(explanation.output).keys()];
      const mutationMatrix: Record<string, string> = {};
      matrix[mutation.key] = mutationMatrix;

      for (const query of commerceGraph.queries) {
        const queryInvalidators = invalidatedBy.get(query.query) ?? [];
        const invalidated = affectedQueries.includes(query.query);

        expect(queryInvalidators.includes(mutation.key)).toBe(invalidated);
        if (invalidated) {
          expect(statuses.get(query.query)).toBeDefined();
          expect(statuses.get(query.query)).not.toBe('UNHANDLED');
          mutationMatrix[query.query] = statuses.get(query.query) ?? 'missing';
        } else {
          expect(statuses.get(query.query)).toBeUndefined();
          mutationMatrix[query.query] = 'no-invalidation';
        }
      }
      expect(explainLine(explanation.output, 'OPTIMISTIC-SUMMARY ')).toContain('UNHANDLED=0');
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
    const affectedQueries = [...mutationUpdateConsumers(addToCartExplanation.output).keys()];
    const uploadReceiptAffectedQueries = [
      ...mutationUpdateConsumers(uploadReceiptExplanation.output).keys(),
    ];
    const statuses = optimisticStatuses(addToCartExplanation.output);
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
    expect(Object.fromEntries(statuses)).toEqual({
      cart: 'hand-written',
      orderHistory: 'await-fragment',
      productGrid: 'await-fragment',
    });
    expect(uploadReceiptAffectedQueries).toEqual([]);
    expect(explainLine(uploadReceiptExplanation.output, 'invalidates: ')).toBe('-');
    expect(explainLine(uploadReceiptExplanation.output, 'updates: ')).toBe('-');
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
        'FW-Targets': affectedQueries.map(fragmentTargetForQuery).join(','),
      },
    );

    expect(response).toMatchObject({
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 200,
    });
    expect(queryChunkNames(response.body).sort((a, b) => a.localeCompare(b))).toEqual(
      [...affectedQueries].sort((a, b) => a.localeCompare(b)),
    );
    for (const query of affectedQueries) {
      expect(response.body).toContain(`<fw-fragment target="${fragmentTargetForQuery(query)}">`);
    }
    expect(response.body).toContain('fw-key="order-2"');
  });
});
