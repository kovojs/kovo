import { createHmac } from 'node:crypto';
import { customVerifier, hmacSignature } from '@kovojs/core';
import { stampTrustedSql } from '@kovojs/core/internal/sql-safety';
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { domain } from './domain.js';
import { runEndpoint, type EndpointRequest } from './endpoint.js';
import { assignDerivedWebhookName } from './internal/wire.js';
import { mutation } from './mutation.js';
import { s, SchemaValidationError } from './schema.js';
import {
  createMemoryWebhookReplayStore as createPublicMemoryWebhookReplayStore,
  runWebhook,
  webhook,
  type WebhookReplayReservation,
  type WebhookReplayStore,
  type WebhookTxDb,
  type WebhookWireResponse,
} from './webhook.js';

const WEBHOOK_HMAC_SECRET = '707172737475767778797a7b7c7d7e7f';

function signedRequest(body: string, signature: string): Request {
  return new Request('https://example.test/webhooks/stripe', {
    body,
    headers: {
      'content-type': 'application/json',
      'x-signature': signature,
    },
    method: 'POST',
  });
}

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_HMAC_SECRET).update(body).digest('hex');
}

describe('server webhook primitive', () => {
  it('strips ambient authorization before direct webhook verification and handling', async () => {
    const verifierViews: Array<[string | null, string | null, string | null]> = [];
    const handlerViews: Array<[string | null, string | null, string | null]> = [];
    const machineWebhook = webhook('/webhooks/machine', {
      handler(_input, context) {
        handlerViews.push([
          context.request.headers.get('authorization'),
          context.request.headers.get('proxy-authorization'),
          context.request.headers.get('x-machine-signature'),
        ]);
      },
      input: s.object({ id: s.string() }),
      verify: customVerifier('machine-signature', (request) => {
        verifierViews.push([
          request.headers.get('authorization'),
          request.headers.get('proxy-authorization'),
          request.headers.get('x-machine-signature'),
        ]);
        return request.headers.get('x-machine-signature') === 'sig_accepted';
      }),
    });
    const request = new Request('https://example.test/webhooks/machine', {
      body: JSON.stringify({ id: 'evt_1' }),
      headers: {
        Authorization: 'Basic victim-browser-credential',
        'Content-Type': 'application/json',
        'Proxy-Authorization': 'Basic victim-proxy-credential',
        'X-Machine-Signature': 'sig_accepted',
      },
      method: 'POST',
    });

    const result = await runWebhook(machineWebhook, request);

    expect(result.response.status).toBe(200);
    expect(verifierViews).toEqual([[null, null, 'sig_accepted']]);
    expect(handlerViews).toEqual([[null, null, 'sig_accepted']]);
  });

  it('types webhook transaction db as transaction-scoped without a public transaction opener', () => {
    type TxDb = {
      $client: { execute(statement: unknown): unknown };
      insert(id: string): void;
      rows: string[];
      session: { run(statement: unknown): unknown };
      transaction<Result>(run: (tx: unknown) => Result): Result;
    };

    const compileOnly = (tx: WebhookTxDb<TxDb>) => {
      tx.insert('evt_1');
      const rows: string[] = tx.rows;

      // @ts-expect-error webhook handler tx is already transaction-scoped.
      tx.transaction((nested) => nested);
      // @ts-expect-error WebhookTxDb hides raw driver escape handles; runtime denial remains the floor.
      tx.$client.execute('select 1');
      // @ts-expect-error WebhookTxDb hides raw driver escape handles; runtime denial remains the floor.
      tx.session.run('select 1');

      return rows;
    };

    void compileOnly;
  });

  it('exports a memory replay store that reserves, commits, and replays webhook responses', async () => {
    const store = createPublicMemoryWebhookReplayStore();
    const reservation = store.reserve('webhook:public-store', 'evt_1');
    expect(reservation).toBeTruthy();
    expect(store.reserve('webhook:public-store', 'evt_1')).toBeUndefined();

    const pending = store.get('webhook:public-store', 'evt_1');
    expect(pending).toBeInstanceOf(Promise);

    const response: WebhookWireResponse = {
      body: 'ok',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 200,
    };
    reservation?.commit(response);

    await expect(pending).resolves.toBe(response);
    expect(store.get('webhook:public-store', 'evt_1')).toBe(response);
  });

  it('rejects replay-store response accessors before status policy and wire status can disagree', async () => {
    let statusReads = 0;
    let handled = 0;
    const forged = {
      body: 'redirecting',
      headers: { Location: 'https://attacker.example/credential-capture' },
      get status() {
        statusReads += 1;
        return statusReads < 3 ? 200 : 302;
      },
    } as unknown as WebhookWireResponse;
    const replayStore: WebhookReplayStore = {
      get() {
        return forged;
      },
      reserve() {
        return undefined;
      },
      set() {},
    };
    const declaration = webhook('/webhooks/replay-wire-carrier', {
      handler() {
        handled += 1;
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
    });

    await expect(
      runWebhook(
        declaration,
        new Request('https://example.test/webhooks/replay-wire-carrier', {
          body: JSON.stringify({ id: 'evt_forged_wire' }),
          method: 'POST',
        }),
      ),
    ).rejects.toThrow(/Webhook replay response\.status/);
    expect(statusReads).toBe(0);
    expect(handled).toBe(0);
  });

  it('keeps committed webhook truth under selective Map.get/has and clock poisoning', () => {
    const store = createPublicMemoryWebhookReplayStore({ ttlMs: 60_000 });
    const response: WebhookWireResponse = { body: 'committed', headers: {}, status: 200 };
    store.set('webhook:public-store', 'evt_1', response);

    const originalDateNow = Date.now;
    const originalMapGet = Map.prototype.get;
    const originalMapHas = Map.prototype.has;
    let duplicateReservation: WebhookReplayReservation | undefined;
    let replayed: ReturnType<typeof store.get> = undefined;
    try {
      Date.now = () => originalDateNow() + 365 * 24 * 60 * 60_000;
      Map.prototype.get = function (key: unknown) {
        if (typeof key === 'string' && key.includes('public-store') && key.includes('evt_1')) {
          return undefined;
        }
        return originalMapGet.call(this, key);
      };
      Map.prototype.has = function (key: unknown) {
        if (typeof key === 'string' && key.includes('public-store') && key.includes('evt_1')) {
          return false;
        }
        return originalMapHas.call(this, key);
      };

      duplicateReservation = store.reserve('webhook:public-store', 'evt_1');
      replayed = store.get('webhook:public-store', 'evt_1');
    } finally {
      Date.now = originalDateNow;
      Map.prototype.get = originalMapGet;
      Map.prototype.has = originalMapHas;
    }

    expect(duplicateReservation).toBeUndefined();
    expect(replayed).toBe(response);
  });

  it('generation-fences a superseded webhook reservation from newer committed truth', async () => {
    const store = createPublicMemoryWebhookReplayStore();
    const stale = store.reserve('webhook:public-store', 'evt_1');
    const joined = store.get('webhook:public-store', 'evt_1');
    const newer: WebhookWireResponse = { body: 'newer', headers: {}, status: 200 };
    store.set('webhook:public-store', 'evt_1', newer);

    await expect(joined).resolves.toBe(newer);
    stale?.commit({ body: 'stale', headers: {}, status: 200 });
    expect(store.get('webhook:public-store', 'evt_1')).toBe(newer);
  });

  it('length-frames webhook scope and event ids without NUL collisions', () => {
    const store = createPublicMemoryWebhookReplayStore();
    const first: WebhookWireResponse = { body: 'first', headers: {}, status: 200 };
    const second: WebhookWireResponse = { body: 'second', headers: {}, status: 200 };
    store.set('webhook\0event', 'tail', first);
    store.set('webhook', 'event\0tail', second);

    expect(store.get('webhook\0event', 'tail')).toBe(first);
    expect(store.get('webhook', 'event\0tail')).toBe(second);
  });

  it('fails closed at capacity and never forgets committed webhook replay truth', async () => {
    const committedStore = createPublicMemoryWebhookReplayStore({
      maxEntries: 1,
      maxPending: 1,
      ttlMs: 5,
    });
    const first: WebhookWireResponse = { body: 'first', headers: {}, status: 200 };
    const second: WebhookWireResponse = { body: 'second', headers: {}, status: 200 };
    committedStore.set('scope', 'first', first);
    expect(() => committedStore.set('scope', 'second', second)).toThrow(/capacity|saturated/u);
    expect(committedStore.reserve('scope', 'second')).toBeUndefined();
    expect(committedStore.get('scope', 'first')).toBe(first);

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(committedStore.get('scope', 'first')).toBe(first);
    expect(committedStore.reserve('scope', 'second')).toBeUndefined();

    const pendingStore = createPublicMemoryWebhookReplayStore({
      maxEntries: 1,
      maxPending: 1,
      ttlMs: 5,
    });
    const pending = pendingStore.reserve('scope', 'pending');
    expect(pending).toBeDefined();
    expect(pendingStore.reserve('scope', 'other-pending')).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(pendingStore.reserve('scope', 'other-pending')).toBeUndefined();
    pending?.abort?.();

    const replacement = pendingStore.reserve('scope', 'other-pending');
    expect(replacement).toBeDefined();
    replacement?.abort?.();
  });

  it('rejects unsafe webhook replay capacity and ttl values', () => {
    expect(() => createPublicMemoryWebhookReplayStore({ maxEntries: Number.NaN })).toThrow(
      /maxEntries.*non-negative integer/u,
    );
    expect(() => createPublicMemoryWebhookReplayStore({ maxPending: -1 })).toThrow(
      /maxPending.*non-negative integer/u,
    );
    expect(() => createPublicMemoryWebhookReplayStore({ ttlMs: 1.5 })).toThrow(
      /ttlMs.*non-negative integer/u,
    );
  });

  it('ignores inherited webhook replay limits and refuses accessors without invoking them', () => {
    const inherited = Object.create({ maxEntries: 0, maxPending: 0, ttlMs: 0 });
    const inheritedStore = createPublicMemoryWebhookReplayStore(inherited);
    expect(inheritedStore.reserve('scope', 'idem')).toBeDefined();

    let getterCalls = 0;
    const accessor = {} as { maxPending?: number };
    Object.defineProperty(accessor, 'maxPending', {
      configurable: true,
      get() {
        getterCalls += 1;
        return 0;
      },
    });
    expect(() => createPublicMemoryWebhookReplayStore(accessor)).toThrow();
    expect(getterCalls).toBe(0);
  });

  it('declares a registry-visible POST endpoint with resolved verifier metadata', () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      name: 'test-provider',
      payload: (request) => request.payload,
      scheme: 'test-provider:v1:hmac-sha256',
      secret: WEBHOOK_HMAC_SECRET,
    });

    const providerWebhook = webhook('/webhooks/provider', {
      handler: () => undefined,
      idempotency: (input) => input.id as string,
      input: s.object({ id: s.string() }),
      verify: verifier,
    });

    expect(providerWebhook).toMatchObject({
      auth: { kind: 'verifier', name: 'test-provider:v1:hmac-sha256' },
      csrf: {
        exempt: true,
        justification: '/webhooks/provider webhook verifier test-provider:v1:hmac-sha256',
      },
      method: 'POST',
      mount: 'exact',
      name: '/webhooks/provider',
      path: '/webhooks/provider',
      reason: 'webhook:/webhooks/provider',
      response: {
        appOwnedSafety: false,
        body: 'text',
        cache: 'no-store',
        reservedHeaders: ['Kovo-*'],
      },
      webhook: true,
    });
  });

  it('binds app dispatch to the snapshotted verifier under a poisoned declaration pin', async () => {
    const nativeDefineProperty = Object.defineProperty;
    let handled = 0;
    const verifier = {
      kind: 'custom' as const,
      name: 'closed-rejecting-verifier',
      scheme: 'custom:closed-rejecting-verifier',
      verify: async () => false,
    };
    const definition = {
      handler() {
        handled += 1;
      },
      input: s.object({ id: s.string() }),
      verify: verifier,
    };

    Object.defineProperty = function (target, property, descriptor) {
      if (target === definition && property === 'verify') return target;
      return Reflect.apply(nativeDefineProperty, Object, [target, property, descriptor]);
    } as typeof Object.defineProperty;

    let declaration;
    try {
      declaration = webhook('/webhooks/closed-verifier', definition);
    } finally {
      Object.defineProperty = nativeDefineProperty;
    }
    (definition as { verify: unknown }).verify = 'none';
    verifier.verify = async () => true;

    const app = createApp({ endpoints: [declaration] });
    expect(app.endpoints[0]?.auth).toEqual({
      kind: 'custom',
      name: 'closed-rejecting-verifier',
    });
    const response = await createRequestHandler(app)(
      new Request('https://example.test/webhooks/closed-verifier', {
        body: JSON.stringify({ id: 'unsigned-attacker-event' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
    expect(handled).toBe(0);
  });

  it('runs verify -> loose parse -> replay reserve -> tx -> handler -> change record', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    const invoice = domain('invoice');
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      name: 'stripe-lite',
      payload: (request) => request.payload,
      scheme: 'stripe-lite:v1:hmac-sha256',
      secret: WEBHOOK_HMAC_SECRET,
    });
    const steps: string[] = [];
    let writes = 0;
    const input = s.object({
      id: s.string(),
      type: s.string(),
    });

    const stripeWebhook = webhook<
      '/webhooks/stripe',
      typeof input,
      { received: string },
      { id: string },
      readonly [typeof invoice]
    >('/webhooks/stripe', {
      async handler(input, context) {
        const scoped = context.actAs('user_evt_1');
        const txId: string = scoped.tx.id;
        steps.push(`handler:${scoped.tx.id}`);
        expect('session' in context.request).toBe(false);
        expect(input.provider_extra).toEqual({ livemode: false });
        writes += 1;
        context.recordChange(invoice, { keys: [input.id] });
        const compileOnly = () => {
          const acceptsWebhookTx = (tx: WebhookTxDb<{ id: string }>) => tx;
          acceptsWebhookTx(scoped.tx);
          // @ts-expect-error raw transaction handles lack the module-private webhook tx brand.
          acceptsWebhookTx({ id: txId });
        };
        void compileOnly;
        return { received: input.type };
      },
      idempotency: (input) => input.id,
      input,
      replayStore,
      async transaction(_context, run) {
        steps.push('begin');
        try {
          const result = await run({ id: 'tx_1' });
          steps.push('commit');
          return result;
        } catch (error) {
          steps.push('rollback');
          throw error;
        }
      },
      verify: verifier,
      writes: [invoice],
    });
    const body = JSON.stringify({
      id: 'evt_1',
      provider_extra: { livemode: false },
      type: 'invoice.paid',
    });
    const request = signedRequest(body, sign(body));

    const first = await runWebhook(stripeWebhook, request);
    const second = await runWebhook(stripeWebhook, signedRequest(body, sign(body)));

    expect(first.replayed).toBe(false);
    expect(first.value).toEqual({ received: 'invoice.paid' });
    expect(first.changes).toEqual([
      {
        domain: 'invoice',
        input: {
          id: 'evt_1',
          provider_extra: { livemode: false },
          type: 'invoice.paid',
        },
        keys: ['evt_1'],
      },
    ]);
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get('kovo-changes')).toBe(
      '[{"domain":"invoice","keys":["evt_1"]}]',
    );
    await expect(first.response.text()).resolves.toBe('ok');

    expect(second.replayed).toBe(true);
    expect(second.changes).toEqual([]);
    expect(second.response.status).toBe(200);
    expect(second.response.headers.get('kovo-idem')).toBe('evt_1');
    await expect(second.response.text()).resolves.toBe('ok');
    expect(writes).toBe(1);
    expect(steps).toEqual(['begin', 'handler:tx_1', 'commit']);
  });

  it('fails closed on malformed JSON before schema parse or handler execution', async () => {
    let handlerCalls = 0;
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      name: 'stripe-lite',
      payload: (request) => request.payload,
      scheme: 'stripe-lite:v1:hmac-sha256',
      secret: WEBHOOK_HMAC_SECRET,
    });
    const stripeWebhook = webhook('/webhooks/stripe', {
      handler() {
        handlerCalls += 1;
      },
      idempotency: (input) => input.id as string,
      input: s.object({ id: s.string() }),
      verify: verifier,
    });
    const body = '{ not json';
    const result = await runWebhook(stripeWebhook, signedRequest(body, sign(body)));

    expect(result.response.status).toBe(400);
    await expect(result.response.text()).resolves.toBe('Invalid JSON webhook body');
    expect(result.changes).toEqual([]);
    expect(result.replayed).toBe(false);
    expect(handlerCalls).toBe(0);
  });

  it('wraps WebhookTxDb with the managed SQL runtime floor before the handler sees it', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    const calls: string[] = [];
    const input = s.object({ id: s.string() });
    const sqlWebhook = webhook('/webhooks/sql-tx', {
      handler(_input, context) {
        const scoped = context.declareSystemWrite('exercise webhook managed SQL tx safety');
        expect(() =>
          (scoped.tx as unknown as { execute(statement: unknown): unknown }).execute(
            'select * from products',
          ),
        ).toThrow(/KV422/);
        expect(() =>
          (scoped.tx as unknown as { session: { run(statement: unknown): unknown } }).session.run(
            'select * from products',
          ),
        ).toThrow(/raw driver escape db\.session|KV422/);
        expect(() =>
          (
            scoped.tx as unknown as { $client: { execute(statement: unknown): unknown } }
          ).$client.execute('select * from products'),
        ).toThrow(/raw driver escape db\.\$client|KV422/);
        expect(() =>
          (scoped.tx as unknown as { futureStatement(options: unknown): unknown }).futureStatement({
            mode: 'opaque',
          }),
        ).toThrow(/unknown managed DB method db\.futureStatement/);
        expect(
          (scoped.tx as unknown as { execute(statement: unknown): unknown }).execute({
            text: 'select id from products where id = $1',
            values: ['p1'],
          }),
        ).toMatchObject({ text: 'select id from products where id = $1' });
        expect(() =>
          (
            scoped.tx as unknown as { $client: { execute(statement: unknown): unknown } }
          ).$client.execute({
            text: 'select id from products where id = $1',
            values: ['p1'],
          }),
        ).toThrow(/raw driver escape db\.\$client|KV422/);
        expect(() =>
          (scoped.tx as unknown as { session: { run(statement: unknown): unknown } }).session.run(
            stampTrustedSql(
              { text: 'update products set name = $1 where id = $2', values: ['Ada', 'p1'] },
              'audited webhook tx update',
            ),
          ),
        ).toThrow(/raw driver escape db\.session|KV422/);
        expect(
          (
            scoped.tx as unknown as { futureStatement(statement: unknown): unknown }
          ).futureStatement({
            text: 'select id from products where id = $1',
            values: ['p1'],
          }),
        ).toMatchObject({ text: 'select id from products where id = $1' });
        return { ok: true };
      },
      idempotency: (input) => input.id,
      input,
      replayStore,
      async transaction(_context, run) {
        return run({
          execute(statement: unknown) {
            calls.push('tx.execute');
            return statement;
          },
          $client: {
            execute(statement: unknown) {
              calls.push('tx.$client.execute');
              return statement;
            },
          },
          futureStatement(statement: unknown) {
            calls.push('tx.futureStatement');
            return statement;
          },
          session: {
            run(statement: unknown) {
              calls.push('tx.session.run');
              return statement;
            },
          },
        });
      },
      verify: 'none',
      verifyJustification: 'fixture-only webhook transaction SQL safety test',
    });
    const body = JSON.stringify({ id: 'evt_sql_tx' });

    const result = await runWebhook(
      sqlWebhook,
      new Request('https://example.test/webhooks/sql-tx', {
        body,
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(result.replayed).toBe(false);
    expect(result.response.status).toBe(200);
    expect(calls).toEqual(['tx.execute', 'tx.futureStatement']);
  });

  it('dispatches webhook writes through an audited mutation and replays provider duplicates', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    const invoice = domain('invoice-run-mutation');
    let mutationWrites = 0;
    const recordInvoice = mutation('invoice/record-webhook', {
      handler(input: { id: string }) {
        mutationWrites += 1;
        return { stored: input.id };
      },
      input: s.object({ id: s.string() }),
      registry: { touches: [invoice] },
    });
    const stripeWebhook = webhook('/webhooks/stripe-mutation', {
      async handler(input, context) {
        return context.actAs(`owner:${input.id}`).runMutation(recordInvoice, { id: input.id });
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
    });
    const body = JSON.stringify({ id: 'evt_run_mutation' });
    const request = () =>
      new Request('https://example.test/webhooks/stripe-mutation', { body, method: 'POST' });

    const first = await runWebhook(stripeWebhook, request());
    const second = await runWebhook(stripeWebhook, request());

    expect(first.replayed).toBe(false);
    expect(first.value).toEqual({ stored: 'evt_run_mutation' });
    expect(first.changes).toEqual([
      { domain: 'invoice-run-mutation', input: { id: 'evt_run_mutation' } },
    ]);
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get('kovo-changes')).toBe('[{"domain":"invoice-run-mutation"}]');
    expect(second.replayed).toBe(true);
    expect(second.changes).toEqual([]);
    expect(second.response.status).toBe(200);
    expect(mutationWrites).toBe(1);
  });

  it('does not let webhook options bypass a composed mutation guard', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    let mutationWrites = 0;
    const guardedMutation = mutation('invoice/guarded-webhook-options', {
      guard: () => false,
      handler(input: { id: string }) {
        mutationWrites += 1;
        return input.id;
      },
      input: s.object({ id: s.string() }),
    });
    const wh = webhook('/webhooks/guarded-options', {
      handler(input, context) {
        return context.actAs('owner_1').runMutation(guardedMutation, input);
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'fixture-only webhook option guard regression',
    });

    const result = await runWebhook(
      wh,
      new Request('https://example.test/webhooks/guarded-options', {
        body: JSON.stringify({ id: 'evt_guarded' }),
        method: 'POST',
      }),
      { mutationOptions: { guardResolved: true } } as never,
    );

    expect(result.response.status).toBe(500);
    expect(mutationWrites).toBe(0);
  });

  it('rejects a late mutation-options accessor before verifier or replay awaits', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    let mutationWrites = 0;
    let optionReads = 0;
    const guardedMutation = mutation('invoice/accessor-webhook-options', {
      guard: () => false,
      handler(input: { id: string }) {
        mutationWrites += 1;
        return input.id;
      },
      input: s.object({ id: s.string() }),
    });
    const wh = webhook('/webhooks/accessor-options', {
      handler(input, context) {
        return context.actAs('owner_1').runMutation(guardedMutation, input);
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'fixture-only webhook option accessor regression',
    });
    const options = {} as Record<string, unknown>;
    Object.defineProperty(options, 'mutationOptions', {
      get() {
        optionReads += 1;
        return { guardResolved: true };
      },
    });

    const result = await runWebhook(
      wh,
      new Request('https://example.test/webhooks/accessor-options', {
        body: JSON.stringify({ id: 'evt_accessor' }),
        method: 'POST',
      }),
      options as never,
    );

    expect(result.response.status).toBe(500);
    expect(optionReads).toBe(0);
    expect(mutationWrites).toBe(0);
  });

  it('refuses a webhook mutation that only carries a payload owner and no actAs posture', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    let mutationWrites = 0;
    const recordInvoice = mutation('invoice/refuse-payload-owner', {
      handler(input: { id: string; ownerId: string }) {
        mutationWrites += 1;
        return { stored: input.id, ownerId: input.ownerId };
      },
      input: s.object({ id: s.string(), ownerId: s.string() }),
    });
    const stripeWebhook = webhook('/webhooks/payload-owner-unscoped', {
      async handler(input, context) {
        return context.runMutation(recordInvoice, {
          id: input.id,
          ownerId: input.ownerId,
        });
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string(), ownerId: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'fixture-only webhook principal posture test',
    });

    const result = await runWebhook(
      stripeWebhook,
      new Request('https://example.test/webhooks/payload-owner-unscoped', {
        body: JSON.stringify({ id: 'evt_payload_owner', ownerId: 'user_from_payload' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(500);
    expect(result.changes).toEqual([]);
    expect(mutationWrites).toBe(0);
  });

  it('denies direct webhook tx access until the handler declares actAs or system write posture', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    let writes = 0;
    const directTx = webhook('/webhooks/direct-tx-unscoped', {
      handler(_input, context) {
        (context.tx as unknown as { insert(): void }).insert();
        return { ok: true };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      async transaction(_context, run) {
        return run({ insert: () => (writes += 1) });
      },
      verify: 'none',
      verifyJustification: 'fixture-only webhook tx principal posture test',
    });

    const result = await runWebhook(
      directTx,
      new Request('https://example.test/webhooks/direct-tx-unscoped', {
        body: JSON.stringify({ id: 'evt_direct_tx' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(500);
    expect(result.changes).toEqual([]);
    expect(writes).toBe(0);
  });

  it('fails closed when a webhook transaction attempts to invoke its handler more than once', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    let handlerCalls = 0;
    const wh = webhook('/webhooks/transaction-handler-once', {
      handler(input) {
        handlerCalls += 1;
        return input.id;
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      async transaction(_context, run) {
        const first = await run({});
        try {
          await run({});
        } catch {
          // Catching the rejected second call must not clear the framework violation.
        }
        return first;
      },
      verify: 'none',
      verifyJustification: 'fixture-only webhook transaction cardinality regression',
    });

    const result = await runWebhook(
      wh,
      new Request('https://example.test/webhooks/transaction-handler-once', {
        body: JSON.stringify({ id: 'evt_once' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(500);
    expect(handlerCalls).toBe(1);
  });

  it('keeps webhook handler result authority when a transaction adapter substitutes success', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    const wh = webhook('/webhooks/transaction-handler-result-authority', {
      handler(input) {
        return `handler:${input.id}`;
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      async transaction(_context, run) {
        await run({});
        return 'adapter-forgery';
      },
      verify: 'none',
      verifyJustification: 'fixture-only webhook transaction result authority regression',
    });

    const result = await runWebhook(
      wh,
      new Request('https://example.test/webhooks/transaction-handler-result-authority', {
        body: JSON.stringify({ id: 'evt_result_authority' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(200);
    expect(result.value).toBe('handler:evt_result_authority');
  });

  it('revokes a webhook transaction continuation returned without any handler invocation', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    let handlerCalls = 0;
    let lateRun: ((tx: {}) => Promise<string>) | undefined;
    const wh = webhook('/webhooks/transaction-handler-late', {
      handler(input) {
        handlerCalls += 1;
        return input.id;
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      transaction(_context, run) {
        lateRun = run;
        return Promise.resolve('forged');
      },
      verify: 'none',
      verifyJustification: 'fixture-only webhook late transaction regression',
    });

    const result = await runWebhook(
      wh,
      new Request('https://example.test/webhooks/transaction-handler-late', {
        body: JSON.stringify({ id: 'evt_late' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(500);
    expect(handlerCalls).toBe(0);
    expect(() => lateRun?.({})).toThrow(/exactly once/u);
    expect(handlerCalls).toBe(0);
  });

  it('waits for an unawaited started webhook handler to quiesce before failing closed', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    let handlerCalls = 0;
    let release!: () => void;
    let markStarted!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const wh = webhook('/webhooks/transaction-handler-pending', {
      async handler(input) {
        handlerCalls += 1;
        markStarted();
        await blocker;
        return input.id;
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      transaction(_context, run) {
        void run({}).then(
          () => undefined,
          () => undefined,
        );
        return Promise.resolve('forged');
      },
      verify: 'none',
      verifyJustification: 'fixture-only webhook pending transaction regression',
    });

    let completed = false;
    const pending = runWebhook(
      wh,
      new Request('https://example.test/webhooks/transaction-handler-pending', {
        body: JSON.stringify({ id: 'evt_pending' }),
        method: 'POST',
      }),
    ).then((result) => {
      completed = true;
      return result;
    });
    await started;
    expect(handlerCalls).toBe(1);
    expect(completed).toBe(false);

    release();
    const result = await pending;
    expect(result.response.status).toBe(500);
    expect(handlerCalls).toBe(1);
  });

  it('pins the denied webhook transaction membrane against late global Proxy replacement', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    let injectedWrites = 0;
    const directTx = webhook('/webhooks/proxy-tx-unscoped', {
      handler(_input, context) {
        (context.tx as unknown as { insert(): void }).insert();
        return { ok: true };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      async transaction(_context, run) {
        return run({ insert() {} });
      },
      verify: 'none',
      verifyJustification: 'fixture-only late Proxy webhook posture test',
    });
    const NativeProxy = globalThis.Proxy;
    let proxyHits = 0;
    let result!: Awaited<ReturnType<typeof runWebhook>>;
    try {
      globalThis.Proxy = class BypassProxy {
        constructor(target: object, handler: ProxyHandler<object>) {
          proxyHits += 1;
          if (Object.getPrototypeOf(target) === null && Reflect.ownKeys(target).length === 0) {
            return { insert: () => (injectedWrites += 1) };
          }
          return new NativeProxy(target, handler);
        }
      } as unknown as ProxyConstructor;
      result = await runWebhook(
        directTx,
        new Request('https://example.test/webhooks/proxy-tx-unscoped', {
          body: JSON.stringify({ id: 'evt_proxy_tx' }),
          method: 'POST',
        }),
      );
    } finally {
      globalThis.Proxy = NativeProxy;
    }

    expect(proxyHits).toBe(0);
    expect(result.response.status).toBe(500);
    expect(result.changes).toEqual([]);
    expect(injectedWrites).toBe(0);
  });

  it('fails closed before a webhook mutation dispatch when replay posture is inactive', async () => {
    const invoice = domain('invoice-run-mutation-no-replay');
    let mutationWrites = 0;
    const recordInvoice = mutation('invoice/record-webhook-no-replay', {
      handler(input: { id: string }) {
        mutationWrites += 1;
        return { stored: input.id };
      },
      input: s.object({ id: s.string() }),
      registry: { touches: [invoice] },
    });
    const unsafeWebhook = webhook('/webhooks/stripe-mutation-no-replay', {
      async handler(input, context) {
        return context.runMutation(recordInvoice, { id: input.id });
      },
      input: s.object({ id: s.string() }),
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
    });

    const result = await runWebhook(
      unsafeWebhook,
      new Request('https://example.test/webhooks/stripe-mutation-no-replay', {
        body: JSON.stringify({ id: 'evt_no_replay' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(500);
    expect(result.replayed).toBe(false);
    expect(result.changes).toEqual([]);
    expect(mutationWrites).toBe(0);
  });

  it('rejects tampered payloads before parsing or handler execution', async () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      payload: (request) => request.payload,
      secret: WEBHOOK_HMAC_SECRET,
    });
    let handled = 0;
    const stripeWebhook = webhook('/webhooks/stripe', {
      handler() {
        handled += 1;
      },
      idempotency: (input) => input.id as string,
      input: s.object({ id: s.string() }),
      verify: verifier,
    });

    const response = await runEndpoint(stripeWebhook, signedRequest('{bad json', sign('{}')));

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe('Unauthorized');
    expect(handled).toBe(0);
  });

  it('parses the exact raw bytes authenticated by an HMAC payload callback', async () => {
    const authenticatedBody = JSON.stringify({ id: 'safe' });
    const substitutedBody = JSON.stringify({ id: 'evil' });
    const substitutedBytes = new TextEncoder().encode(substitutedBody);
    let handledId: string | undefined;
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      payload(request) {
        if (!(request.payload instanceof Uint8Array)) {
          throw new TypeError('expected raw webhook bytes');
        }
        const signedBytes = new Uint8Array(request.payload);
        request.payload.set(substitutedBytes);
        return signedBytes;
      },
      secret: WEBHOOK_HMAC_SECRET,
    });
    const signedWebhook = webhook('/webhooks/exact-authenticated-body', {
      handler(input) {
        handledId = input.id;
      },
      input: s.object({ id: s.string() }),
      verify: verifier,
    });

    const result = await runWebhook(
      signedWebhook,
      new Request('https://example.test/webhooks/exact-authenticated-body', {
        body: authenticatedBody,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': sign(authenticatedBody),
        },
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(200);
    expect(handledId).toBe('safe');
  });

  it('rolls back recorded changes when the handler returns fail()', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    const invoice = domain('invoice');
    const steps: string[] = [];
    const failingWebhook = webhook('/webhooks/billing', {
      handler(input, context) {
        context.recordChange(invoice, { keys: [input.id] });
        return context.fail('IGNORED_EVENT', { id: input.id }, { status: 422 });
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      async transaction(_context, run) {
        steps.push('begin');
        try {
          return await run({ id: 'tx_fail' });
        } catch (error) {
          steps.push('rollback');
          throw error;
        }
      },
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
      writes: [invoice],
    });

    const body = JSON.stringify({ id: 'evt_ignore' });
    const first = await runWebhook(
      failingWebhook,
      new Request('https://example.test/webhooks/billing', {
        body,
        method: 'POST',
      }),
    );
    const second = await runWebhook(
      failingWebhook,
      new Request('https://example.test/webhooks/billing', {
        body,
        method: 'POST',
      }),
    );

    expect(first.changes).toEqual([]);
    expect(first.response.status).toBe(422);
    expect(first.response.headers.get('kovo-changes')).toBeNull();
    await expect(first.response.json()).resolves.toEqual({
      error: { code: 'IGNORED_EVENT', payload: { id: 'evt_ignore' } },
      ok: false,
    });
    expect(second.replayed).toBe(true);
    await expect(second.response.json()).resolves.toEqual({
      error: { code: 'IGNORED_EVENT', payload: { id: 'evt_ignore' } },
      ok: false,
    });
    expect(steps).toEqual(['begin', 'rollback']);
  });

  it('recognizes only context.fail() outcomes as framework rollback authority', async () => {
    const structural = {
      error: { code: 'FORGED_FAILURE', payload: { attacker: true } },
      ok: false as const,
      status: 401 as const,
    };
    const declaration = webhook('/webhooks/structural-failure', {
      handler: () => structural as never,
      input: s.object({ id: s.string() }),
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
    });

    const result = await runWebhook(
      declaration,
      new Request('https://example.test/webhooks/structural-failure', {
        body: JSON.stringify({ id: 'evt_structural' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(200);
    expect(result.value).toBe(structural);
  });

  it('pins declared write keys and ignores late Array.some allowlist poison', async () => {
    const allowed = domain('allowed-ledger');
    const undeclared = domain('admin-ledger');
    const nativeSome = Array.prototype.some;
    const declaration = webhook('/webhooks/closed-writes', {
      handler(_input, context) {
        Array.prototype.some = () => true;
        try {
          context.recordChange(undeclared);
          return 'accepted';
        } catch {
          return 'rejected';
        } finally {
          Array.prototype.some = nativeSome;
        }
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore: createMemoryWebhookReplayStore(),
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
      writes: [allowed],
    });
    allowed.key = 'admin-ledger';

    const result = await runWebhook(
      declaration,
      new Request('https://example.test/webhooks/closed-writes', {
        body: JSON.stringify({ id: 'evt_closed_writes' }),
        method: 'POST',
      }),
    );

    expect(result.value).toBe('rejected');
    expect(result.changes).toEqual([]);
  });

  it('does not expose ambient session on webhook requests', () => {
    const assertNoAmbientSession = (request: EndpointRequest) => {
      // @ts-expect-error SPEC §9.1 webhooks receive raw requests, not req.session.
      const session: { id: string } = request.session;
      return session;
    };

    const assertNoneVerifierRequiresJustification = () => {
      // @ts-expect-error SPEC §9.1 requires a named justification for verify: 'none'.
      webhook('/webhooks/bad', {
        handler: () => undefined,
        input: s.object({ id: s.string() }),
        verify: 'none',
      });
    };

    expect(assertNoAmbientSession).toBeTypeOf('function');
    expect(assertNoneVerifierRequiresJustification).toBeTypeOf('function');
  });

  it('does not accept the removed options.path public shape', () => {
    const removedOptionsPath = () =>
      webhook('/webhooks/path-first-only', {
        handler: () => undefined,
        input: s.object({ id: s.string() }),
        // @ts-expect-error Phase 1 path-first API removed public options.path.
        path: '/webhooks/legacy-options-path',
        verify: 'none',
        verifyJustification: 'compile-time fixture only',
      });

    expect(removedOptionsPath).toBeTypeOf('function');
  });

  it('scopes replay by the path-derived webhook identity plus provider event id', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    let paidCalls = 0;
    let refundedCalls = 0;
    const paid = webhook('/webhooks/order-paid', {
      handler: () => {
        paidCalls += 1;
        return { ok: true };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
    });
    const refunded = webhook('/webhooks/order-refunded', {
      handler: () => {
        refundedCalls += 1;
        return { ok: true };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
    });
    const body = JSON.stringify({ id: 'evt_same_provider_id' });
    const request = (path: string) =>
      new Request(`https://example.test${path}`, { body, method: 'POST' });

    const paidFirst = await runWebhook(paid, request('/webhooks/order-paid'));
    const paidSecond = await runWebhook(paid, request('/webhooks/order-paid'));
    const refundedFirst = await runWebhook(refunded, request('/webhooks/order-refunded'));
    const refundedSecond = await runWebhook(refunded, request('/webhooks/order-refunded'));

    expect(paid.name).toBe('/webhooks/order-paid');
    expect(refunded.name).toBe('/webhooks/order-refunded');
    expect(paid.reason).toBe('webhook:/webhooks/order-paid');
    expect(refunded.reason).toBe('webhook:/webhooks/order-refunded');
    expect(paidFirst.replayed).toBe(false);
    expect(paidSecond.replayed).toBe(true);
    expect(refundedFirst.replayed).toBe(false);
    expect(refundedSecond.replayed).toBe(true);
    expect(paidCalls).toBe(1);
    expect(refundedCalls).toBe(1);
  });

  it('scopes replay and audit metadata by compiler-assigned webhook identity', async () => {
    const seenScopes: string[] = [];
    const replayStore = createMemoryWebhookReplayStore();
    const tracingReplayStore: WebhookReplayStore = {
      get(scope, idem) {
        seenScopes.push(`get:${scope}:${idem}`);
        return replayStore.get(scope, idem);
      },
      reserve(scope, idem) {
        seenScopes.push(`reserve:${scope}:${idem}`);
        return replayStore.reserve(scope, idem);
      },
      set(scope, idem, response) {
        seenScopes.push(`set:${scope}:${idem}`);
        replayStore.set(scope, idem, response);
      },
    };
    let calls = 0;
    const orderPaid = assignDerivedWebhookName(
      webhook('/webhooks/order-paid', {
        handler: () => {
          calls += 1;
          return { ok: true };
        },
        idempotency: (input) => input.id,
        input: s.object({ id: s.string() }),
        replayStore: tracingReplayStore,
        verify: 'none',
        verifyJustification: 'fixture-only webhook test',
      }),
      'webhooks/order-paid/order-paid',
    );
    const body = JSON.stringify({ id: 'evt_derived' });
    const request = () =>
      new Request('https://example.test/webhooks/order-paid', { body, method: 'POST' });

    const first = await runWebhook(orderPaid, request());
    const second = await runWebhook(orderPaid, request());

    expect(orderPaid).toMatchObject({
      csrf: {
        exempt: true,
        justification: 'fixture-only webhook test',
      },
      name: 'webhooks/order-paid/order-paid',
      path: '/webhooks/order-paid',
      reason: 'webhook:webhooks/order-paid/order-paid',
    });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(calls).toBe(1);
    expect(seenScopes).toContain('get:webhook:webhooks/order-paid/order-paid:evt_derived');
    expect(seenScopes).toContain('reserve:webhook:webhooks/order-paid/order-paid:evt_derived');
    expect(seenScopes).not.toContain('get:webhook:/webhooks/order-paid:evt_derived');
  });

  it('rejects declared write webhooks without a replay store before signed delivery runtime', () => {
    const invoice = domain('invoice-declared-missing-replay');
    let handled = 0;

    expect(() =>
      webhook('/webhooks/missing-replay-store', {
        handler(input, context) {
          handled += 1;
          context.recordChange(invoice, { keys: [input.id] });
          return { ok: true };
        },
        idempotency: (input) => input.id,
        input: s.object({ id: s.string() }),
        verify: hmacSignature({
          encoding: 'hex',
          header: 'x-signature',
          payload: (request) => request.payload,
          scheme: 'stripe-lite:v1:hmac-sha256',
          secret: WEBHOOK_HMAC_SECRET,
        }),
        writes: [invoice],
      }),
    ).toThrow(/declares writable domains[\s\S]*idempotency\(\) and replayStore/);

    expect(handled).toBe(0);
  });

  it('allows declared write webhooks when idempotency and replay store posture are present', () => {
    const invoice = domain('invoice-declared-with-replay');
    const wh = webhook('/webhooks/declared-with-replay', {
      handler(input, context) {
        context.recordChange(invoice, { keys: [input.id] });
        return { ok: true };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore: createMemoryWebhookReplayStore(),
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
      writes: [invoice],
    });

    expect(wh.webhookDefinition.writes).toEqual([invoice]);
  });

  it('fails closed before a write-capable handler when idempotency resolves without an event id', async () => {
    const invoice = domain('invoice-missing-runtime-id');
    let handlerCalls = 0;
    const wh = webhook('/webhooks/missing-runtime-id', {
      handler(input, context) {
        handlerCalls += 1;
        context.recordChange(invoice, { keys: [input.id] });
        return { ok: true };
      },
      idempotency: () => undefined,
      input: s.object({ id: s.string() }),
      replayStore: createMemoryWebhookReplayStore(),
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
      writes: [invoice],
    });

    const result = await runWebhook(
      wh,
      new Request('https://example.test/webhooks/missing-runtime-id', {
        body: JSON.stringify({ id: 'evt_missing' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(500);
    expect(result.replayed).toBe(false);
    expect(handlerCalls).toBe(0);
  });

  it('rejects non-string idempotency outcomes without coercing them into replay keys', async () => {
    const invoice = domain('invoice-invalid-runtime-id');
    let handlerCalls = 0;
    let coercions = 0;
    const wh = webhook('/webhooks/invalid-runtime-id', {
      handler() {
        handlerCalls += 1;
        return { ok: true };
      },
      idempotency: () =>
        ({
          toString() {
            coercions += 1;
            return 'evt_forged';
          },
        }) as never,
      input: s.object({ id: s.string() }),
      replayStore: createMemoryWebhookReplayStore(),
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
      writes: [invoice],
    });

    const result = await runWebhook(
      wh,
      new Request('https://example.test/webhooks/invalid-runtime-id', {
        body: JSON.stringify({ id: 'evt_invalid' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(500);
    expect(handlerCalls).toBe(0);
    expect(coercions).toBe(0);
  });

  it('B4: fails closed when recordChange targets a domain outside declared writes', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    const contact = domain('model/contact');
    const billing = domain('billing');
    const wh = webhook('/webhooks/undeclared-write', {
      handler(input, context) {
        context.recordChange(contact, { keys: [input.id] });
        (
          context as unknown as {
            recordChange(domain: typeof billing, options: { keys: readonly string[] }): unknown;
          }
        ).recordChange(billing, { keys: [input.id] });
        return { ok: true };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
      writes: [contact],
    });

    const result = await runWebhook(
      wh,
      new Request('https://example.test/webhooks/undeclared-write', {
        body: JSON.stringify({ id: 'evt_undeclared' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(500);
    expect(result.changes).toEqual([]);
    expect(result.response.headers.get('kovo-changes')).toBeNull();
  });

  it('fails closed when a write-reaching webhook lacks idempotency replay posture', async () => {
    const invoice = domain('invoice-missing-replay');
    const unsafeWebhook = webhook('/webhooks/missing-replay', {
      handler(input, context) {
        (context as any).recordChange(invoice, { keys: [input.id] });
        return { ok: true };
      },
      input: s.object({ id: s.string() }),
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
    });

    const result = await runWebhook(
      unsafeWebhook,
      new Request('https://example.test/webhooks/missing-replay', {
        body: JSON.stringify({ id: 'evt_1' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(500);
    expect(result.replayed).toBe(false);
  });

  // H8 (SPEC §9.1:875 / §10.3:1151): the idempotency floor must key on whether the webhook
  // can WRITE, not on whether the handler called recordChange(). A handler that writes via
  // its `transaction`-provided `tx` (or an outbox table) but never records a change yields
  // changes.length===0, which the old post-commit posture check waved through — so a provider
  // retry double-executes (double charge). Require idempotency()+replayStore unconditionally
  // for any webhook that exposes a writable tx, failing closed BEFORE the transaction commits.
  it('H8: a tx-writing webhook without idempotency+replayStore cannot be declared', () => {
    const ledger = domain('ledger-h8');
    let writes = 0;
    expect(() =>
      webhook('/webhooks/charge-no-posture', {
        handler(input, context) {
          (context.tx as unknown as { insert(): void }).insert();
          (context as any).recordChange(ledger, { keys: [input.id] });
          return { ok: true };
        },
        input: s.object({ id: s.string() }),
        // Exposes a writable tx, but declares neither idempotency() nor replayStore.
        async transaction(_context, run) {
          return run({ insert: () => (writes += 1) });
        },
        verify: 'none',
        verifyJustification: 'fixture-only webhook test',
      }),
    ).toThrow(/idempotency\(\) and replayStore/);
    // The handler/transaction never ran: the declaration itself is rejected.
    expect(writes).toBe(0);
  });

  it('H8: a tx-writing webhook whose posture was stripped fails closed at dispatch before commit', async () => {
    let writes = 0;
    const wh = webhook('/webhooks/charge-dispatch', {
      handler(input, context) {
        (context.tx as unknown as { insert(): void }).insert();
        return { received: input.id };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore: createDurableWebhookReplayStore(),
      async transaction(_context, run) {
        return run({ insert: () => (writes += 1) });
      },
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
    });
    // Simulate a declaration that bypassed the builder (e.g. hand-constructed): strip posture
    // from a structural clone. webhook() itself now returns an immutable closed definition.
    const stripped = {
      ...wh,
      webhookDefinition: { ...wh.webhookDefinition },
    };
    delete (stripped.webhookDefinition as { idempotency?: unknown }).idempotency;
    delete (stripped.webhookDefinition as { replayStore?: unknown }).replayStore;

    const result = await runWebhook(
      stripped as typeof wh,
      new Request('https://example.test/webhooks/charge-dispatch', {
        body: JSON.stringify({ id: 'evt_1' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(500);
    expect(result.replayed).toBe(false);
    // The transaction was never opened, so the write never executed even once.
    expect(writes).toBe(0);
  });

  it('pins structural write posture before a toggling definition can run without replay', async () => {
    const invoice = domain('invoice-toggling-runtime-posture');
    let handlerCalls = 0;
    let writesReads = 0;
    const wh = webhook('/webhooks/toggling-runtime-posture', {
      handler(input, context) {
        handlerCalls += 1;
        context.recordChange(invoice, { keys: [input.id] });
        return { ok: true };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore: createMemoryWebhookReplayStore(),
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
      writes: [invoice],
    });
    const toggling = {
      ...wh,
      webhookDefinition: { ...wh.webhookDefinition },
    };
    delete (toggling.webhookDefinition as { idempotency?: unknown }).idempotency;
    delete (toggling.webhookDefinition as { replayStore?: unknown }).replayStore;
    Object.defineProperty(toggling.webhookDefinition, 'writes', {
      configurable: true,
      enumerable: true,
      get() {
        writesReads += 1;
        return writesReads === 1 ? [] : [invoice];
      },
    });

    const result = await runWebhook(
      toggling as typeof wh,
      new Request('https://example.test/webhooks/toggling-runtime-posture', {
        body: JSON.stringify({ id: 'evt_toggle' }),
        method: 'POST',
      }),
    );

    expect(result.response.status).toBe(500);
    expect(handlerCalls).toBe(0);
    expect(writesReads).toBe(0);
  });

  // H9 (SPEC §10.3:1151): the reserve path did a single non-blocking attempt and, on
  // reserve()===undefined + get()===undefined, fell through to execute. A contract-compliant
  // durable cross-instance store (Postgres `INSERT ... ON CONFLICT DO NOTHING` + `SELECT`)
  // returns undefined from get() for a reserved-but-uncommitted row, so two concurrent
  // deliveries of the same event id both ran the handler. Re-reserve, and if still unobtainable
  // with no committed response, fail closed (429) so the provider retries — never double-execute.
  it('H9: concurrent same-event delivery on a durable store does not double-execute', async () => {
    const durable = createDurableWebhookReplayStore();
    const ledger = domain('ledger-h9');
    let enteredTotal = 0;
    let sideEffects = 0;
    let resolveAEntered = (): void => undefined;
    const aEntered = new Promise<void>((resolve) => (resolveAEntered = resolve));
    let releaseA = (): void => undefined;
    const aReleased = new Promise<void>((resolve) => (releaseA = resolve));

    const wh = webhook('/webhooks/durable-charge', {
      async handler(input, context) {
        enteredTotal += 1;
        (context.actAs(`owner:${input.id}`).tx as unknown as { insert(): void }).insert();
        context.recordChange(ledger, { keys: [input.id] });
        if (enteredTotal === 1) {
          resolveAEntered();
          await aReleased; // park the first (winning) delivery inside the handler
        }
        return { ok: true };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore: durable,
      async transaction(_context, run) {
        return run({ insert: () => (sideEffects += 1) });
      },
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
      writes: [ledger],
    });

    const body = JSON.stringify({ id: 'evt_dup' });
    const makeRequest = () =>
      new Request('https://example.test/webhooks/durable-charge', { body, method: 'POST' });

    const pendingA = runWebhook(wh, makeRequest());
    await aEntered; // A has reserved and entered the handler, parked at the barrier
    const resultB = await runWebhook(wh, makeRequest()); // B now runs to completion
    releaseA();
    const resultA = await pendingA;

    // Exactly one delivery executed the write; the loser failed closed.
    expect(enteredTotal).toBe(1);
    expect(sideEffects).toBe(1);
    expect(resultA.response.status).toBe(200);
    expect(resultA.replayed).toBe(false);
    expect(resultB.response.status).toBe(429);
    expect(resultB.replayed).toBe(false);
    expect(resultB.response.headers.get('retry-after')).toBe('1');

    // A redelivery after A committed replays the stored response (no third execution).
    const resultC = await runWebhook(wh, makeRequest());
    expect(resultC.replayed).toBe(true);
    expect(resultC.response.status).toBe(200);
    expect(enteredTotal).toBe(1);
    expect(sideEffects).toBe(1);
  });

  it('fails closed before webhook execution when retained replay truth fills capacity', async () => {
    const replayStore = createPublicMemoryWebhookReplayStore({ maxEntries: 1 });
    const retained: WebhookWireResponse = { body: 'retained', headers: {}, status: 200 };
    replayStore.set('retained-scope', 'retained-event', retained);
    let handlerCalls = 0;
    const wh = webhook('/webhooks/capacity', {
      handler() {
        handlerCalls += 1;
        return { ok: true };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
    });

    const result = await runWebhook(
      wh,
      new Request('https://example.test/webhooks/capacity', {
        body: JSON.stringify({ id: 'new-event' }),
        method: 'POST',
      }),
    );

    expect(handlerCalls).toBe(0);
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get('retry-after')).toBe('1');
    expect(replayStore.get('retained-scope', 'retained-event')).toBe(retained);
  });

  // A4 (SPEC §9.1:850): an unexpected handler exception must abort the reservation so
  // a provider retry re-runs the handler, not re-serve a cached 500.
  it('A4: does not commit a 500 to replay on unexpected exception; retry reruns the handler', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    let callCount = 0;
    const flakyWebhook = webhook('/webhooks/flaky', {
      handler(input: { id: string }) {
        callCount += 1;
        if (callCount === 1) throw new Error('transient DB blip');
        return { received: input.id };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'fixture-only test webhook',
    });

    const body = JSON.stringify({ id: 'evt_flaky' });
    const makeRequest = () =>
      new Request('https://example.test/webhooks/flaky', { body, method: 'POST' });

    // First call: handler throws.
    const first = await runWebhook(flakyWebhook, makeRequest());
    expect(first.response.status).toBe(500);
    expect(first.replayed).toBe(false);

    // Second call: same event id — must NOT replay the cached 500; handler runs again.
    const second = await runWebhook(flakyWebhook, makeRequest());
    expect(second.replayed).toBe(false);
    expect(second.response.status).toBe(200);
    expect(callCount).toBe(2);
  });

  // L10-1 (SPEC §9.1:860-862): verification is fail-closed. An app-authored
  // `verify()`/`payload`/`tolerance.timestamp` callback that THROWS on a malformed
  // signature header (`core/src/verifier.ts:198-200,253-256,266`) must NOT propagate
  // as an uncaught rejection → framework 500. It must be treated as verification
  // failure → the same 401/Unauthorized as a `false` return, never revealing which
  // check failed.
  it('L10-1: a throwing custom verify() fails closed to 401, not a thrown 500', async () => {
    let handled = 0;
    const throwingWebhook = webhook('/webhooks/throwing-custom', {
      handler() {
        handled += 1;
      },
      idempotency: (input) => input.id as string,
      input: s.object({ id: s.string() }),
      // A malformed signature header makes a real app verifier throw rather than
      // return false (e.g. `Buffer.from(badHex, 'hex')` / signature parsing).
      verify: customVerifier('boom', () => {
        throw new Error('malformed signature header');
      }),
    });

    const body = JSON.stringify({ id: 'evt_throw' });
    const request = new Request('https://example.test/webhooks/throwing-custom', {
      body,
      headers: { 'content-type': 'application/json', 'x-signature': 'not-a-real-sig' },
      method: 'POST',
    });

    const result = await runWebhook(throwingWebhook, request);

    expect(result.response.status).toBe(401);
    await expect(result.response.text()).resolves.toBe('Unauthorized');
    expect(handled).toBe(0);
    expect(result.replayed).toBe(false);
    expect(result.changes).toEqual([]);
  });

  it('L10-1: a throwing HMAC payload callback fails closed to 401; a valid request still 200', async () => {
    let handled = 0;
    // The payload builder throws when the signature header is malformed — mirrors a
    // real provider recipe that parses the header inside `payload`/`tolerance.timestamp`.
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      payload: (request, context) => {
        const sig = context.header('x-signature');
        if (sig === 'malformed') throw new Error('cannot parse signature header');
        return request.payload;
      },
      secret: WEBHOOK_HMAC_SECRET,
    });
    const okWebhook = webhook('/webhooks/throwing-payload', {
      handler(input: { id: string }) {
        handled += 1;
        return { received: input.id };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      verify: verifier,
    });

    const body = JSON.stringify({ id: 'evt_payload' });

    // Malformed signature header → payload callback throws → fail closed to 401.
    const bad = await runWebhook(
      okWebhook,
      signedRequestNamed('throwing-payload', body, 'malformed'),
    );
    expect(bad.response.status).toBe(401);
    await expect(bad.response.text()).resolves.toBe('Unauthorized');
    expect(handled).toBe(0);

    // A correctly signed request still verifies and runs the handler → 200.
    const good = await runWebhook(
      okWebhook,
      signedRequestNamed('throwing-payload', body, sign(body)),
    );
    expect(good.response.status).toBe(200);
    expect(good.value).toEqual({ received: 'evt_payload' });
    expect(handled).toBe(1);
  });

  // L10-3 (SPEC §9.1:860): idem truthiness is consistent. An empty-string idem is a
  // valid key — the replay LOOKUP must be consulted (treated active) just like
  // reserve/set, so a redelivered '' event replays the stored response and never
  // re-runs the handler.
  it('L10-3: an empty-string idem is active — fast-path lookup consulted, redelivery replays', async () => {
    const memory = createMemoryWebhookReplayStore();
    // Spy store: records the idem values the fast-path LOOKUP (`get`) is consulted
    // with, plus whether `reserve` was attempted. With the truthy `idem` gate at
    // webhook.ts:242, an '' idem skips the lookup entirely (latent double-execute
    // window); with the consistent `idem !== undefined` predicate it is consulted.
    const getCalls: string[] = [];
    let reserveCalls = 0;
    const replayStore = {
      get(scope: string, idem: string) {
        getCalls.push(idem);
        return memory.get(scope, idem);
      },
      reserve(scope: string, idem: string) {
        reserveCalls += 1;
        return memory.reserve(scope, idem);
      },
      set(scope: string, idem: string, response: Parameters<typeof memory.set>[2]) {
        memory.set(scope, idem, response);
      },
    };
    let handled = 0;
    const emptyIdemWebhook = webhook('/webhooks/empty-idem', {
      handler(input: { id: string }) {
        handled += 1;
        return { received: input.id };
      },
      // Idempotency key is the empty string for every delivery.
      idempotency: () => '',
      input: s.object({ id: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'fixture-only test webhook',
    });

    const body = JSON.stringify({ id: 'evt_empty' });
    const makeRequest = () =>
      new Request('https://example.test/webhooks/empty-idem', { body, method: 'POST' });

    const first = await runWebhook(emptyIdemWebhook, makeRequest());
    expect(first.replayed).toBe(false);
    expect(first.response.status).toBe(200);
    // First delivery: fast-path lookup consulted with '' (idem treated active),
    // then reserved. With the truthy gate the lookup is skipped (getCalls === []).
    expect(getCalls).toEqual(['']);
    expect(reserveCalls).toBe(1);

    // Redelivery of the committed '' event must consult the fast-path lookup and
    // replay the stored response — NOT re-run the handler (the double-execute window).
    const second = await runWebhook(emptyIdemWebhook, makeRequest());
    expect(second.replayed).toBe(true);
    expect(second.response.status).toBe(200);
    expect(handled).toBe(1);
    // The redelivery replayed via the fast-path lookup, so no second reservation.
    expect(getCalls).toEqual(['', '']);
    expect(reserveCalls).toBe(1);
  });

  // L2 (SPEC §9.2:876): webhook input parsing must not launder a non-validation throw
  // (an internal storage/DB exception, e.g. an `s.file().store()` backend failure that
  // throws a DSN/endpoint string) into the typed 422 body. Only a SchemaValidationError
  // is a 422; any other error is an unexpected failure that maps to a sanitized 500 and
  // must not surface the raw `.message` to the caller.
  it('L2: an internal (non-validation) input-parse error maps to 500, not a 422 leaking the message', async () => {
    const secret = 'DB dsn postgres://user:pw@db.internal:5432/prod';
    let handled = 0;
    const leakyWebhook = webhook('/webhooks/leaky-parse', {
      handler() {
        handled += 1;
        return { ok: true };
      },
      // A field schema whose `.parse` throws a raw internal error on a perfectly valid
      // body (e.g. a degraded storage/DB backend reached during coercion).
      input: {
        parse() {
          throw new Error(secret);
        },
      } as unknown as Parameters<typeof webhook>[1]['input'],
      verify: 'none',
      verifyJustification: 'fixture-only test webhook',
    });

    const body = JSON.stringify({ id: 'evt_leak' });
    const result = await runWebhook(
      leakyWebhook,
      new Request('https://example.test/webhooks/leaky-parse', { body, method: 'POST' }),
    );

    expect(result.response.status).toBe(500);
    const text = await result.response.text();
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain(secret);
    // The handler must never run for a failed input parse.
    expect(handled).toBe(0);
    expect(result.changes).toEqual([]);
    expect(result.replayed).toBe(false);
  });

  // L2: a genuine SchemaValidationError still produces the typed 422 (not a 500), so the
  // re-throw of internals does not regress the legitimate validation path.
  it('L2: a real validation error still maps to a typed 422', async () => {
    const validatingWebhook = webhook('/webhooks/validating', {
      handler() {
        return { ok: true };
      },
      input: {
        parse() {
          throw new SchemaValidationError([{ message: 'id is required', path: ['id'] }]);
        },
      } as unknown as Parameters<typeof webhook>[1]['input'],
      verify: 'none',
      verifyJustification: 'fixture-only test webhook',
    });

    const body = JSON.stringify({});
    const result = await runWebhook(
      validatingWebhook,
      new Request('https://example.test/webhooks/validating', { body, method: 'POST' }),
    );

    expect(result.response.status).toBe(422);
    const payload = (await result.response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('VALIDATION');
  });
});

function signedRequestNamed(name: string, body: string, signature: string): Request {
  return new Request(`https://example.test/webhooks/${name}`, {
    body,
    headers: {
      'content-type': 'application/json',
      'x-signature': signature,
    },
    method: 'POST',
  });
}

function createMemoryWebhookReplayStore(): WebhookReplayStore {
  const responses = new Map<
    string,
    | {
        pending: Promise<WebhookWireResponse>;
        reject(reason?: unknown): void;
        resolve(response: WebhookWireResponse): void;
      }
    | { response: WebhookWireResponse }
  >();

  return {
    get(scope, idem) {
      const record = responses.get(webhookReplayKey(scope, idem));
      if (!record) return undefined;
      if ('pending' in record) return record.pending;
      return record.response;
    },
    reserve(scope, idem) {
      const key = webhookReplayKey(scope, idem);
      if (responses.has(key)) return undefined;

      let resolvePending: (response: WebhookWireResponse) => void = () => undefined;
      let rejectPending: (reason?: unknown) => void = () => undefined;
      const pending = new Promise<WebhookWireResponse>((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
      pending.catch(() => undefined);
      const record = {
        pending,
        reject: rejectPending,
        resolve: resolvePending,
      };
      responses.set(key, record);

      return {
        abort() {
          if (responses.get(key) === record) responses.delete(key);
          rejectPending(new Error('Webhook replay reservation aborted'));
        },
        commit(response: WebhookWireResponse) {
          responses.set(key, { response });
          resolvePending(response);
        },
      };
    },
    set(scope, idem, response) {
      const key = webhookReplayKey(scope, idem);
      const existing = responses.get(key);
      responses.set(key, { response });
      if (existing && 'pending' in existing) existing.resolve(response);
    },
  };
}

function webhookReplayKey(scope: string, idem: string): string {
  return `${scope}\0${idem}`;
}

// A contract-compliant durable cross-instance store analogue (SPEC §10.3:1151):
// `reserve` claims the row only when absent (Postgres `INSERT ... ON CONFLICT DO NOTHING`),
// and `get` is NON-BLOCKING — it returns undefined for a reserved-but-uncommitted row,
// the realistic shape that exposed the H9 fall-through double-execute.
function createDurableWebhookReplayStore(): WebhookReplayStore {
  const rows = new Map<string, { committed?: WebhookWireResponse }>();
  return {
    get(scope, idem) {
      return rows.get(webhookReplayKey(scope, idem))?.committed;
    },
    reserve(scope, idem): WebhookReplayReservation | undefined {
      const key = webhookReplayKey(scope, idem);
      if (rows.has(key)) return undefined;
      const row: { committed?: WebhookWireResponse } = {};
      rows.set(key, row);
      return {
        abort() {
          if (rows.get(key) === row) rows.delete(key);
        },
        commit(response) {
          row.committed = response;
        },
      };
    },
    set(scope, idem, response) {
      rows.set(webhookReplayKey(scope, idem), { committed: response });
    },
  };
}
