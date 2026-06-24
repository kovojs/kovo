import { describe, expect, it } from 'vitest';

import { mutation, s, publicAccess } from '@kovojs/server';

import {
  createVerifiedFakeHarness,
  deferred,
  expectedDiagnostic,
  expectedDiagnosticMessage,
  type FakeDb,
} from './test-fixtures.js';

describe('@kovojs/test harness verifier integration', () => {
  it('verifies observed writes against the static touch graph after exec', async () => {
    const cartMutation = mutation('cart/add', {
      access: publicAccess('test fixture'),
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('cart_items', input.productId);
        return request.db.read('cart_items');
      },
    });
    const harness = createVerifiedFakeHarness({
      touchGraph: {
        'cart.addItem': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          cart_items: 'cart',
        },
      },
    });

    await expect(harness.exec(cartMutation, { productId: 'p1' })).resolves.toMatchObject({
      ok: true,
      value: ['p1'],
    });
  });

  it('exposes verification diagnostics through the harness context', async () => {
    const cartMutation = mutation('cart/add', {
      access: publicAccess('test fixture'),
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('cart_items', input.productId, { branch: 'cart-line' });
        return request.db.read('cart_items');
      },
    });
    const harness = createVerifiedFakeHarness({
      touchGraph: {
        'cart.addItem': {
          touches: [
            {
              branch: 'cart-line',
              domain: 'cart',
              keys: 'arg:productId',
              site: 'cart.domain.ts:1',
              via: 'cart_items',
            },
            {
              branch: 'stock-reserve',
              domain: 'product',
              keys: 'arg:productId',
              site: 'cart.domain.ts:2',
              via: 'products',
            },
          ],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          cart_items: 'cart',
          products: 'product',
        },
      },
    });

    await harness.exec(cartMutation, { productId: 'p1' });

    expect(harness.verificationDiagnostics()).toEqual([
      {
        branch: 'stock-reserve',
        code: 'KV405',
        domain: 'product',
        message: expectedDiagnosticMessage('KV405'),
        severity: 'error',
        site: 'cart.domain.ts:2',
      },
      {
        code: 'KV403',
        domain: 'product',
        message: expectedDiagnosticMessage('KV403'),
        severity: 'warn',
      },
    ]);
  });

  it('verifies raw SQL writes against the static touch graph', async () => {
    const cartMutation = mutation('cart/add', {
      access: publicAccess('test fixture'),
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.sql(`insert into cart_items (product_id) values ('${input.productId}')`);
        return input.productId;
      },
    });
    const harness = createVerifiedFakeHarness({
      touchGraph: {
        'cart.addItem': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          cart_items: 'cart',
        },
      },
    });

    await expect(harness.exec(cartMutation, { productId: 'p1' })).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
    expect(harness.dbHandle().read('cart_items')).toEqual([]);
  });

  it('fails verification when raw SQL writes outside KV406 coverage', async () => {
    const cartMutation = mutation('cart/add', {
      access: publicAccess('test fixture'),
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.sql(`update audit_log set product_id = '${input.productId}' where id = 'a1'`);
        return input.productId;
      },
    });
    const harness = createVerifiedFakeHarness({
      touchGraph: {
        'cart.addItem': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          audit_log: 'audit',
          cart_items: 'cart',
        },
      },
    });

    await expect(harness.exec(cartMutation, { productId: 'p1' })).rejects.toThrow(
      expectedDiagnostic('KV402', 'audit'),
    );
  });

  it('scopes observations to interleaved mutation exec calls', async () => {
    const releaseHandlers = deferred();
    const cartStarted = deferred();
    const auditStarted = deferred();
    const bothWritten = deferred();
    let writeCount = 0;
    const waitForBothWrites = async () => {
      writeCount += 1;
      if (writeCount === 2) bothWritten.resolve(undefined);
      await bothWritten.promise;
    };
    const cartMutation = mutation('cart/add', {
      access: publicAccess('test fixture'),
      csrf: false,
      input: s.object({ productId: s.string() }),
      async handler(input, request: { db: FakeDb }) {
        cartStarted.resolve(undefined);
        await releaseHandlers.promise;
        request.db.write('cart_items', input.productId);
        await waitForBothWrites();
        return input.productId;
      },
    });
    const auditMutation = mutation('audit/add', {
      access: publicAccess('test fixture'),
      csrf: false,
      input: s.object({ event: s.string() }),
      async handler(input, request: { db: FakeDb }) {
        auditStarted.resolve(undefined);
        await releaseHandlers.promise;
        request.db.write('audit_log', input.event);
        await waitForBothWrites();
        return input.event;
      },
    });
    const harness = createVerifiedFakeHarness({
      touchGraph: {
        'audit.add': {
          touches: [{ domain: 'audit', keys: null, site: 'audit.domain.ts:1', via: 'audit_log' }],
          unresolved: [],
        },
        'cart.add': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          audit_log: 'audit',
          cart_items: 'cart',
        },
      },
    });

    const cartExec = harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart.add' });
    const auditExec = harness.exec(
      auditMutation,
      { event: 'cart-add' },
      { touchGraphKey: 'audit.add' },
    );
    await Promise.all([cartStarted.promise, auditStarted.promise]);
    releaseHandlers.resolve(undefined);

    await expect(Promise.all([cartExec, auditExec])).resolves.toMatchObject([
      { ok: true, value: 'p1' },
      { ok: true, value: 'cart-add' },
    ]);
    expect(harness.verificationDiagnostics()).toEqual([]);
  });
});
