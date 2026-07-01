import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

const kv330 = diagnosticDefinitions.KV330;

describe('compiler direct db diagnostics', () => {
  it('reports KV330 when mutation handlers access request db directly', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation({
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
export const addToCart = mutation({
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
export const addToCart = mutation({
  input: addToCartInput,
  handler(input, request) {
    request.db.insert(cartItems).values(input);
  },
});

export const clearCart = mutation({
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
export const addToCart = mutation({
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
export const addToCart = mutation({
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
export const addToCart = mutation({
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

  it('reports KV330 when task run bodies write through module-level db handles', () => {
    const result = compileComponentModule({
      fileName: 'tasks.ts',
      source: `
export const sendReceipt = task({
  input: receiptInput,
  async run(args, ctx) {
    await appDb.insert(ownerTable).values({ ownerId: args.userId });
    await ctx.runMutation(recordReceipt, args);
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV330',
        fileName: 'tasks.ts',
        message: 'Direct db access in a task run body; route through ctx.runMutation.',
        severity: kv330.severity,
        start: { column: 11, line: 5 },
        length: 12,
      },
    ]);
  });

  it('reports KV330 when task run bodies write through the app db provider', () => {
    const result = compileComponentModule({
      fileName: 'tasks.ts',
      source: `
import { appRuntimeDbProvider } from './db.js';

export const sendReceipt = task({
  input: receiptInput,
  async run(args, ctx) {
    await appRuntimeDbProvider().insert(ownerTable).values({ ownerId: args.userId });
    await ctx.runMutation(recordReceipt, args);
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV330',
        fileName: 'tasks.ts',
        message: 'Direct db access in a task run body; route through ctx.runMutation.',
        severity: kv330.severity,
      },
    ]);
  });

  it('does not report KV330 for task bodies that compose through ctx', () => {
    const result = compileComponentModule({
      fileName: 'tasks.ts',
      source: `
export const sendReceipt = task({
  input: receiptInput,
  async run(args, ctx) {
    await ctx.runQuery(orderQuery, { id: args.orderId });
    await ctx.runMutation(recordReceipt, args);
    await ctx.schedule(sendReceipt, args);
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports KV330 when webhook handlers write through the app db provider', () => {
    const result = compileComponentModule({
      fileName: 'webhooks.ts',
      source: `
import { webhook } from '@kovojs/server';
import { appRuntimeDbProvider } from './db.js';

export const paymentWebhook = webhook('/webhooks/payment', {
  access: verifiedMachineAccess('payment signature'),
  auth: paymentSignatureAuth,
  async handler(request) {
    await appRuntimeDbProvider().insert(payments).values({ id: request.headers.get('x-id') });
    return Response.json({ ok: true });
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV330',
        fileName: 'webhooks.ts',
        message:
          'Direct db access in a webhook handler; route writes through an audited mutation/domain write.',
        severity: kv330.severity,
      },
    ]);
  });

  it('reports KV330 when endpoint handlers write through the app db provider', () => {
    const result = compileComponentModule({
      fileName: 'endpoints.ts',
      source: `
import { endpoint, publicAccess } from '@kovojs/server';
import { appRuntimeDbProvider } from './db.js';

export const unsafeEndpoint = endpoint('/api/unsafe', {
  access: publicAccess('test'),
  auth: { kind: 'none', justification: 'test' },
  csrf: false,
  csrfJustification: 'test',
  method: 'POST',
  async handler(request) {
    await appRuntimeDbProvider().insert(payments).values({ id: await request.text() });
    return Response.json({ ok: true });
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV330',
        fileName: 'endpoints.ts',
        message:
          'Direct db access in an endpoint handler; use readonlyAppDb for reads and route writes through an audited mutation/domain write.',
        severity: kv330.severity,
      },
    ]);
  });

  it('reports KV330 when endpoint handlers write through the read-only app db handle', () => {
    const result = compileComponentModule({
      fileName: 'endpoints.ts',
      source: `
import { endpoint, publicAccess } from '@kovojs/server';
import { readonlyAppDb } from './db.js';

export const unsafeEndpoint = endpoint('/api/unsafe', {
  access: publicAccess('test'),
  auth: { kind: 'none', justification: 'test' },
  csrf: false,
  csrfJustification: 'test',
  method: 'POST',
  async handler() {
    await readonlyAppDb.insert(payments).values({ id: 'p1' });
    return Response.json({ ok: true });
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV330',
        fileName: 'endpoints.ts',
        message:
          'Direct db access in an endpoint handler; use readonlyAppDb for reads and route writes through an audited mutation/domain write.',
        severity: kv330.severity,
      },
    ]);
  });

  it('does not report KV330 for endpoint reads through the read-only app db handle', () => {
    const result = compileComponentModule({
      fileName: 'endpoints.ts',
      source: `
import { endpoint, publicAccess } from '@kovojs/server';
import { readonlyAppDb } from './db.js';

export const countEndpoint = endpoint('/api/count', {
  access: publicAccess('test'),
  auth: { kind: 'none', justification: 'test' },
  csrf: false,
  csrfJustification: 'test',
  method: 'GET',
  async handler() {
    const rows = await readonlyAppDb.select().from(payments);
    return Response.json({ count: rows.length });
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });
});
