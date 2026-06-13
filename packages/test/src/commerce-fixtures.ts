import { createJisoTestHarness } from './harness.js';
import {
  fwExplainListField,
  fwExplainOptimisticStatuses,
  fwExplainUpdateConsumerMap,
  fwExplainUpdateConsumers,
  type FwExplainResultLike,
  type FwExplainUpdateConsumerFact,
} from './fw-explain-fixtures.js';
import { graphFragmentTargetForQuery, type JisoGraphFixture } from './graph-fixtures.js';
import { fwResponseBodyFact } from './html-fragment.js';
import type { DbVerificationDiagnostic } from './verifier-diagnostics.js';

export interface CommerceFixtureFile {
  arrayBuffer(): Promise<ArrayBuffer>;
  name: string;
  size: number;
  type: string;
}

export interface CommerceMutationQueryAcceptanceOptions<Db, Graph extends JisoGraphFixture> {
  addToCart: unknown;
  commerceCsrf: unknown;
  commerceCsrfInput: (input: unknown, request: any) => unknown;
  commerceTouchGraph: Record<string, unknown>;
  createDb: () => Db;
  fwExplain: (
    graph: Graph,
    options: { kind: 'mutation'; optimistic?: boolean; target: string },
  ) => FwExplainResultLike;
  graph: Graph;
  receiptFile?: CommerceFixtureFile;
  submitAddToCart: (
    input: unknown,
    request: any,
    headers: any,
  ) => Promise<{ body: string; headers: Record<string, unknown>; status: number }>;
  uploadReceipt: unknown;
}

export interface CommerceMutationQueryAcceptanceFact {
  addToCart: {
    diagnostics: readonly DbVerificationDiagnostic[];
    result: Record<string, unknown>;
    updateQueries: string[];
  };
  fragmentResponse: {
    expectedFragmentTargets: string[];
    fragmentTargets: string[];
    headers: Record<string, unknown>;
    keyValues: string[];
    queryNames: string[];
    status: number;
  };
  optimisticStatuses: Record<string, string>;
  uploadReceipt: {
    diagnostics: readonly DbVerificationDiagnostic[];
    invalidates: string[];
    result: Record<string, unknown>;
    updateConsumers: FwExplainUpdateConsumerFact[];
    updateQueries: string[];
  };
}

export async function commerceMutationQueryAcceptanceFact<Db, Graph extends JisoGraphFixture>(
  options: CommerceMutationQueryAcceptanceOptions<Db, Graph>,
): Promise<CommerceMutationQueryAcceptanceFact> {
  // SPEC.md §10.4/§11.2/§16.5: commerce mutation/query acceptance is proven
  // through public graph explanations, harness verification, and fragment wire facts.
  const addToCartExplanation = options.fwExplain(options.graph, {
    kind: 'mutation',
    optimistic: true,
    target: 'cart/add',
  });
  const uploadReceiptExplanation = options.fwExplain(options.graph, {
    kind: 'mutation',
    optimistic: true,
    target: 'order/receipt',
  });
  const addToCartUpdateQueries = [
    ...fwExplainUpdateConsumerMap(addToCartExplanation.output).keys(),
  ];
  const uploadReceiptUpdateQueries = [
    ...fwExplainUpdateConsumerMap(uploadReceiptExplanation.output).keys(),
  ];
  const optimisticStatuses = fwExplainOptimisticStatuses(addToCartExplanation.output);

  const db = options.createDb();
  const harness = createJisoTestHarness({
    db,
    request: {
      session: { id: 's-commerce-acceptance', user: { id: 'u1' } },
    },
    touchGraph: { 'cart.addItem': options.commerceTouchGraph['cart.addItem'] } as never,
    verification: {
      domainByTable: {
        cart_items: 'cart',
        orders: 'order',
        products: 'product',
      },
    },
  });
  const verifiedDb = harness.dbHandle() as Db & {
    transaction?: (run: (db: unknown) => unknown) => unknown;
  };
  verifiedDb.transaction = (run) => run(verifiedDb);

  const receiptHarness = createJisoTestHarness({
    db: options.createDb(),
    request: {
      session: { id: 's-commerce-receipt', user: { id: 'u1' } },
    },
    touchGraph: { 'order.receipt': options.commerceTouchGraph['order.receipt'] } as never,
    verification: {
      domainByTable: {
        attachments: 'attachment',
        cart_items: 'cart',
        orders: 'order',
        products: 'product',
      },
    },
  });
  const receiptFile =
    options.receiptFile ??
    ({
      async arrayBuffer() {
        return new ArrayBuffer(2048);
      },
      name: 'receipt.pdf',
      size: 2048,
      type: 'application/pdf',
    } satisfies CommerceFixtureFile);

  const addToCartResult = await harness.exec(
    options.addToCart as never,
    options.commerceCsrfInput(
      { productId: 'p1', quantity: 2 },
      { db: verifiedDb, session: { id: 's-commerce-acceptance', user: { id: 'u1' } } },
    ),
    { touchGraphKey: 'cart.addItem' },
  );
  const uploadReceiptResult = await receiptHarness.exec(
    options.uploadReceipt as never,
    options.commerceCsrfInput(
      {
        orderId: 'order-1',
        receipt: receiptFile,
      },
      {
        db: receiptHarness.dbHandle(),
        session: { id: 's-commerce-receipt', user: { id: 'u1' } },
      },
    ),
    { csrf: options.commerceCsrf as never, touchGraphKey: 'order.receipt' },
  );
  const response = await options.submitAddToCart(
    { productId: 'p2', quantity: 1 },
    { db: verifiedDb, session: { id: 's-commerce-acceptance-2', user: { id: 'u1' } } },
    {
      'FW-Fragment': 'true',
      'FW-Targets': addToCartUpdateQueries
        .map((query) => graphFragmentTargetForQuery(options.graph, query))
        .join(','),
    },
  );
  const responseFact = fwResponseBodyFact(response.body);

  return {
    addToCart: {
      diagnostics: harness.verificationDiagnostics(),
      result: addToCartResult as unknown as Record<string, unknown>,
      updateQueries: addToCartUpdateQueries,
    },
    fragmentResponse: {
      expectedFragmentTargets: addToCartUpdateQueries
        .map((query) => graphFragmentTargetForQuery(options.graph, query))
        .sort((left, right) => left.localeCompare(right)),
      fragmentTargets: responseFact.fragmentTargets.sort((left, right) =>
        left.localeCompare(right),
      ),
      headers: response.headers,
      keyValues: responseFact.keyValues,
      queryNames: responseFact.queryNames.sort((left, right) => left.localeCompare(right)),
      status: response.status,
    },
    optimisticStatuses,
    uploadReceipt: {
      diagnostics: receiptHarness.verificationDiagnostics(),
      invalidates: fwExplainListField(uploadReceiptExplanation.output, 'invalidates'),
      result: uploadReceiptResult as unknown as Record<string, unknown>,
      updateConsumers: fwExplainUpdateConsumers(uploadReceiptExplanation.output),
      updateQueries: uploadReceiptUpdateQueries,
    },
  };
}
