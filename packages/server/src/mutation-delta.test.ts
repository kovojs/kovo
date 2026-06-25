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
          item.productId === 'p0'
            ? { ...item, qty: 2, title: '<img src=x onerror="alert(1)">' }
            : item,
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
      buildToken: 'delta-build-token',
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
    expect(response.body).not.toContain('<img src=x onerror=');

    const wire = parseSingleQueryWire(response.body);
    expect(wire).toMatchObject({ delta: true, name: 'cart' });
    expect(wire.value).toMatchObject({
      lists: {
        items: {
          key: 'productId',
          upsert: [
            {
              productId: 'p0',
              qty: 2,
              title: '<img src=x onerror="alert(1)">',
            },
          ],
        },
      },
    });
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
      buildToken: 'delta-build-token',
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
      buildToken: 'delta-build-token',
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
      buildToken: 'delta-build-token',
      fragment: true,
      rawInput: { productId: 'p1' },
      request: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).not.toContain(' delta>');
    expect(response.body).toContain('"count":1');
  });
});

function parseSingleQueryWire(body: string): {
  delta: boolean;
  name: string;
  value: unknown;
} {
  const match = /^<kovo-query\s+([^>]*)>([\s\S]*)<\/kovo-query>$/.exec(body.trim());
  if (!match) throw new Error(`Expected one kovo-query chunk, got: ${body}`);
  const [, attributes = '', encodedJson = ''] = match;
  const nameMatch = /\bname="([^"]+)"/.exec(attributes);
  if (!nameMatch) throw new Error(`Missing query name in: ${body}`);

  return {
    delta: /\sdelta(?:\s|$)/.test(` ${attributes} `),
    name: decodeHtmlText(nameMatch[1] ?? ''),
    value: JSON.parse(decodeHtmlText(encodedJson)),
  };
}

function decodeHtmlText(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

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

  it('fails closed when buildToken is absent on a successful mutation wire response', async () => {
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

    expect(response.status).toBe(500);
    expect(response.body).toContain('data-error-code="RENDER_ERROR"');
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
