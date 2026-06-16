import { diagnosticDefinitions } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

const kv330 = diagnosticDefinitions.KV330;

describe('compiler direct db diagnostics', () => {
  it('reports KV330 when mutation handlers access request db directly', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  handler(input, request) {
    request.db.insert(cartItems).values(input);
    return input.productId;
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV330',
        fileName: 'cart.mutation.ts',
        message: kv330.message,
        severity: kv330.severity,
        start: { column: 5, line: 5 },
        length: 10,
      },
    ]);
  });

  it('reports KV330 for arrow mutation handlers that receive db directly', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  handler: async (input, db) => {
    await db.insert(cartItems).values(input);
    return input.productId;
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV330',
        fileName: 'cart.mutation.ts',
        message: kv330.message,
        severity: kv330.severity,
        start: { column: 26, line: 4 },
        length: 2,
      },
    ]);
  });

  it('reports KV330 for every mutation handler with direct db access', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  handler(input, request) {
    request.db.insert(cartItems).values(input);
  },
});

export const clearCart = mutation('cart/clear', {
  input: clearCartInput,
  handler(input, db) {
    db.delete(cartItems);
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV330',
        fileName: 'cart.mutation.ts',
        length: 10,
        message: kv330.message,
        severity: kv330.severity,
        start: { column: 5, line: 5 },
      },
      {
        code: 'KV330',
        fileName: 'cart.mutation.ts',
        length: 2,
        message: kv330.message,
        severity: kv330.severity,
        start: { column: 18, line: 11 },
      },
    ]);
  });

  it('does not report KV330 for domain-routed mutation handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  handler(input, request, context) {
    return cartDomain.addItem(input, request.session.user.id, context);
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores mutation handler text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
const sample = "export const bad = mutation('cart/add', { handler(input, request) { request.db.insert(cartItems).values(input); } });";
// export const bad = mutation('cart/add', { handler(input, db) { db.insert(cartItems).values(input); } });
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  handler(input, request, context) {
    return cartDomain.addItem(input, request.session.user.id, context);
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores direct-db-looking text inside real mutation handler strings', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  handler(input, request) {
    const message = "request.db.insert(cartItems)";
    const template = \`request.db.delete(cartItems)\`;
    return cartDomain.addItem(input, request.session.user.id, message + template);
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });
});
