import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';

import type { MutationReplayResponse } from './replay.js';
import type { WebhookWireResponse } from './webhook.js';

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const postgresRuntimeApi = await import('./postgres-runtime.js?durable-replay-runtime');
const runtimeRoot = mkdtempSync(join(tmpdir(), 'kovo-replay-production-'));
const replayOwners = pgTable(
  'replay_production_owners',
  { id: text('id').primaryKey(), ownerId: text('owner_id').notNull() },
  kovo({ domain: 'replay-production', key: 'id', owner: 'ownerId' }),
);
const postgresRuntime = postgresRuntimeApi.createPostgresAppRuntimeDb({
  dataDir: runtimeRoot,
  driver: 'pglite',
  schema: postgresRuntimeApi.postgresSchemaModule({ replayOwners }),
});
await postgresRuntime.ready;
process.env.NODE_ENV = 'production';

const [{ createApp }, { domain }, { mutation }, replayApi, serverPublicApi, webhookApi, { s }] =
  await Promise.all([
    import('./app.js?volatile-replay-production'),
    import('./domain.js?volatile-replay-production'),
    import('./mutation.js?volatile-replay-production'),
    import('./replay.js'),
    import('./index.js?volatile-replay-production'),
    import('./webhook.js?volatile-replay-production'),
    import('./schema.js?volatile-replay-production'),
  ]);

const egressDisabled = {
  enabled: false as const,
  justification: 'production replay posture test performs no outbound I/O',
};

function declaredMutation() {
  return mutation('receipt/write', {
    csrf: false,
    csrfJustification: 'test fixture uses a non-browser caller',
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

afterAll(async () => {
  await postgresRuntime.close();
  rmSync(runtimeRoot, { force: true, recursive: true });
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

describe('production replay truth posture', () => {
  it('does not expose structural SQL-executor replay authority', () => {
    expect(serverPublicApi).not.toHaveProperty('createPostgresCapabilityReplayStore');
    expect(serverPublicApi).not.toHaveProperty('createPostgresMutationReplayStore');
    expect(serverPublicApi).not.toHaveProperty('createPostgresWebhookReplayStore');
    expect(serverPublicApi).not.toHaveProperty('releasePostgresPendingReplay');
  });

  it('refuses the framework memory mutation store at app boot', () => {
    expect(() =>
      createApp({
        egress: egressDisabled,
        mutationReplayStore: replayApi.createMemoryMutationReplayStore(),
      }),
    ).toThrow(/KV436.*volatile memory mutationReplayStore.*mutationReplayStore/);
  });

  it('refuses to silently disable replay when production declares a mutation', () => {
    expect(() => createApp({ egress: egressDisabled, mutations: [declaredMutation()] })).toThrow(
      /KV436.*missing.*mutationReplayStore.*createPostgresAppRuntimeDb.*mutationReplayStore/,
    );
  });

  it('refuses custom structural and global-symbol mutation store forgeries', () => {
    expect(() =>
      createApp({
        egress: egressDisabled,
        mutationReplayStore: structuralMutationReplayStore(),
        mutations: [declaredMutation()],
      }),
    ).toThrow(/KV436.*custom.*mutationReplayStore.*mutationReplayStore/);
  });

  it('accepts the authenticated Postgres mutation store', () => {
    const mutationReplayStore = postgresRuntime.mutationReplayStore;

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
    ).toThrow(/KV436.*volatile memory replayStore.*webhookReplayStore/);
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
    ).toThrow(/KV436.*missing.*replayStore.*webhookReplayStore/);
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
    ).toThrow(/KV436.*custom.*replayStore.*webhookReplayStore/);
  });

  it('accepts the authenticated Postgres store for an idempotent writable webhook', () => {
    const records = domain('receipt-records-durable');
    const replayStore = postgresRuntime.webhookReplayStore;

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
