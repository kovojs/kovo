import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createMemoryStorage,
  createS3CompatibleStorage,
  principalScopedKey,
  type S3CompatibleGetObjectInput,
  type S3CompatibleGetObjectOutput,
  type S3CompatibleHeadObjectInput,
  type S3CompatibleListObjectsInput,
  type S3CompatibleObjectClient,
  type S3CompatibleObjectMetadata,
  type S3CompatiblePutObjectInput,
  type S3CompatiblePutObjectOutput,
} from '@kovojs/core/internal/storage';
import type { StorageCapability } from '@kovojs/core';
import { kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';

import { usePostgresSystemDb } from './internal/postgres-capability.js';
import { createSigningKeyRing } from './keyring.js';
import {
  PrincipalErasureIncompleteError,
  erasePrincipal,
  verifyPrincipalErasureReceipt,
} from './principal-erasure.js';
import { persistedReplayPrincipal } from './postgres-replay.js';
import {
  createPostgresAppRuntimeDb,
  postgresSchemaModule,
  type KovoPostgresAppRuntimeDb,
} from './postgres-runtime.js';
import { mutationReplayScopedKey } from './replay.js';
import { replayMutationWireBody } from './response.js';
import { createDurableTaskSqlExecutor, PostgresDurableTaskQueue } from './task-queue.js';

const signingKeyRing = createSigningKeyRing({
  keys: [
    {
      id: 'principal-erasure-test-key',
      secret: 'principal-erasure-test-root-secret-32-bytes-minimum',
      state: 'active',
    },
  ],
});

const erasureOwners = pgTable(
  'principal_erasure_test_owners',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
  },
  kovo({ domain: 'principal-erasure-tests', key: 'id', owner: 'ownerId' }),
);
const schema = postgresSchemaModule({ erasureOwners });

function mutationIdem(label: string): string {
  const nonce = createHash('sha256').update(label).digest('hex').slice(0, 32);
  return `v1_${Date.now()}_${nonce}`;
}

function mutationResponse(body: string) {
  return {
    body: replayMutationWireBody(body, { reason: 'Principal erasure regression fixture' }),
    headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8' },
    status: 200 as const,
  };
}

describe('principal erasure receipts (SPEC §10.3)', () => {
  const roots: string[] = [];
  const runtimes: KovoPostgresAppRuntimeDb[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) await runtimes.pop()?.close();
    while (roots.length > 0) rmSync(roots.pop()!, { force: true, recursive: true });
  });

  async function runtime(): Promise<KovoPostgresAppRuntimeDb> {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-principal-erasure-'));
    roots.push(dataDir);
    const created = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    runtimes.push(created);
    await created.ready;
    return created;
  }

  it('tombstones, erases every Kovo-owned sink, proves absence, and signs a narrow receipt', async () => {
    const appRuntime = await runtime();
    const storage = createMemoryStorage();
    const victimBlob = principalScopedKey('victim', 'private/avatar');
    const otherBlob = principalScopedKey('other', 'private/avatar');
    await storage.put(victimBlob, 'victim blob');
    await storage.put(otherBlob, 'other blob');

    const executor = usePostgresSystemDb(
      appRuntime.systemDb({
        operation: 'write',
        reason: 'seed principal-erasure regression sinks',
        surface: 'principal-erasure.test.ts',
      }),
      createDurableTaskSqlExecutor,
    );
    const tasks = new PostgresDurableTaskQueue(executor);
    await tasks.enqueue({
      args: { private: 'victim task args' },
      principal: 'victim',
      task: 'victim',
    });
    await tasks.enqueue({
      args: { private: 'other task args' },
      principal: 'other',
      task: 'other',
    });

    const victimIdem = mutationIdem('victim');
    const otherIdem = mutationIdem('other');
    await appRuntime.mutationReplayStore.set(
      mutationReplayScopedKey('same-authority-shape', victimIdem),
      'same-authority-shape',
      victimIdem,
      mutationResponse('victim replay body'),
      undefined,
      'victim',
    );
    await appRuntime.mutationReplayStore.set(
      mutationReplayScopedKey('same-authority-shape', otherIdem),
      'same-authority-shape',
      otherIdem,
      mutationResponse('other replay body'),
      undefined,
      'other',
    );

    const receipt = await erasePrincipal('victim', {
      runtime: appRuntime,
      signingKeyRing,
      storage: [storage],
    });

    expect(receipt).toMatchObject({
      absenceProbed: true,
      blobObjectsDeleted: 1,
      durableTaskRowsDeleted: 1,
      keyId: 'principal-erasure-test-key',
      mutationReplayRowsDeleted: 1,
      storageAdaptersProbed: 1,
      tombstoneEpoch: 1,
      version: 'kovo-principal-erasure-receipt/v1',
    });
    expect(JSON.stringify(receipt)).not.toContain('victim');
    expect(receipt.principalCommitment).toMatch(/^sha256:/u);
    expect(verifyPrincipalErasureReceipt(receipt, signingKeyRing)).toBe(true);
    expect(
      verifyPrincipalErasureReceipt(
        { ...receipt, blobObjectsDeleted: receipt.blobObjectsDeleted + 1 },
        signingKeyRing,
      ),
    ).toBe(false);
    expect(
      verifyPrincipalErasureReceipt(
        { ...receipt, principalCommitment: 'sha256:not-a-digest' },
        signingKeyRing,
      ),
    ).toBe(false);
    expect(verifyPrincipalErasureReceipt({ ...receipt, signature: 'short' }, signingKeyRing)).toBe(
      false,
    );

    await expect(storage.get(victimBlob)).resolves.toBeUndefined();
    await expect(storage.get(otherBlob)).resolves.toBeDefined();
    const residue = await executor.execute<{
      other_replay: number;
      other_tasks: number;
      victim_replay: number;
      victim_tasks: number;
    }>({
      text:
        "SELECT (SELECT COUNT(*)::int FROM public._kovo_replay WHERE surface = 'mutation' " +
        'AND principal_index = $1) AS victim_replay, ' +
        "(SELECT COUNT(*)::int FROM public._kovo_replay WHERE surface = 'mutation' " +
        'AND principal_index = $2) AS other_replay, ' +
        "(SELECT COUNT(*)::int FROM public._kovo_jobs WHERE args::text LIKE '%victim task args%') AS victim_tasks, " +
        "(SELECT COUNT(*)::int FROM public._kovo_jobs WHERE args::text LIKE '%other task args%') AS other_tasks",
      values: [persistedReplayPrincipal('victim'), persistedReplayPrincipal('other')],
    });
    expect(residue.rows).toEqual([
      { other_replay: 1, other_tasks: 1, victim_replay: 0, victim_tasks: 0 },
    ]);

    const epoch = await appRuntime.principalEpochStore.current('victim', {
      signal: new AbortController().signal,
    });
    expect(epoch).toMatchObject({ epoch: 1, status: 'tombstoned' });
  });

  it('fails closed without a receipt when a built-in adapter cannot prove deletion', async () => {
    const appRuntime = await runtime();
    const client = new StickyS3Client();
    const storage = createS3CompatibleStorage({ bucket: 'private', client });
    await storage.put(principalScopedKey('victim', 'private/object'), 'secret');

    await expect(
      erasePrincipal('victim', {
        runtime: appRuntime,
        signingKeyRing,
        storage: [storage],
      }),
    ).rejects.toEqual(new PrincipalErasureIncompleteError('blobs'));
  });

  it('rejects structural runtime and storage lookalikes at their exact authority boundaries', async () => {
    const storage = createMemoryStorage();
    const structuralRuntime = {} as KovoPostgresAppRuntimeDb;
    await expect(
      erasePrincipal('victim', {
        runtime: structuralRuntime,
        signingKeyRing,
        storage: [storage],
      }),
    ).rejects.toThrow(/invalid Postgres app runtime/u);

    const appRuntime = await runtime();
    const structuralStorage = {
      async delete() {},
      async get() {
        return undefined;
      },
      async put() {
        return { key: 'structural' };
      },
      async stat() {
        return undefined;
      },
      async stream() {
        return undefined;
      },
    } as StorageCapability;
    await expect(
      erasePrincipal('victim', {
        runtime: appRuntime,
        signingKeyRing,
        storage: [structuralStorage],
      }),
    ).rejects.toThrow(/exact enumerable storage capability/u);

    const epoch = await appRuntime.principalEpochStore.current('victim', {
      signal: new AbortController().signal,
    });
    expect(epoch).toBeUndefined();
  });

  it('rejects unbounded principals and duplicate adapters before irreversible work', async () => {
    const storage = createMemoryStorage();
    const structuralRuntime = {} as KovoPostgresAppRuntimeDb;
    await expect(
      erasePrincipal('p'.repeat(1_025), {
        runtime: structuralRuntime,
        signingKeyRing,
        storage: [storage],
      }),
    ).rejects.toThrow(/bounded proven principal/u);

    const appRuntime = await runtime();
    await expect(
      erasePrincipal('victim', {
        runtime: appRuntime,
        signingKeyRing,
        storage: [storage, storage],
      }),
    ).rejects.toThrow(/storage entries must be unique exact capabilities/u);

    const epoch = await appRuntime.principalEpochStore.current('victim', {
      signal: new AbortController().signal,
    });
    expect(epoch).toBeUndefined();
  });
});

class StickyS3Client implements S3CompatibleObjectClient {
  private object:
    | { key: string; metadata?: Readonly<Record<string, string>> | undefined }
    | undefined;

  async deleteObject(): Promise<void> {
    // Deliberately leave the object in place to exercise the mandatory absence probe.
  }

  async getObject(
    input: S3CompatibleGetObjectInput,
  ): Promise<S3CompatibleGetObjectOutput | undefined> {
    if (this.object?.key !== input.key) return undefined;
    return {
      body: 'secret',
      ...(this.object.metadata === undefined ? {} : { metadata: this.object.metadata }),
    };
  }

  async headObject(
    input: S3CompatibleHeadObjectInput,
  ): Promise<S3CompatibleObjectMetadata | undefined> {
    if (this.object?.key !== input.key) return undefined;
    return this.object.metadata === undefined ? {} : { metadata: this.object.metadata };
  }

  async listObjects(input: S3CompatibleListObjectsInput) {
    return {
      objects:
        this.object !== undefined && this.object.key.startsWith(input.prefix)
          ? [{ key: this.object.key }]
          : [],
    };
  }

  async putObject(input: S3CompatiblePutObjectInput): Promise<S3CompatiblePutObjectOutput> {
    this.object = { key: input.key, metadata: input.metadata };
    return input.metadata === undefined ? {} : { metadata: input.metadata };
  }
}
