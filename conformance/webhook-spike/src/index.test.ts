import { describe, expect, it } from 'vitest';

import {
  hmacSignature,
  type HmacSecret,
  type HmacSignatureVerifier,
  type WebhookPayload,
} from '@kovojs/core';
import { createMemoryMutationReplayStore, type MutationReplayStore } from '@kovojs/server';
import type { MutationWireResponse } from '@kovojs/server/internal/wire';

const stripePayload =
  '{"id":"evt_payment_succeeded_001","object":"event","type":"payment_intent.succeeded","data":{"object":{"id":"pi_123","metadata":{"orderId":"order_123"}}},"livemode":false,"pending_webhooks":1}';
const stripeTimestamp = 1_674_087_231;
const stripeNow = stripeTimestamp * 1000;
const stripeHeader =
  't=1674087231,v1=16de56e1424fa5548a47dee454c8718c66241d4b9e62668bb2fe43355842d3cf';
const rotatedStripeSignatureHeader = [
  't=1674087231',
  'v1=0000000000000000000000000000000000000000000000000000000000000000',
  'v1=905f240a41547aab27bd6e0dc3699a5cd121de3da4f90a926768d1993bf7ee00',
].join(',');

type StripeFixtureEvent = {
  data?: {
    object?: {
      id?: unknown;
      metadata?: Record<string, unknown>;
    };
  };
  id: string;
  type: string;
};

type ChangeRecord = {
  domain: 'order';
  keys: readonly string[];
  input: { eventId: string; paymentIntentId: string };
};

type SpikeState = {
  changes: ChangeRecord[];
  commits: number;
  rollbacks: number;
  writes: { eventId: string; orderId: string; paymentIntentId: string }[];
};

type StripeSpikeOptions = {
  now?: number;
  replayStore: MutationReplayStore;
  secret?: readonly string[] | string;
  state: SpikeState;
};

type SpikeResponse = {
  body: string;
  headers: MutationWireResponse['headers'];
  status: MutationWireResponse['status'] | 400 | 409;
};

describe('S7 Stripe-format webhook lifecycle spike', () => {
  it('captures raw bytes once, then verifies, parses, writes in a tx, records changes, and replays duplicates', async () => {
    const replayStore = createMemoryMutationReplayStore();
    const state = createSpikeState();
    const firstRequest = countingStripeRequest(stripePayload, stripeHeader);
    const first = await runStripeWebhookSpike(firstRequest.request, {
      replayStore,
      state,
    });

    expect(firstRequest.arrayBufferReads()).toBe(1);
    expect(first).toEqual({
      body: 'ok',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Kovo-Changes':
          '[{"domain":"order","keys":["order_123"],"input":{"eventId":"evt_payment_succeeded_001","paymentIntentId":"pi_123"}}]',
        'Kovo-Idem': 'evt_payment_succeeded_001',
      },
      status: 200,
    });
    expect(state).toEqual({
      changes: [
        {
          domain: 'order',
          keys: ['order_123'],
          input: {
            eventId: 'evt_payment_succeeded_001',
            paymentIntentId: 'pi_123',
          },
        },
      ],
      commits: 1,
      rollbacks: 0,
      writes: [
        {
          eventId: 'evt_payment_succeeded_001',
          orderId: 'order_123',
          paymentIntentId: 'pi_123',
        },
      ],
    });

    const duplicateRequest = countingStripeRequest(stripePayload, stripeHeader);
    const duplicate = await runStripeWebhookSpike(duplicateRequest.request, {
      replayStore,
      state,
    });

    expect(duplicateRequest.arrayBufferReads()).toBe(1);
    expect(duplicate).toEqual(first);
    expect(state.writes).toHaveLength(1);
    expect(state.commits).toBe(1);
    expect(state.changes).toHaveLength(1);
  });

  it('rejects semantically equivalent but byte-tampered JSON before parsing can normalize it', async () => {
    const tamperedPayload = JSON.stringify(JSON.parse(stripePayload), null, 2);
    const request = countingStripeRequest(tamperedPayload, stripeHeader);
    const state = createSpikeState();

    await expect(
      runStripeWebhookSpike(request.request, {
        replayStore: createMemoryMutationReplayStore(),
        state,
      }),
    ).resolves.toMatchObject({
      body: 'signature verification failed',
      status: 400,
    });
    expect(request.arrayBufferReads()).toBe(1);
    expect(state.writes).toHaveLength(0);
    expect(state.rollbacks).toBe(0);
  });

  it('rejects stale Stripe timestamps before replay or handler execution', async () => {
    const state = createSpikeState();

    await expect(
      runStripeWebhookSpike(countingStripeRequest(stripePayload, stripeHeader).request, {
        now: stripeNow + 301_000,
        replayStore: createMemoryMutationReplayStore(),
        state,
      }),
    ).resolves.toMatchObject({
      body: 'signature verification failed',
      status: 400,
    });
    expect(state.writes).toHaveLength(0);
  });

  it('accepts rotated Stripe secrets with multiple v1 signatures', async () => {
    const state = createSpikeState();

    await expect(
      runStripeWebhookSpike(
        countingStripeRequest(stripePayload, rotatedStripeSignatureHeader).request,
        {
          replayStore: createMemoryMutationReplayStore(),
          secret: ['whsec_current_secret', 'whsec_old_secret'],
          state,
        },
      ),
    ).resolves.toMatchObject({
      headers: {
        'Kovo-Idem': 'evt_payment_succeeded_001',
      },
      status: 200,
    });
    expect(state.writes).toHaveLength(1);
  });
});

async function runStripeWebhookSpike(
  request: Request,
  options: StripeSpikeOptions,
): Promise<SpikeResponse> {
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const verifier = stripeFixtureSignature({ secret: options.secret ?? 'whsec_test_secret' });
  const verified = await verifier.verify({
    headers: request.headers,
    now: options.now ?? stripeNow,
    payload: rawBody,
  });

  if (!verified) {
    return textResponse(400, 'signature verification failed');
  }

  // SPEC §9.1 fixes webhook order as raw-byte verification, loose provider parse,
  // replay by provider event id, then transaction/domain writes/change record.
  const event = parseStripeFixtureEvent(rawBody);
  const replayScope = 'webhook:stripe';
  const replayed = await options.replayStore.get(replayScope, event.id);
  if (replayed) return replayed;

  const reservation = options.replayStore.reserve(replayScope, event.id);
  if (!reservation) {
    const pendingReplay = await options.replayStore.get(replayScope, event.id);
    if (pendingReplay) return pendingReplay;
    return textResponse(409, 'duplicate webhook is already running');
  }

  const tx = createOrderTx(options.state);
  try {
    const write = tx.recordPayment(event);
    tx.commit();
    const change: ChangeRecord = {
      domain: 'order',
      keys: [write.orderId],
      input: {
        eventId: event.id,
        paymentIntentId: write.paymentIntentId,
      },
    };
    options.state.changes.push(change);

    const response = {
      body: 'ok',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Kovo-Changes': JSON.stringify([change]),
        'Kovo-Idem': event.id,
      },
      status: 200 as const,
    };
    reservation.commit(response);
    return response;
  } catch (error) {
    tx.rollback();
    throw error;
  }
}

function parseStripeFixtureEvent(rawBody: Uint8Array): StripeFixtureEvent {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(rawBody));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('id' in parsed) ||
    typeof parsed.id !== 'string' ||
    !('type' in parsed) ||
    typeof parsed.type !== 'string'
  ) {
    throw new Error('invalid Stripe fixture');
  }

  return parsed as StripeFixtureEvent;
}

function stripeFixtureSignature(options: {
  secret: HmacSecret | readonly HmacSecret[];
}): HmacSignatureVerifier {
  return hmacSignature({
    encoding: 'hex',
    header: 'stripe-signature',
    multiSig: stripeV1Signatures,
    name: 'stripe-fixture',
    payload: (request, context) => {
      const timestamp = stripeHeaderPart(context.signatureHeader, 't');
      if (timestamp === undefined) return '';
      return `${timestamp}.${webhookPayloadToString(request.payload)}`;
    },
    scheme: 'stripe:v1:hmac-sha256',
    secret: options.secret,
    tolerance: {
      seconds: 5 * 60,
      timestamp: (_request, context) => stripeHeaderPart(context.signatureHeader, 't'),
    },
  });
}

function stripeV1Signatures(header: string): readonly string[] {
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [name, value] = part.split('=', 2);
    if (name?.trim() === 'v1' && value !== undefined && value.length > 0) {
      signatures.push(value);
    }
  }
  return signatures;
}

function stripeHeaderPart(header: string, partName: string): string | undefined {
  for (const part of header.split(',')) {
    const [name, value] = part.split('=', 2);
    if (name?.trim() === partName && value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

function webhookPayloadToString(payload: WebhookPayload): string {
  if (typeof payload === 'string') return payload;
  if (payload instanceof ArrayBuffer) return new TextDecoder().decode(payload);
  return new TextDecoder().decode(
    payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  );
}

function createOrderTx(state: SpikeState) {
  let complete = false;

  return {
    commit() {
      if (complete) throw new Error('transaction already closed');
      complete = true;
      state.commits += 1;
    },
    recordPayment(event: StripeFixtureEvent) {
      if (complete) throw new Error('transaction already closed');
      const object = event.data?.object;
      const orderId = stringMetadata(object?.metadata, 'orderId');
      const paymentIntentId = objectId(object);
      const write = {
        eventId: event.id,
        orderId,
        paymentIntentId,
      };
      state.writes = [...state.writes, write];
      return write;
    },
    rollback() {
      if (!complete) {
        complete = true;
        state.rollbacks += 1;
      }
    },
  };
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing Stripe metadata ${key}`);
  }
  return value;
}

function objectId(object: { id?: unknown } | undefined): string {
  if (
    typeof object !== 'object' ||
    object === null ||
    typeof object.id !== 'string' ||
    object.id.length === 0
  ) {
    throw new Error('missing Stripe object id');
  }
  return object.id;
}

function createSpikeState(): SpikeState {
  return {
    changes: [],
    commits: 0,
    rollbacks: 0,
    writes: [],
  };
}

function countingStripeRequest(
  payload: string,
  signature: string,
): {
  arrayBufferReads(): number;
  request: Request;
} {
  let reads = 0;
  const request = new Request('https://app.example.test/webhooks/stripe', {
    body: payload,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    method: 'POST',
  });
  const counted = new Proxy(request, {
    get(target, property) {
      if (property === 'arrayBuffer') {
        return async () => {
          reads += 1;
          return target.arrayBuffer();
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return {
    arrayBufferReads: () => reads,
    request: counted,
  };
}

function textResponse(status: SpikeResponse['status'], body: string): SpikeResponse {
  return {
    body,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
    status,
  };
}
