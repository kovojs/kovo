import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import type { KovoPostgresAppRuntimeDb } from './public-postgres.js';
import type { MutationReplayStore } from './public-replay.js';
import type { CapabilityReplayStore } from './public-storage-downloads.js';
import type { WebhookReplayStore } from './public-webhooks.js';

const serverPackageRoot = resolve(process.cwd(), 'packages/server');
const vpBin = resolve(process.cwd(), 'node_modules/.bin/vp');
const bundleReplayOwners = pgTable(
  'bundle_replay_owners',
  { id: text('id').primaryKey(), ownerId: text('owner_id').notNull() },
  kovo((columns) => ({ domain: 'bundle-replay', key: columns.id, owner: columns.ownerId })),
);

describe('built-bundle durable replay receipts (SPEC §10.3)', () => {
  it('shares core-authenticated receipts across bundle A and bundle B while rejecting forgeries', async () => {
    const root = mkdtempSync(join(serverPackageRoot, '.tmp-replay-receipt-bundles-'));
    const bundleAPath = join(root, 'bundle-a');
    const bundleBPath = join(root, 'bundle-b');
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    let runtimeA: KovoPostgresAppRuntimeDb | undefined;

    try {
      packServerBundle(bundleAPath);
      packServerBundle(bundleBPath);

      const bundleAPostgres = (await import(
        pathToFileURL(join(bundleAPath, 'public-postgres.mjs')).href
      )) as typeof import('./public-postgres.js');
      runtimeA = bundleAPostgres.createPostgresAppRuntimeDb({
        dataDir: join(root, 'runtime-a'),
        driver: 'pglite',
        schema: bundleAPostgres.postgresSchemaModule({ bundleReplayOwners }),
      });
      await runtimeA.ready;
      const mutationStoreFromA = runtimeA.mutationReplayStore;
      const webhookStoreFromA = runtimeA.webhookReplayStore;
      const capabilityStoreFromA = runtimeA.capabilityReplayStore;
      process.env.NODE_ENV = 'production';
      const bundleB = (await import(
        pathToFileURL(join(bundleBPath, 'index.mjs')).href
      )) as typeof import('./index.js');
      const bundleBStorageDownloads = (await import(
        pathToFileURL(join(bundleBPath, 'public-storage-downloads.mjs')).href
      )) as typeof import('./public-storage-downloads.js');
      const bundleBWebhooks = (await import(
        pathToFileURL(join(bundleBPath, 'public-webhooks.mjs')).href
      )) as typeof import('./public-webhooks.js');
      const contractB = bundleB.defineKovo({
        appId: '00000000-0000-4000-8000-0000000000b2',
        egress: {
          enabled: false,
          justification: 'cross-bundle receipt test performs no outbound I/O',
        },
        mutationReplayStore: mutationStoreFromA,
      });

      expect(() => contractB.assemble({})).not.toThrow();

      const records = bundleB.domain('receipt-cross-bundle-records');
      expect(() =>
        bundleBWebhooks.webhook('/webhooks/cross-bundle', {
          handler() {},
          idempotency: (input) =>
            bundleBWebhooks.webhookReplayIdentity(input.id, input.occurredAtMs),
          input: bundleB.s.object({
            id: bundleB.s.string(),
            occurredAtMs: bundleB.s.number().int(),
          }),
          replayStore: webhookStoreFromA,
          verify: 'none',
          verifyJustification: 'cross-bundle production replay posture test',
          writes: [records],
        }),
      ).not.toThrow();

      const storage = {
        async get() {
          return undefined;
        },
        async stat() {
          return undefined;
        },
        async stream() {
          return undefined;
        },
      };
      expect(() =>
        bundleBStorageDownloads.createStorageDownloadEndpoint({
          replayStore: capabilityStoreFromA,
          secret: 'cross-bundle-capability-secret-at-least-32-bytes',
          storage,
        }),
      ).not.toThrow();

      const forgedContract = bundleB.defineKovo({
        appId: '00000000-0000-4000-8000-0000000000f2',
        egress: {
          enabled: false,
          justification: 'cross-bundle receipt test performs no outbound I/O',
        },
        mutationReplayStore: forgedMutationStore(),
      });
      expect(() => forgedContract.assemble({})).toThrow(/KV436.*mutationReplayStore/);
      expect(() =>
        bundleBWebhooks.webhook('/webhooks/cross-bundle-forged', {
          handler() {},
          idempotency: (input) =>
            bundleBWebhooks.webhookReplayIdentity(input.id, input.occurredAtMs),
          input: bundleB.s.object({
            id: bundleB.s.string(),
            occurredAtMs: bundleB.s.number().int(),
          }),
          replayStore: forgedWebhookStore(),
          verify: 'none',
          verifyJustification: 'cross-bundle production replay posture test',
          writes: [records],
        }),
      ).toThrow(/KV436.*webhookReplayStore/);
      expect(() =>
        bundleBStorageDownloads.createStorageDownloadEndpoint({
          replayStore: forgedCapabilityStore(),
          secret: 'cross-bundle-capability-secret-at-least-32-bytes',
          storage,
        }),
      ).toThrow(/KV436.*capabilityReplayStore/);
    } finally {
      await runtimeA?.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      rmSync(root, { force: true, recursive: true });
    }
  }, 30_000);
});

function packServerBundle(outDir: string): void {
  execFileSync(
    vpBin,
    [
      'pack',
      'src/index.ts',
      'src/public-postgres.ts',
      'src/public-storage-downloads.ts',
      'src/public-webhooks.ts',
      '-d',
      outDir,
      '--no-dts',
      '--logLevel',
      'silent',
    ],
    {
      cwd: serverPackageRoot,
      stdio: 'pipe',
    },
  );
}

function forgedMutationStore(): MutationReplayStore {
  return {
    get() {
      return undefined;
    },
    reserve() {
      return { commit() {} };
    },
    set() {},
    [Symbol.for('kovo.durable-replay-store')]: true,
  };
}

function forgedWebhookStore(): WebhookReplayStore {
  return {
    get() {
      return undefined;
    },
    reserve() {
      return { commit() {} };
    },
    set() {},
    [Symbol.for('kovo.durable-replay-store')]: true,
  };
}

function forgedCapabilityStore(): CapabilityReplayStore {
  return {
    consume() {
      return true;
    },
    [Symbol.for('kovo.durable-replay-store')]: true,
  };
}
