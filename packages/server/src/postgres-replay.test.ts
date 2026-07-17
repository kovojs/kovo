import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { PGlite } from '@electric-sql/pglite';
import { kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';

import { signCapability, verifyCapability } from './capability-url.js';
import { usePostgresSystemDb } from './internal/postgres-capability.js';
import {
  createPostgresAppRuntimeDb,
  postgresSchemaModule,
  type KovoPostgresAppRuntimeDb,
} from './postgres-runtime.js';
import {
  createPostgresCapabilityReplayStoreFromExecutor,
  createPostgresMutationReplayStoreFromExecutor,
  createPostgresWebhookReplayStoreFromExecutor,
  releasePostgresPendingReplayFromExecutor,
} from './postgres-replay.js';
import { MutationReplayConflictError } from './replay.js';
import { replayMutationWireBody } from './response.js';
import type { DurableTaskStatusSqlExecutor } from './task-observability.js';
import { createDurableTaskSqlExecutor } from './task-queue.js';
import { MUTATION_IDEM_MAX_AGE_MS } from './mutation-idem.js';
import {
  WEBHOOK_REPLAY_HORIZON_MS,
  webhookReplayIdentity,
  WebhookReplayIdentityConflictError,
} from './webhook.js';

const MUTATION_TEST_ISSUED_AT_MS = Date.now();
const WEBHOOK_TEST_OCCURRED_AT_MS = Date.now();

function mutationIdem(label: string, issuedAtMs = MUTATION_TEST_ISSUED_AT_MS): string {
  const nonce = createHash('sha256').update(label).digest('hex').slice(0, 32);
  return `v1_${issuedAtMs}_${nonce}`;
}

function webhookIdentity(label: string, occurredAtMs = WEBHOOK_TEST_OCCURRED_AT_MS) {
  return webhookReplayIdentity(label, occurredAtMs);
}

const replayOwners = pgTable(
  'postgres_replay_test_owners',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
  },
  kovo({
    domain: 'postgres-replay-tests',
    key: 'id',
    owner: 'ownerId',
  }),
);
const schema = postgresSchemaModule({ replayOwners });

function mutationResponse(body = 'ok') {
  return {
    body: replayMutationWireBody(body, { reason: 'Postgres replay test fixture' }),
    headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8' },
    status: 200 as const,
  };
}

describe('Postgres durable replay stores', () => {
  const roots: string[] = [];
  const runtimes: KovoPostgresAppRuntimeDb[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) await runtimes.pop()?.close();
    while (roots.length > 0) rmSync(roots.pop()!, { force: true, recursive: true });
  });

  async function runtimeAt(dataDir: string): Promise<{
    executor: DurableTaskStatusSqlExecutor;
    runtime: KovoPostgresAppRuntimeDb;
  }> {
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    runtimes.push(runtime);
    await runtime.ready;
    const executor = usePostgresSystemDb(
      runtime.systemDb({
        operation: 'write',
        reason: 'exercise framework-owned durable replay truth',
        surface: 'postgres-replay.test.ts',
      }),
      createDurableTaskSqlExecutor,
    );
    return { executor, runtime };
  }

  function dataDir(): string {
    const root = mkdtempSync(join(tmpdir(), 'kovo-postgres-replay-'));
    roots.push(root);
    return root;
  }

  it('atomically consumes a one-time capability across replicas and process restart', async () => {
    const dir = dataDir();
    const firstRuntime = await runtimeAt(dir);
    const first = createPostgresCapabilityReplayStoreFromExecutor(firstRuntime.executor);
    const replica = createPostgresCapabilityReplayStoreFromExecutor(firstRuntime.executor);
    const now = Date.now();
    const signed = await signCapability(
      'postgres-capability-replay-test-secret-at-least-32-bytes',
      { expiresIn: 60_000, key: 'receipts/ord_1.pdf', oneTime: true },
      now,
    );
    const verify = (
      replayStore: ReturnType<typeof createPostgresCapabilityReplayStoreFromExecutor>,
    ) =>
      verifyCapability(
        'postgres-capability-replay-test-secret-at-least-32-bytes',
        signed.token,
        { key: 'receipts/ord_1.pdf', method: 'GET' },
        { now: now + 1, replayStore },
      );

    const results = await Promise.all([verify(first), verify(replica)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'replayed' }]);

    const persisted = await firstRuntime.executor.execute<{ expires_at: string; idem: string }>({
      text: "SELECT expires_at, idem FROM public._kovo_replay WHERE surface = 'capability'",
      values: [],
    });
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]?.idem).toMatch(/^sha256:/);
    expect(persisted.rows[0]?.idem).not.toContain('ord_1.pdf');
    expect(String(persisted.rows[0]?.expires_at)).toBe(String(signed.claims.expiry));

    await firstRuntime.runtime.close();
    runtimes.splice(runtimes.indexOf(firstRuntime.runtime), 1);
    const restarted = await runtimeAt(dir);
    const afterRestart = createPostgresCapabilityReplayStoreFromExecutor(restarted.executor);
    await expect(verify(afterRestart)).resolves.toEqual({ ok: false, reason: 'replayed' });
    await expect(
      afterRestart.consume('v3:receipts/ord_2.pdf:nonce', signed.claims.expiry),
    ).resolves.toBe(true);
  });

  it('refuses already-expired capability ids without retaining replay rows', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresCapabilityReplayStoreFromExecutor(executor);

    await expect(store.consume('v3:expired:nonce', Date.now() - 1)).resolves.toBe(false);
    const persisted = await executor.execute<{ count: number }>({
      text: "SELECT COUNT(*)::int AS count FROM public._kovo_replay WHERE surface = 'capability'",
      values: [],
    });
    expect(persisted.rows).toEqual([{ count: 0 }]);
  });

  it('bounds expired capability cleanup while preserving live replay truth', async () => {
    const { executor } = await runtimeAt(dataDir());
    await executor.execute({
      text: "UPDATE public._kovo_replay_reclaimed SET reclaimed_through = 0 WHERE surface = 'capability'",
      values: [],
    });
    await executor.execute({
      text:
        'INSERT INTO public._kovo_replay ' +
        '(surface, scope, idem, fingerprint, generation, state, response_body, ' +
        'response_headers, response_status, expires_at, committed_at) ' +
        "SELECT 'capability', 'cleanup', 'expired-' || value::text, NULL, " +
        "'generation-' || value::text, 'committed', '1', '{}', 204, value, CURRENT_TIMESTAMP " +
        'FROM generate_series(1, 1030) AS value',
      values: [],
    });
    const liveExpiry = Date.now() + 60_000;
    await executor.execute({
      text:
        'INSERT INTO public._kovo_replay ' +
        '(surface, scope, idem, fingerprint, generation, state, response_body, ' +
        'response_headers, response_status, expires_at, committed_at) ' +
        "VALUES ('capability', 'cleanup', 'live', NULL, 'live-generation', " +
        "'committed', '1', '{}', 204, $1, CURRENT_TIMESTAMP)",
      values: [liveExpiry],
    });
    const store = createPostgresCapabilityReplayStoreFromExecutor(executor);

    await expect(store.consume('cleanup-trigger-1', liveExpiry)).resolves.toBe(true);
    const afterFirst = await executor.execute<{
      expired: number;
      live: number;
      reclaimed_through: string;
    }>({
      text:
        'SELECT COUNT(*) FILTER (WHERE expires_at <= 1030)::int AS expired, ' +
        "COUNT(*) FILTER (WHERE idem = 'live')::int AS live, " +
        "(SELECT reclaimed_through::text FROM public._kovo_replay_reclaimed WHERE surface = 'capability') AS reclaimed_through " +
        "FROM public._kovo_replay WHERE surface = 'capability'",
      values: [],
    });
    expect(afterFirst.rows).toEqual([{ expired: 6, live: 1, reclaimed_through: '1024' }]);

    await expect(store.consume('cleanup-trigger-2', liveExpiry)).resolves.toBe(true);
    const afterSecond = await executor.execute<{
      expired: number;
      live: number;
      reclaimed_through: string;
    }>({
      text:
        'SELECT COUNT(*) FILTER (WHERE expires_at <= 1030)::int AS expired, ' +
        "COUNT(*) FILTER (WHERE idem = 'live')::int AS live, " +
        "(SELECT reclaimed_through::text FROM public._kovo_replay_reclaimed WHERE surface = 'capability') AS reclaimed_through " +
        "FROM public._kovo_replay WHERE surface = 'capability'",
      values: [],
    });
    expect(afterSecond.rows).toEqual([{ expired: 0, live: 1, reclaimed_through: '1030' }]);
  });

  it('refuses capability reuse below a persisted cleanup watermark after clock rollback', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresCapabilityReplayStoreFromExecutor(executor);
    const expiry = Date.now() + 60_000;
    await expect(store.consume('retained-capability', expiry)).resolves.toBe(true);
    await executor.execute({
      text: "UPDATE public._kovo_replay_reclaimed SET reclaimed_through = $1 WHERE surface = 'capability'",
      values: [expiry],
    });

    await expect(store.consume('retained-capability', expiry)).resolves.toBe(false);
    await expect(store.consume('reclaimed-capability', expiry)).resolves.toBe(false);
    const persisted = await executor.execute<{ count: number }>({
      text: "SELECT COUNT(*)::int AS count FROM public._kovo_replay WHERE surface = 'capability'",
      values: [],
    });
    expect(persisted.rows).toEqual([{ count: 1 }]);
  });

  it('upgrades the prior replay relation before admitting capability truth', async () => {
    const dir = dataDir();
    const legacy = new PGlite(dir);
    await legacy.exec(
      [
        'CREATE TABLE _kovo_replay (',
        "surface text NOT NULL CHECK (surface IN ('mutation', 'webhook')),",
        'scope text NOT NULL, idem text NOT NULL, fingerprint text, generation text NOT NULL,',
        'state text NOT NULL, response_body text, response_headers text, response_status integer,',
        'created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, committed_at timestamptz,',
        'PRIMARY KEY (surface, scope, idem))',
      ].join(' '),
    );
    await legacy.close();

    const { executor } = await runtimeAt(dir);
    const store = createPostgresCapabilityReplayStoreFromExecutor(executor);
    await expect(store.consume('v3:migrated:nonce', Date.now() + 60_000)).resolves.toBe(true);
  });

  it('fails closed instead of inventing expiry for legacy mutation or webhook truth', async () => {
    const dir = dataDir();
    const legacy = new PGlite(dir);
    await legacy.exec(
      [
        'CREATE TABLE _kovo_replay (',
        "surface text NOT NULL CHECK (surface IN ('mutation', 'webhook')),",
        'scope text NOT NULL, idem text NOT NULL, fingerprint text, generation text NOT NULL,',
        'state text NOT NULL, response_body text, response_headers text, response_status integer,',
        'created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, committed_at timestamptz,',
        'PRIMARY KEY (surface, scope, idem));',
        'INSERT INTO _kovo_replay ',
        '(surface, scope, idem, generation, state, response_body, response_headers, response_status, committed_at) ',
        "VALUES ('mutation', 'legacy', 'timeless', 'legacy-generation', 'committed', '', '{}', 200, CURRENT_TIMESTAMP)",
      ].join(' '),
    );
    await legacy.close();

    const rejected = createPostgresAppRuntimeDb({ dataDir: dir, driver: 'pglite', schema });
    runtimes.push(rejected);
    await expect(rejected.ready).rejects.toThrow(
      /KV433_REPLAY_STORE_CUTOVER[\s\S]*operator cutover/u,
    );
  });

  it('atomically joins duplicate reservations across store instances and persists settlement', async () => {
    const dir = dataDir();
    const firstRuntime = await runtimeAt(dir);
    const first = createPostgresMutationReplayStoreFromExecutor(firstRuntime.executor, {
      pendingWaitMs: 500,
      pollIntervalMs: 5,
    });
    const replica = createPostgresMutationReplayStoreFromExecutor(firstRuntime.executor, {
      pendingWaitMs: 500,
      pollIntervalMs: 5,
    });
    const idem = mutationIdem('idem-1');

    const [left, right] = await Promise.all([
      first.reserve('session:mutation', idem, 'sha256:request'),
      replica.reserve('session:mutation', idem, 'sha256:request'),
    ]);
    const owner = left ?? right;
    expect(owner).toBeDefined();
    expect([left, right].filter(Boolean)).toHaveLength(1);

    const joined = replica.get('session:mutation', idem, 'sha256:request');
    await owner?.commit(mutationResponse('settled'));
    await expect(joined).resolves.toEqual(mutationResponse('settled'));

    await firstRuntime.runtime.close();
    runtimes.splice(runtimes.indexOf(firstRuntime.runtime), 1);
    const restarted = await runtimeAt(dir);
    const afterRestart = createPostgresMutationReplayStoreFromExecutor(restarted.executor, {
      pendingWaitMs: 0,
    });
    await expect(afterRestart.get('session:mutation', idem, 'sha256:request')).resolves.toEqual(
      mutationResponse('settled'),
    );
    await expect(
      afterRestart.reserve('session:mutation', idem, 'sha256:request'),
    ).resolves.toBeUndefined();
  });

  it('releases mutation admission slots after commit instead of saturating for process lifetime', async () => {
    const { executor, runtime } = await runtimeAt(dataDir());
    const store = runtime.mutationReplayStore;

    for (let index = 0; index < 1_001; index += 1) {
      const reservation = await store.reserve(
        'public:save',
        mutationIdem(`idem-${index}`),
        `fingerprint-${index}`,
      );
      expect(reservation).toBeDefined();
      await reservation?.commit(mutationResponse('saved'));
    }

    const persisted = await executor.execute<{ count: number; occupied: number }>({
      text:
        'SELECT COUNT(*)::int AS count, COUNT(admission_slot)::int AS occupied ' +
        "FROM public._kovo_replay WHERE surface = 'mutation'",
      values: [],
    });
    expect(persisted.rows).toEqual([{ count: 1_001, occupied: 0 }]);
  });

  it('releases webhook admission slots after commit instead of saturating for process lifetime', async () => {
    const { executor, runtime } = await runtimeAt(dataDir());
    const store = runtime.webhookReplayStore;

    for (let index = 0; index < 1_001; index += 1) {
      const reservation = await store.reserve('public:provider', webhookIdentity(`event-${index}`));
      expect(reservation).toBeDefined();
      await reservation?.commit({ body: 'ok', headers: {}, status: 200 });
    }

    const persisted = await executor.execute<{ count: number; occupied: number }>({
      text:
        'SELECT COUNT(*)::int AS count, COUNT(admission_slot)::int AS occupied ' +
        "FROM public._kovo_replay WHERE surface = 'webhook'",
      values: [],
    });
    expect(persisted.rows).toEqual([{ count: 1_001, occupied: 0 }]);
  });

  it('caps 1000 pending mutation claims while keeping the webhook slot pool isolated', async () => {
    const { executor, runtime } = await runtimeAt(dataDir());
    const attempts: Array<ReturnType<typeof runtime.mutationReplayStore.reserve>> = [];
    for (let index = 0; index < 1_000; index += 1) {
      attempts.push(
        runtime.mutationReplayStore.reserve(
          'public:pending-cap',
          mutationIdem(`pending-${index}`),
          `fingerprint-${index}`,
        ),
      );
    }
    const pending = await Promise.all(attempts);
    expect(pending.every((reservation) => reservation !== undefined)).toBe(true);
    await expect(
      runtime.mutationReplayStore.reserve(
        'public:pending-cap',
        mutationIdem('pending-over-capacity'),
        'fingerprint-over-capacity',
      ),
    ).resolves.toBeUndefined();

    const webhook = await runtime.webhookReplayStore.reserve(
      'public:pending-cap',
      webhookIdentity('event-in-isolated-pool'),
    );
    expect(webhook).toBeDefined();

    const persisted = await executor.execute<{
      distinct_slots: number;
      mutation_pending: number;
      webhook_pending: number;
    }>({
      text:
        "SELECT COUNT(*) FILTER (WHERE surface = 'mutation')::int AS mutation_pending, " +
        "COUNT(*) FILTER (WHERE surface = 'webhook')::int AS webhook_pending, " +
        "COUNT(DISTINCT admission_slot) FILTER (WHERE surface = 'mutation')::int AS distinct_slots " +
        "FROM public._kovo_replay WHERE state = 'pending'",
      values: [],
    });
    expect(persisted.rows).toEqual([
      { distinct_slots: 1_000, mutation_pending: 1_000, webhook_pending: 1 },
    ]);
  });

  it('serializes cross-replica admission and preserves duplicate truth at capacity', async () => {
    const { executor } = await runtimeAt(dataDir());
    const first = createPostgresMutationReplayStoreFromExecutor(executor, {
      maxEntries: 1,
      pendingWaitMs: 0,
    });
    const replica = createPostgresMutationReplayStoreFromExecutor(executor, {
      maxEntries: 1,
      pendingWaitMs: 0,
    });
    const idemA = mutationIdem('idem-a');
    const idemB = mutationIdem('idem-b');
    const idemC = mutationIdem('idem-c');

    const reservations = await Promise.all([
      first.reserve('public:save', idemA, 'fingerprint-a'),
      replica.reserve('public:save', idemB, 'fingerprint-b'),
    ]);
    const admitted = reservations.filter((reservation) => reservation !== undefined);
    expect(admitted).toHaveLength(1);
    const admittedIndex = reservations[0] === undefined ? 1 : 0;
    const admittedIdem = admittedIndex === 0 ? idemA : idemB;
    const admittedFingerprint = admittedIndex === 0 ? 'fingerprint-a' : 'fingerprint-b';
    await admitted[0]?.commit(mutationResponse('settled-at-capacity'));

    const replacement = await first.reserve('public:save', idemC, 'fingerprint-c');
    expect(replacement).toBeDefined();
    await replacement?.commit(mutationResponse('replacement'));
    await expect(replica.get('public:save', admittedIdem, admittedFingerprint)).resolves.toEqual(
      mutationResponse('settled-at-capacity'),
    );
  });

  it('releases only an aborted pending row admission slot', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresWebhookReplayStoreFromExecutor(executor, {
      maxEntries: 1,
      pendingWaitMs: 0,
    });
    const first = await store.reserve('provider', webhookIdentity('event-a'));
    expect(first).toBeDefined();
    await expect(store.reserve('provider', webhookIdentity('event-b'))).resolves.toBeUndefined();

    await first?.abort?.();
    const replacement = await store.reserve('provider', webhookIdentity('event-b'));
    expect(replacement).toBeDefined();
    await replacement?.commit({ body: 'ok', headers: {}, status: 200 });
  });

  it('retires only expired committed truth and leaves expired pending claims fail-closed', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresMutationReplayStoreFromExecutor(executor, {
      maxEntries: 2,
      pendingWaitMs: 0,
    });
    const issuedAtMs = Date.now() - MUTATION_IDEM_MAX_AGE_MS + 1_500;
    const committedIdem = mutationIdem('expiring-committed', issuedAtMs);
    const pendingIdem = mutationIdem('expiring-pending', issuedAtMs);
    const slowCommitIdem = mutationIdem('expiring-slow-commit', issuedAtMs);

    const committed = await store.reserve('expiry', committedIdem, 'committed');
    expect(committed).toBeDefined();
    await committed?.commit(mutationResponse('committed-before-expiry'));
    const pending = await store.reserve('expiry', pendingIdem, 'pending');
    const slowCommit = await store.reserve('expiry', slowCommitIdem, 'slow');
    expect(pending).toBeDefined();
    expect(slowCommit).toBeDefined();

    await delay(1_700);

    await expect(slowCommit?.commit(mutationResponse('too-late'))).rejects.toThrow(
      /lost its generation-fenced pending claim/u,
    );
    await expect(store.get('expiry', committedIdem, 'committed')).resolves.toBeUndefined();
    await expect(store.reserve('expiry', committedIdem, 'committed')).resolves.toBeUndefined();
    await expect(
      store.reserve('expiry', mutationIdem('live-after-expiry'), 'live'),
    ).resolves.toBeUndefined();

    const persisted = await executor.execute<{
      committed: number;
      occupied: number;
      pending: number;
      reclaimed_through: string;
    }>({
      text:
        "SELECT COUNT(*) FILTER (WHERE state = 'committed')::int AS committed, " +
        "COUNT(*) FILTER (WHERE state = 'pending')::int AS pending, " +
        'COUNT(admission_slot)::int AS occupied, ' +
        "(SELECT reclaimed_through::text FROM public._kovo_replay_reclaimed WHERE surface = 'mutation') AS reclaimed_through " +
        'FROM public._kovo_replay ' +
        "WHERE surface = 'mutation'",
      values: [],
    });
    expect(persisted.rows).toEqual([
      {
        committed: 0,
        occupied: 2,
        pending: 2,
        reclaimed_through: String(issuedAtMs + MUTATION_IDEM_MAX_AGE_MS),
      },
    ]);
  });

  it('replays retained mutation truth but refuses fresh claims below a rollback watermark', async () => {
    const dir = dataDir();
    const firstRuntime = await runtimeAt(dir);
    const store = createPostgresMutationReplayStoreFromExecutor(firstRuntime.executor, {
      pendingWaitMs: 0,
    });
    const retainedIdem = mutationIdem('rollback-retained-mutation');
    const blockedIdem = mutationIdem('rollback-blocked-mutation');
    const pendingIdem = mutationIdem('rollback-pending-mutation');
    const expiresAtMs = MUTATION_TEST_ISSUED_AT_MS + MUTATION_IDEM_MAX_AGE_MS;
    const retained = await store.reserve('rollback', retainedIdem, 'retained');
    expect(retained).toBeDefined();
    await retained?.commit(mutationResponse('retained'));
    const pending = await store.reserve('rollback', pendingIdem, 'pending');
    expect(pending).toBeDefined();
    await firstRuntime.executor.execute({
      text: "UPDATE public._kovo_replay_reclaimed SET reclaimed_through = $1 WHERE surface = 'mutation'",
      values: [expiresAtMs],
    });

    await expect(pending?.commit(mutationResponse('pending'))).rejects.toThrow(
      /lost its generation-fenced pending claim/u,
    );
    await firstRuntime.runtime.close();
    runtimes.splice(runtimes.indexOf(firstRuntime.runtime), 1);
    const restarted = await runtimeAt(dir);
    const afterRestart = createPostgresMutationReplayStoreFromExecutor(restarted.executor, {
      pendingWaitMs: 0,
    });

    await expect(afterRestart.get('rollback', retainedIdem, 'retained')).resolves.toEqual(
      mutationResponse('retained'),
    );
    await expect(afterRestart.reserve('rollback', blockedIdem, 'blocked')).resolves.toBeUndefined();
    await expect(
      afterRestart.set('rollback', blockedIdem, mutationResponse('blocked'), 'blocked'),
    ).rejects.toThrow(/expired or unavailable at database time/u);
    const watermark = await restarted.executor.execute<{ reclaimed_through: string }>({
      text: "SELECT reclaimed_through::text AS reclaimed_through FROM public._kovo_replay_reclaimed WHERE surface = 'mutation'",
      values: [],
    });
    expect(watermark.rows).toEqual([{ reclaimed_through: String(expiresAtMs) }]);

    const persisted = await restarted.executor.execute<{ committed: number; pending: number }>({
      text:
        "SELECT COUNT(*) FILTER (WHERE state = 'committed')::int AS committed, " +
        "COUNT(*) FILTER (WHERE state = 'pending')::int AS pending " +
        "FROM public._kovo_replay WHERE surface = 'mutation'",
      values: [],
    });
    expect(persisted.rows).toEqual([{ committed: 1, pending: 1 }]);
  });

  it('retires webhook commits at occurrence plus 30 days without expiring pending claims', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresWebhookReplayStoreFromExecutor(executor, {
      maxEntries: 2,
      pendingWaitMs: 0,
    });
    const occurredAtMs = Date.now() - WEBHOOK_REPLAY_HORIZON_MS + 1_500;
    const committedIdentity = webhookIdentity('expiring-webhook-committed', occurredAtMs);
    const pendingIdentity = webhookIdentity('expiring-webhook-pending', occurredAtMs);
    const slowCommitIdentity = webhookIdentity('expiring-webhook-slow-commit', occurredAtMs);

    const committed = await store.reserve('webhook-expiry', committedIdentity);
    expect(committed).toBeDefined();
    await committed?.commit({ body: 'committed-before-expiry', headers: {}, status: 200 });
    const pending = await store.reserve('webhook-expiry', pendingIdentity);
    const slowCommit = await store.reserve('webhook-expiry', slowCommitIdentity);
    expect(pending).toBeDefined();
    expect(slowCommit).toBeDefined();

    await delay(1_700);

    await expect(
      slowCommit?.commit({ body: 'too-late', headers: {}, status: 200 }),
    ).rejects.toThrow(/lost its generation-fenced pending claim/u);
    await expect(store.get('webhook-expiry', committedIdentity)).resolves.toBeUndefined();
    await expect(store.reserve('webhook-expiry', committedIdentity)).resolves.toBeUndefined();
    await expect(
      store.reserve('webhook-expiry', webhookIdentity('live-webhook-after-expiry')),
    ).resolves.toBeUndefined();

    const persisted = await executor.execute<{
      committed: number;
      horizon_mismatch: number;
      occurrence_mismatch: number;
      occupied: number;
      pending: number;
      reclaimed_through: string;
    }>({
      text:
        "SELECT COUNT(*) FILTER (WHERE state = 'committed')::int AS committed, " +
        "COUNT(*) FILTER (WHERE state = 'pending')::int AS pending, " +
        'COUNT(admission_slot)::int AS occupied, ' +
        'COUNT(*) FILTER (WHERE occurred_at <> $1)::int AS occurrence_mismatch, ' +
        'COUNT(*) FILTER (WHERE expires_at <> occurred_at + $2)::int AS horizon_mismatch, ' +
        "(SELECT reclaimed_through::text FROM public._kovo_replay_reclaimed WHERE surface = 'webhook') AS reclaimed_through " +
        "FROM public._kovo_replay WHERE surface = 'webhook'",
      values: [occurredAtMs, WEBHOOK_REPLAY_HORIZON_MS],
    });
    expect(persisted.rows).toEqual([
      {
        committed: 0,
        horizon_mismatch: 0,
        occurrence_mismatch: 0,
        occupied: 2,
        pending: 2,
        reclaimed_through: String(occurredAtMs + WEBHOOK_REPLAY_HORIZON_MS),
      },
    ]);
  });

  it('replays retained webhook truth but refuses fresh claims below a rollback watermark', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresWebhookReplayStoreFromExecutor(executor, { pendingWaitMs: 0 });
    const retainedIdentity = webhookIdentity('rollback-retained-webhook');
    const blockedIdentity = webhookIdentity('rollback-blocked-webhook');
    const retained = await store.reserve('rollback', retainedIdentity);
    expect(retained).toBeDefined();
    await retained?.commit({ body: 'retained', headers: {}, status: 200 });
    await executor.execute({
      text: "UPDATE public._kovo_replay_reclaimed SET reclaimed_through = $1 WHERE surface = 'webhook'",
      values: [retainedIdentity.expiresAtMs],
    });

    await expect(store.get('rollback', retainedIdentity)).resolves.toEqual({
      body: 'retained',
      headers: {},
      status: 200,
    });
    await expect(store.reserve('rollback', blockedIdentity)).resolves.toBeUndefined();
    await expect(
      store.set('rollback', blockedIdentity, { body: 'blocked', headers: {}, status: 200 }),
    ).rejects.toThrow(/expired or unavailable at database time/u);

    const persisted = await executor.execute<{ count: number }>({
      text: "SELECT COUNT(*)::int AS count FROM public._kovo_replay WHERE surface = 'webhook'",
      values: [],
    });
    expect(persisted.rows).toEqual([{ count: 1 }]);
  });

  it('binds webhook replay truth to the exact authenticated occurrence and expiry', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresWebhookReplayStoreFromExecutor(executor, { pendingWaitMs: 0 });
    const original = webhookIdentity('provider-event', WEBHOOK_TEST_OCCURRED_AT_MS);
    const conflicting = webhookIdentity('provider-event', WEBHOOK_TEST_OCCURRED_AT_MS + 1);
    const reservation = await store.reserve('provider', original);
    expect(reservation).toBeDefined();
    await reservation?.commit({ body: 'accepted', headers: {}, status: 200 });

    await expect(store.get('provider', conflicting)).rejects.toBeInstanceOf(
      WebhookReplayIdentityConflictError,
    );
    await expect(store.reserve('provider', conflicting)).rejects.toBeInstanceOf(
      WebhookReplayIdentityConflictError,
    );
    await expect(
      store.set('provider', conflicting, { body: 'conflicting', headers: {}, status: 200 }),
    ).rejects.toBeInstanceOf(WebhookReplayIdentityConflictError);

    const persisted = await executor.execute<{
      admission_slot: number | null;
      expires_at: string;
      occurred_at: string;
    }>({
      text:
        'SELECT admission_slot, expires_at::text AS expires_at, occurred_at::text AS occurred_at ' +
        "FROM public._kovo_replay WHERE surface = 'webhook'",
      values: [],
    });
    expect(persisted.rows).toEqual([
      {
        admission_slot: null,
        expires_at: String(original.expiresAtMs),
        occurred_at: String(original.occurredAtMs),
      },
    ]);
  });

  it('settles direct committed truth without consuming the pending admission pool', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresMutationReplayStoreFromExecutor(executor, {
      maxEntries: 1,
      pendingWaitMs: 0,
    });
    const pendingIdem = mutationIdem('direct-set-pending');
    const settledIdem = mutationIdem('direct-set-committed');
    const pending = await store.reserve('direct-set', pendingIdem, 'pending');
    expect(pending).toBeDefined();

    await store.set('direct-set', settledIdem, mutationResponse('direct'), 'settled');
    await expect(store.get('direct-set', settledIdem, 'settled')).resolves.toEqual(
      mutationResponse('direct'),
    );
    await expect(
      store.reserve('direct-set', mutationIdem('direct-set-refused'), 'refused'),
    ).resolves.toBeUndefined();

    const persisted = await executor.execute<{
      admission_slot: number | null;
      expires_at: string;
      state: string;
    }>({
      text:
        'SELECT admission_slot, expires_at::text AS expires_at, state ' +
        "FROM public._kovo_replay WHERE surface = 'mutation' ORDER BY state",
      values: [],
    });
    expect(persisted.rows).toEqual([
      {
        admission_slot: null,
        expires_at: String(MUTATION_TEST_ISSUED_AT_MS + MUTATION_IDEM_MAX_AGE_MS),
        state: 'committed',
      },
      {
        admission_slot: 1,
        expires_at: String(MUTATION_TEST_ISSUED_AT_MS + MUTATION_IDEM_MAX_AGE_MS),
        state: 'pending',
      },
    ]);
  });

  it('rejects oversized durable response snapshots before writing committed truth', async () => {
    const { executor } = await runtimeAt(dataDir());
    const bodyStore = createPostgresMutationReplayStoreFromExecutor(executor, {
      maxResponseBodyBytes: 4,
      pendingWaitMs: 0,
    });
    const bodyReservation = await bodyStore.reserve('scope', mutationIdem('body-limit'));
    await expect(bodyReservation?.commit(mutationResponse('abc'))).rejects.toThrow(
      /body exceeds the durable storage byte limit/u,
    );

    const headerStore = createPostgresWebhookReplayStoreFromExecutor(executor, {
      maxResponseHeaderBytes: 8,
      pendingWaitMs: 0,
    });
    const headerReservation = await headerStore.reserve('scope', webhookIdentity('header-limit'));
    await expect(
      headerReservation?.commit({ body: '', headers: { 'X-Test': 'value' }, status: 200 }),
    ).rejects.toThrow(/headers exceed the durable storage byte limit/u);

    const rows = await executor.execute<{ committed: number; pending: number }>({
      text:
        "SELECT COUNT(*) FILTER (WHERE state = 'committed')::int AS committed, " +
        "COUNT(*) FILTER (WHERE state = 'pending')::int AS pending " +
        "FROM public._kovo_replay WHERE surface IN ('mutation', 'webhook')",
      values: [],
    });
    expect(rows.rows).toEqual([{ committed: 0, pending: 2 }]);
  });

  it('keeps a crash-orphaned pending row fail-closed across restart until exact reconciliation', async () => {
    const dir = dataDir();
    const firstRuntime = await runtimeAt(dir);
    const first = createPostgresMutationReplayStoreFromExecutor(firstRuntime.executor, {
      pendingWaitMs: 0,
    });
    const idem = mutationIdem('idem-crash');
    await expect(first.reserve('session:crash', idem, 'sha256:crash')).resolves.toBeDefined();

    const generationRows = await firstRuntime.executor.execute<{ generation: string }>({
      text: "SELECT generation FROM public._kovo_replay WHERE surface = 'mutation'",
      values: [],
    });
    const generation = generationRows.rows[0]?.generation;
    expect(generation).toBeTypeOf('string');

    await firstRuntime.runtime.close();
    runtimes.splice(runtimes.indexOf(firstRuntime.runtime), 1);
    const restarted = await runtimeAt(dir);
    const afterRestart = createPostgresMutationReplayStoreFromExecutor(restarted.executor, {
      pendingWaitMs: 0,
    });
    await expect(afterRestart.get('session:crash', idem, 'sha256:crash')).resolves.toBeUndefined();
    await expect(
      afterRestart.reserve('session:crash', idem, 'sha256:crash'),
    ).resolves.toBeUndefined();

    await expect(
      releasePostgresPendingReplayFromExecutor(
        restarted.executor,
        {
          generation: generation!,
          idem,
          scope: 'session:crash',
          surface: 'mutation',
        },
        { justification: 'operator confirmed the owning process crashed before app commit' },
      ),
    ).resolves.toBe(true);
    await expect(
      afterRestart.reserve('session:crash', idem, 'sha256:crash'),
    ).resolves.toBeDefined();
  });

  it('rejects a fingerprint mismatch without changing committed truth', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresMutationReplayStoreFromExecutor(executor, { pendingWaitMs: 0 });
    const idem = mutationIdem('fingerprint-idem');
    const reservation = await store.reserve('scope', idem, 'fingerprint-a\u0000raw');
    await reservation?.commit(mutationResponse());

    await expect(store.get('scope', idem, 'fingerprint-a%00raw')).rejects.toBeInstanceOf(
      MutationReplayConflictError,
    );
    await expect(store.reserve('scope', idem, 'fingerprint-a%00raw')).rejects.toBeInstanceOf(
      MutationReplayConflictError,
    );
    await expect(store.get('scope', idem, 'fingerprint-a\u0000raw')).resolves.toEqual(
      mutationResponse(),
    );
  });

  it('accepts canonical request fingerprints larger than the replay-key token budget', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresMutationReplayStoreFromExecutor(executor, { pendingWaitMs: 0 });
    const fingerprint = JSON.stringify({ value: 'x'.repeat(4_096) });
    const idem = mutationIdem('idem-large-fingerprint');
    const reservation = await store.reserve('scope', idem, fingerprint);
    expect(reservation).toBeDefined();
    await reservation?.commit(mutationResponse('large-fingerprint'));

    await expect(store.get('scope', idem, fingerprint)).resolves.toEqual(
      mutationResponse('large-fingerprint'),
    );
  });

  it('persists webhook response truth independently from mutation keys', async () => {
    const { executor } = await runtimeAt(dataDir());
    const mutationStore = createPostgresMutationReplayStoreFromExecutor(executor, {
      pendingWaitMs: 0,
    });
    const webhookStore = createPostgresWebhookReplayStoreFromExecutor(executor, {
      pendingWaitMs: 0,
    });
    const mutationIdentity = mutationIdem('shared-idem');
    const webhookEvent = webhookIdentity('shared-idem');
    const mutation = await mutationStore.reserve('shared', mutationIdentity);
    const webhook = await webhookStore.reserve('shared', webhookEvent);
    expect(mutation).toBeDefined();
    expect(webhook).toBeDefined();
    await mutation?.commit(mutationResponse('mutation'));
    await webhook?.commit({ body: 'ok', headers: { 'X-Test': ['one', 'two'] }, status: 200 });

    await expect(mutationStore.get('shared', mutationIdentity)).resolves.toEqual(
      mutationResponse('mutation'),
    );
    await expect(webhookStore.get('shared', webhookEvent)).resolves.toEqual({
      body: 'ok',
      headers: { 'X-Test': ['one', 'two'] },
      status: 200,
    });
  });

  it('keeps lone-surrogate replay keys distinct from valid replacement characters', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresMutationReplayStoreFromExecutor(executor, { pendingWaitMs: 0 });
    const loneSurrogate = '\ud800';
    const replacementCharacter = '\ufffd';
    const idem = mutationIdem('surrogate-scope');
    const loneReservation = await store.reserve(loneSurrogate, idem);
    const replacementReservation = await store.reserve(replacementCharacter, idem);
    expect(loneReservation).toBeDefined();
    expect(replacementReservation).toBeDefined();
    await loneReservation?.commit(mutationResponse('lone-surrogate'));
    await replacementReservation?.commit(mutationResponse('replacement-character'));

    await expect(store.get(loneSurrogate, idem)).resolves.toEqual(
      mutationResponse('lone-surrogate'),
    );
    await expect(store.get(replacementCharacter, idem)).resolves.toEqual(
      mutationResponse('replacement-character'),
    );

    const rows = await executor.execute<{ scope: string }>({
      text: "SELECT scope FROM public._kovo_replay WHERE surface = 'mutation' ORDER BY scope",
      values: [],
    });
    expect(rows.rows).toHaveLength(2);
    expect(new Set(rows.rows.map((row) => row.scope)).size).toBe(2);
  });

  it('canonicalizes NUL-delimited framework scopes without aliasing literal escape text', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresMutationReplayStoreFromExecutor(executor, { pendingWaitMs: 0 });
    const nulScope = 'session\u0000mutation';
    const literalScope = 'session%00mutation';
    const idem = mutationIdem('nul-scope');
    const nulReservation = await store.reserve(nulScope, idem);
    const literalReservation = await store.reserve(literalScope, idem);
    expect(nulReservation).toBeDefined();
    expect(literalReservation).toBeDefined();
    await nulReservation?.commit(mutationResponse('nul\u0000body'));
    await literalReservation?.commit(mutationResponse('literal'));

    await expect(store.get(nulScope, idem)).resolves.toEqual(mutationResponse('nul\u0000body'));
    await expect(store.get(literalScope, idem)).resolves.toEqual(mutationResponse('literal'));

    const rows = await executor.execute<{ idem: string; response_body: string; scope: string }>({
      text: "SELECT scope, idem, response_body FROM public._kovo_replay WHERE surface = 'mutation' ORDER BY scope",
      values: [],
    });
    expect(rows.rows).toHaveLength(2);
    expect(
      rows.rows.every(
        (row) =>
          !row.scope.includes('\u0000') &&
          !row.idem.includes('\u0000') &&
          !row.response_body.includes('\u0000'),
      ),
    ).toBe(true);
  });
});
