import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPostgresAppRuntimeDb,
  postgresSchemaModule,
  usePostgresSystemDb,
  type KovoPostgresAppRuntimeDb,
} from './postgres-runtime.js';
import {
  createPostgresMutationReplayStore,
  createPostgresWebhookReplayStore,
  releasePostgresPendingReplay,
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

  it('atomically joins duplicate reservations across store instances and persists settlement', async () => {
    const dir = dataDir();
    const firstRuntime = await runtimeAt(dir);
    const first = createPostgresMutationReplayStore(firstRuntime.executor, {
      pendingWaitMs: 500,
      pollIntervalMs: 5,
    });
    const replica = createPostgresMutationReplayStore(firstRuntime.executor, {
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
    const afterRestart = createPostgresMutationReplayStore(restarted.executor, {
      pendingWaitMs: 0,
    });
    await expect(afterRestart.get('session:mutation', 'idem-1', 'sha256:request')).resolves.toEqual(
      mutationResponse('settled'),
    );
    await expect(
      afterRestart.reserve('session:mutation', 'idem-1', 'sha256:request'),
    ).resolves.toBeUndefined();
  });

  it('keeps a crash-orphaned pending row fail-closed across restart until exact reconciliation', async () => {
    const dir = dataDir();
    const firstRuntime = await runtimeAt(dir);
    const first = createPostgresMutationReplayStore(firstRuntime.executor, { pendingWaitMs: 0 });
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
    const afterRestart = createPostgresMutationReplayStore(restarted.executor, {
      pendingWaitMs: 0,
    });
    await expect(
      afterRestart.get('session:crash', 'idem-crash', 'sha256:crash'),
    ).resolves.toBeUndefined();
    await expect(
      afterRestart.reserve('session:crash', 'idem-crash', 'sha256:crash'),
    ).resolves.toBeUndefined();

    await expect(
      releasePostgresPendingReplay(
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
    const store = createPostgresMutationReplayStore(executor, { pendingWaitMs: 0 });
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

  it('persists webhook response truth independently from mutation keys', async () => {
    const { executor } = await runtimeAt(dataDir());
    const mutationStore = createPostgresMutationReplayStore(executor, { pendingWaitMs: 0 });
    const webhookStore = createPostgresWebhookReplayStore(executor, { pendingWaitMs: 0 });
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

  it('canonicalizes NUL-delimited framework scopes without aliasing literal escape text', async () => {
    const { executor } = await runtimeAt(dataDir());
    const store = createPostgresMutationReplayStore(executor, { pendingWaitMs: 0 });
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
