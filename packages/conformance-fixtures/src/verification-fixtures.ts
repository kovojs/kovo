import { kovoCheckAssertionFact, type KovoCheckAssertionFact } from './kovo-check-fixtures.ts';

export interface VerificationLayerRuntime {
  createDbVerifier: (...args: any[]) => any;
  createKovoTestHarness: (...args: any[]) => any;
  csrfField: (...args: any[]) => string;
  csrfToken: (...args: any[]) => string;
  domain: (...args: any[]) => any;
  diagnosticDefinitions: Record<string, { message: string }>;
  mutation: (...args: any[]) => any;
  query: (...args: any[]) => any;
  s: any;
}

export interface VerificationLayerKovoCheckDiagnosticsRuntime {
  diagnosticDefinitions: Record<string, { message: string }>;
  kovoCheck(graph: Record<string, unknown>): { exitCode: number; output: string };
}

export interface VerificationLayerBehaviorFact {
  csrf: {
    invalidResult: unknown;
    mutationExecutions: number;
    tokenMatchesField: boolean;
    validResult: unknown;
  };
  diagnosticMessages: Record<string, string>;
  harness: {
    validOutputQuery: unknown;
    writeMutation: unknown;
  };
  failures: Record<string, string>;
  pglite: {
    rawMutationFailure: string;
    transactionFailure: string;
  };
  sqlite: {
    libsqlRowKey: string | undefined;
    mutationReadCovered: boolean;
    preparedStatementObserved: unknown;
    writeCovered: boolean;
  };
  sql: {
    compoundRowKeyCovered: boolean;
    nestedUpdateCovered: boolean;
    nestedUpdateReadsCovered: boolean;
    selectSubqueryCoveredWithBothDomains: boolean;
    structuredStatementForwarded: boolean;
    structuredStatementObserved: unknown;
  };
  verifier: {
    exemptWriteCovered: boolean;
  };
}

export interface VerificationLayerKovoCheckDiagnosticsFact {
  exemptTableDiagnostic: KovoCheckAssertionFact;
  verificationDiagnosticMessages: Record<string, string>;
  verificationDiagnostics: KovoCheckAssertionFact;
}

interface FakeDb {
  read(table: string, options?: unknown): unknown[];
  sql(statement: string, ...args: unknown[]): unknown[];
  write(table: string, value: unknown, options?: unknown): void;
}

export function createVerificationFakeDb(): FakeDb {
  const tables = new Map<string, unknown[]>();

  return {
    read(table, options) {
      void options;
      return tables.get(table) ?? [];
    },
    sql() {
      return [];
    },
    write(table, value, options) {
      void options;
      tables.set(table, [...(tables.get(table) ?? []), value]);
    },
  };
}

export async function verificationLayerBehaviorFact(
  runtime: VerificationLayerRuntime,
): Promise<VerificationLayerBehaviorFact> {
  const failures: Record<string, string> = {};
  const {
    createDbVerifier,
    createKovoTestHarness,
    csrfField,
    csrfToken,
    diagnosticDefinitions,
    domain,
    mutation,
    query,
    s,
  } = runtime;

  const diagnosticMessages = Object.fromEntries(
    ['KV402', 'KV404', 'KV407', 'KV408', 'KV410', 'KV411'].map((code) => [
      code,
      diagnosticDefinitions[code]?.message ?? '',
    ]),
  );

  const csrfRequest = { session: { id: 's1' } };
  const csrf = {
    field: 'csrf',
    secret: 'test-secret',
    sessionId(request: { session: { id: string } }) {
      return request.session.id;
    },
  };
  let csrfMutationExecutions = 0;
  const csrfMutation = mutation('cart/add', {
    csrf,
    input: s.object({ csrf: s.string(), productId: s.string() }),
    handler(input: { productId: string }) {
      csrfMutationExecutions += 1;
      return input.productId;
    },
  });
  const csrfHarness = createKovoTestHarness({ db: {}, request: csrfRequest });
  const token = csrfToken(csrfRequest, csrf);
  const field = csrfField(csrfRequest, csrf);
  const validResult = await csrfHarness.exec(csrfMutation, { csrf: token, productId: 'p1' });
  const invalidResult = await csrfHarness.exec(csrfMutation, { csrf: 'wrong', productId: 'p2' });

  const writeMutation = mutation('cart/add', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    handler(input: { productId: string }, request: { db: FakeDb }) {
      request.db.write('cart_items', input.productId);
      return input.productId;
    },
  });
  const writeHarness = createKovoTestHarness({
    db: createVerificationFakeDb(),
    touchGraph: {
      'cart.add': {
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
        unresolved: [],
      },
    },
    verification: { domainByTable: { audit_log: 'audit', cart_items: 'cart' } },
  });
  const writeMutationResult = await writeHarness.exec(
    writeMutation,
    { productId: 'p1' },
    {
      touchGraphKey: 'cart.add',
    },
  );

  const writeOutsideGraph = mutation('cart/add', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    handler(input: { productId: string }, request: { db: FakeDb }) {
      request.db.write('audit_log', input.productId);
      return input.productId;
    },
  });
  failures.writeOutsideGraph = await rejectedMessage(
    writeHarness.exec(writeOutsideGraph, { productId: 'p1' }, { touchGraphKey: 'cart.add' }),
  );

  const unmappedVerifier = createDbVerifier(
    { write: { touches: [], unresolved: [] } },
    { domainByTable: {} },
  );
  const unmappedDb = unmappedVerifier.wrap(createVerificationFakeDb());
  unmappedDb.write('unknown_table', 'p1');
  failures.unmappedWrite = thrownMessage(() => unmappedVerifier.assertCovered('write'));

  const exemptWriteVerifier = createDbVerifier(
    {},
    { domainByTable: {}, exemptTables: ['audit_log'] },
  );
  const exemptWriteDb = exemptWriteVerifier.wrap(createVerificationFakeDb());
  exemptWriteDb.write('audit_log', { event: 'restock' });
  const exemptWriteCovered = doesNotThrow(() => exemptWriteVerifier.assertCovered());

  const exemptReadVerifier = createDbVerifier(
    {},
    { domainByTable: { cart_items: 'cart' }, exemptTables: ['audit_log'] },
  );
  const exemptReadDb = exemptReadVerifier.wrap(createVerificationFakeDb());
  exemptReadDb.read('audit_log');
  failures.exemptRead = thrownMessage(() => exemptReadVerifier.assertReadsCovered(['cart']));

  const cart = domain('cart');
  const product = domain('product');
  const queryHarness = createKovoTestHarness({
    db: createVerificationFakeDb(),
    touchGraph: {},
    verification: {
      domainByTable: { audit_log: 'audit', cart_items: 'cart', products: 'product' },
    },
  });
  const undeclaredReadQuery = query('cart', {
    load() {
      queryHarness.db.read('products');
      return queryHarness.db.read('cart_items');
    },
    reads: [cart],
  });
  failures.undeclaredRead = await rejectedMessage(queryHarness.query(undeclaredReadQuery));

  const validOutputQuery = query('cart/count', {
    load() {
      queryHarness.db.read('cart_items');
      return { count: 2 };
    },
    output: s.object({ count: s.number().int().min(0) }),
    reads: [cart],
  });
  const validOutputQueryResult = await queryHarness.query(validOutputQuery);

  const invalidOutputQuery = query('product/list', {
    load() {
      queryHarness.db.read('products');
      return { items: [{ id: 7 }] };
    },
    output: s.object({ items: s.array(s.object({ id: s.string() })) }),
    reads: [product],
  });
  failures.invalidOutput = await rejectedMessage(queryHarness.query(invalidOutputQuery));

  const exemptRawSqlHarness = createKovoTestHarness({
    db: createVerificationFakeDb(),
    touchGraph: {},
    verification: { domainByTable: { cart_items: 'cart' }, exemptTables: ['audit_log'] },
  });
  const exemptRawSqlQuery = query('cart/audit', {
    load() {
      exemptRawSqlHarness.db.sql('select * from audit_log');
      return [];
    },
    reads: [cart],
  });
  failures.exemptRawSql = await rejectedMessage(exemptRawSqlHarness.query(exemptRawSqlQuery));

  const structuredSqlVerifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
  const structuredStatementCalls: unknown[] = [];
  const structuredSqlDb = structuredSqlVerifier.wrap({
    exec(statement: unknown) {
      structuredStatementCalls.push(statement);
      return [];
    },
    query() {
      return [];
    },
  });
  const structuredStatement = { text: 'select * from cart_items', values: ['c1'] };
  structuredSqlDb.exec(structuredStatement);

  const nestedVerifier = createDbVerifier(
    {
      'product.syncPrice': {
        reads: [
          {
            domain: 'price',
            keys: null,
            site: 'product.ts:2',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [{ domain: 'product', keys: null, site: 'product.ts:1', via: 'products' }],
        unresolved: [],
      },
    },
    { domainByTable: { prices: 'price', products: 'product' } },
  );
  const nestedDb = nestedVerifier.wrap(createVerificationFakeDb());
  nestedDb.sql(
    'update products set price = prices.amount from prices where prices.product_id = products.id',
  );
  const nestedUpdateCovered = doesNotThrow(() => nestedVerifier.assertCovered('product.syncPrice'));
  const nestedUpdateReadsCovered = doesNotThrow(() => nestedVerifier.assertReadsCovered(['price']));

  const missingNestedReadVerifier = createDbVerifier(
    {
      'product.syncPrice': {
        touches: [{ domain: 'product', keys: null, site: 'product.ts:1', via: 'products' }],
        unresolved: [],
      },
    },
    { domainByTable: { prices: 'price', products: 'product' } },
  );
  const missingNestedReadDb = missingNestedReadVerifier.wrap(createVerificationFakeDb());
  missingNestedReadDb.sql(
    [
      'update products set unit_price = (select max(amount) from prices)',
      'where id in (select product_id from prices)',
    ].join(' '),
  );
  failures.missingNestedRead = thrownMessage(() =>
    missingNestedReadVerifier.assertCovered('product.syncPrice'),
  );

  const selectSubqueryVerifier = createDbVerifier(
    {},
    { domainByTable: { prices: 'price', products: 'product' } },
  );
  const selectSubqueryDb = selectSubqueryVerifier.wrap(createVerificationFakeDb());
  selectSubqueryDb.sql('select * from products where id in (select product_id from prices)');
  failures.selectSubqueryMissingRead = thrownMessage(() =>
    selectSubqueryVerifier.assertReadsCovered(['product']),
  );
  const selectSubqueryCoveredWithBothDomains = doesNotThrow(() =>
    selectSubqueryVerifier.assertReadsCovered(['product', 'price']),
  );

  const rowKeyVerifier = createDbVerifier(
    {
      'product.reserve': {
        touches: [
          { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
        ],
        unresolved: [],
      },
    },
    { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
  );
  const rowKeyDb = rowKeyVerifier.wrap(createVerificationFakeDb());
  rowKeyDb.sql("update products set reserved = true where sku = 'sku-1'");
  failures.rowKey = thrownMessage(() => rowKeyVerifier.assertCovered('product.reserve'));

  const compoundRowKeyVerifier = createDbVerifier(
    {
      'product.reserve': {
        touches: [
          { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
        ],
        unresolved: [],
      },
    },
    { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
  );
  const compoundRowKeyDb = compoundRowKeyVerifier.wrap(createVerificationFakeDb());
  compoundRowKeyDb.sql("update products set reserved = true where sku = 'sku-1' and id = 'p1'");
  const compoundRowKeyCovered = doesNotThrow(() =>
    compoundRowKeyVerifier.assertCovered('product.reserve'),
  );

  const pgliteHandle = {
    exec() {
      return [];
    },
    query() {
      return [];
    },
    transaction(callback: (tx: { exec(): unknown[]; query(): unknown[] }) => unknown) {
      return callback({
        exec() {
          return [];
        },
        query() {
          return [];
        },
      });
    },
  };
  const pgliteHarness = createKovoTestHarness({
    db: { pglite: pgliteHandle },
    touchGraph: {
      'cart.add': {
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
        unresolved: [],
      },
    },
    verification: { domainByTable: { audit_log: 'audit', cart_items: 'cart' } },
  });
  const rawPgliteMutation = mutation('cart/add', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    async handler(input: { productId: string }, request: { db: { pglite: any } }) {
      await request.db.pglite.query('insert into audit_log (product_id) values ($1)', [
        input.productId,
      ]);
      return input.productId;
    },
  });

  const sqliteVerifier = createDbVerifier(
    {
      'product.upsert': {
        reads: [
          {
            domain: 'price',
            keys: null,
            site: 'product.ts:2',
            source: 'sqlite-on-conflict',
            via: 'prices',
          },
        ],
        touches: [
          { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
        ],
        unresolved: [],
      },
    },
    {
      domainByTable: { prices: 'price', products: 'product' },
      sqlDialect: 'sqlite',
    },
  );
  const preparedRuns: unknown[][] = [];
  const sqliteDb = sqliteVerifier.wrap({
    sqlite: {
      exec() {
        return undefined;
      },
      prepare(statement: string) {
        return {
          run(...params: unknown[]) {
            preparedRuns.push([statement, ...params]);
            return { changes: 1 };
          },
        };
      },
    },
  });
  sqliteDb.sqlite
    .prepare(
      [
        'insert into products (id, price) values (?, ?)',
        'on conflict (id) do update set price = (',
        'select amount from prices where prices.product_id = products.id',
        ') returning id',
      ].join(' '),
    )
    .run('p1', 10);
  const sqliteWriteCovered = doesNotThrow(() => sqliteVerifier.assertCovered('product.upsert'));
  const sqliteMutationReadCovered = doesNotThrow(() => sqliteVerifier.assertReadsCovered(['price']));

  const libsqlVerifier = createDbVerifier(
    {},
    { domainByTable: { products: 'product' }, sqlDialect: 'sqlite' },
  );
  const libsqlDb = libsqlVerifier.wrap({
    client: {
      execute() {
        return { rows: [] };
      },
    },
  });
  libsqlDb.client.execute({ sql: 'select * from products where id = ?', args: ['p1'] });
  const transactionMutation = mutation('cart/add-transaction', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    async handler(input: { productId: string }, request: { db: { pglite: any } }) {
      await request.db.pglite.transaction(
        async (tx: { query: (...args: unknown[]) => unknown }) => {
          await tx.query('insert into audit_log (product_id) values ($1)', [input.productId]);
        },
      );
      return input.productId;
    },
  });

  return {
    csrf: {
      invalidResult,
      mutationExecutions: csrfMutationExecutions,
      tokenMatchesField: field === `<input type="hidden" name="csrf" value="${token}">`,
      validResult,
    },
    diagnosticMessages,
    failures,
    harness: {
      validOutputQuery: validOutputQueryResult,
      writeMutation: writeMutationResult,
    },
    pglite: {
      rawMutationFailure: await rejectedMessage(
        pgliteHarness.exec(rawPgliteMutation, { productId: 'p1' }, { touchGraphKey: 'cart.add' }),
      ),
      transactionFailure: await rejectedMessage(
        pgliteHarness.exec(
          transactionMutation,
          { productId: 'p2' },
          {
            touchGraphKey: 'cart.add',
          },
        ),
      ),
    },
    sqlite: {
      libsqlRowKey: libsqlVerifier.observed[0]?.rowKey,
      mutationReadCovered: sqliteMutationReadCovered,
      preparedStatementObserved: sqliteVerifier.observed,
      writeCovered: sqliteWriteCovered,
    },
    sql: {
      compoundRowKeyCovered,
      nestedUpdateCovered,
      nestedUpdateReadsCovered,
      selectSubqueryCoveredWithBothDomains,
      structuredStatementForwarded: structuredStatementCalls[0] === structuredStatement,
      structuredStatementObserved: structuredSqlVerifier.observed,
    },
    verifier: {
      exemptWriteCovered,
    },
  };
}

export function verificationLayerKovoCheckDiagnosticsFact(
  runtime: VerificationLayerKovoCheckDiagnosticsRuntime,
): VerificationLayerKovoCheckDiagnosticsFact {
  const verificationDiagnosticMessages = Object.fromEntries(
    ['KV402', 'KV403', 'KV404', 'KV405', 'KV407', 'KV408', 'KV410', 'KV411'].map((code) => [
      code,
      runtime.diagnosticDefinitions[code]?.message ?? '',
    ]),
  );

  return {
    exemptTableDiagnostic: kovoCheckAssertionFact(
      runtime.kovoCheck({
        diagnostics: [{ code: 'KV411', site: 'cart.queries.ts:9' }],
      }),
    ),
    verificationDiagnosticMessages,
    verificationDiagnostics: kovoCheckAssertionFact(
      runtime.kovoCheck({
        diagnostics: [
          {
            code: 'KV410',
            site: 'cart.queries.ts:5',
          },
          {
            code: 'KV302',
            message: 'data-bind path is not present in the declared query shape. cart.missing',
            site: 'cart-badge.tsx',
            start: { column: 23, line: 3 },
          },
        ],
        verificationDiagnostics: [
          {
            branch: 'stock-reserve',
            code: 'KV405',
            domain: 'product',
            site: 'cart.domain.ts:2',
          },
          {
            code: 'KV402',
            detail: 'observed table audit_log',
            domain: 'audit',
          },
          {
            code: 'KV403',
            domain: 'order',
          },
          {
            code: 'KV404',
            detail: 'observed table unknown_table',
            domain: 'unknown_table',
          },
          {
            code: 'KV407',
            detail: 'observed table products',
            domain: 'product',
            site: 'cart.queries.ts:7',
          },
          {
            code: 'KV408',
            detail: 'expected id observed sku',
            domain: 'product',
            site: 'product.domain.ts:9',
          },
          {
            code: 'KV410',
            detail: 'cart Expected number',
            domain: 'cart',
            site: 'cart.queries.ts:11',
          },
        ],
      }),
    ),
  };
}

function doesNotThrow(callback: () => unknown): boolean {
  callback();
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function rejectedMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return errorMessage(error);
  }
  throw new Error('Expected promise to reject.');
}

function thrownMessage(callback: () => unknown): string {
  try {
    callback();
  } catch (error) {
    return errorMessage(error);
  }
  throw new Error('Expected callback to throw.');
}
