import { afterAll, describe, expect, it } from 'vitest';

import type { MutationReplayResponse } from './replay.js';
import type { WebhookWireResponse } from './webhook.js';

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';

const [{ createApp }, { domain }, { mutation }, postgresReplayApi, replayApi, webhookApi, { s }] =
  await Promise.all([
    import('./app.js?volatile-replay-production'),
    import('./domain.js?volatile-replay-production'),
    import('./mutation.js?volatile-replay-production'),
    import('./postgres-replay.js?volatile-replay-production'),
    import('./replay.js'),
    import('./webhook.js?volatile-replay-production'),
    import('./schema.js?volatile-replay-production'),
  ]);

const egressDisabled = {
  enabled: false as const,
  justification: 'production replay posture test performs no outbound I/O',
};

const postgresExecutor = {
  async execute() {
    return { rows: [] };
  },
};

function declaredMutation() {
  return mutation('receipt/write', {
    csrf: false,
    handler(input) {
      return input;
    },
    input: s.object({ value: s.string() }),
  });
}

function structuralMutationReplayStore() {
  const responses = new Map<string, MutationReplayResponse>();
  return {
    get(scope: string, idem: string) {
      return responses.get(`${scope}\u0000${idem}`);
    },
    reserve(scope: string, idem: string) {
      const key = `${scope}\u0000${idem}`;
      return {
        commit(response: MutationReplayResponse) {
          responses.set(key, response);
        },
      };
    },
    set(scope: string, idem: string, response: MutationReplayResponse) {
      responses.set(`${scope}\u0000${idem}`, response);
    },
    [Symbol.for('kovo.durable-replay-store')]: true,
  };
}

function structuralWebhookReplayStore() {
  const responses = new Map<string, WebhookWireResponse>();
  return {
    get(scope: string, idem: string) {
      return responses.get(`${scope}\u0000${idem}`);
    },
    reserve(scope: string, idem: string) {
      const key = `${scope}\u0000${idem}`;
      return {
        commit(response: WebhookWireResponse) {
          responses.set(key, response);
        },
      };
    },
    set(scope: string, idem: string, response: WebhookWireResponse) {
      responses.set(`${scope}\u0000${idem}`, response);
    },
    [Symbol.for('kovo.durable-replay-store')]: true,
  };
}

afterAll(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

describe('production replay truth posture', () => {
  it('refuses the framework memory mutation store at app boot', () => {
    expect(() =>
      createApp({
        egress: egressDisabled,
        mutationReplayStore: replayApi.createMemoryMutationReplayStore(),
      }),
    ).toThrow(/KV436.*volatile memory mutationReplayStore.*createPostgresMutationReplayStore/);
  });

  it('refuses to silently disable replay when production declares a mutation', () => {
    expect(() => createApp({ egress: egressDisabled, mutations: [declaredMutation()] })).toThrow(
      /KV436.*missing.*mutationReplayStore.*createPostgresMutationReplayStore/,
    );
  });

  it('refuses custom structural and global-symbol mutation store forgeries', () => {
    expect(() =>
      createApp({
        egress: egressDisabled,
        mutationReplayStore: structuralMutationReplayStore(),
        mutations: [declaredMutation()],
      }),
    ).toThrow(/KV436.*custom.*mutationReplayStore.*createPostgresMutationReplayStore/);
  });

  it('accepts the authenticated Postgres mutation store', () => {
    const mutationReplayStore =
      postgresReplayApi.createPostgresMutationReplayStore(postgresExecutor);

    const app = createApp({
      egress: egressDisabled,
      mutationReplayStore,
      mutations: [declaredMutation()],
    });

    expect(replayApi.isDurableMutationReplayStore(app.mutationReplayStore)).toBe(true);
  });

  it('refuses the framework memory webhook store at declaration', () => {
    expect(() =>
      webhookApi.webhook('/webhooks/volatile', {
        handler() {},
        idempotency: (input) => input.id,
        input: s.object({ id: s.string() }),
        replayStore: webhookApi.createMemoryWebhookReplayStore(),
        verify: 'none',
        verifyJustification: 'production posture test fixture',
      }),
    ).toThrow(/KV436.*volatile memory replayStore.*createPostgresWebhookReplayStore/);
  });

  it('refuses an idempotent writable webhook with no durable store', () => {
    const records = domain('receipt-records-missing');

    expect(() =>
      webhookApi.webhook('/webhooks/missing', {
        handler() {},
        idempotency: (input) => input.id,
        input: s.object({ id: s.string() }),
        verify: 'none',
        verifyJustification: 'production posture test fixture',
        writes: [records],
      }),
    ).toThrow(/KV436.*missing.*replayStore.*createPostgresWebhookReplayStore/);
  });

  it('refuses custom structural and global-symbol webhook store forgeries', () => {
    const records = domain('receipt-records-forged');

    expect(() =>
      webhookApi.webhook('/webhooks/forged', {
        handler() {},
        idempotency: (input) => input.id,
        input: s.object({ id: s.string() }),
        replayStore: structuralWebhookReplayStore(),
        verify: 'none',
        verifyJustification: 'production posture test fixture',
        writes: [records],
      }),
    ).toThrow(/KV436.*custom.*replayStore.*createPostgresWebhookReplayStore/);
  });

  it('accepts the authenticated Postgres store for an idempotent writable webhook', () => {
    const records = domain('receipt-records-durable');
    const replayStore = postgresReplayApi.createPostgresWebhookReplayStore(postgresExecutor);

    const declaration = webhookApi.webhook('/webhooks/durable', {
      handler() {},
      idempotency: (input) => input.id,
      input: s.object({ id: s.string() }),
      replayStore,
      verify: 'none',
      verifyJustification: 'production posture test fixture',
      writes: [records],
    });

    expect(webhookApi.isDurableWebhookReplayStore(declaration.webhookDefinition.replayStore)).toBe(
      true,
    );
  });
});
