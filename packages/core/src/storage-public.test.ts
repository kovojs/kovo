import { describe, expect, it } from 'vitest';

import { publicScopedKey } from './index.js';
import {
  createFileSystemStorage,
  createMemoryStorage,
  createS3CompatibleStorage,
  S3CompatibleObjectClient,
  type StorageBody,
  type StoragePutOptions,
  type StoragePutResult,
} from '@kovojs/core/storage';

type S3CompatibleObjectOperations = Parameters<typeof S3CompatibleObjectClient.create>[0];

interface StoredObject {
  body: Uint8Array;
  info: StoragePutResult;
}

describe('public S3-compatible adapter contract (SPEC §6.6/§10.3)', () => {
  it('publishes the three supported storage factories from the task entrypoint', () => {
    expect(createFileSystemStorage).toBeTypeOf('function');
    expect(createMemoryStorage).toBeTypeOf('function');
    expect(createS3CompatibleStorage).toBeTypeOf('function');
  });

  it('adapts provider-local operations without exposing raw S3 request records', async () => {
    const records = new Map<string, StoredObject>();
    const calls: string[] = [];
    const client = S3CompatibleObjectClient.create({
      async delete(bucket, key) {
        calls.push(`delete:${bucket}:${key}`);
        records.delete(key);
      },
      async get(bucket, key) {
        calls.push(`get:${bucket}:${key}`);
        const stored = records.get(key);
        return stored === undefined
          ? undefined
          : {
              ...stored.info,
              body: stored.body.slice(),
            };
      },
      async list(bucket, prefix) {
        calls.push(`list:${bucket}:${prefix}`);
        return {
          keys: [...records.keys()].filter((key) => key.startsWith(prefix)),
        };
      },
      async put(bucket, key, body, options) {
        calls.push(`put:${bucket}:${key}`);
        const bytes = snapshotTestBody(body);
        const info = storageInfo(key, bytes.byteLength, options);
        records.set(key, { body: bytes, info });
        return info;
      },
      async stat(bucket, key) {
        calls.push(`stat:${bucket}:${key}`);
        return records.get(key)?.info;
      },
    });
    const storage = createS3CompatibleStorage({
      bucket: 'app-assets',
      client,
      prefix: 'production',
    });
    const key = publicScopedKey('avatars/a.png');

    await expect(
      storage.put(key, 'avatar', {
        contentType: 'image/png',
        metadata: { source: 'profile' },
      }),
    ).resolves.toMatchObject({
      contentType: 'image/png',
      key: 'avatars/a.png',
      size: 6,
    });
    await expect(storage.get(key)).resolves.toMatchObject({
      contentType: 'image/png',
      key: 'avatars/a.png',
      size: 6,
    });
    await expect(storage.stat(key)).resolves.toMatchObject({
      key: 'avatars/a.png',
      size: 6,
    });
    await storage.delete(key);
    await expect(storage.get(key)).resolves.toBeUndefined();

    expect(calls.every((call) => call.includes('app-assets'))).toBe(true);
    expect(calls.some((call) => call.includes('production/'))).toBe(true);
    expect(Object.keys(client)).toEqual([]);
    expect(client).not.toHaveProperty('deleteObject');
    expect(client).not.toHaveProperty('getObject');
    expect(client).not.toHaveProperty('listObjects');
    expect(client).not.toHaveProperty('putObject');
    expect(client).not.toHaveProperty('headObject');

    const compileOnly = (): void => {
      // @ts-expect-error Raw provider-shaped requests are not part of the public client.
      void client.getObject;
      // @ts-expect-error Raw provider inspection records are not retained on the public client.
      void client.config;
    };
    expect(compileOnly).toBeTypeOf('function');
  });

  it('rejects accessors, inherited operations, prototype forgeries, and another module copy', async () => {
    let reads = 0;
    const accessorOperations = Object.defineProperty({}, 'delete', {
      get() {
        reads += 1;
        return async () => undefined;
      },
    });
    expect(() =>
      S3CompatibleObjectClient.create(accessorOperations as S3CompatibleObjectOperations),
    ).toThrow(/stable own method/u);
    expect(reads).toBe(0);

    expect(() =>
      S3CompatibleObjectClient.create(
        Object.create(completeOperations()) as S3CompatibleObjectOperations,
      ),
    ).toThrow(/stable own method/u);

    const forged = Object.create(S3CompatibleObjectClient.prototype);
    expect(() =>
      createS3CompatibleStorage({
        bucket: 'assets',
        client: forged as S3CompatibleObjectClient,
      }),
    ).toThrow(/this installed copy/u);

    const isolated = await import('./storage-public.js?isolated-public-s3-client');
    const foreignClient = isolated.S3CompatibleObjectClient.create(completeOperations());
    expect(() =>
      createS3CompatibleStorage({
        bucket: 'assets',
        client: foreignClient as unknown as S3CompatibleObjectClient,
      }),
    ).toThrow(/created by S3CompatibleObjectClient|this installed copy/u);
  });

  it('does not execute accessors in adapter result records', async () => {
    let reads = 0;
    const operations = completeOperations();
    operations.get = async () =>
      Object.defineProperty(
        {
          contentType: 'text/plain',
          key: 'physical',
          size: 1,
        },
        'body',
        {
          get() {
            reads += 1;
            return new Uint8Array([1]);
          },
        },
      ) as never;
    const storage = createS3CompatibleStorage({
      bucket: 'assets',
      client: S3CompatibleObjectClient.create(operations),
    });

    await expect(storage.get(publicScopedKey('a'))).rejects.toThrow(/body.*own data property/u);
    expect(reads).toBe(0);
  });
});

function completeOperations(): S3CompatibleObjectOperations {
  return {
    async delete() {},
    async get() {
      return undefined;
    },
    async list() {
      return { keys: [] };
    },
    async put(_bucket, key) {
      return { key };
    },
    async stat() {
      return undefined;
    },
  };
}

function snapshotTestBody(body: StorageBody): Uint8Array {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  }
  throw new TypeError('Test adapter expected Kovo to materialize stream bodies.');
}

function storageInfo(key: string, size: number, options?: StoragePutOptions): StoragePutResult {
  return {
    ...(options?.contentType === undefined ? {} : { contentType: options.contentType }),
    ...(options?.etag === undefined ? {} : { etag: options.etag }),
    key,
    ...(options?.metadata === undefined ? {} : { metadata: options.metadata }),
    size,
  };
}
