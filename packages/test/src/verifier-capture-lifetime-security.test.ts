import { describe, expect, it } from 'vitest';

import { domain, mutation, query, s } from '@kovojs/server';

import { createKovoTestHarness } from './harness.js';
import { createFakeDb, createVerifiedFakeHarness, deferred, type FakeDb } from './test-fixtures.js';
import { createDbVerifier } from './verifier.js';

const drizzleTableName = Symbol.for('drizzle:Name');

function table(name: string): { [drizzleTableName]: string } {
  return { [drizzleTableName]: name };
}

describe('@kovojs/test capture lifetime security', () => {
  it('revokes verifier DB authority after a captured handler settles', async () => {
    let adapterCalls = 0;
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verifier = createDbVerifier(
      {},
      { domainByTable: { audit_log: 'audit' } },
      {
        recordOutsideCapture: false,
      },
    );
    const db = verifier.wrap({
      write() {
        adapterCalls += 1;
      },
    });
    let lateWrite!: Promise<void>;

    const captured = await verifier.capture(() => {
      lateWrite = deferred.then(() => {
        db.write('audit_log');
      });
    });
    expect(captured.observed).toEqual([]);
    expect(() => verifier.assertCoveredOperations(captured.observed)).not.toThrow();

    release();
    await expect(lateWrite).rejects.toThrow(/KV407.*capture.*settled/u);
    expect(adapterCalls).toBe(0);
  });

  it('keeps awaited work active and revokes only the scope that settled', async () => {
    const firstGate = deferred();
    const secondGate = deferred();
    const verifier = createDbVerifier(
      {},
      { domainByTable: { audit_log: 'audit', products: 'product' } },
      { recordOutsideCapture: false },
    );
    const adapterCalls: string[] = [];
    const db = verifier.wrap({
      write(tableName: string) {
        adapterCalls.push(tableName);
      },
    });
    let detachedFirst!: Promise<void>;

    const settledFirst = await verifier.capture(() => {
      detachedFirst = firstGate.promise.then(() => db.write('audit_log'));
    });
    const pendingSecond = verifier.capture(async () => {
      await secondGate.promise;
      db.write('products');
      return 'awaited';
    });

    firstGate.resolve();
    await expect(detachedFirst).rejects.toThrow(/KV407.*capture.*settled/u);
    secondGate.resolve();
    await expect(pendingSecond).resolves.toMatchObject({
      observed: [expect.objectContaining({ kind: 'write', table: 'products' })],
      result: 'awaited',
    });
    expect(settledFirst.observed).toEqual([]);
    expect(adapterCalls).toEqual(['products']);
  });

  it('revokes detached work when a captured handler rejects', async () => {
    const gate = deferred();
    const handlerError = new Error('handler failed');
    let adapterCalls = 0;
    const verifier = createDbVerifier(
      {},
      { domainByTable: { audit_log: 'audit' } },
      { recordOutsideCapture: false },
    );
    const db = verifier.wrap({
      write() {
        adapterCalls += 1;
      },
    });
    let detached!: Promise<void>;

    await expect(
      verifier.capture(() => {
        detached = gate.promise.then(() => db.write('audit_log'));
        throw handlerError;
      }),
    ).rejects.toBe(handlerError);

    gate.resolve();
    await expect(detached).rejects.toThrow(/KV407.*capture.*settled/u);
    expect(adapterCalls).toBe(0);
  });

  it('stops delayed SQL after its row probe and delayed transactions before BEGIN', async () => {
    const sqlDiscovery = deferred<unknown>();
    const sqlCalls: string[] = [];
    const sqlVerifier = createDbVerifier(
      {},
      { domainByTable: { audit_log: 'audit' } },
      { recordOutsideCapture: false },
    );
    const sqlDb = sqlVerifier.wrap({
      async query(statement: string) {
        sqlCalls.push(statement);
        if (statement.includes('information_schema')) return sqlDiscovery.promise;
        return [];
      },
    });
    let delayedSql!: Promise<unknown>;

    const capturedSql = await sqlVerifier.capture(() => {
      delayedSql = sqlDb.query('delete from audit_log where id = 1');
    });
    expect(capturedSql.observed).toEqual([
      expect.objectContaining({ kind: 'write', table: 'audit_log' }),
    ]);
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0]).toContain('information_schema');

    sqlDiscovery.resolve([]);
    await expect(delayedSql).rejects.toThrow(/KV407.*capture.*settled/u);
    expect(sqlCalls).toHaveLength(1);

    const transactionDiscovery = deferred<unknown>();
    let transactionCalls = 0;
    const transactionVerifier = createDbVerifier(
      {},
      { domainByTable: { audit_log: 'audit' } },
      { recordOutsideCapture: false },
    );
    const transactionDb = transactionVerifier.wrap({
      pglite: {
        async query(statement: string) {
          if (statement.includes('information_schema')) return transactionDiscovery.promise;
          return [];
        },
        async transaction(callback: (tx: object) => unknown) {
          transactionCalls += 1;
          return callback({});
        },
      },
    });
    let delayedTransaction!: Promise<unknown>;

    await transactionVerifier.capture(() => {
      delayedTransaction = transactionDb.pglite.transaction(() => undefined);
    });
    transactionDiscovery.resolve([]);

    await expect(delayedTransaction).rejects.toThrow(/KV407.*capture.*settled/u);
    expect(transactionCalls).toBe(0);
  });

  it('revokes retained prepared, read-builder, write-builder, and nested handles', async () => {
    const gate = deferred();
    const products = table('products');
    const auditLog = table('audit_log');
    let preparedExecutes = 0;
    let readExecutes = 0;
    let writeExecutes = 0;
    let nestedCloses = 0;
    const readBuilder = {
      execute() {
        readExecutes += 1;
        return [];
      },
      from() {
        return this;
      },
    };
    const writeBuilder = {
      execute() {
        writeExecutes += 1;
      },
      values() {
        return this;
      },
    };
    const verifier = createDbVerifier(
      {},
      { domainByTable: { audit_log: 'audit', products: 'product' } },
      { recordOutsideCapture: false },
    );
    const db = verifier.wrap({
      insert() {
        return writeBuilder;
      },
      prepare() {
        return {
          execute() {
            preparedExecutes += 1;
          },
        };
      },
      select() {
        return readBuilder;
      },
      session: {
        close() {
          nestedCloses += 1;
        },
      },
    });
    let delayedPrepared!: Promise<unknown>;
    let delayedRead!: Promise<unknown>;
    let delayedWrite!: Promise<unknown>;
    let delayedNested!: Promise<unknown>;

    const captured = await verifier.capture(() => {
      const executePrepared = db.prepare('delete from audit_log').execute;
      const executeRead = db.select().from(products).execute;
      const executeWrite = db.insert(auditLog).values({ id: 'event-1' }).execute;
      const closeNested = db.session.close;
      delayedPrepared = gate.promise.then(() => executePrepared());
      delayedRead = gate.promise.then(() => executeRead());
      delayedWrite = gate.promise.then(() => executeWrite());
      delayedNested = gate.promise.then(() => closeNested());
    });

    expect(captured.observed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'read', table: 'products' }),
        expect.objectContaining({ kind: 'write', table: 'audit_log' }),
      ]),
    );
    gate.resolve();
    await expect(delayedPrepared).rejects.toThrow(/KV407.*capture.*settled/u);
    await expect(delayedRead).rejects.toThrow(/KV407.*capture.*settled/u);
    await expect(delayedWrite).rejects.toThrow(/KV407.*capture.*settled/u);
    await expect(delayedNested).rejects.toThrow(/KV407.*capture.*settled/u);
    expect({ nestedCloses, preparedExecutes, readExecutes, writeExecutes }).toEqual({
      nestedCloses: 0,
      preparedExecutes: 0,
      readExecutes: 0,
      writeExecutes: 0,
    });
  });

  it('revokes mutation handler descendants after harness verification', async () => {
    const gate = deferred();
    const rawDb = createFakeDb();
    let detached!: Promise<void>;
    const lateMutation = mutation('audit/late', {
      csrf: false,
      input: s.object({ id: s.string() }),
      handler(input, request: { db: FakeDb }) {
        detached = gate.promise.then(() => request.db.write('audit_log', input.id));
        return input.id;
      },
    });
    const harness = createVerifiedFakeHarness({
      db: rawDb,
      touchGraph: {},
      verification: { domainByTable: { audit_log: 'audit' } },
    });

    await expect(harness.exec(lateMutation, { id: 'event-1' })).resolves.toMatchObject({
      ok: true,
      value: 'event-1',
    });
    gate.resolve();

    await expect(detached).rejects.toThrow(/KV407.*capture.*settled/u);
    expect(rawDb.read('audit_log')).toEqual([]);
  });

  it('revokes a handler-retained DB closure even when it is called from a fresh context', async () => {
    const rawDb = createFakeDb();
    let retainedWrite!: () => void;
    const lateMutation = mutation('audit/retain', {
      csrf: false,
      input: s.object({ id: s.string() }),
      handler(input, request: { db: FakeDb }) {
        retainedWrite = () => request.db.write('audit_log', input.id);
        return input.id;
      },
    });
    const harness = createVerifiedFakeHarness({
      db: rawDb,
      touchGraph: {},
      verification: { domainByTable: { audit_log: 'audit' } },
    });

    await expect(harness.exec(lateMutation, { id: 'event-1' })).resolves.toMatchObject({
      ok: true,
      value: 'event-1',
    });

    expect(retainedWrite).toThrow(/KV407.*capture.*settled/u);
    expect(rawDb.read('audit_log')).toEqual([]);
  });

  it('binds a directly captured DB method to its verifier epoch', async () => {
    let adapterCalls = 0;
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const db = verifier.wrap({
      write() {
        adapterCalls += 1;
      },
    });
    let retainedWrite!: () => void;

    await verifier.capture(() => {
      retainedWrite = db.write;
    });

    expect(retainedWrite).toThrow(/KV407.*capture.*settled/u);
    expect(adapterCalls).toBe(0);
  });

  it('binds retained nested and prepared handles to the capture that exposed them', async () => {
    let nestedCalls = 0;
    let preparedCalls = 0;
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const db = verifier.wrap({
      prepare() {
        return {
          execute() {
            preparedCalls += 1;
          },
        };
      },
      session: {
        close() {
          nestedCalls += 1;
        },
      },
    });
    let retainedNested!: () => void;
    let retainedPrepared!: () => void;

    await verifier.capture(() => {
      const scopedDb = verifier.bindAuthority(db);
      const prepared = scopedDb.prepare('delete from audit_log');
      const session = scopedDb.session;
      retainedPrepared = () => prepared.execute();
      retainedNested = () => session.close();
    });

    expect(retainedPrepared).toThrow(/KV407.*capture.*settled/u);
    expect(retainedNested).toThrow(/KV407.*capture.*settled/u);
    expect({ nestedCalls, preparedCalls }).toEqual({ nestedCalls: 0, preparedCalls: 0 });
  });

  it('revokes query loader descendants after read verification', async () => {
    const gate = deferred();
    let readCalls = 0;
    let detached!: Promise<unknown>;
    const rawDb: FakeDb = {
      read() {
        readCalls += 1;
        return [];
      },
      sql() {
        return [];
      },
      write() {},
    };
    const product = domain('product');
    const lateQuery = query('product/late', {
      load(_input, context: { db: FakeDb }) {
        detached = gate.promise.then(() => context.db.read('products'));
        return 'ready';
      },
      reads: [product],
    });
    const harness = createVerifiedFakeHarness({
      db: rawDb,
      touchGraph: {},
      verification: { domainByTable: { products: 'product' } },
    });

    await expect(harness.query(lateQuery)).resolves.toBe('ready');
    gate.resolve();

    await expect(detached).rejects.toThrow(/KV407.*capture.*settled/u);
    expect(readCalls).toBe(0);
  });

  it('revokes query and page DB closures invoked from a fresh context', async () => {
    const rawDb = createFakeDb();
    let retainedPageRead!: () => unknown;
    let retainedQueryRead!: () => unknown;
    const product = domain('product');
    const lateQuery = query('product/retain', {
      load(_input, context: { db: FakeDb }) {
        retainedQueryRead = () => context.db.read('products');
        return 'ready';
      },
      reads: [product],
    });
    const harness = createKovoTestHarness({
      db: rawDb,
      pages: {
        '/products': {
          reads: ['product'],
          render({ db }) {
            retainedPageRead = () => db.read('products');
            return '<main>ready</main>';
          },
        },
      },
      touchGraph: {},
      verification: { domainByTable: { products: 'product' } },
    });

    await expect(harness.query(lateQuery)).resolves.toBe('ready');
    await expect(harness.page('/products')).resolves.toMatchObject({ html: '<main>ready</main>' });

    expect(retainedQueryRead).toThrow(/KV407.*capture.*settled/u);
    expect(retainedPageRead).toThrow(/KV407.*capture.*settled/u);
  });

  it('revokes route-page render descendants after page verification', async () => {
    const gate = deferred();
    let readCalls = 0;
    let detached!: Promise<unknown>;
    const rawDb: FakeDb = {
      read() {
        readCalls += 1;
        return [];
      },
      sql() {
        return [];
      },
      write() {},
    };
    const harness = createKovoTestHarness({
      db: rawDb,
      pages: {
        '/products': {
          reads: ['product'],
          render({ db }) {
            detached = gate.promise.then(() => db.read('products'));
            return '<main>ready</main>';
          },
        },
      },
      touchGraph: {},
      verification: { domainByTable: { products: 'product' } },
    });

    await expect(harness.page('/products')).resolves.toMatchObject({ html: '<main>ready</main>' });
    gate.resolve();

    await expect(detached).rejects.toThrow(/KV407.*capture.*settled/u);
    expect(readCalls).toBe(0);
  });
});
