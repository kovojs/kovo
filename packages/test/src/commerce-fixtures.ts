import { createKovoTestHarness } from './harness.js';
import {
  kovoExplainListField,
  kovoExplainOptimisticStatuses,
  kovoExplainUpdateConsumerMap,
  kovoExplainUpdateConsumers,
  type KovoExplainResultLike,
  type KovoExplainUpdateConsumerFact,
} from './kovo-explain-fixtures.js';
import { graphFragmentTargetForQuery, type KovoGraphFixture } from './graph-fixtures.js';
import { kovoResponseBodyFact } from './html-fragment.js';
import type { QueryDefinition } from '@kovojs/server';
import type { DbVerificationDiagnostic } from './verifier-diagnostics.js';

export interface CommerceFixtureFile {
  arrayBuffer(): Promise<ArrayBuffer>;
  name: string;
  size: number;
  type: string;
}

export interface CommerceMutationQueryAcceptanceOptions<Db, Graph extends KovoGraphFixture> {
  addToCart: unknown;
  commerceCsrf: unknown;
  commerceCsrfInput: (input: unknown, request: any) => unknown;
  commerceTouchGraph: Record<string, unknown>;
  createDb: () => Db;
  kovoExplain: (
    graph: Graph,
    options: { kind: 'mutation'; optimistic?: boolean; target: string },
  ) => KovoExplainResultLike;
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
    updateConsumers: KovoExplainUpdateConsumerFact[];
    updateQueries: string[];
  };
}

export interface CommerceUpdateIntentOptions<Graph> {
  kovoExplain: (
    graph: Graph,
    options:
      | { kind: 'mutation'; optimistic?: boolean; target: string }
      | { kind: 'page'; target: string }
      | { kind: 'query'; target: string },
  ) => KovoExplainResultLike;
  graph: Graph;
  mutation: string;
  page: string;
}

export interface CommerceUpdateIntentFact {
  componentConsumersByQuery: Record<string, string[]>;
  missingComponentConsumers: string[];
  missingPageConsumers: string[];
  page: string;
  pageQueries: string[];
  updateConsumersByQuery: Record<string, string[]>;
}

export interface CommerceHarnessQueryFact {
  diagnostics: readonly DbVerificationDiagnostic[];
  input: unknown;
  result: unknown;
}

export interface CommerceDeclaredQueryFact {
  diagnostics: readonly DbVerificationDiagnostic[];
  result: unknown;
}

export type CommerceDeclaredQueriesHarnessFact<QueryName extends string = string> = Record<
  QueryName,
  CommerceDeclaredQueryFact
>;

export interface CommerceDeclaredQueriesHarnessOptions<Db, QueryName extends string = string> {
  createDb: () => Db;
  inputs?: Partial<Record<QueryName, unknown>>;
  queries: Record<QueryName, QueryDefinition>;
  request?: Record<string, unknown>;
  setupDb?: (db: Db) => void | Promise<void>;
  verification?: {
    domainByTable: Record<string, string>;
  };
}

export interface CommerceHarnessQueryOptions<Db> {
  createDb: () => Db;
  input?: unknown;
  query: QueryDefinition;
  request?: Record<string, unknown>;
  setupDb?: (db: Db) => void | Promise<void>;
  verification?: {
    domainByTable: Record<string, string>;
  };
}

export async function commerceDeclaredQueriesHarnessFact<Db, QueryName extends string = string>(
  options: CommerceDeclaredQueriesHarnessOptions<Db, QueryName>,
): Promise<CommerceDeclaredQueriesHarnessFact<QueryName>> {
  // SPEC.md §11.2: declared commerce query acceptance runs through the public
  // harness DB seam and keeps verifier diagnostics attached to each observed query.
  const db = options.createDb();
  await options.setupDb?.(db);
  const harness = createKovoTestHarness({
    db,
    touchGraph: {},
    ...(options.request === undefined ? {} : { request: options.request }),
    ...(options.verification === undefined ? {} : { verification: options.verification }),
  });
  const facts = {} as CommerceDeclaredQueriesHarnessFact<QueryName>;

  for (const [name, query] of Object.entries(options.queries) as [QueryName, QueryDefinition][]) {
    facts[name] = {
      diagnostics: [],
      result: await harness.query(query, options.inputs?.[name]),
    };
  }
  const diagnostics = harness.verificationDiagnostics();
  for (const name of Object.keys(options.queries) as QueryName[]) {
    facts[name] = { ...facts[name], diagnostics };
  }

  return facts;
}

export function commerceFixtureFile(name: string, type: string, size: number): CommerceFixtureFile {
  return {
    async arrayBuffer() {
      return new ArrayBuffer(size);
    },
    name,
    size,
    type,
  };
}

export function commerceUpdateIntentFact<Graph>(
  options: CommerceUpdateIntentOptions<Graph>,
): CommerceUpdateIntentFact {
  // SPEC.md §10.4/§16.5: mutation update intent must mechanically cover every
  // query consumer affected on the page instead of relying on duplicated test logic.
  const mutation = options.kovoExplain(options.graph, {
    kind: 'mutation',
    target: options.mutation,
  });
  const page = options.kovoExplain(options.graph, { kind: 'page', target: options.page });
  const updateConsumers = kovoExplainUpdateConsumerMap(mutation.output);
  const pageQueries = kovoExplainListField(page.output, 'queries');
  const componentConsumersByQuery: Record<string, string[]> = {};
  const updateConsumersByQuery: Record<string, string[]> = {};
  const missingComponentConsumers: string[] = [];
  const missingPageConsumers: string[] = [];

  for (const query of pageQueries) {
    const queryExplain = options.kovoExplain(options.graph, { kind: 'query', target: query });
    const queryConsumers = kovoExplainListField(queryExplain.output, 'consumers');
    const componentConsumers = queryConsumers.filter((consumer) =>
      consumer.startsWith('component:'),
    );
    const updates = updateConsumers.get(query) ?? [];

    componentConsumersByQuery[query] = componentConsumers;
    updateConsumersByQuery[query] = updates;

    for (const consumer of componentConsumers) {
      if (!updates.includes(consumer)) {
        missingComponentConsumers.push(`${query}:${consumer}`);
      }
    }
    if (
      queryConsumers.includes(`page:${options.page}`) &&
      !updates.includes(`page:${options.page}`)
    ) {
      missingPageConsumers.push(query);
    }
  }

  return {
    componentConsumersByQuery,
    missingComponentConsumers,
    missingPageConsumers,
    page: options.page,
    pageQueries,
    updateConsumersByQuery,
  };
}

export async function commerceHarnessQueryFact<Db>(
  options: CommerceHarnessQueryOptions<Db>,
): Promise<CommerceHarnessQueryFact> {
  // SPEC.md §11.2: query source-truth tests exercise loaders through the public
  // harness DB seam so runtime read verification remains observable.
  const db = options.createDb();
  await options.setupDb?.(db);
  const harnessOptions = {
    db,
    touchGraph: {},
    ...(options.request === undefined ? {} : { request: options.request }),
    ...(options.verification === undefined ? {} : { verification: options.verification }),
  };
  const harness = createKovoTestHarness(harnessOptions);
  const result = await harness.query(options.query, options.input);

  return {
    diagnostics: harness.verificationDiagnostics(),
    input: options.input,
    result,
  };
}

export async function commerceMutationQueryAcceptanceFact<Db, Graph extends KovoGraphFixture>(
  options: CommerceMutationQueryAcceptanceOptions<Db, Graph>,
): Promise<CommerceMutationQueryAcceptanceFact> {
  // SPEC.md §10.4/§11.2/§16.5: commerce mutation/query acceptance is proven
  // through public graph explanations, harness verification, and fragment wire facts.
  const addToCartExplanation = options.kovoExplain(options.graph, {
    kind: 'mutation',
    optimistic: true,
    target: 'cart/add',
  });
  const uploadReceiptExplanation = options.kovoExplain(options.graph, {
    kind: 'mutation',
    optimistic: true,
    target: 'order/receipt',
  });
  const addToCartUpdateQueries = [
    ...kovoExplainUpdateConsumerMap(addToCartExplanation.output).keys(),
  ];
  const uploadReceiptUpdateQueries = [
    ...kovoExplainUpdateConsumerMap(uploadReceiptExplanation.output).keys(),
  ];
  const optimisticStatuses = kovoExplainOptimisticStatuses(addToCartExplanation.output);

  const db = options.createDb();
  const harness = createKovoTestHarness({
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

  const receiptHarness = createKovoTestHarness({
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
    options.receiptFile ?? commerceFixtureFile('receipt.pdf', 'application/pdf', 2048);

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
      'Kovo-Fragment': 'true',
      'Kovo-Targets': addToCartUpdateQueries
        .map((query) => graphFragmentTargetForQuery(options.graph, query))
        .join(','),
    },
  );
  const responseFact = kovoResponseBodyFact(response.body);

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
      invalidates: kovoExplainListField(uploadReceiptExplanation.output, 'invalidates'),
      result: uploadReceiptResult as unknown as Record<string, unknown>,
      updateConsumers: kovoExplainUpdateConsumers(uploadReceiptExplanation.output),
      updateQueries: uploadReceiptUpdateQueries,
    },
  };
}
