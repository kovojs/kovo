import { createHmac } from 'node:crypto';
import { customVerifier, hmacSignature } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { domain } from './domain.js';
import { runEndpoint, type EndpointRequest } from './endpoint.js';
import { createMemoryMutationReplayStore } from './replay.js';
import { s } from './schema.js';
import { runWebhook, webhook } from './webhook.js';

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
  it('declares a registry-visible POST endpoint with resolved verifier metadata', () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      name: 'test-provider',
      payload: (request) => request.payload,
      scheme: 'test-provider:v1:hmac-sha256',
      secret: 'whsec_test',
    });

    const providerWebhook = webhook('provider', {
      handler: () => undefined,
      idempotency: (input) => input.id as string,
      input: s.object({ id: s.string() }),
      path: '/webhooks/provider',
      verify: verifier,
    });

    expect(providerWebhook).toMatchObject({
      auth: { kind: 'verifier', name: 'test-provider:v1:hmac-sha256' },
      csrf: {
        exempt: true,
        justification: 'provider webhook verifier test-provider:v1:hmac-sha256',
      },
      method: 'POST',
      mount: 'exact',
      name: 'provider',
      path: '/webhooks/provider',
      webhook: true,
    });
  });

  it('runs verify -> loose parse -> replay reserve -> tx -> handler -> change record', async () => {
    const replayStore = createMemoryMutationReplayStore();
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
      'stripe',
      '/webhooks/stripe',
      typeof input,
      { received: string },
      { id: string }
    >('stripe', {
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
      path: '/webhooks/stripe',
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
    const stripeWebhook = webhook('stripe', {
      handler() {
        handled += 1;
      },
      idempotency: (input) => input.id as string,
      input: s.object({ id: s.string() }),
      path: '/webhooks/stripe',
      verify: verifier,
    });

    const response = await runEndpoint(stripeWebhook, signedRequest('{bad json', sign('{}')));

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe('Unauthorized');
    expect(handled).toBe(0);
  });

  it('rolls back recorded changes when the handler returns fail()', async () => {
    const replayStore = createMemoryMutationReplayStore();
    const invoice = domain('invoice');
    const steps: string[] = [];
    const failingWebhook = webhook('billing', {
      handler(input, context) {
        context.recordChange(invoice, { keys: [input.id] });
        return context.fail('IGNORED_EVENT', { id: input.id }, { status: 422 });
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      path: '/webhooks/billing',
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
      webhook('bad', {
        handler: () => undefined,
        input: s.object({ id: s.string() }),
        path: '/webhooks/bad',
        verify: 'none',
      });
    };

    expect(assertNoAmbientSession).toBeTypeOf('function');
    expect(assertNoneVerifierRequiresJustification).toBeTypeOf('function');
  });

  // A4 (SPEC §9.1:850): an unexpected handler exception must abort the reservation so
  // a provider retry re-runs the handler, not re-serve a cached 500.
  it('A4: does not commit a 500 to replay on unexpected exception; retry reruns the handler', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let callCount = 0;
    const flakyWebhook = webhook('flaky', {
      handler(input: { id: string }) {
        callCount += 1;
        if (callCount === 1) throw new Error('transient DB blip');
        return { received: input.id };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      path: '/webhooks/flaky',
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
    const throwingWebhook = webhook('throwing-custom', {
      handler() {
        handled += 1;
      },
      idempotency: (input) => input.id as string,
      input: s.object({ id: s.string() }),
      path: '/webhooks/throwing-custom',
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
    const okWebhook = webhook('throwing-payload', {
      handler(input: { id: string }) {
        handled += 1;
        return { received: input.id };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      path: '/webhooks/throwing-payload',
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
    const memory = createMemoryMutationReplayStore();
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
    const emptyIdemWebhook = webhook('empty-idem', {
      handler(input: { id: string }) {
        handled += 1;
        return { received: input.id };
      },
      // Idempotency key is the empty string for every delivery.
      idempotency: () => '',
      input: s.object({ id: s.string() }),
      path: '/webhooks/empty-idem',
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
