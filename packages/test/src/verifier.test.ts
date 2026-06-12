import { describe, expect, it } from 'vitest';

import { diagnosticDefinitions, type DiagnosticCode } from '@jiso/core';

import { createFakeDb } from './test-fixtures.js';
import { createDbVerifier } from './verifier.js';

function expectedDiagnostic(code: DiagnosticCode, detail: string): string {
  const message = diagnosticDefinitions[code].message.replace(/\.$/, '');
  return `${code} ${message}: ${detail}`;
}

describe('@jiso/test DB verifier', () => {
  it('rejects observed writes covered only by unscoped FW406 static analysis', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [],
          unresolved: [
            {
              code: 'FW406',
              message: 'Statically un-analyzable write site; manual touches required.',
              site: 'cart.domain.ts:9',
            },
          ],
        },
      },
      { domainByTable: { audit_log: 'audit' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('audit_log', 'p1');

    expect(() => verifier.assertCovered()).toThrow(
      'FW402 Write touched an undeclared domain: audit',
    );
  });

  it('allows observed writes when unscoped FW406 is backed by declared touches', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [{ domain: 'audit', keys: null, site: 'cart.domain.ts:8', via: 'audit_log' }],
          unresolved: [
            {
              code: 'FW406',
              message: 'Statically un-analyzable write site; manual touches required.',
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

  it('limits domain-scoped FW406 coverage to the annotated domain', () => {
    const verifier = createDbVerifier(
      {
        'cart.addItem': {
          touches: [],
          unresolved: [
            {
              code: 'FW406',
              domain: 'audit',
              message: 'Statically un-analyzable write site; manual touches required.',
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

    expect(() => verifier.assertCovered()).toThrow(
      'FW402 Write touched an undeclared domain: product',
    );
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
        code: 'FW403',
        domain: 'product',
        message: 'Declared domain was never observed written.',
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
        code: 'FW405',
        domain: 'product',
        message: 'Conditional write branch was never executed under instrumentation.',
        severity: 'warn',
        site: 'cart.domain.ts:12',
      },
      {
        code: 'FW403',
        domain: 'product',
        message: 'Declared domain was never observed written.',
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

  it('returns scoped capture observations as a completed snapshot', async () => {
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
    await lateWrite;

    expect(captured.observed.map((operation) => operation.table)).toEqual(['cart_items']);
    expect(verifier.observed.map((operation) => operation.table)).toEqual([
      'cart_items',
      'audit_log',
    ]);
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
      expectedDiagnostic('FW411', 'audit_log'),
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
