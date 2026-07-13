import { describe, expect, it } from 'vitest';
import {
  kovoDeclaredWriteDbHandle,
  managedDb,
  type KovoDeclaredWriteDbCapable,
} from '@kovojs/server/internal/managed-db';

import { createFakeDb, expectedDiagnostic, expectedDiagnosticMessage } from './test-fixtures.js';
import { createDbVerifier } from './verifier.js';

describe('@kovojs/test DB verifier', () => {
  it('keeps declared-write handles and inherited SQL methods inside verification', async () => {
    class DeclaredWriteDb {
      readonly calls: unknown[] = [];

      async query(statement: unknown): Promise<unknown[]> {
        this.calls.push(statement);
        return [];
      }
    }

    const declaredDb = new DeclaredWriteDb();
    const rawDb: KovoDeclaredWriteDbCapable<DeclaredWriteDb> = {
      [kovoDeclaredWriteDbHandle]() {
        return declaredDb;
      },
    };
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          tables: ['cart_items'],
          touches: [{ domain: 'cart', keys: null, site: 'cart.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      { domainByTable: { cart_items: 'cart' }, sqlDialect: 'postgres' },
    );
    const writer = managedDb(verifier.wrap(rawDb), 'write', {
      sqlWritePolicy: { dialect: 'postgres', tables: ['cart_items'], touches: ['cart'] },
    }) as unknown as Pick<DeclaredWriteDb, 'query'>;

    await writer.query({
      text: 'insert into cart_items (product_id) values ($1)',
      values: ['p1'],
    });

    expect(declaredDb.calls).toContainEqual(
      expect.objectContaining({
        text: 'insert into cart_items (product_id) values ($1)',
        values: ['p1'],
      }),
    );
    expect(verifier.observed).toEqual([
      expect.objectContaining({ domain: 'cart', kind: 'write', table: 'cart_items' }),
    ]);
    expect(verifier.diagnostics()).toEqual([]);
  });

  it('does not invoke an accessor-backed SQL method while composing managed verification', () => {
    let queryReads = 0;
    const declaredDb = {};
    Object.defineProperty(declaredDb, 'query', {
      configurable: true,
      get() {
        queryReads += 1;
        return () => [];
      },
    });
    const rawDb: KovoDeclaredWriteDbCapable<object> = {
      [kovoDeclaredWriteDbHandle]() {
        return declaredDb;
      },
    };
    const verifier = createDbVerifier({}, { domainByTable: {} });
    const writer = managedDb(verifier.wrap(rawDb), 'write', {
      sqlWritePolicy: { dialect: 'postgres', tables: [], touches: [] },
    }) as unknown as { query: unknown };

    expect(() => writer.query).toThrow(/KV422.*accessor-backed/);
    expect(queryReads).toBe(0);
  });

  it('rejects observed writes covered only by unscoped KV406 static analysis', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [],
          unresolved: [
            {
              code: 'KV406',
              message: expectedDiagnosticMessage('KV406'),
              site: 'cart.domain.ts:9',
            },
          ],
        },
      },
      { domainByTable: { audit_log: 'audit' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('audit_log', 'p1');

    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('allows observed writes when unscoped KV406 is backed by declared touches', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:8', via: 'audit_log' }],
          unresolved: [
            {
              code: 'KV406',
              message: expectedDiagnosticMessage('KV406'),
              site: 'cart.domain.ts:9',
            },
          ],
        },
      },
      { domainByTable: { audit_log: 'audit' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('audit_log', 'p1');

    expect(() => verifier.assertCovered()).not.toThrow();
  });

  it('allows raw SQL writes to declared raw table allowlists', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          tables: ['cart_items'],
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:8', via: 'cart_items' }],
          unresolved: [
            {
              code: 'KV406',
              domain: 'cart',
              message: expectedDiagnosticMessage('KV406'),
              site: 'cart.domain.ts:9',
            },
          ],
        },
      },
      { domainByTable: { audit_log: 'audit', cart_items: 'cart' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql("insert into cart_items (product_id) values ('p1')");

    expect(() => verifier.assertCovered()).not.toThrow();
  });

  it('fails closed when raw SQL writes outside declared raw table allowlists', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          tables: ['cart_items'],
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:8', via: 'cart_items' }],
          unresolved: [
            {
              code: 'KV406',
              domain: 'cart',
              message: expectedDiagnosticMessage('KV406'),
              site: 'cart.domain.ts:9',
            },
          ],
        },
      },
      { domainByTable: { audit_log: 'audit', cart_items: 'cart' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql("update audit_log set product_id = 'p1' where id = 'a1'");

    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV406', 'audit_log'));
  });

  it('limits domain-scoped KV406 coverage to the annotated domain', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [],
          unresolved: [
            {
              code: 'KV406',
              domain: 'audit',
              message: expectedDiagnosticMessage('KV406'),
              site: 'cart.domain.ts:9',
            },
          ],
        },
      },
      { domainByTable: { audit_log: 'audit', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('audit_log', 'p1');
    db.write('products', 'p1');

    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'product'));
  });

  it('warns when a declared write domain is never observed', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [
            { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
            { domain: 'product', keys: null, site: 'cart.domain.ts:2', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { cart_items: 'cart', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('cart_items', 'p1');

    expect(verifier.diagnostics()).toEqual([
      {
        code: 'KV403',
        domain: 'product',
        message: expectedDiagnosticMessage('KV403'),
        severity: 'warn',
      },
    ]);
  });

  it('does not warn for declared write domains observed under instrumentation', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      { domainByTable: { cart_items: 'cart' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('cart_items', 'p1');

    expect(verifier.diagnostics()).toEqual([]);
  });

  it('warns when a declared conditional write branch is never observed', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [
            {
              branch: 'stock-reserve',
              domain: 'product',
              keys: 'arg:productId',
              site: 'cart.domain.ts:12',
              via: 'products',
            },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' } },
    );

    expect(verifier.diagnostics()).toEqual([
      {
        branch: 'stock-reserve',
        code: 'KV405',
        domain: 'product',
        message: expectedDiagnosticMessage('KV405'),
        severity: 'error',
        site: 'cart.domain.ts:12',
      },
      {
        code: 'KV403',
        domain: 'product',
        message: expectedDiagnosticMessage('KV403'),
        severity: 'warn',
      },
    ]);
  });

  it('does not warn for conditional write branches observed under instrumentation', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [
            {
              branch: 'stock-reserve',
              domain: 'product',
              keys: 'arg:productId',
              site: 'cart.domain.ts:12',
              via: 'products',
            },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('products', { id: 'p1' }, { branch: 'stock-reserve' });

    expect(verifier.diagnostics()).toEqual([]);
  });

  it('C235 returns a completed snapshot and revokes detached capture descendants', async () => {
    const verifier = createDbVerifier(
      {},
      { domainByTable: { audit_log: 'audit', cart_items: 'cart' } },
    );
    const db = verifier.wrap(createFakeDb());
    let releaseLateWrite!: () => void;
    let lateWrite!: Promise<void>;

    const captured = await verifier.capture(async () => {
      db.write('cart_items', 'p1');
      lateWrite = new Promise<void>((resolve) => {
        releaseLateWrite = resolve;
      }).then(() => {
        db.write('audit_log', 'late');
      });

      return 'ok';
    });

    expect(captured.result).toBe('ok');
    expect(Object.isFrozen(captured.observed)).toBe(true);
    expect(captured.observed.map((operation) => operation.table)).toEqual(['cart_items']);

    releaseLateWrite();
    await expect(lateWrite).rejects.toThrow(/KV407.*capture.*settled/u);

    expect(captured.observed.map((operation) => operation.table)).toEqual(['cart_items']);
    expect(verifier.observed.map((operation) => operation.table)).toEqual(['cart_items']);
  });

  it('verifies observed query reads against declared domains', () => {
    const verifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
    const db = verifier.wrap(createFakeDb());

    db.read('cart_items');

    expect(() => verifier.assertReadsCovered(['cart'])).not.toThrow();
  });

  it('fails read-side verification for exempt table reads', () => {
    const verifier = createDbVerifier(
      {},
      {
        domainByTable: {
          cart_items: 'cart',
        },
        exemptTables: ['audit_log'],
      },
    );
    const db = verifier.wrap(createFakeDb());

    db.read('audit_log');

    expect(() => verifier.assertReadsCovered(['cart'])).toThrow(
      expectedDiagnostic('KV411', 'audit_log'),
    );
  });

  it('allows observed writes to exempt tables without requiring touch graph domains', () => {
    const verifier = createDbVerifier(
      {},
      {
        domainByTable: {},
        exemptTables: ['audit_log'],
      },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('audit_log', { event: 'restock' });

    expect(() => verifier.assertCovered()).not.toThrow();
  });

  it('returns stable proxies and method wrappers for repeated pglite access', () => {
    const verifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
    const handle = {
      exec() {
        return ['exec-ok'];
      },
      query() {
        return ['query-ok'];
      },
    };
    const db = verifier.wrap({
      pglite: handle,
      write() {
        return undefined;
      },
    });

    expect(db.pglite).toBe(db.pglite);
    expect(db.pglite).not.toBe(handle);
    expect(Reflect.get(db.pglite, 'exec')).toBe(Reflect.get(db.pglite, 'exec'));
    expect(Reflect.get(db.pglite, 'query')).toBe(Reflect.get(db.pglite, 'query'));
    expect(Reflect.get(db, 'write')).toBe(Reflect.get(db, 'write'));
  });

  it('observes better-sqlite3-style prepared statement execution through raw handles', () => {
    const verifier = createDbVerifier(
      {},
      { domainByTable: { products: 'product' }, sqlDialect: 'sqlite' },
    );
    const preparedRuns: unknown[][] = [];
    const sqlite = {
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
      transaction<T extends (...args: never[]) => unknown>(callback: T): T {
        return callback;
      },
    };
    const db = verifier.wrap({ sqlite });

    db.sqlite.prepare('insert into products (id) values (?)').run('p1');

    expect(preparedRuns).toEqual([['insert into products (id) values (?)', 'p1']]);
    expect(verifier.observed).toEqual([
      expect.objectContaining({
        kind: 'write',
        sql: 'insert into products (id) values (?)',
        table: 'products',
      }),
    ]);
    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'product'));
  });

  it('observes libsql-style execute calls through client handles', () => {
    const verifier = createDbVerifier(
      {},
      { domainByTable: { products: 'product' }, sqlDialect: 'sqlite' },
    );
    const calls: unknown[] = [];
    const db = verifier.wrap({
      client: {
        execute(statement: unknown) {
          calls.push(statement);
          return { rows: [] };
        },
      },
    });

    db.client.execute({ sql: 'select * from products where id = ?', args: ['p1'] });

    expect(calls).toEqual([{ sql: 'select * from products where id = ?', args: ['p1'] }]);
    expect(verifier.observed).toEqual([
      expect.objectContaining({
        kind: 'read',
        rowKey: 'id',
        table: 'products',
      }),
    ]);
  });

  it('does not observe a root query method without a DB adapter seam', () => {
    const verifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
    const calls: unknown[] = [];
    const utility = verifier.wrap({
      query(statement: unknown) {
        calls.push(statement);
        return ['ok'];
      },
    });

    expect(utility.query('insert into cart_items default values')).toEqual(['ok']);
    expect(calls).toEqual(['insert into cart_items default values']);
    expect(verifier.observed).toEqual([]);
  });
});
