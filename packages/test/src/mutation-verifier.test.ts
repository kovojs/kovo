import { describe, expect, it } from 'vitest';

import { mutation, s } from '@jiso/server';

import { createJisoTestHarness } from './index.js';
import { createFakeDb, type FakeDb } from './test-fixtures.js';

describe('@jiso/test mutation verifier', () => {
  it('fails verification for writes to domains outside the static graph', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('audit_log', input.productId);
        return input.productId;
      },
    });
    const harness = createJisoTestHarness({
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
      'FW402 Write touched an undeclared domain: audit',
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
    const harness = createJisoTestHarness({
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
    ).rejects.toThrow('FW402 Write touched an undeclared domain: product');
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
    const harness = createJisoTestHarness({
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

  it('keeps scoped FW406 coverage tied to the executed mutation graph entry', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('audit_log', input.productId);
        return input.productId;
      },
    });
    const harness = createJisoTestHarness({
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
              code: 'FW406',
              domain: 'audit',
              message: 'Statically un-analyzable write site; manual touches required.',
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
    ).rejects.toThrow('FW402 Write touched an undeclared domain: audit');
  });

  it('allows scoped writes covered by same-entry FW406 annotations', async () => {
    const cartMutation = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: { db: FakeDb }) {
        request.db.write('audit_log', input.productId);
        return input.productId;
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'cart/add': {
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
    const harness = createJisoTestHarness({
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
    const harness = createJisoTestHarness({
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
      'FW404 Write to unmapped table: unknown_table',
    );
  });
});
