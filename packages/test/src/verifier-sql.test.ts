import { describe, expect, it } from 'vitest';

import { domain, mutation, s } from '@jiso/server';

import { createDbVerifier, createJisoTestHarness } from './index.js';
import { createFakeDb, type FakeDb } from './test-fixtures.js';

describe('@jiso/test SQL verifier integration', () => {
  it('verifies insert-select SQL as a target write plus source reads', async () => {
    const productImport = mutation('product/import', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      registry: {
        touches: [domain('product')],
      },
      handler(_input, request: { db: FakeDb }) {
        request.db.sql(
          [
            'insert into product_snapshots (product_id, name)',
            'select products.id, products.name',
            'from products',
            'join vendors on vendors.id = products.vendor_id',
          ].join(' '),
        );
        return 'ok';
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'product.import': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'product.ts:2',
              source: 'insert-select',
              via: 'products',
            },
            {
              domain: 'vendor',
              keys: null,
              site: 'product.ts:3',
              source: 'insert-select',
              via: 'vendors',
            },
          ],
          touches: [
            { domain: 'product', keys: null, site: 'product.ts:1', via: 'product_snapshots' },
          ],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          product_snapshots: 'product',
          products: 'product',
          vendors: 'vendor',
        },
      },
    });

    await expect(harness.exec(productImport, { productId: 'p1' })).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });

    const verifier = createDbVerifier(
      {},
      {
        domainByTable: {
          product_snapshots: 'product',
          products: 'product',
          vendors: 'vendor',
        },
      },
    );
    const db = verifier.wrap(createFakeDb());
    db.sql(
      'insert into product_snapshots select products.id from products join vendors on vendors.id = products.vendor_id',
    );

    expect(() => verifier.assertReadsCovered(['product', 'vendor'])).not.toThrow();
    expect(() => verifier.assertReadsCovered(['product'])).toThrow(
      'FW407 Query read from undeclared domain: vendor',
    );
  });

  it('fails mutation exec when insert-select reads are missing from the touch graph', async () => {
    const productImport = mutation('product/import', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      registry: {
        touches: [domain('product')],
      },
      handler(_input, request: { db: FakeDb }) {
        request.db.sql(
          [
            'insert into product_snapshots (product_id, name)',
            'select products.id, products.name',
            'from products',
            'join vendors on vendors.id = products.vendor_id',
          ].join(' '),
        );
        return 'ok';
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'product.import': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'product.ts:2',
              source: 'insert-select',
              via: 'products',
            },
          ],
          touches: [
            { domain: 'product', keys: null, site: 'product.ts:1', via: 'product_snapshots' },
          ],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          product_snapshots: 'product',
          products: 'product',
          vendors: 'vendor',
        },
      },
    });

    await expect(harness.exec(productImport, { productId: 'p1' })).rejects.toThrow(
      'FW407 Query read from undeclared domain: vendor',
    );
  });

  it('does not let unscoped FW406 cover missing mutation read domains', async () => {
    const productImport = mutation('product/import', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(_input, request: { db: FakeDb }) {
        request.db.sql(
          [
            'insert into product_snapshots (product_id, name)',
            'select products.id, vendors.name',
            'from products',
            'join vendors on vendors.id = products.vendor_id',
          ].join(' '),
        );
        return 'ok';
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'product.import': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'product.ts:2',
              source: 'insert-select',
              via: 'products',
            },
          ],
          touches: [
            { domain: 'product', keys: null, site: 'product.ts:1', via: 'product_snapshots' },
          ],
          unresolved: [
            {
              code: 'FW406',
              message: 'Statically un-analyzable write site; manual touches required.',
              site: 'product.ts:9',
            },
          ],
        },
      },
      verification: {
        domainByTable: {
          product_snapshots: 'product',
          products: 'product',
          vendors: 'vendor',
        },
      },
    });

    await expect(harness.exec(productImport, { productId: 'p1' })).rejects.toThrow(
      'FW407 Query read from undeclared domain: vendor',
    );
  });

  it('scopes mutation-read verification to the executed mutation graph entry', async () => {
    const productImport = mutation('product/import', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(_input, request: { db: FakeDb }) {
        request.db.sql(
          [
            'insert into product_snapshots (product_id, name)',
            'select products.id, vendors.name',
            'from products',
            'join vendors on vendors.id = products.vendor_id',
          ].join(' '),
        );
        return 'ok';
      },
    });
    const harness = createJisoTestHarness({
      db: createFakeDb(),
      touchGraph: {
        'product/import': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'product.ts:2',
              source: 'insert-select',
              via: 'products',
            },
          ],
          touches: [
            { domain: 'product', keys: null, site: 'product.ts:1', via: 'product_snapshots' },
          ],
          unresolved: [],
        },
        'vendor/import': {
          reads: [
            {
              domain: 'vendor',
              keys: null,
              site: 'vendor.ts:2',
              source: 'insert-select',
              via: 'vendors',
            },
          ],
          touches: [],
          unresolved: [],
        },
      },
      verification: {
        domainByTable: {
          product_snapshots: 'product',
          products: 'product',
          vendors: 'vendor',
        },
      },
    });

    await expect(
      harness.exec(productImport, { productId: 'p1' }, { touchGraphKey: 'product/import' }),
    ).rejects.toThrow('FW407 Query read from undeclared domain: vendor');
  });

  it('verifies update-from SQL as a target write plus source reads', () => {
    const verifier = createDbVerifier(
      {
        'product.syncPrice': {
          reads: [
            {
              domain: 'price',
              keys: null,
              site: 'product.ts:2',
              source: 'update-from',
              via: 'prices',
            },
          ],
          touches: [{ domain: 'product', keys: null, site: 'product.ts:1', via: 'products' }],
          unresolved: [],
        },
      },
      { domainByTable: { prices: 'price', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql(
      'update products set price = prices.amount from prices where prices.product_id = products.id',
    );

    expect(() => verifier.assertCovered()).not.toThrow();
    expect(() => verifier.assertReadsCovered(['price'])).not.toThrow();
    expect(() => verifier.assertReadsCovered(['product'])).toThrow(
      'FW407 Query read from undeclared domain: price',
    );
  });

  it('verifies update expression subqueries as mutation reads', () => {
    const verifier = createDbVerifier(
      {
        'product.syncPrice': {
          touches: [{ domain: 'product', keys: null, site: 'product.ts:1', via: 'products' }],
          unresolved: [],
        },
      },
      { domainByTable: { prices: 'price', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql(
      'update products set unit_price = (select max(amount) from prices) where id in (select product_id from prices)',
    );

    expect(() => verifier.assertCovered()).toThrow(
      'FW407 Query read from undeclared domain: price',
    );
  });

  it('verifies select expression subqueries as query reads', () => {
    const verifier = createDbVerifier(
      {
        'product.load': {
          reads: [
            {
              domain: 'product',
              keys: null,
              site: 'product.ts:1',
              source: 'select',
              via: 'products',
            },
          ],
          touches: [],
          unresolved: [],
        },
      },
      { domainByTable: { prices: 'price', products: 'product' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql('select * from products where id in (select product_id from prices)');

    expect(() => verifier.assertReadsCovered(['product'])).toThrow(
      'FW407 Query read from undeclared domain: price',
    );
    expect(() => verifier.assertReadsCovered(['product', 'price'])).not.toThrow();
  });

  it('checks row keys parsed from raw SQL predicates', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql("update products set reserved = true where sku = 'sku-1'");

    expect(() => verifier.assertCovered()).toThrow(
      'FW408 Declared row key differs from observed row predicate: products expected id observed sku',
    );
  });

  it('accepts raw SQL compound predicates when one observed row key matches', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql("update products set reserved = true where sku = 'sku-1' and id = 'p1'");

    expect(() => verifier.assertCovered()).not.toThrow();
  });

  it('reports all raw SQL predicate keys when none matches the declared row key', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql("update products set reserved = true where sku = 'sku-1' and slug = 'beans'");

    expect(() => verifier.assertCovered()).toThrow(
      'FW408 Declared row key differs from observed row predicate: products expected id observed sku, slug',
    );
  });

  it('checks row keys parsed from raw SQL delete predicates', () => {
    const verifier = createDbVerifier(
      {
        'product.delete': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.sql("delete from public.products where sku = 'sku-1'");

    expect(() => verifier.assertCovered()).toThrow(
      'FW408 Declared row key differs from observed row predicate: products expected id observed sku',
    );
  });

  it('fails verification when an observed write predicate uses the wrong row key', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('products', { id: 'p1' }, { rowKey: 'sku' });

    expect(() => verifier.assertCovered()).toThrow(
      'FW408 Declared row key differs from observed row predicate: products expected id observed sku',
    );
  });

  it('fails verification when a keyed static write has no observed row predicate', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('products', { id: 'p1' });

    expect(() => verifier.assertCovered()).toThrow(
      'FW408 Declared row key differs from observed row predicate: products expected id observed <missing>',
    );
  });

  it('accepts observed row predicates that match the declared table key', () => {
    const verifier = createDbVerifier(
      {
        'product.reserve': {
          touches: [
            { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
          ],
          unresolved: [],
        },
      },
      { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
    );
    const db = verifier.wrap(createFakeDb());

    db.write('products', { id: 'p1' }, { rowKey: 'id' });

    expect(() => verifier.assertCovered()).not.toThrow();
  });
});
