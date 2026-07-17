import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
      afterRestart.consume('v2:receipts/ord_2.pdf:nonce', signed.claims.expiry),
    ).resolves.toBe(true);
  });

  it('refuses already-expired capability ids without retaining replay rows', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresCapabilityReplayStoreFromExecutor(executor);

    await expect(store.consume('v2:expired:nonce', Date.now() - 1)).resolves.toBe(false);
    const persisted = await executor.execute<{ count: number }>({
      text: "SELECT COUNT(*)::int AS count FROM public._kovo_replay WHERE surface = 'capability'",
      values: [],
    });
    expect(persisted.rows).toEqual([{ count: 0 }]);
  });

  it('bounds expired capability cleanup while preserving live replay truth', async () => {
    const { executor } = await runtimeAt(dataDir());
    await executor.execute({
      text:
        'INSERT INTO public._kovo_replay ' +
        '(surface, scope, idem, fingerprint, generation, state, response_body, ' +
        'response_headers, response_status, expires_at, committed_at) ' +
        "SELECT 'capability', 'cleanup', 'expired-' || value::text, NULL, " +
        "'generation-' || value::text, 'committed', '1', '{}', 204, 1, CURRENT_TIMESTAMP " +
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
    const afterFirst = await executor.execute<{ expired: number; live: number }>({
      text:
        'SELECT COUNT(*) FILTER (WHERE expires_at = 1)::int AS expired, ' +
        "COUNT(*) FILTER (WHERE idem = 'live')::int AS live " +
        "FROM public._kovo_replay WHERE surface = 'capability'",
      values: [],
    });
    expect(afterFirst.rows).toEqual([{ expired: 6, live: 1 }]);

    await expect(store.consume('cleanup-trigger-2', liveExpiry)).resolves.toBe(true);
    const afterSecond = await executor.execute<{ expired: number; live: number }>({
      text:
        'SELECT COUNT(*) FILTER (WHERE expires_at = 1)::int AS expired, ' +
        "COUNT(*) FILTER (WHERE idem = 'live')::int AS live " +
        "FROM public._kovo_replay WHERE surface = 'capability'",
      values: [],
    });
    expect(afterSecond.rows).toEqual([{ expired: 0, live: 1 }]);
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
    await expect(store.consume('v2:migrated:nonce', Date.now() + 60_000)).resolves.toBe(true);
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

    const [left, right] = await Promise.all([
      first.reserve('session:mutation', 'idem-1', 'sha256:request'),
      replica.reserve('session:mutation', 'idem-1', 'sha256:request'),
    ]);
    const owner = left ?? right;
    expect(owner).toBeDefined();
    expect([left, right].filter(Boolean)).toHaveLength(1);

    const joined = replica.get('session:mutation', 'idem-1', 'sha256:request');
    await owner?.commit(mutationResponse('settled'));
    await expect(joined).resolves.toEqual(mutationResponse('settled'));

    await firstRuntime.runtime.close();
    runtimes.splice(runtimes.indexOf(firstRuntime.runtime), 1);
    const restarted = await runtimeAt(dir);
    const afterRestart = createPostgresMutationReplayStoreFromExecutor(restarted.executor, {
      pendingWaitMs: 0,
    });
    await expect(afterRestart.get('session:mutation', 'idem-1', 'sha256:request')).resolves.toEqual(
      mutationResponse('settled'),
    );
    await expect(
      afterRestart.reserve('session:mutation', 'idem-1', 'sha256:request'),
    ).resolves.toBeUndefined();
  });

  it('fails closed when durable mutation replay truth reaches the default admission ceiling', async () => {
    const { executor, runtime } = await runtimeAt(dataDir());
    const store = runtime.mutationReplayStore;

    for (let index = 0; index < 1_000; index += 1) {
      const reservation = await store.reserve('public:save', `idem-${index}`, `fingerprint-${index}`);
      expect(reservation).toBeDefined();
      await reservation?.commit(mutationResponse('saved'));
    }

    await expect(
      store.reserve('public:save', 'idem-over-capacity', 'fingerprint-over-capacity'),
    ).resolves.toBeUndefined();

    const persisted = await executor.execute<{ count: number }>({
      text: "SELECT COUNT(*)::int AS count FROM public._kovo_replay WHERE surface = 'mutation'",
      values: [],
    });
    expect(persisted.rows).toEqual([{ count: 1_000 }]);
  });

  it('fails closed when durable webhook replay truth reaches the default admission ceiling', async () => {
    const { executor, runtime } = await runtimeAt(dataDir());
    const store = runtime.webhookReplayStore;

    for (let index = 0; index < 1_000; index += 1) {
      const reservation = await store.reserve('public:provider', `event-${index}`);
      expect(reservation).toBeDefined();
      await reservation?.commit({ body: 'ok', headers: {}, status: 200 });
    }

    await expect(store.reserve('public:provider', 'event-over-capacity')).resolves.toBeUndefined();

    const persisted = await executor.execute<{ count: number }>({
      text: "SELECT COUNT(*)::int AS count FROM public._kovo_replay WHERE surface = 'webhook'",
      values: [],
    });
    expect(persisted.rows).toEqual([{ count: 1_000 }]);
  });

  it('keeps a crash-orphaned pending row fail-closed across restart until exact reconciliation', async () => {
    const dir = dataDir();
    const firstRuntime = await runtimeAt(dir);
    const first = createPostgresMutationReplayStoreFromExecutor(firstRuntime.executor, {
      pendingWaitMs: 0,
    });
    await expect(
      first.reserve('session:crash', 'idem-crash', 'sha256:crash'),
    ).resolves.toBeDefined();

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
    await expect(
      afterRestart.get('session:crash', 'idem-crash', 'sha256:crash'),
    ).resolves.toBeUndefined();
    await expect(
      afterRestart.reserve('session:crash', 'idem-crash', 'sha256:crash'),
    ).resolves.toBeUndefined();

    await expect(
      releasePostgresPendingReplayFromExecutor(
        restarted.executor,
        {
          generation: generation!,
          idem: 'idem-crash',
          scope: 'session:crash',
          surface: 'mutation',
        },
        { justification: 'operator confirmed the owning process crashed before app commit' },
      ),
    ).resolves.toBe(true);
    await expect(
      afterRestart.reserve('session:crash', 'idem-crash', 'sha256:crash'),
    ).resolves.toBeDefined();
  });

  it('rejects a fingerprint mismatch without changing committed truth', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresMutationReplayStoreFromExecutor(executor, { pendingWaitMs: 0 });
    const reservation = await store.reserve('scope', 'idem', 'fingerprint-a\u0000raw');
    await reservation?.commit(mutationResponse());

    await expect(store.get('scope', 'idem', 'fingerprint-a%00raw')).rejects.toBeInstanceOf(
      MutationReplayConflictError,
    );
    await expect(store.reserve('scope', 'idem', 'fingerprint-a%00raw')).rejects.toBeInstanceOf(
      MutationReplayConflictError,
    );
    await expect(store.get('scope', 'idem', 'fingerprint-a\u0000raw')).resolves.toEqual(
      mutationResponse(),
    );
  });

  it('accepts canonical request fingerprints larger than the replay-key token budget', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresMutationReplayStoreFromExecutor(executor, { pendingWaitMs: 0 });
    const fingerprint = JSON.stringify({ value: 'x'.repeat(4_096) });
    const reservation = await store.reserve('scope', 'idem-large-fingerprint', fingerprint);
    expect(reservation).toBeDefined();
    await reservation?.commit(mutationResponse('large-fingerprint'));

    await expect(store.get('scope', 'idem-large-fingerprint', fingerprint)).resolves.toEqual(
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
    const mutation = await mutationStore.reserve('shared', 'idem');
    const webhook = await webhookStore.reserve('shared', 'idem');
    expect(mutation).toBeDefined();
    expect(webhook).toBeDefined();
    await mutation?.commit(mutationResponse('mutation'));
    await webhook?.commit({ body: 'ok', headers: { 'X-Test': ['one', 'two'] }, status: 200 });

    await expect(mutationStore.get('shared', 'idem')).resolves.toEqual(
      mutationResponse('mutation'),
    );
    await expect(webhookStore.get('shared', 'idem')).resolves.toEqual({
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
    const loneReservation = await store.reserve('scope', loneSurrogate);
    const replacementReservation = await store.reserve('scope', replacementCharacter);
    expect(loneReservation).toBeDefined();
    expect(replacementReservation).toBeDefined();
    await loneReservation?.commit(mutationResponse('lone-surrogate'));
    await replacementReservation?.commit(mutationResponse('replacement-character'));

    await expect(store.get('scope', loneSurrogate)).resolves.toEqual(
      mutationResponse('lone-surrogate'),
    );
    await expect(store.get('scope', replacementCharacter)).resolves.toEqual(
      mutationResponse('replacement-character'),
    );

    const rows = await executor.execute<{ idem: string }>({
      text: "SELECT idem FROM public._kovo_replay WHERE surface = 'mutation' ORDER BY idem",
      values: [],
    });
    expect(rows.rows).toHaveLength(2);
    expect(new Set(rows.rows.map((row) => row.idem)).size).toBe(2);
  });

  it('canonicalizes NUL-delimited framework scopes without aliasing literal escape text', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresMutationReplayStoreFromExecutor(executor, { pendingWaitMs: 0 });
    const nulScope = 'session\u0000mutation';
    const literalScope = 'session%00mutation';
    const nulReservation = await store.reserve(nulScope, 'idem\u0000one');
    const literalReservation = await store.reserve(literalScope, 'idem%00one');
    expect(nulReservation).toBeDefined();
    expect(literalReservation).toBeDefined();
    await nulReservation?.commit(mutationResponse('nul\u0000body'));
    await literalReservation?.commit(mutationResponse('literal'));

    await expect(store.get(nulScope, 'idem\u0000one')).resolves.toEqual(
      mutationResponse('nul\u0000body'),
    );
    await expect(store.get(literalScope, 'idem%00one')).resolves.toEqual(
      mutationResponse('literal'),
    );

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
