import { createHmac } from 'node:crypto';
import { hmacSignature } from '@jiso/core';
import { describe, expect, it } from 'vitest';

import {
  createMemoryMutationReplayStore,
  domain,
  runEndpoint,
  runWebhook,
  s,
  webhook,
  type EndpointRequest,
} from './index.js';

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
    expect(first.response.headers.get('fw-changes')).toBe(
      '[{"domain":"invoice","keys":["evt_1"]}]',
    );
    await expect(first.response.text()).resolves.toBe('ok');

    expect(second.replayed).toBe(true);
    expect(second.changes).toEqual([]);
    expect(second.response.status).toBe(200);
    expect(second.response.headers.get('fw-idem')).toBe('evt_1');
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
    expect(first.response.headers.get('fw-changes')).toBeNull();
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
});
