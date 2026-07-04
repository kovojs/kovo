import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

const kv330 = diagnosticDefinitions.KV330;
const kv406 = diagnosticDefinitions.KV406;

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
        length: 17,
      },
    ]);
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'request.db', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'cart.mutation/add-to-cart' },
        path: 'request.db.insert',
        surface: 'mutation',
      }),
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
        start: { column: 11, line: 5 },
        length: 9,
      },
    ]);
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'db', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'cart.mutation/add-to-cart' },
        path: 'db.insert',
        surface: 'mutation',
      }),
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
        message: kv330.message,
        severity: kv330.severity,
        start: { column: 5, line: 5 },
        length: 17,
      },
      {
        code: 'KV330',
        fileName: 'cart.mutation.ts',
        length: 9,
        message: kv330.message,
        severity: kv330.severity,
        start: { column: 5, line: 12 },
      },
    ]);
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'request.db', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'cart.mutation/add-to-cart' },
        path: 'request.db.insert',
        surface: 'mutation',
      }),
      expect.objectContaining({
        canonicalTarget: { identity: 'db', provenance: 'property-access-path' },
        operationKind: 'delete',
        owner: { kind: 'key', value: 'cart.mutation/clear-cart' },
        path: 'db.delete',
        surface: 'mutation',
      }),
    ]);
  });

  it('reports KV330 for mutation handler aliases and destructured db handles', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation({
  handler(input, request) {
    const tx = request.db;
    const { db: destructuredDb } = request;
    tx.insert(cartItems).values(input);
    destructuredDb.delete(cartItems);
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV330',
        fileName: 'cart.mutation.ts',
        length: 9,
        message: kv330.message,
        severity: kv330.severity,
        start: { column: 5, line: 6 },
      },
      {
        code: 'KV330',
        fileName: 'cart.mutation.ts',
        length: 21,
        message: kv330.message,
        severity: kv330.severity,
        start: { column: 5, line: 7 },
      },
    ]);
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'tx', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'cart.mutation/add-to-cart' },
        path: 'tx.insert',
        surface: 'mutation',
      }),
      expect.objectContaining({
        canonicalTarget: { identity: 'destructuredDb', provenance: 'property-access-path' },
        operationKind: 'delete',
        owner: { kind: 'key', value: 'cart.mutation/add-to-cart' },
        path: 'destructuredDb.delete',
        surface: 'mutation',
      }),
    ]);
  });

  it('reports KV330 for mutation helper-wrapper callback db writes', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation({
  handler(input) {
    return withDb(async (db) => db.update(cartItems).set(input));
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
      },
    ]);
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'db', provenance: 'property-access-path' },
        operationKind: 'update',
        owner: { kind: 'key', value: 'cart.mutation/add-to-cart' },
        path: 'db.update',
        surface: 'mutation',
      }),
    ]);
  });

  it('reports KV406 for unresolved mutation write sinks', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation({
  async handler(input) {
    await dbFor(input.tenant).insert(cartItems).values(input);
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV406',
        fileName: 'cart.mutation.ts',
        message: 'Unresolved write sink in a mutation handler; route through domain.',
        severity: kv406.severity,
        start: { column: 11, line: 4 },
      },
    ]);
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'UNRESOLVED', provenance: 'unresolved-property-access' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'cart.mutation/add-to-cart' },
        path: 'UNRESOLVED',
        surface: 'mutation',
      }),
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

  it('keeps the commerce reference mutation free of handler db write sinks', () => {
    const source = readFileSync(
      new URL('../../../examples/commerce/src/domain.ts', import.meta.url),
      'utf8',
    );
    const result = compileComponentModule({
      fileName: 'examples/commerce/src/domain.ts',
      source,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV330')).toEqual([]);
    expect(result.handlerWriteSinkFacts.filter((fact) => fact.surface === 'mutation')).toEqual([]);
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
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'appDb', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'tasks/send-receipt' },
        path: 'appDb.insert',
        surface: 'task',
      }),
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

  it('reports KV406 for unresolved task run write sinks', () => {
    const result = compileComponentModule({
      fileName: 'tasks.ts',
      source: `
export const sendReceipt = task('email/send-receipt', {
  input: receiptInput,
  async run(args, ctx) {
    await dbFor(args.tenant).insert(ownerTable).values({ ownerId: args.userId });
    await ctx.runMutation(recordReceipt, args);
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV406',
        fileName: 'tasks.ts',
        message: 'Unresolved write sink in a task run body; route through ctx.runMutation.',
        severity: 'error',
        start: { column: 11, line: 5 },
      },
    ]);
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'UNRESOLVED', provenance: 'unresolved-property-access' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'email/send-receipt' },
        path: 'UNRESOLVED',
        surface: 'task',
      }),
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
    expect(result.handlerWriteSinkFacts).toEqual([]);
  });

  it('reports KV330 when webhook handlers with declared writes write through the app db provider', () => {
    const result = compileComponentModule({
      fileName: 'webhooks.ts',
      source: `
import { webhook } from '@kovojs/server';
import { appRuntimeDbProvider } from './db.js';

const payment = domain('payment');

export const paymentWebhook = webhook('/webhooks/payment', {
  access: verifiedMachineAccess('payment signature'),
  auth: paymentSignatureAuth,
  async handler(request) {
    await appRuntimeDbProvider().insert(payments).values({ id: request.headers.get('x-id') });
    return Response.json({ ok: true });
  },
  writes: [payment],
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
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'appRuntimeDbProvider()', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'path', value: '/webhooks/payment' },
        path: 'appRuntimeDbProvider().insert',
        surface: 'webhook',
      }),
    ]);
  });

  it('still reports KV330 for raw webhook DB writes next to context.runMutation', () => {
    const result = compileComponentModule({
      fileName: 'webhooks.ts',
      source: `
import { webhook } from '@kovojs/server';
import { appRuntimeDbProvider } from './db.js';

const payment = domain('payment');

export const paymentWebhook = webhook('/webhooks/payment', {
  async handler(input, context) {
    await context.runMutation(recordPayment, { id: input.id });
    await appRuntimeDbProvider().insert(payments).values({ id: input.id });
    return { ok: true };
  },
  idempotency: (input) => input.id,
  input: paymentInput,
  replayStore,
  verify: 'none',
  verifyJustification: 'fixture-only webhook test',
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
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'appRuntimeDbProvider()', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'path', value: '/webhooks/payment' },
        path: 'appRuntimeDbProvider().insert',
        surface: 'webhook',
      }),
    ]);
  });

  it('reports KV330 for webhook transaction raw-driver escape handles', () => {
    const result = compileComponentModule({
      fileName: 'webhooks.ts',
      source: `
import { webhook } from '@kovojs/server';

const payment = domain('payment');

export const paymentWebhook = webhook('/webhooks/payment', {
  async handler(input, context) {
    void (context.tx as unknown as { $client: unknown }).$client;
    void (context.tx as unknown as { session: unknown }).session;
    await context.runMutation(recordPayment, { id: input.id });
    return { ok: true };
  },
  idempotency: (input) => input.id,
  input: paymentInput,
  replayStore,
  verify: 'none',
  verifyJustification: 'fixture-only webhook test',
  writes: [payment],
});
`,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV330',
        fileName: 'webhooks.ts',
        message:
          'Direct db access in a webhook handler; route writes through an audited mutation/domain write.',
        severity: kv330.severity,
      }),
      expect.objectContaining({
        code: 'KV330',
        fileName: 'webhooks.ts',
        message:
          'Direct db access in a webhook handler; route writes through an audited mutation/domain write.',
        severity: kv330.severity,
      }),
    ]);
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'context.tx', provenance: 'property-access-path' },
        operationKind: 'raw-driver-escape',
        owner: { kind: 'path', value: '/webhooks/payment' },
        path: 'context.tx.$client',
        surface: 'webhook',
      }),
      expect.objectContaining({
        canonicalTarget: { identity: 'context.tx', provenance: 'property-access-path' },
        operationKind: 'raw-driver-escape',
        owner: { kind: 'path', value: '/webhooks/payment' },
        path: 'context.tx.session',
        surface: 'webhook',
      }),
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
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: {
          identity: 'appRuntimeDbProvider()',
          provenance: 'property-access-path',
        },
        operationKind: 'insert',
        owner: { kind: 'path', value: '/api/unsafe' },
        path: 'appRuntimeDbProvider().insert',
        surface: 'endpoint',
      }),
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
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'readonlyAppDb', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'path', value: '/api/unsafe' },
        path: 'readonlyAppDb.insert',
        surface: 'endpoint',
      }),
    ]);
  });

  it('reports KV330 when endpoint handlers write through storage put authority', () => {
    const result = compileComponentModule({
      fileName: 'endpoints.ts',
      source: `
import { endpoint, publicAccess } from '@kovojs/server';
import { storage } from './storage.js';

export const unsafeEndpoint = endpoint('/api/unsafe', {
  access: publicAccess('test'),
  auth: { kind: 'none', justification: 'test' },
  csrf: false,
  csrfJustification: 'test',
  method: 'POST',
  async handler() {
    await storage.put('receipts/endpoint.txt', 'bad');
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
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'storage', provenance: 'property-access-path' },
        operationKind: 'put',
        owner: { kind: 'path', value: '/api/unsafe' },
        path: 'storage.put',
        surface: 'endpoint',
      }),
    ]);
  });

  it('reports KV406 for unresolved endpoint write sinks', () => {
    const result = compileComponentModule({
      fileName: 'endpoints.ts',
      source: `
import { endpoint, publicAccess } from '@kovojs/server';

export const unsafeEndpoint = endpoint('/api/unsafe', {
  access: publicAccess('test'),
  auth: { kind: 'none', justification: 'test' },
  csrf: false,
  csrfJustification: 'test',
  method: 'POST',
  async handler(request) {
    await dbFor(request).insert(payments).values({ id: await request.text() });
    return Response.json({ ok: true });
  },
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV406',
        fileName: 'endpoints.ts',
        message:
          'Unresolved write sink in an endpoint handler; route writes through an audited mutation/domain write.',
        severity: kv406.severity,
      },
    ]);
    expect(result.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'UNRESOLVED', provenance: 'unresolved-property-access' },
        operationKind: 'insert',
        owner: { kind: 'path', value: '/api/unsafe' },
        path: 'UNRESOLVED',
        surface: 'endpoint',
      }),
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
    expect(result.handlerWriteSinkFacts).toEqual([]);
  });
});
