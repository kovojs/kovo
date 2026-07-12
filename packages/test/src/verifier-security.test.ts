/* oxlint-disable typescript/unbound-method -- Adversarial tests deliberately replace late realm methods. */
import { AsyncLocalStorage } from 'node:async_hooks';

import { kovoDeclaredWriteDbHandle, kovoReadonlyDbHandle } from '@kovojs/server/internal/execution';
import { describe, expect, it } from 'vitest';

import { createFakeDb, expectedDiagnostic } from './test-fixtures.js';
import { assertOwnerRowsScoped, assertOwnerWritesScoped, createDbVerifier } from './verifier.js';
import { registerFrameworkSqlSnapshotter } from './verifier-snapshots.js';

const nativeReflectApply = Reflect.apply;

describe('@kovojs/test verifier shared-realm security', () => {
  it('C124 keeps wrapping when global Proxy is replaced during wrap()', () => {
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const raw = createFakeDb();
    const NativeProxy = globalThis.Proxy;
    let db: typeof raw;
    try {
      globalThis.Proxy = class BypassProxy {
        constructor(target: object) {
          return target;
        }
      } as unknown as ProxyConstructor;
      db = verifier.wrap(raw);
    } finally {
      globalThis.Proxy = NativeProxy;
    }

    db.write('audit_log', 'p1');
    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C125 never exposes the mutable recorder through observed or __kovoObserved', () => {
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const db = verifier.wrap(createFakeDb()) as ReturnType<typeof createFakeDb> & {
      __kovoObserved: unknown[];
    };
    db.write('audit_log', 'p1');

    expect(() => {
      (verifier.observed as unknown[]).length = 0;
    }).toThrow();
    expect(() => {
      db.__kovoObserved.length = 0;
    }).toThrow();
    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C126 snapshots caller touch graphs and verification config at construction', () => {
    const touchGraph: Record<string, never> = {};
    const config = { domainByTable: { audit_log: 'audit' } };
    const verifier = createDbVerifier(touchGraph, config);
    const db = verifier.wrap(createFakeDb());
    db.write('audit_log', 'p1');

    (touchGraph as Record<string, unknown>)['audit.allow'] = {
      touches: [{ domain: 'audit', keys: null, site: 'late.ts:1', via: 'audit_log' }],
      unresolved: [],
    };
    config.domainByTable.audit_log = 'cart';

    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C126 rejects inherited, accessor-backed, and sparse policy carriers', () => {
    const inheritedConfig = Object.create({ domainByTable: { audit_log: 'audit' } }) as {
      domainByTable: Record<string, string>;
    };
    expect(() => createDbVerifier({}, inheritedConfig)).toThrow(/domainByTable.*own data/);

    const getterConfig = Object.defineProperty({}, 'domainByTable', {
      enumerable: true,
      get: () => ({ audit_log: 'audit' }),
    }) as { domainByTable: Record<string, string> };
    expect(() => createDbVerifier({}, getterConfig)).toThrow(/own data property/);

    const touches = new Array(1) as unknown as [];
    expect(() =>
      createDbVerifier(
        { broken: { touches, unresolved: [] } },
        { domainByTable: { audit_log: 'audit' } },
      ),
    ).toThrow(/dense stable own-data/);
  });

  it('C127 ignores late Array.filter substitution in both owner-scope checks', () => {
    const nativeFilter = Array.prototype.filter;
    try {
      Array.prototype.filter = function <T>(): T[] {
        return [];
      };
      const input = {
        domain: 'order',
        ownerColumn: 'userId',
        principal: 'u1',
        rows: [{ id: 'o2', userId: 'u2' }],
      };
      expect(() => assertOwnerRowsScoped(input)).toThrow(/KV414.*u2/);
      expect(() => assertOwnerWritesScoped(input)).toThrow(/KV414.*u2/);
    } finally {
      Array.prototype.filter = nativeFilter;
    }
  });

  it('C139 keeps SQL read observations when Array.flatMap and Set.has are replaced', () => {
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const db = verifier.wrap({
      query() {
        return [];
      },
    });
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeSetHas = Set.prototype.has;
    try {
      Array.prototype.flatMap = function <Value>(): Value[] {
        return [];
      };
      Set.prototype.has = function (): boolean {
        return true;
      };
      db.query({ text: 'select * from audit_log', values: [] });
    } finally {
      Set.prototype.has = nativeSetHas;
      Array.prototype.flatMap = nativeFlatMap;
    }

    expect(() => verifier.assertReadsCovered([])).toThrow(expectedDiagnostic('KV407', 'audit'));
  });

  it('pins Function.call so a covered table cannot be rewritten at dispatch', () => {
    const actualTables: string[] = [];
    const raw = {
      write(table: string) {
        actualTables.push(table);
      },
    };
    const verifier = createDbVerifier(
      {
        'cart.add': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      { domainByTable: { audit_log: 'audit', cart_items: 'cart' } },
    );
    const db = verifier.wrap(raw);
    const nativeCall = Function.prototype.call;
    try {
      Function.prototype.call = function (thisArg: unknown, ...args: unknown[]) {
        if (this === raw.write && args[0] === 'cart_items') args[0] = 'audit_log';
        return nativeReflectApply(this, thisArg, args);
      };
      db.write('cart_items');
    } finally {
      Function.prototype.call = nativeCall;
    }

    expect(actualTables).toEqual(['cart_items']);
    expect(() => verifier.assertCovered()).not.toThrow();
  });

  it('pins Reflect.get and WeakMap/Map caches against method substitution', () => {
    const actualTables: string[] = [];
    const raw = {
      write(table: string) {
        actualTables.push(table);
      },
    };
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const nativeWeakGet = WeakMap.prototype.get;
    const nativeMapGet = Map.prototype.get;
    const nativeReflectGet = Reflect.get;
    let db: typeof raw;
    try {
      WeakMap.prototype.get = function (key: object) {
        return key === raw ? raw : nativeReflectApply(nativeWeakGet, this, [key]);
      };
      db = verifier.wrap(raw);
    } finally {
      WeakMap.prototype.get = nativeWeakGet;
    }
    try {
      Map.prototype.get = function (key: unknown) {
        if (key === 'write') return { original: raw.write, wrapped: raw.write };
        return nativeReflectApply(nativeMapGet, this, [key]);
      };
      Reflect.get = function (target: object, property: PropertyKey, receiver?: unknown) {
        if (target === raw && property === 'write') {
          return () => raw.write('cart_items');
        }
        return nativeReflectApply(nativeReflectGet, Reflect, [target, property, receiver]);
      };
      db.write('audit_log');
    } finally {
      Reflect.get = nativeReflectGet;
      Map.prototype.get = nativeMapGet;
    }

    expect(actualTables).toEqual(['audit_log']);
    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C204 keeps reflected root and nested SQL descriptors inside observation', () => {
    const writes: string[] = [];
    const nestedStatements: unknown[] = [];
    const nested = {
      query(statement: unknown) {
        nestedStatements.push(statement);
        return [];
      },
    };
    const raw = {
      pglite: nested,
      write(table: string) {
        writes.push(table);
      },
    };
    const verifier = createDbVerifier(
      {},
      { domainByTable: { audit_log: 'audit', products: 'product' } },
    );
    const db = verifier.wrap(raw);

    const writeDescriptor = Object.getOwnPropertyDescriptor(db, 'write');
    const pgliteDescriptor = Object.getOwnPropertyDescriptor(db, 'pglite');
    expect(writeDescriptor).toBeDefined();
    expect(pgliteDescriptor).toBeDefined();
    if (writeDescriptor === undefined || !('value' in writeDescriptor)) return;
    if (pgliteDescriptor === undefined || !('value' in pgliteDescriptor)) return;
    expect(writeDescriptor.value).not.toBe(raw.write);
    expect(pgliteDescriptor.value).toBe(db.pglite);
    expect(pgliteDescriptor.value).not.toBe(nested);
    expect(Object.getPrototypeOf(pgliteDescriptor.value as object)).toBeNull();

    nativeReflectApply(writeDescriptor.value as Function, db, ['audit_log']);
    const queryDescriptor = Object.getOwnPropertyDescriptor(
      pgliteDescriptor.value as object,
      'query',
    );
    expect(queryDescriptor).toBeDefined();
    if (queryDescriptor === undefined || !('value' in queryDescriptor)) return;
    expect(queryDescriptor.value).not.toBe(nested.query);
    nativeReflectApply(queryDescriptor.value as Function, pgliteDescriptor.value, [
      { text: 'select * from products', values: [] },
    ]);

    expect(writes).toEqual(['audit_log']);
    expect(nestedStatements).toHaveLength(1);
    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
    expect(() => verifier.assertReadsCovered([])).toThrow(expectedDiagnostic('KV407', 'product'));
  });

  it('C204 does not vend adapter capability hooks through reflected descriptors', () => {
    const raw = {
      [kovoDeclaredWriteDbHandle]() {
        return raw;
      },
      [kovoReadonlyDbHandle]() {
        return raw;
      },
    };
    const db = createDbVerifier({}, { domainByTable: {} }).wrap(raw);

    for (const capability of [kovoDeclaredWriteDbHandle, kovoReadonlyDbHandle]) {
      const descriptor = Object.getOwnPropertyDescriptor(db, capability);
      expect(descriptor).toBeDefined();
      if (descriptor === undefined || !('value' in descriptor)) continue;
      expect(descriptor.value).not.toBe(raw[capability]);
      expect(() => nativeReflectApply(descriptor.value as Function, db, [{}])).toThrow(
        /reserved for the framework lifecycle/u,
      );
    }
  });

  it('C204 keeps reflected prepared-statement execution inside observation', () => {
    const executions: unknown[][] = [];
    const rawRun = (...args: unknown[]) => {
      executions.push(args);
      return { changes: 1 };
    };
    const verifier = createDbVerifier(
      {},
      { domainByTable: { audit_log: 'audit' }, sqlDialect: 'sqlite' },
    );
    const db = verifier.wrap({
      sqlite: {
        prepare() {
          return { run: rawRun };
        },
      },
    });

    const prepared = db.sqlite.prepare({
      text: 'delete from audit_log where id = ?',
      values: ['event-1'],
    });
    const descriptor = Object.getOwnPropertyDescriptor(prepared, 'run');
    expect(descriptor).toBeDefined();
    if (descriptor === undefined || !('value' in descriptor)) return;
    expect(descriptor.value).not.toBe(rawRun);
    nativeReflectApply(descriptor.value as Function, prepared, []);

    expect(executions).toEqual([[]]);
    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C204 pins inherited methods as safe data without evaluating inherited accessors', () => {
    let getterReads = 0;
    const methodPrototype = {
      write(table: string) {
        return table;
      },
    };
    const accessorPrototype = Object.defineProperty({}, 'query', {
      configurable: true,
      get() {
        getterReads += 1;
        return () => [];
      },
    });
    const methodDb = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } }).wrap(
      Object.create(methodPrototype) as typeof methodPrototype,
    );
    const accessorDb = createDbVerifier({}, { domainByTable: {} }).wrap(
      Object.create(accessorPrototype) as { query(): unknown[] },
    );

    const methodDescriptor = Object.getOwnPropertyDescriptor(methodDb, 'write');
    expect(methodDescriptor).toMatchObject({ configurable: true, writable: false });
    expect(methodDescriptor).toHaveProperty('value');
    expect(
      methodDescriptor && 'value' in methodDescriptor ? methodDescriptor.value : undefined,
    ).not.toBe(methodPrototype.write);
    expect(Object.getOwnPropertyDescriptor(accessorDb, 'query')).toBeUndefined();
    expect(getterReads).toBe(0);
    expect(Object.getPrototypeOf(methodDb)).toBeNull();
    expect(Object.getPrototypeOf(accessorDb)).toBeNull();
  });

  it('C211 observes the complete nested-driver and replica handle family', async () => {
    const sqlCalls: unknown[] = [];
    const tableCalls: string[] = [];
    const nestedHandle = {
      exec(statement: unknown) {
        sqlCalls.push(statement);
        return [];
      },
      query(statement: unknown) {
        sqlCalls.push(statement);
        return [];
      },
    };
    const primary = {
      write(table: string) {
        tableCalls.push(`primary:${table}`);
      },
    };
    const replica = {
      read(table: string) {
        tableCalls.push(`replica:${table}`);
        return [];
      },
    };
    const raw = {
      $client: nestedHandle,
      $primary: primary,
      $replicas: [replica],
      session: nestedHandle,
    };
    const verifier = createDbVerifier(
      {},
      {
        domainByTable: {
          audit_log: 'audit',
          inventory: 'inventory',
          products: 'product',
        },
      },
    );
    const db = verifier.wrap(raw);

    await db.session.query({ text: 'select * from products', values: [] });
    await db.$client.exec({ text: 'delete from audit_log where id = $1', values: ['event-1'] });
    db.$primary.write('audit_log');
    db.$replicas[0]!.read('inventory');
    raw.$replicas.push({ read: () => [] });

    expect(db.session).toBe(db.$client);
    expect(db.$primary).not.toBe(primary);
    expect(db.$replicas).toBe(db.$replicas);
    expect(db.$replicas).not.toBe(raw.$replicas);
    expect(db.$replicas).toHaveLength(1);
    expect(Object.isFrozen(db.$replicas)).toBe(true);
    expect(sqlCalls).toHaveLength(2);
    expect(tableCalls).toEqual(['primary:audit_log', 'replica:inventory']);
    expect(verifier.observed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'read', table: 'products' }),
        expect.objectContaining({ kind: 'write', table: 'audit_log' }),
        expect.objectContaining({ kind: 'read', table: 'inventory' }),
      ]),
    );
    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
    expect(() => verifier.assertReadsCovered([])).toThrow(/KV407.*(inventory|product)/u);
  });

  it('C211 rejects malformed nested-driver carriers before they can escape wrapping', () => {
    const invalid = createDbVerifier({}, { domainByTable: {} }).wrap({
      $client: null,
      $primary: () => undefined,
      $replicas: [null],
      session: 'raw-driver',
    });

    expect(() => invalid.$client).toThrow(/nested SQL handle/u);
    expect(() => invalid.session).toThrow(/nested SQL handle/u);
    expect(() => invalid.$primary).toThrow(/\$primary handle/u);
    expect(() => invalid.$replicas).toThrow(/entries must be DB handle objects/u);
  });

  it('C214 observes select, join, count, and CTE read-builder tables', () => {
    const tableName = Symbol.for('drizzle:Name');
    const products = { [tableName]: 'products' };
    const audit = { [tableName]: 'audit_log' };
    const inventory = { [tableName]: 'inventory' };
    const executed: string[] = [];
    const readBuilder = {
      execute() {
        executed.push('execute');
        return [];
      },
      from(_table: unknown) {
        executed.push('from');
        return this;
      },
      leftJoin(_table: unknown) {
        executed.push('leftJoin');
        return this;
      },
      where() {
        executed.push('where');
        return this;
      },
    };
    const cteBuilder = {
      as(query: unknown) {
        const result =
          typeof query === 'function'
            ? nativeReflectApply(query, undefined, [{ select: () => readBuilder }])
            : query;
        return { alias: 'products_cte', result };
      },
    };
    const raw = {
      $count(_table: unknown) {
        executed.push('count');
        return 1;
      },
      $with() {
        return cteBuilder;
      },
      select() {
        return readBuilder;
      },
      with() {
        return raw;
      },
    };
    const verifier = createDbVerifier(
      {},
      {
        domainByTable: {
          audit_log: 'audit',
          inventory: 'inventory',
          products: 'product',
        },
      },
    );
    const db = verifier.wrap(raw);

    const safeReadBuilder = db.select();
    const fromDescriptor = Object.getOwnPropertyDescriptor(safeReadBuilder, 'from');
    expect(fromDescriptor && 'value' in fromDescriptor).toBe(true);
    expect(fromDescriptor && 'value' in fromDescriptor ? fromDescriptor.value : null).not.toBe(
      readBuilder.from,
    );
    expect(Object.getPrototypeOf(safeReadBuilder)).toBeNull();
    safeReadBuilder.from(products).leftJoin(audit).where().execute();
    db.$count(inventory);
    expect(() => db.$with('unsafe_cte').as({ getSQL: () => 'select * from audit_log' })).toThrow(
      /KV407.*verifier-wrapped query builder/u,
    );
    const cte = db
      .$with('products_cte')
      .as((qb: { select(): typeof readBuilder }) => qb.select().from(products));
    db.with(cte).select().from(cte).execute();

    expect(executed).toEqual([
      'from',
      'leftJoin',
      'where',
      'execute',
      'count',
      'from',
      'from',
      'execute',
    ]);
    expect(verifier.observed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'read', table: 'products' }),
        expect.objectContaining({ kind: 'read', table: 'audit_log' }),
        expect.objectContaining({ kind: 'read', table: 'inventory' }),
      ]),
    );
    expect(() => verifier.assertReadsCovered(['product', 'audit', 'inventory'])).not.toThrow();
    expect(() => verifier.assertReadsCovered(['product'])).toThrow(/KV407.*(audit|inventory)/u);
    expect(() => db.select().from({})).toThrow(/KV407.*stable physical identity/u);
  });

  it('C214 membranes relational namespaces, reflection, and nested-read configs', () => {
    const tableName = Symbol.for('drizzle:Name');
    const products = { [tableName]: 'products' };
    let findManyCalls = 0;
    let escapeCalls = 0;
    const builder = {
      table: products,
      escape() {
        escapeCalls += 1;
      },
      findMany() {
        findManyCalls += 1;
        return [];
      },
    };
    const raw = { query: { products: builder } };
    const verifier = createDbVerifier({}, { domainByTable: { products: 'product' } });
    const db = verifier.wrap(raw);
    const namespaceDescriptor = Object.getOwnPropertyDescriptor(db.query, 'products');
    const safeBuilder = db.query.products;
    const terminalDescriptor = Object.getOwnPropertyDescriptor(safeBuilder, 'findMany');
    const escapeDescriptor = Object.getOwnPropertyDescriptor(safeBuilder, 'escape');

    expect(namespaceDescriptor && 'value' in namespaceDescriptor).toBe(true);
    expect(
      namespaceDescriptor && 'value' in namespaceDescriptor ? namespaceDescriptor.value : null,
    ).toBe(safeBuilder);
    expect(safeBuilder).not.toBe(builder);
    expect(terminalDescriptor && 'value' in terminalDescriptor).toBe(true);
    expect(
      terminalDescriptor && 'value' in terminalDescriptor ? terminalDescriptor.value : null,
    ).not.toBe(builder.findMany);
    terminalDescriptor && 'value' in terminalDescriptor
      ? nativeReflectApply(terminalDescriptor.value as Function, safeBuilder, [])
      : undefined;
    expect(findManyCalls).toBe(1);
    expect(() => verifier.assertReadsCovered([])).toThrow(expectedDiagnostic('KV407', 'product'));

    expect(() => safeBuilder.findMany({ with: { auditEvents: true } } as never)).toThrow(
      /KV407.*nested relational reads/u,
    );
    expect(findManyCalls).toBe(1);
    expect(() =>
      escapeDescriptor && 'value' in escapeDescriptor
        ? nativeReflectApply(escapeDescriptor.value as Function, safeBuilder, [])
        : undefined,
    ).toThrow(/KV407.*unsupported relational-builder/u);
    expect(escapeCalls).toBe(0);
    expect(Object.getPrototypeOf(db.query)).toBeNull();
    expect(Object.getPrototypeOf(safeBuilder)).toBeNull();
  });

  it('pins AsyncLocalStorage.run so capture evidence cannot be erased', async () => {
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const db = verifier.wrap(createFakeDb());
    const nativeRun = AsyncLocalStorage.prototype.run;
    let captured!: Awaited<ReturnType<typeof verifier.capture<void>>>;
    try {
      AsyncLocalStorage.prototype.run = function <R, TArgs extends unknown[]>(
        store: unknown,
        callback: (...args: TArgs) => R,
        ...args: TArgs
      ): R {
        if (
          typeof store === 'object' &&
          store !== null &&
          Object.prototype.hasOwnProperty.call(store, 'observed')
        ) {
          return nativeReflectApply(callback, undefined, args);
        }
        return nativeReflectApply(nativeRun, this, [store, callback, ...args]);
      };
      captured = await verifier.capture(() => {
        db.write('audit_log', 'p1');
      });
    } finally {
      AsyncLocalStorage.prototype.run = nativeRun;
    }

    expect(() => verifier.assertCoveredOperations(captured.observed)).toThrow(
      expectedDiagnostic('KV402', 'audit'),
    );
  });

  it('rejects mutable external observation and SQL getter carriers', () => {
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const operation = Object.defineProperty(
      {
        branch: undefined,
        kind: 'write',
        mutationRead: undefined,
        rowKey: undefined,
        sql: undefined,
        table: 'audit_log',
      },
      'domain',
      { enumerable: true, get: () => 'audit' },
    );
    expect(() => verifier.assertCoveredOperations([operation as never])).toThrow(/own data/);

    const calls: unknown[] = [];
    const db = verifier.wrap({
      query(statement: unknown) {
        calls.push(statement);
      },
    });
    const statement = Object.defineProperty({}, 'text', {
      enumerable: true,
      get: () => 'select * from audit_log',
    });
    expect(() => db.query(statement)).toThrow(/own data property/);
    expect(calls).toEqual([]);
  });

  it('C170 rejects a split-view Proxy table before observer and adapter see different names', () => {
    const tableName = Symbol.for('drizzle:Name');
    const actualTables: string[] = [];
    let nameReads = 0;
    const table = new Proxy(
      {},
      {
        get(target, property, receiver) {
          if (property === tableName) {
            nameReads += 1;
            return nameReads === 1 ? 'cart_items' : 'audit_log';
          }
          return nativeReflectApply(Reflect.get, Reflect, [target, property, receiver]);
        },
      },
    );
    const verifier = createDbVerifier(
      {
        'cart/add': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      { domainByTable: { audit_log: 'audit', cart_items: 'cart' } },
    );
    const db = verifier.wrap({
      insert(value: object) {
        actualTables.push(Reflect.get(value, tableName) as string);
      },
    });

    expect(() => db.insert(table)).toThrow(/table.*Proxy|stable.*table/i);
    expect(actualTables).toEqual([]);
  });

  it('C170 preserves stable own-data Drizzle table identity at adapter dispatch', () => {
    const tableName = Symbol.for('drizzle:Name');
    const table = { [tableName]: 'cart_items' };
    const actualTables: string[] = [];
    const verifier = createDbVerifier(
      {
        'cart/add': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      { domainByTable: { cart_items: 'cart' } },
    );
    const db = verifier.wrap({
      insert(value: typeof table) {
        actualTables.push(value[tableName]);
      },
    });

    db.insert(table);
    expect(actualTables).toEqual(['cart_items']);
    expect(() => verifier.assertCovered('cart/add')).not.toThrow();
  });

  it('bridges only artifacts authenticated by a registered framework snapshot control', () => {
    const trusted = {};
    const privateLookalike = { [Symbol('kovo.sql.private-lookalike')]: true };
    const unregister = registerFrameworkSqlSnapshotter((statement: unknown) =>
      statement === trusted
        ? {
            ok: true,
            statement: {
              dialect: 'postgres',
              provenance: 'pinned-kovo-recipe',
              sql: 'select * from cart_items',
              text: 'select * from cart_items',
              values: [],
            },
          }
        : { ok: false },
    );
    const calls: unknown[] = [];
    const verifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
    const db = verifier.wrap({
      query(statement: unknown) {
        calls.push(statement);
        return [];
      },
    });

    try {
      db.query(trusted);
      expect(calls).toHaveLength(1);
      expect(calls[0]).not.toBe(trusted);
      expect(calls[0]).toMatchObject({ text: 'select * from cart_items', values: [] });
      expect(() => db.query(privateLookalike)).toThrow(/must not contain symbol properties/);
      expect(calls).toHaveLength(1);
    } finally {
      unregister();
    }
  });
});
