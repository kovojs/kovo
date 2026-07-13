import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const postgresRuntimeApi = await import('./postgres-runtime.js?durable-capability-runtime');
const runtimeRoot = mkdtempSync(join(tmpdir(), 'kovo-capability-production-'));
const capabilityOwners = pgTable(
  'capability_production_owners',
  { id: text('id').primaryKey(), ownerId: text('owner_id').notNull() },
  kovo({ domain: 'capability-production', key: 'id', owner: 'ownerId' }),
);
const postgresRuntime = postgresRuntimeApi.createPostgresAppRuntimeDb({
  dataDir: runtimeRoot,
  driver: 'pglite',
  schema: postgresRuntimeApi.postgresSchemaModule({ capabilityOwners }),
});
await postgresRuntime.ready;
process.env.NODE_ENV = 'production';

const [capabilityRouteApi, capabilityUrlApi] = await Promise.all([
  import('./capability-route.js?durable-capability-replay-production'),
  import('./capability-url.js?durable-capability-replay-production'),
]);

const SECRET = 'production-capability-replay-secret-at-least-32-bytes';
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
afterAll(async () => {
  await postgresRuntime.close();
  rmSync(runtimeRoot, { force: true, recursive: true });
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

describe('production one-time capability replay truth', () => {
  it('refuses a storage download endpoint with no durable replay store', () => {
    expect(() =>
      capabilityRouteApi.createStorageDownloadEndpoint({ secret: SECRET, storage }),
    ).toThrow(/KV436.*missing.*replayStore.*capabilityReplayStore/);
  });

  it('refuses the framework memory capability replay store', () => {
    expect(() =>
      capabilityRouteApi.createStorageDownloadEndpoint({
        replayStore: capabilityUrlApi.createMemoryCapabilityReplayStore(),
        secret: SECRET,
        storage,
      }),
    ).toThrow(/KV436.*volatile memory replayStore.*capabilityReplayStore/);
  });

  it('refuses a custom structural and global-symbol replay store forgery', () => {
    const replayStore = {
      consume() {
        return true;
      },
      [Symbol.for('kovo.durable-replay-store')]: true,
    };

    expect(() =>
      capabilityRouteApi.createStorageDownloadEndpoint({ replayStore, secret: SECRET, storage }),
    ).toThrow(/KV436.*custom.*replayStore.*capabilityReplayStore/);
  });

  it('accepts and snapshots the authenticated Postgres capability store', () => {
    const replayStore = postgresRuntime.capabilityReplayStore;

    expect(() =>
      capabilityRouteApi.createStorageDownloadEndpoint({ replayStore, secret: SECRET, storage }),
    ).not.toThrow();
    expect(
      capabilityUrlApi.isDurableCapabilityReplayStore(
        capabilityUrlApi.snapshotReplayStore(replayStore),
      ),
    ).toBe(true);
  });

  it('fails closed when direct production verification is given a memory store', async () => {
    const { token } = await capabilityUrlApi.signCapability(SECRET, {
      expiresIn: 60_000,
      key: 'receipts/one-time.pdf',
      oneTime: true,
    });

    await expect(
      capabilityUrlApi.verifyCapability(
        SECRET,
        token,
        { key: 'receipts/one-time.pdf', method: 'GET' },
        {
          replayStore: capabilityUrlApi.createMemoryCapabilityReplayStore(),
        },
      ),
    ).resolves.toEqual({ ok: false, reason: 'replayed' });
  });

  it('refuses injected signing and verification clocks in production', async () => {
    await expect(
      capabilityUrlApi.signCapability(SECRET, { expiresIn: 60_000, key: 'receipts/clock.pdf' }, 1),
    ).rejects.toThrow(/KV436.*injected clock.*production/);

    const { token } = await capabilityUrlApi.signCapability(SECRET, {
      expiresIn: 60_000,
      key: 'receipts/clock.pdf',
    });
    await expect(
      capabilityUrlApi.verifyCapability(
        SECRET,
        token,
        { key: 'receipts/clock.pdf', method: 'GET' },
        { now: 1 },
      ),
    ).resolves.toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses endpoint and signer clock injection in production', () => {
    const replayStore = postgresRuntime.capabilityReplayStore;
    expect(() =>
      capabilityRouteApi.createStorageDownloadEndpoint({
        now: () => 0,
        replayStore,
        secret: SECRET,
        storage,
      }),
    ).toThrow(/KV436.*injected clock.*production/);
    expect(() =>
      capabilityRouteApi.createSignUrl({
        basePath: '/downloads',
        now: () => 0,
        secret: SECRET,
      }),
    ).toThrow(/KV436.*injected clock.*production/);
  });

  it('rejects an expired ordinary token without touching storage', async () => {
    process.env.NODE_ENV = 'test';
    let token: string;
    try {
      ({ token } = await capabilityUrlApi.signCapability(
        SECRET,
        { expiresIn: 1, key: 'receipts/expired.pdf' },
        1,
      ));
    } finally {
      process.env.NODE_ENV = 'production';
    }
    let reads = 0;
    const recordingStorage = {
      async get() {
        reads += 1;
        return undefined;
      },
      async stat() {
        reads += 1;
        return undefined;
      },
      async stream() {
        reads += 1;
        return undefined;
      },
    };
    const route = capabilityRouteApi.createStorageDownloadEndpoint({
      replayStore: postgresRuntime.capabilityReplayStore,
      secret: SECRET,
      storage: recordingStorage,
    });

    const response = await (route.handler as (request: Request) => Promise<Response>)(
      new Request(`https://example.test/_kovo/storage/receipts/expired.pdf?kovo-cap=${token}`),
    );

    expect(response.status).toBe(404);
    expect(reads).toBe(0);
  });
});
