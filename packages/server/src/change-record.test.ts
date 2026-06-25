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

  it('narrows a keyed change to canonical per-row instance keys of the touched domain (SPEC §10.2:1019)', () => {
    // Canonical currency is `name:keyValue` (`product:p1`) — NO `via`/source-table
    // segment, even when the change record carries one. A per-row reader of domain
    // `product` is named `product`, so the canonical key prefix is the domain.
    expect(
      changeRecordTouchesQueryInstance(
        { domain: 'product', keys: ['p1'], via: 'products' },
        'product:p1',
      ),
    ).toBe(true);
    // L2-invalidation-2: a SIBLING single-row reader of the same domain must NOT
    // rerun — the old `domain:via:key` matcher over-invalidated every sibling.
    expect(
      changeRecordTouchesQueryInstance(
        { domain: 'product', keys: ['p1'], via: 'products' },
        'product:p2',
      ),
    ).toBe(false);
    // A key prefixed by a different query name reading the domain is not a provable
    // single-row identity → over-invalidate (SPEC §10.1).
    expect(
      changeRecordTouchesQueryInstance(
        { domain: 'product', keys: ['p1'], via: 'products' },
        'productDetail:p2',
      ),
    ).toBe(true);
    // A key for a different domain prefix never matches this change's domain.
    expect(
      changeRecordTouchesQueryInstance(
        { domain: 'product', keys: ['p1'], via: 'products' },
        'cart:p1',
      ),
    ).toBe(true);
    // A whole-domain change (no keys) reruns every reader.
    expect(changeRecordTouchesQueryInstance({ domain: 'product' }, 'product:p1')).toBe(true);
  });

  it('A4: a keyed change reruns a LIST/AGGREGATE reader of the same domain (SPEC §1.1:19, §10.1)', () => {
    // The canonical SPEC §1.1:19 stale-list bug: a list/aggregate/session-scoped
    // reader is NOT a single-row identity of the domain, so a keyed change must
    // still rerun it rather than silently leave it stale.
    expect(
      changeRecordTouchesQueryInstance(
        { domain: 'order', keys: ['o1'], via: 'orders' },
        'orders-page:1',
      ),
    ).toBe(true);
    expect(
      changeRecordTouchesQueryInstance(
        { domain: 'cart', keys: ['u7'], via: 'carts' },
        'cartTotal:u7',
      ),
    ).toBe(true);
    expect(
      changeRecordTouchesQueryInstance(
        { domain: 'product', keys: ['p1'], via: 'products' },
        'productsByCat:electronics',
      ),
    ).toBe(true);
  });

  it('over-invalidates legacy same-domain keys whose value is not a provable single row', () => {
    // `product:p1` is a provable single-row identity → narrow to the touched key.
    expect(
      changeRecordTouchesQueryInstance({ domain: 'product', keys: ['p1'] }, 'product:p1'),
    ).toBe(true);
    expect(
      changeRecordTouchesQueryInstance({ domain: 'product', keys: ['p1'] }, 'product:p2'),
    ).toBe(false);
    // A composite value after the domain is not a single row → over-invalidate.
    expect(
      changeRecordTouchesQueryInstance({ domain: 'product', keys: ['p1'] }, 'product:p2:variant'),
    ).toBe(true);
    expect(changeRecordTouchesQueryInstance({ domain: 'product', keys: ['p1'] }, 'cart:p1')).toBe(
      true,
    );
  });

  it('narrows per-row instances and over-invalidates non-row readers of the same domain (canonical §10.2 keys)', async () => {
    // Canonical per-row identity of domain `catalog` is `catalog:<key>` (name == domain).
    const catalog = domain('catalog');
    const catalogP1 = query('catalog', {
      instanceKey: 'catalog:p1',
      reads: [catalog],
    });
    const catalogP2 = query('catalog', {
      instanceKey: 'catalog:p2',
      reads: [catalog],
    });
    // A differently-named reader of the same domain is NOT a provable single-row
    // identity → it over-invalidates (reruns) on any keyed catalog change.
    const priceP2 = query('priceDetail', {
      instanceKey: 'priceDetail:p2',
      reads: [catalog],
    });
    const updateProduct = mutation('catalog/product/update', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'catalog', keys: 'arg:productId', via: 'products' }],
        queries: [catalogP1, catalogP2, priceP2],
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
      rerunQueries: ['catalog', 'priceDetail'],
      rerunQueryInstances: [
        { instanceKey: 'catalog:p1', key: 'catalog' },
        { instanceKey: 'priceDetail:p2', key: 'priceDetail', whole: true },
      ],
      value: 'p1',
    });
  });

  it('renders narrowed + over-invalidated same-domain instances after one row mutates', async () => {
    const catalog = domain('catalog');
    // Sibling per-row instance `catalog:p2` must NOT rerun when `p1` is touched.
    const catalogP2 = query('catalog', {
      instanceKey: 'catalog:p2',
      load: () => ({ id: 'p2', title: 'Catalog p2' }),
      reads: [catalog],
    });
    // Non-row reader of the domain reruns (over-invalidate).
    const priceP2 = query('priceDetail', {
      instanceKey: 'priceDetail:p2',
      load: () => ({ id: 'p2', amount: 25 }),
      reads: [catalog],
    });
    const updateProduct = mutation('catalog/product/render-update', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'catalog', keys: 'arg:productId', via: 'products' }],
        queries: [catalogP2, priceP2],
      },
      handler(input) {
        return input.productId;
      },
    });

    const response = await renderMutationResponse(updateProduct, {
      buildToken: 'change-record-test-build',
      fragment: true,
      rawInput: { productId: 'p1' },
      request: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).not.toContain('key="catalog:p2"');
    expect(response.body).toContain(
      '<kovo-query name="priceDetail" key="priceDetail:p2">{"id":"p2","amount":25}</kovo-query>',
    );
  });

  it('A4: a LIST query reading the touched domain appears in rerunQueries (SPEC §1.1:19)', async () => {
    const order = domain('order');
    // A list reader keyed `orderList:active` reads the `order` domain but is not a
    // single-row identity; today it is silently excluded and renders stale data.
    const orderList = query('orderList', {
      instanceKey: 'orderList:active',
      load: () => ({ orders: ['o1', 'o2'] }),
      reads: [order],
    });
    const reserveOrder = mutation('order/reserve', {
      input: s.object({ orderId: s.string() }),
      registry: {
        inferredTouches: [{ domain: 'order', keys: 'arg:orderId', via: 'orders' }],
        queries: [orderList],
      },
      handler(input) {
        return input.orderId;
      },
    });

    await expect(runMutation(reserveOrder, { orderId: 'o1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'order',
          input: { orderId: 'o1' },
          keys: ['o1'],
          via: 'orders',
        },
      ],
      ok: true,
      rerunQueries: ['orderList'],
      rerunQueryInstances: [{ instanceKey: 'orderList:active', key: 'orderList', whole: true }],
      value: 'o1',
    });
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
        buildToken: 'change-record-test-build',
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
      buildToken: 'change-record-test-build',
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
