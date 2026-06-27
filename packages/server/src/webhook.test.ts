import { createHmac } from 'node:crypto';
import { customVerifier, hmacSignature } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { domain } from './domain.js';
import { runEndpoint, type EndpointRequest } from './endpoint.js';
import { s, SchemaValidationError } from './schema.js';
import {
  createMemoryWebhookReplayStore as createPublicMemoryWebhookReplayStore,
  runWebhook,
  webhook,
  type WebhookReplayReservation,
  type WebhookReplayStore,
  type WebhookWireResponse,
} from './webhook.js';

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
  return createHmac('sha256', 'whsec_test').update(body).digest('hex');
}

describe('server webhook primitive', () => {
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

  it('declares a registry-visible POST endpoint with resolved verifier metadata', () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      name: 'test-provider',
      payload: (request) => request.payload,
      scheme: 'test-provider:v1:hmac-sha256',
      secret: 'whsec_test',
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

  it('runs verify -> loose parse -> replay reserve -> tx -> handler -> change record', async () => {
    const replayStore = createMemoryWebhookReplayStore();
    const invoice = domain('invoice');
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      name: 'stripe-lite',
      payload: (request) => request.payload,
      scheme: 'stripe-lite:v1:hmac-sha256',
      secret: 'whsec_test',
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
      { id: string }
    >('/webhooks/stripe', {
      async handler(input, context) {
        steps.push(`handler:${context.tx.id}`);
        expect('session' in context.request).toBe(false);
        expect(input.provider_extra).toEqual({ livemode: false });
        writes += 1;
        context.recordChange(invoice, { keys: [input.id] });
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

  it('rejects tampered payloads before parsing or handler execution', async () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      payload: (request) => request.payload,
      secret: 'whsec_test',
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

  it('fails closed when a write-reaching webhook lacks idempotency replay posture', async () => {
    const invoice = domain('invoice-missing-replay');
    const unsafeWebhook = webhook('/webhooks/missing-replay', {
      handler(input, context) {
        context.recordChange(invoice, { keys: [input.id] });
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
          (context.tx as { insert(): void }).insert();
          context.recordChange(ledger, { keys: [input.id] });
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
        (context.tx as { insert(): void }).insert();
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
    // Simulate a declaration that bypassed the builder (e.g. hand-constructed): strip posture.
    delete (wh.webhookDefinition as { idempotency?: unknown }).idempotency;
    delete (wh.webhookDefinition as { replayStore?: unknown }).replayStore;

    const result = await runWebhook(
      wh,
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
        (context.tx as { write(): void }).write();
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
        return run({ write: () => (sideEffects += 1) });
      },
      verify: 'none',
      verifyJustification: 'fixture-only webhook test',
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
      secret: 'whsec_test',
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
