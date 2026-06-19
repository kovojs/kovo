import { validateHeaderValue } from 'node:http';
import { describe, expect, it } from 'vitest';

import {
  changeRecordTouchesQueryInstance,
  invalidate,
  mutationRegistryChangeRecords,
  type ChangeRecord,
} from './change-record.js';
import { domain } from './domain.js';
import { renderMutationResponse, runMutation } from './mutation.js';
import { query } from './query.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

describe('server change records', () => {
  it('derives inferred mutation touch keys from arg:path sources', () => {
    const input = {
      item: {
        id: 'p1',
        variantIds: ['v1', 2, true, { ignored: true }],
      },
    };

    expect(
      mutationRegistryChangeRecords(
        {
          inferredTouches: [
            { domain: 'product', keys: 'arg:item.id', via: 'products' },
            { domain: 'product', keys: 'arg:item.id', via: 'products' },
            { domain: 'variant', keys: 'arg:item.variantIds' },
            { domain: 'cart', keys: null },
            { domain: 'ignored', keys: 'literal' },
          ],
        },
        input,
      ),
    ).toEqual([
      { domain: 'product', input, keys: ['p1'], via: 'products' },
      { domain: 'variant', input, keys: ['v1', '2', 'true'] },
      { domain: 'cart', input },
      { domain: 'ignored', input },
    ]);
  });

  it('matches change records against table-scoped query instance keys', () => {
    expect(
      changeRecordTouchesQueryInstance(
        { domain: 'product', keys: ['p1'], via: 'products' },
        'product:products:p1',
      ),
    ).toBe(true);
    expect(
      changeRecordTouchesQueryInstance(
        { domain: 'product', keys: ['p1'], via: 'products' },
        'product:products:p2',
      ),
    ).toBe(false);
    expect(
      changeRecordTouchesQueryInstance(
        { domain: 'product', keys: ['p1'], via: 'products' },
        'product:prices:p2',
      ),
    ).toBe(true);
    expect(
      changeRecordTouchesQueryInstance(
        { domain: 'product', keys: ['p1'], via: 'products' },
        'cart:products:p1',
      ),
    ).toBe(false);
    expect(changeRecordTouchesQueryInstance({ domain: 'product' }, 'product:products:p1')).toBe(
      true,
    );
  });

  it('over-invalidates legacy same-domain keyed instances when source table is unknown', () => {
    expect(
      changeRecordTouchesQueryInstance({ domain: 'product', keys: ['p1'] }, 'product:p1'),
    ).toBe(true);
    expect(
      changeRecordTouchesQueryInstance({ domain: 'product', keys: ['p1'] }, 'product:p2'),
    ).toBe(true);
    expect(changeRecordTouchesQueryInstance({ domain: 'product', keys: ['p1'] }, 'cart:p1')).toBe(
      false,
    );
  });

  it('invalidates same-domain query instances from another keyed table', async () => {
    const catalog = domain('catalog');
    const productP1 = query('productDetail', {
      instanceKey: 'catalog:products:p1',
      reads: [catalog],
    });
    const productP2 = query('productDetail', {
      instanceKey: 'catalog:products:p2',
      reads: [catalog],
    });
    const priceP2 = query('priceDetail', {
      instanceKey: 'catalog:prices:p2',
      reads: [catalog],
    });
    const updateProduct = mutation('catalog/product/update', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'catalog', keys: 'arg:productId', via: 'products' }],
        queries: [productP1, productP2, priceP2],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(updateProduct, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'catalog',
          input: { productId: 'p1' },
          keys: ['p1'],
          via: 'products',
        },
      ],
      ok: true,
      rerunQueries: ['productDetail', 'priceDetail'],
      rerunQueryInstances: [
        { instanceKey: 'catalog:products:p1', key: 'productDetail' },
        { instanceKey: 'catalog:prices:p2', key: 'priceDetail' },
      ],
      value: 'p1',
    });
  });

  it('renders same-domain query instances from another keyed table after one table mutates', async () => {
    const catalog = domain('catalog');
    const productP2 = query('productDetail', {
      instanceKey: 'catalog:products:p2',
      load: () => ({ id: 'p2', title: 'Catalog p2' }),
      reads: [catalog],
    });
    const priceP2 = query('priceDetail', {
      instanceKey: 'catalog:prices:p2',
      load: () => ({ id: 'p2', amount: 25 }),
      reads: [catalog],
    });
    const updateProduct = mutation('catalog/product/render-update', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'catalog', keys: 'arg:productId', via: 'products' }],
        queries: [productP2, priceP2],
      },
      handler(input) {
        return input.productId;
      },
    });

    const response = await renderMutationResponse(updateProduct, {
      fragment: true,
      rawInput: { productId: 'p1' },
      request: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).not.toContain('name="productDetail"');
    expect(response.body).toContain(
      '<kovo-query name="priceDetail" key="catalog:prices:p2">{"id":"p2","amount":25}</kovo-query>',
    );
  });

  it('emits manual invalidate escape-hatch records from mutation context', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const syncInventory = mutation('inventory/sync', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery, productQuery],
      },
      handler(input, _request, context) {
        context.invalidate(product, {
          input,
          keys: [input.productId],
          reason: 'external inventory webhook',
        });
        return input.productId;
      },
    });

    await expect(runMutation(syncInventory, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
          manual: true,
          reason: 'external inventory webhook',
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });
  });

  it('creates standalone manual invalidate records for external systems', () => {
    const product = domain('product');

    expect(invalidate(product, { keys: ['p1'], reason: 'stripe webhook' })).toEqual({
      domain: 'product',
      keys: ['p1'],
      manual: true,
      reason: 'stripe webhook',
    });
  });

  it('types change records by domain key and invalidation input', () => {
    const cart = domain('cart');
    const record = invalidate(cart, {
      input: { cartId: 'c1', quantity: 2 },
      keys: ['c1'],
    });
    const typed = record satisfies ChangeRecord<'cart', { cartId: string; quantity: number }>;
    const assertWrongDomainRejected = () => {
      // @ts-expect-error cart invalidation records cannot satisfy the product domain.
      const wrongDomain: ChangeRecord<'product', { cartId: string; quantity: number }> = record;
      return wrongDomain;
    };
    const assertWrongInputRejected = () => {
      // @ts-expect-error sku is not part of the invalidation input payload.
      const wrongInput: ChangeRecord<'cart', { sku: string }> = record;
      return wrongInput;
    };

    expect(typed).toEqual({
      domain: 'cart',
      input: { cartId: 'c1', quantity: 2 },
      keys: ['c1'],
      manual: true,
    });
    expect(assertWrongDomainRejected).toBeTypeOf('function');
    expect(assertWrongInputRejected).toBeTypeOf('function');
  });

  it('omits mutation input and manual reasons from Kovo-Changes headers', async () => {
    const cart = domain('cart');
    const addToCart = mutation('cart/add', {
      input: s.object({ cartId: s.string(), note: s.string(), productId: s.string() }),
      handler(input, _request, context) {
        context.invalidate(cart, {
          input,
          keys: [input.cartId],
          reason: 'manual refresh includes private note',
        });
        return input;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        rawInput: { cartId: 'c1', note: 'secret café token', productId: 'p1' },
        request: {},
      }),
    ).resolves.toMatchObject({
      headers: {
        'Kovo-Changes': '[{"domain":"cart","keys":["c1"]}]',
      },
      status: 200,
    });
  });

  it('keeps Kovo-Changes headers ASCII-safe when input and keys contain Unicode', async () => {
    const cart = domain('cart');
    const addToCart = mutation('cart/add', {
      input: s.object({ cartId: s.string(), note: s.string(), productId: s.string() }),
      handler(input, _request, context) {
        context.invalidate(cart, {
          input,
          keys: [input.cartId],
          reason: 'private reason',
        });
        return input;
      },
    });

    const response = await renderMutationResponse(addToCart, {
      rawInput: { cartId: '東京-🔐', note: 'secret café token'.repeat(256), productId: 'p1' },
      request: {},
    });
    const header = response.headers['Kovo-Changes'];

    expect(header).toBe('[{"domain":"cart","keys":["\\u6771\\u4eac-\\ud83d\\udd10"]}]');
    expect(header).toBeDefined();
    if (typeof header !== 'string') throw new Error('expected Kovo-Changes header');
    expect(header).not.toContain('secret');
    expect(header).not.toContain('café');
    expect(() => validateHeaderValue('Kovo-Changes', header)).not.toThrow();
    expect(JSON.parse(header)).toEqual([{ domain: 'cart', keys: ['東京-🔐'] }]);
  });
});
