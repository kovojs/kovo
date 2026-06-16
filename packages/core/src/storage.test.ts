import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createFileSystemStorage,
  createMemoryStorage,
  createS3CompatibleStorage,
  normalizeStorageKey,
  storageBodyToBytes,
  type S3CompatibleGetObjectInput,
  type S3CompatibleGetObjectOutput,
  type S3CompatibleHeadObjectInput,
  type S3CompatibleObjectClient,
  type S3CompatibleObjectMetadata,
  type S3CompatiblePutObjectInput,
  type S3CompatiblePutObjectOutput,
  type StorageCapability,
} from './index.js';

interface StorageHarness {
  cleanup?: () => Promise<void>;
  storage: StorageCapability;
}

interface MockS3Object {
  body: Uint8Array;
  contentType?: string;
  etag: string;
  lastModified: Date;
  metadata?: Readonly<Record<string, string>>;
}

const textDecoder = new TextDecoder();

function storageConformance(name: string, createHarness: () => Promise<StorageHarness>) {
  describe(`${name} storage conformance`, () => {
    it('round-trips object bytes and metadata through put/get/stat/stream', async () => {
      const harness = await createHarness();
      try {
        const put = await harness.storage.put('receipts/order-1.txt', 'paid', {
          contentType: 'text/plain',
          metadata: { orderId: 'ord_1' },
        });

        expect(put).toMatchObject({
          contentType: 'text/plain',
          key: 'receipts/order-1.txt',
          metadata: { orderId: 'ord_1' },
          size: 4,
        });
        expect(put.etag).toMatch(/^".+"$/u);

        const stat = await harness.storage.stat('receipts/order-1.txt');
        expect(stat).toMatchObject({
          contentType: 'text/plain',
          etag: put.etag,
          key: 'receipts/order-1.txt',
          metadata: { orderId: 'ord_1' },
          size: 4,
        });

        const get = await harness.storage.get('receipts/order-1.txt');
        expect(get).toMatchObject({
          contentType: 'text/plain',
          etag: put.etag,
          key: 'receipts/order-1.txt',
          metadata: { orderId: 'ord_1' },
          size: 4,
        });
        expect(bytesToText(get?.body)).toBe('paid');

        const streamed = await harness.storage.stream('receipts/order-1.txt');
        expect(streamed).toMatchObject({
          contentType: 'text/plain',
          etag: put.etag,
          key: 'receipts/order-1.txt',
          metadata: { orderId: 'ord_1' },
          size: 4,
        });
        expect(bytesToText(await storageBodyToBytes(streamed?.body ?? ''))).toBe('paid');
      } finally {
        await harness.cleanup?.();
      }
    });

    it('returns undefined for missing objects', async () => {
      const harness = await createHarness();
      try {
        await expect(harness.storage.stat('missing.txt')).resolves.toBeUndefined();
        await expect(harness.storage.get('missing.txt')).resolves.toBeUndefined();
        await expect(harness.storage.stream('missing.txt')).resolves.toBeUndefined();
      } finally {
        await harness.cleanup?.();
      }
    });
  });
}

storageConformance('memory', async () => ({
  storage: createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') }),
}));

storageConformance('filesystem', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-'));
  return {
    cleanup: () => rm(root, { force: true, recursive: true }),
    storage: createFileSystemStorage({ root }),
  };
});

storageConformance('S3-compatible', async () => {
  const client = new MockS3Client();
  return {
    storage: createS3CompatibleStorage({
      bucket: 'kovo-test',
      client,
      prefix: 'uploads',
    }),
  };
});

describe('storage adapters', () => {
  it('passes caller-provided ETags through memory and filesystem storage', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-etag-'));
    try {
      const memory = createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') });
      const filesystem = createFileSystemStorage({ root });

      for (const storage of [memory, filesystem]) {
        const put = await storage.put('attachments/a.txt', 'a', { etag: '"caller-etag"' });
        const stat = await storage.stat('attachments/a.txt');
        const get = await storage.get('attachments/a.txt');
        const stream = await storage.stream('attachments/a.txt');

        expect(put.etag).toBe('"caller-etag"');
        expect(stat?.etag).toBe('"caller-etag"');
        expect(get?.etag).toBe('"caller-etag"');
        expect(stream?.etag).toBe('"caller-etag"');
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps filesystem keys inside the configured root', async () => {
    const storage = createFileSystemStorage({ root: os.tmpdir() });

    expect(() => normalizeStorageKey('../escape.txt')).toThrow(/parent path/u);
    await expect(storage.put('/absolute.txt', 'x')).rejects.toThrow(/relative/u);
  });

  it('maps storage operations onto an injected S3-compatible client without network access', async () => {
    const client = new MockS3Client();
    const storage = createS3CompatibleStorage({
      bucket: 'bucket-a',
      client,
      prefix: '/tenant-a/',
    });

    const put = await storage.put('docs/report.csv', 'id,total\n1,42\n', {
      contentType: 'text/csv',
      metadata: { report: 'orders' },
    });
    const get = await storage.get('docs/report.csv');

    expect(client.calls).toEqual([
      'put bucket-a/tenant-a/docs/report.csv',
      'get bucket-a/tenant-a/docs/report.csv',
    ]);
    expect(put.etag).toBe('"mock-14"');
    expect(get?.etag).toBe('"mock-14"');
    expect(get?.contentType).toBe('text/csv');
    expect(get?.metadata).toEqual({ report: 'orders' });
    expect(bytesToText(get?.body)).toBe('id,total\n1,42\n');
  });
});

class MockS3Client implements S3CompatibleObjectClient {
  readonly calls: string[] = [];
  private readonly objects = new Map<string, MockS3Object>();

  async getObject(
    input: S3CompatibleGetObjectInput,
  ): Promise<S3CompatibleGetObjectOutput | undefined> {
    this.calls.push(`get ${input.bucket}/${input.key}`);
    const object = this.objects.get(`${input.bucket}/${input.key}`);
    if (object === undefined) return undefined;

    return {
      body: bytesToReadableStream(object.body),
      ...mockS3Metadata(object),
    };
  }

  async headObject(
    input: S3CompatibleHeadObjectInput,
  ): Promise<S3CompatibleObjectMetadata | undefined> {
    this.calls.push(`head ${input.bucket}/${input.key}`);
    const object = this.objects.get(`${input.bucket}/${input.key}`);
    if (object === undefined) return undefined;

    return mockS3Metadata(object);
  }

  async putObject(input: S3CompatiblePutObjectInput): Promise<S3CompatiblePutObjectOutput> {
    this.calls.push(`put ${input.bucket}/${input.key}`);
    const body = await storageBodyToBytes(input.body);
    const object: MockS3Object = {
      body,
      etag: `"mock-${body.byteLength}"`,
      lastModified: new Date('2026-06-11T12:00:00.000Z'),
      ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
    this.objects.set(`${input.bucket}/${input.key}`, object);

    return mockS3Metadata(object);
  }
}

function bytesToText(bytes: Uint8Array | undefined): string {
  return bytes === undefined ? '' : textDecoder.decode(bytes);
}

function mockS3Metadata(object: MockS3Object): S3CompatibleObjectMetadata {
  return {
    contentLength: object.body.byteLength,
    etag: object.etag,
    lastModified: object.lastModified,
    ...(object.contentType === undefined ? {} : { contentType: object.contentType }),
    ...(object.metadata === undefined ? {} : { metadata: object.metadata }),
  };
}

function bytesToReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}
