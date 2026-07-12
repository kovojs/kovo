import { describe, expect, it } from 'vitest';

import { mutation, s } from '@kovojs/server';

import { createKovoTestHarness } from './harness.js';
import {
  createFakeDb,
  expectedDiagnostic,
  expectedDiagnosticMessage,
  type FakeDb,
} from './test-fixtures.js';

describe('@kovojs/test mutation verifier', () => {
  it('fails verification for writes to domains outside the static graph', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('audit_log', input.productId);
        return input.productId;
      },
    });
    const harness = createKovoTestHarness({
      db: createFakeDb(),
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

  it('scopes harness write verification to the executed mutation graph entry', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('products', input.productId);
        return input.productId;
      },
    });
    const harness = createKovoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart/add': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
        'product/update': {
          touches: [
            { domain: 'product', keys: null, site: 'product.domain.ts:1', via: 'products' },
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

    await expect(
      harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart/add' }),
    ).rejects.toThrow(expectedDiagnostic('KV402', 'product'));
  });

  it('C167 rejects undeclared standalone reads performed by a mutation handler', async () => {
    const cartMutation = mutation('cart/read-product', {
      csrf: false,
      input: s.object({}),
      handler(_input, request: { db: FakeDb }) {
        return request.db.read('products');
      },
    });
    const harness = createKovoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart/read-product': {
          reads: [],
          touches: [],
          unresolved: [],
        },
      },
      verification: { domainByTable: { products: 'product' } },
    });

    await expect(
      harness.exec(cartMutation, {}, { touchGraphKey: 'cart/read-product' }),
    ).rejects.toThrow(expectedDiagnostic('KV407', 'product'));
  });

  it('C167 accepts a standalone mutation read declared in the immutable graph', async () => {
    const cartMutation = mutation('cart/read-product', {
      csrf: false,
      input: s.object({}),
      handler(_input, request: { db: FakeDb }) {
        return request.db.read('products');
      },
    });
    const harness = createKovoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart/read-product': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'cart.ts:1',
              source: 'products',
              via: 'products',
            },
          ],
          touches: [],
          unresolved: [],
        },
      },
      verification: { domainByTable: { products: 'product' } },
    });

    await expect(
      harness.exec(cartMutation, {}, { touchGraphKey: 'cart/read-product' }),
    ).resolves.toMatchObject({ ok: true, value: [] });
  });

  it('C145 snapshots the touch graph key before a mutation can switch verification scope', async () => {
    const execOptions = { touchGraphKey: 'cart/add' };
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        execOptions.touchGraphKey = 'product/update';
        request.db.write('products', input.productId);
        return input.productId;
      },
    });
    const harness = createKovoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart/add': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
        'product/update': {
          touches: [
            { domain: 'product', keys: null, site: 'product.domain.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      verification: { domainByTable: { cart_items: 'cart', products: 'product' } },
    });

    await expect(harness.exec(cartMutation, { productId: 'p1' }, execOptions)).rejects.toThrow(
      expectedDiagnostic('KV402', 'product'),
    );
  });

  it('uses explicit harness touch graph keys when mutation keys differ from graph entries', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('cart_items', input.productId);
        return input.productId;
      },
    });
    const harness = createKovoTestHarness({
      db: createFakeDb(),
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

    await expect(
      harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart.addItem' }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
  });

  it('keeps scoped KV406 coverage tied to the executed mutation graph entry', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('audit_log', input.productId);
        return input.productId;
      },
    });
    const harness = createKovoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart/add': {
          touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
          unresolved: [],
        },
        'audit/raw': {
          touches: [],
          unresolved: [
            {
              code: 'KV406',
              domain: 'audit',
              message: expectedDiagnosticMessage('KV406'),
              site: 'audit.domain.ts:1',
            },
          ],
        },
      },
      verification: {
        domainByTable: {
          audit_log: 'audit',
          cart_items: 'cart',
        },
      },
    });

    await expect(
      harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart/add' }),
    ).rejects.toThrow(expectedDiagnostic('KV402', 'audit'));
  });

  it('allows scoped writes covered by same-entry KV406 annotations', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('audit_log', input.productId);
        return input.productId;
      },
    });
    const harness = createKovoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart/add': {
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
      verification: {
        domainByTable: {
          audit_log: 'audit',
        },
      },
    });

    await expect(
      harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart/add' }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
  });

  it('checks only writes observed during the current mutation exec', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('cart_items', input.productId);
        return input.productId;
      },
    });
    const harness = createKovoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart/add': {
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

    harness.db.write('audit_log', 'previous');

    await expect(
      harness.exec(cartMutation, { productId: 'p1' }, { touchGraphKey: 'cart/add' }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
  });

  it('fails verification for writes to unmapped tables', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('unknown_table', input.productId);
        return input.productId;
      },
    });
    const harness = createKovoTestHarness({
      db: createFakeDb(),
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

    await expect(harness.exec(cartMutation, { productId: 'p1' })).rejects.toThrow(
      expectedDiagnostic('KV404', 'unknown_table'),
    );
  });
});
