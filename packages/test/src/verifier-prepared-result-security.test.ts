import { describe, expect, it } from 'vitest';

import { managedDb } from '@kovojs/server/internal/execution';

import { expectedDiagnostic } from './test-fixtures.js';
import { createDbVerifier } from './verifier.js';

describe('@kovojs/test prepared-result security', () => {
  it('C229 observes execute() on a raw prepared SQL statement', () => {
    let executeCalls = 0;
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const db = verifier.wrap({
      prepare() {
        return {
          execute() {
            executeCalls += 1;
          },
        };
      },
    });

    db.prepare('delete from audit_log where id = 1').execute();

    expect(executeCalls).toBe(1);
    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C229 observes the sync, values, iterator, iterate, and stream terminal family', () => {
    const terminals = ['sync', 'values', 'iterator', 'iterate', 'stream'] as const;
    for (const terminal of terminals) {
      let calls = 0;
      const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
      const statement = {
        [terminal]() {
          calls += 1;
          return [];
        },
      };
      const db = verifier.wrap({ prepare: () => statement });

      (db.prepare('delete from audit_log') as Record<string, () => unknown>)[terminal]!();

      expect(calls).toBe(1);
      expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
    }
  });

  it('C229 observes thenable and async-iterator prepared execution', async () => {
    let thenCalls = 0;
    const readVerifier = createDbVerifier({}, { domainByTable: { products: 'product' } });
    const thenableDb = readVerifier.wrap({
      prepare() {
        return {
          then(resolve: (value: string) => unknown) {
            thenCalls += 1;
            return resolve('ready');
          },
        };
      },
    });

    await expect(thenableDb.prepare('select * from products')).resolves.toBe('ready');
    expect(thenCalls).toBe(1);
    expect(() => readVerifier.assertReadsCovered([])).toThrow(
      expectedDiagnostic('KV407', 'product'),
    );

    let iteratorCalls = 0;
    const writeVerifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const iterableDb = writeVerifier.wrap({
      prepare() {
        return {
          async *[Symbol.asyncIterator]() {
            iteratorCalls += 1;
            yield 'row';
          },
        };
      },
    });
    const rows: string[] = [];
    for await (const row of iterableDb.prepare('delete from audit_log') as AsyncIterable<string>) {
      rows.push(row);
    }

    expect(rows).toEqual(['row']);
    expect(iteratorCalls).toBe(1);
    expect(() => writeVerifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C229 recursively wraps configuration and reflected terminal methods', () => {
    let executeCalls = 0;
    let escapeCalls = 0;
    const rawStatement = {
      execute() {
        executeCalls += 1;
      },
      escape() {
        escapeCalls += 1;
      },
      pluck() {
        return this;
      },
    };
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const db = verifier.wrap({ prepare: () => rawStatement });
    const prepared = db.prepare('delete from audit_log');
    const configured = prepared.pluck();
    const descriptor = Object.getOwnPropertyDescriptor(configured, 'execute');

    expect(configured).not.toBe(rawStatement);
    expect(Object.getPrototypeOf(configured)).toBeNull();
    expect(descriptor && 'value' in descriptor).toBe(true);
    expect(descriptor && 'value' in descriptor ? descriptor.value : null).not.toBe(
      rawStatement.execute,
    );
    descriptor && 'value' in descriptor
      ? Reflect.apply(descriptor.value as Function, configured, [])
      : undefined;
    expect(() => prepared.escape()).toThrow(/KV407.*unsupported prepared-statement/u);
    expect(executeCalls).toBe(1);
    expect(escapeCalls).toBe(0);
    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C229 recursively wraps DB authority resolved by async result carriers', async () => {
    const resultDb = {
      query() {
        return [];
      },
    };
    const verifier = createDbVerifier(
      {},
      { domainByTable: { audit_log: 'audit', products: 'product' } },
    );
    const db = verifier.wrap({
      prepare() {
        return {
          execute() {
            return {
              then(resolve: (value: typeof resultDb) => unknown) {
                return resolve(resultDb);
              },
            };
          },
        };
      },
    });

    const safeResult = await db.prepare('select * from products').execute();
    expect(safeResult).not.toBe(resultDb);
    expect(Object.getPrototypeOf(safeResult)).toBeNull();
    safeResult.query('delete from audit_log');

    expect(() => verifier.assertReadsCovered([])).toThrow(expectedDiagnostic('KV407', 'product'));
    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('C229 rejects malformed and accessor-backed prepared carriers', () => {
    let accessorCalls = 0;
    let prepareCalls = 0;
    const verifier = createDbVerifier({}, { domainByTable: {} });
    const primitiveDb = verifier.wrap({
      prepare() {
        prepareCalls += 1;
        return null;
      },
    });
    expect(() => primitiveDb.prepare('select 1')).toThrow(/KV407.*must return a statement object/u);
    expect(prepareCalls).toBe(1);

    const accessorStatement = Object.defineProperty({}, 'execute', {
      configurable: true,
      get() {
        accessorCalls += 1;
        return () => undefined;
      },
    });
    const accessorDb = verifier.wrap({ prepare: () => accessorStatement });
    const prepared = accessorDb.prepare('select 1');
    expect(() => prepared.execute).toThrow(/KV407.*must be data-backed/u);
    expect(accessorCalls).toBe(0);

    const authorityDb = verifier.wrap({ prepare: () => ({ database: { exec() {} } }) });
    expect(() => authorityDb.prepare('select 1').database).toThrow(
      /KV407.*authority property database/u,
    );

    const proxyResultDb = verifier.wrap({
      prepare: () => ({ execute: () => new Proxy({}, {}) }),
    });
    expect(() => proxyResultDb.prepare('select 1').execute()).toThrow(
      /KV407.*must not return a Proxy authority carrier/u,
    );
  });

  it('C229 observes root, nested, and both managed composition orders', () => {
    const rawStatement = { execute() {} };
    const raw = {
      prepare: () => rawStatement,
      session: { prepare: () => rawStatement },
    };
    const verifier = createDbVerifier({}, { domainByTable: { audit_log: 'audit' } });
    const observed = verifier.wrap(raw);
    const policy = {
      sqlWritePolicy: { dialect: 'postgres' as const, tables: ['audit_log'], touches: ['audit'] },
    };
    const managedOutside = managedDb(observed, 'write', policy) as unknown as typeof observed;
    const managedInside = verifier.wrap(managedDb(raw, 'write', policy) as unknown as typeof raw);
    const statement = { text: 'delete from audit_log where id = $1', values: ['event-1'] };

    observed.session.prepare(statement).execute();
    managedOutside.prepare(statement).execute();
    managedInside.prepare(statement).execute();

    expect(() => verifier.assertCovered()).toThrow(expectedDiagnostic('KV402', 'audit'));
    expect(
      verifier.observed.filter(
        (operation) => operation.kind === 'write' && operation.table === 'audit_log',
      ),
    ).toHaveLength(3);
  });
});
