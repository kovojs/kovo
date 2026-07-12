/* oxlint-disable typescript/unbound-method -- Adversarial tests deliberately replace late realm methods. */
import { AsyncLocalStorage } from 'node:async_hooks';

import { describe, expect, it } from 'vitest';

import { createFakeDb, expectedDiagnostic } from './test-fixtures.js';
import { assertOwnerRowsScoped, assertOwnerWritesScoped, createDbVerifier } from './verifier.js';

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
});
