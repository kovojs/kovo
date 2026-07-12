import { describe, expect, it } from 'vitest';

import { managedDb } from '@kovojs/server/internal/execution';

import { expectedDiagnostic } from './test-fixtures.js';
import { createDbVerifier } from './verifier.js';

describe('@kovojs/test transaction security', () => {
  it('C225 observes writes through root adapter transaction callbacks', async () => {
    const tableName = Symbol.for('drizzle:Name');
    const auditLog = { [tableName]: 'audit_log' };
    const builder = {
      execute() {},
      values() {
        return this;
      },
    };
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const db = verifier.wrap({
      transaction(callback: (tx: { insert(table: unknown): typeof builder }) => unknown) {
        return callback({ insert: () => builder });
      },
    });

    await db.transaction(async (tx) => {
      tx.insert(auditLog).values({ id: 'event-1' }).execute();
    });

    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C225 recursively wraps nested transactions used as Drizzle savepoints', async () => {
    const tableName = Symbol.for('drizzle:Name');
    const auditLog = { [tableName]: 'audit_log' };
    const builder = {
      execute() {},
      values() {
        return this;
      },
    };
    const savepointDb = { insert: () => builder };
    const transactionDb = {
      transaction(callback: (tx: typeof savepointDb) => unknown) {
        return callback(savepointDb);
      },
    };
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const db = verifier.wrap({
      transaction(callback: (tx: typeof transactionDb) => unknown) {
        return callback(transactionDb);
      },
    });

    await db.transaction(async (tx) => {
      await tx.transaction(async (savepoint) => {
        await Promise.resolve();
        savepoint.insert(auditLog).values({ id: 'event-1' }).execute();
      });
    });

    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C225 observes raw reads and writes on nested SQL-handle transactions', async () => {
    const verifier = createDbVerifier(
      {},
      { domainByTable: { audit_log: 'audit', products: 'product' } },
    );
    const pglite = {
      async query() {
        return [];
      },
      async transaction(
        callback: (tx: { query(statement: unknown): Promise<unknown[]> }) => Promise<unknown>,
      ) {
        return callback({
          async query() {
            return [];
          },
        });
      },
    };
    const db = verifier.wrap({ pglite });

    await db.pglite.transaction(async (tx) => {
      await tx.query({ text: 'select * from products', values: [] });
      await tx.query({ text: 'delete from audit_log where id = $1', values: ['event-1'] });
    });

    expect(() => verifier.assertReadsCovered([])).toThrow(expectedDiagnostic('KV407', 'product'));
    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C225 rejects malformed callback and transaction carriers before app authority', () => {
    let adapterCalls = 0;
    let callbackCalls = 0;
    const verifier = createDbVerifier({}, { domainByTable: {} });
    const invalidCallbackDb = verifier.wrap({
      transaction(callback: (tx: object) => unknown) {
        adapterCalls += 1;
        return callback({});
      },
    });

    expect(() => invalidCallbackDb.transaction('COMMIT' as never)).toThrow(
      /KV407.*requires a callback function/u,
    );
    expect(adapterCalls).toBe(0);

    const accessorConfig = Object.defineProperty({}, 'behavior', {
      get: () => 'immediate',
    });
    expect(() =>
      (
        invalidCallbackDb.transaction as unknown as (
          callback: () => void,
          config: unknown,
        ) => unknown
      )(() => undefined, accessorConfig),
    ).toThrow(/KV407.*own data properties/u);
    expect(adapterCalls).toBe(0);

    const invalidCarrierDb = verifier.wrap({
      transaction(callback: (tx: null, extra: object) => unknown) {
        adapterCalls += 1;
        return callback(null, {});
      },
    });
    expect(() =>
      invalidCarrierDb.transaction((() => {
        callbackCalls += 1;
      }) as never),
    ).toThrow(/KV407.*unsupported authority arguments/u);
    expect(adapterCalls).toBe(1);
    expect(callbackCalls).toBe(0);

    const nullCarrierDb = verifier.wrap({
      transaction(callback: (tx: null) => unknown) {
        adapterCalls += 1;
        return callback(null);
      },
    });
    expect(() =>
      nullCarrierDb.transaction((() => {
        callbackCalls += 1;
      }) as never),
    ).toThrow(/KV407.*must receive a DB object/u);
    expect(adapterCalls).toBe(2);
    expect(callbackCalls).toBe(0);
  });

  it('C225 snapshots stable transaction config before adapter authority', () => {
    let receivedConfig: unknown;
    const callerConfig = { behavior: 'immediate' };
    const verifier = createDbVerifier({}, { domainByTable: {} });
    const db = verifier.wrap({
      transaction(callback: (tx: object) => unknown, config?: unknown) {
        receivedConfig = config;
        return callback({});
      },
    });

    db.transaction(() => undefined, callerConfig);
    callerConfig.behavior = 'exclusive';

    expect(receivedConfig).not.toBe(callerConfig);
    expect(receivedConfig).toEqual({ behavior: 'immediate' });
    expect(Object.isFrozen(receivedConfig)).toBe(true);
    expect(Object.getPrototypeOf(receivedConfig)).toBeNull();
  });

  it('C225 preserves wrapped descriptors and the original rollback error', async () => {
    const rollbackError = new Error('rollback sentinel');
    let safeTransactionDb: object | undefined;
    const rawTransactionDb = {
      rollback() {
        throw rollbackError;
      },
      transaction(callback: (tx: object) => unknown) {
        return callback({});
      },
    };
    const raw = {
      async transaction(callback: (tx: typeof rawTransactionDb) => unknown) {
        return callback(rawTransactionDb);
      },
    };
    const verifier = createDbVerifier({}, { domainByTable: {} });
    const db = verifier.wrap(raw);
    const descriptor = Object.getOwnPropertyDescriptor(db, 'transaction');

    expect(descriptor && 'value' in descriptor).toBe(true);
    expect(descriptor && 'value' in descriptor ? descriptor.value : null).not.toBe(raw.transaction);
    await expect(
      db.transaction(async (tx) => {
        safeTransactionDb = tx;
        tx.rollback();
      }),
    ).rejects.toBe(rollbackError);
    expect(safeTransactionDb).not.toBe(rawTransactionDb);
    expect(Object.getPrototypeOf(safeTransactionDb!)).toBeNull();
    const nested = Object.getOwnPropertyDescriptor(safeTransactionDb!, 'transaction');
    expect(nested && 'value' in nested).toBe(true);
    expect(nested && 'value' in nested ? nested.value : null).not.toBe(
      rawTransactionDb.transaction,
    );
  });

  it('C225 composes transaction observation under the managed write membrane', async () => {
    const tableName = Symbol.for('drizzle:Name');
    const auditLog = { [tableName]: 'audit_log' };
    const builder = {
      execute() {},
      values() {
        return this;
      },
    };
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const observed = verifier.wrap({
      transaction(callback: (tx: { insert(table: unknown): typeof builder }) => unknown) {
        return callback({ insert: () => builder });
      },
    });
    const db = managedDb(observed, 'write') as unknown as typeof observed;

    await db.transaction(async (tx) => {
      tx.insert(auditLog).values({ id: 'event-1' }).execute();
    });

    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });
});
