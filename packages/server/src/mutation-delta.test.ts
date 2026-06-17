/**
 * Tests for change-record-scoped query delta selection in mutation responses
 * (SPEC §9.1.1) and the Kovo-Build header on 200 responses (SPEC §5.1).
 */
import { describe, expect, it } from 'vitest';

import { domain } from './domain.js';
import { renderMutationResponse } from './mutation.js';
import { query } from './query.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

// Helper: build a query value where the delta over a single-key update is
// smaller than shipping the full array (many large rows, one updated).
function largeCartValue() {
  return {
    // A large scalar array of description fields that are expensive to ship whole.
    items: Array.from({ length: 20 }, (_, i) => ({
      productId: `p${i}`,
      qty: 1,
      title: `Product ${i} - a very long title string that makes the full value large`,
      unitPrice: 1000 + i,
    })),
    totalPrice: 20000,
  };
}

// The delta for updating a single item p0 should be much smaller than shipping
// all 20 rows again.
function largeCartDeltaMeta() {
  return [{ domain: 'cart', key: 'productId', path: 'items' }] as const;
}

describe('prod wire deltas: query delta selection (SPEC §9.1.1)', () => {
  it('emits a delta query chunk when delta is smaller than full value', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      delta: largeCartDeltaMeta(),
      load: () => ({
        ...largeCartValue(),
        items: largeCartValue().items.map((item) =>
          item.productId === 'p0' ? { ...item, qty: 2 } : item,
        ),
      }),
      reads: [cart],
    });
    const updateItem = mutation('cart/update', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input, _request, context) {
        // Scope the change record to only p0.
        context.invalidate(cart, { keys: [input.productId] });
        return input.productId;
      },
    });

    const errors: unknown[] = [];
    const response = await renderMutationResponse(updateItem, {
      fragment: true,
      onError: (err) => {
        errors.push(err);
      },
      rawInput: { productId: 'p0' },
      request: {},
    });

    expect(
      errors,
      `render errors: ${JSON.stringify(errors.map((e) => (e instanceof Error ? e.message : e)))}`,
    ).toHaveLength(0);
    expect(response.status).toBe(200);

    // The delta chunk must carry the boolean `delta` attribute.
    expect(response.body).toContain(' delta>');
    // It should NOT contain the full large value (would have all 20 products).
    expect(response.body).not.toContain('"productId":"p10"');
    // It should contain the updated item for p0 in a delta envelope (lists or set).
    expect(response.body).toContain('"productId":"p0"');
  });

  it('emits a full query chunk when change records have no scoped keys (delta unsound)', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      delta: largeCartDeltaMeta(),
      load: () => largeCartValue(),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(_input) {
        // No keys in change record → whole collection may have changed → delta unsound.
        return 'ok';
      },
    });

    const response = await renderMutationResponse(addToCart, {
      fragment: true,
      rawInput: { productId: 'p0' },
      request: {},
    });

    expect(response.status).toBe(200);
    // Should ship the full value without `delta` attribute.
    expect(response.body).not.toContain(' delta>');
    expect(response.body).toContain('"totalPrice":20000');
  });

  it('emits a full query chunk when the delta would be larger than the full value', async () => {
    // A short full value: one item. Delta for one item is larger than the value itself.
    const cart = domain('cart');
    const cartQuery = query('cart', {
      delta: [{ domain: 'cart', key: 'productId', path: 'items' }],
      load: () => ({ items: [{ productId: 'p1', qty: 2 }] }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input, _request, context) {
        context.invalidate(cart, { keys: [input.productId] });
        return input.productId;
      },
    });

    const response = await renderMutationResponse(addToCart, {
      fragment: true,
      rawInput: { productId: 'p1' },
      request: {},
    });

    expect(response.status).toBe(200);
    // Full value is `{"items":[{"productId":"p1","qty":2}]}` ~ 42 chars.
    // Delta would be `{"lists":{"items":{"key":"productId","upsert":[{"productId":"p1","qty":2}]}}}` ~ 80 chars.
    // Delta is larger → server emits full without `delta` attribute.
    expect(response.body).not.toContain(' delta>');
    expect(response.body).toContain('"items":[{"productId":"p1","qty":2}]');
  });

  it('emits a full query chunk when query has no delta meta', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      // No delta field → always full regardless of change record scoping.
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(_input, _request, context) {
        context.invalidate(cart, { keys: ['p1'] });
        return 'ok';
      },
    });

    const response = await renderMutationResponse(addToCart, {
      fragment: true,
      rawInput: { productId: 'p1' },
      request: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).not.toContain(' delta>');
    expect(response.body).toContain('"count":1');
  });
});

describe('Kovo-Build header (SPEC §5.1, §9.1.1)', () => {
  it('emits Kovo-Build header on 200 when buildToken is set in the wire request', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input.productId;
      },
    });

    const response = await renderMutationResponse(addToCart, {
      buildToken: 'abc123token',
      fragment: true,
      rawInput: { productId: 'p1' },
      request: {},
    });

    expect(response.status).toBe(200);
    expect((response.headers as Record<string, string>)['Kovo-Build']).toBe('abc123token');
  });

  it('does not emit Kovo-Build header when buildToken is absent', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input.productId;
      },
    });

    const response = await renderMutationResponse(addToCart, {
      fragment: true,
      rawInput: { productId: 'p1' },
      request: {},
    });

    expect(response.status).toBe(200);
    expect((response.headers as Record<string, string>)['Kovo-Build']).toBeUndefined();
  });

  it('does not emit Kovo-Build header on non-200 responses', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({}),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', {});
      },
    });

    const response = await renderMutationResponse(addToCart, {
      buildToken: 'abc123token',
      fragment: true,
      rawInput: { productId: 'p1' },
      request: {},
    });

    expect(response.status).toBe(422);
    expect((response.headers as Record<string, string>)['Kovo-Build']).toBeUndefined();
  });
});
