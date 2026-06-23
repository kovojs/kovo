import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { type StorageCapability } from './index.js';
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
} from './internal/storage.js';

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
const textEncoder = new TextEncoder();

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
  // SPEC §12 (Testing API: the wire/behavior is asserted identically across backends) +
  // §13 (data-layer parity): the three adapters MUST agree on the etag a caller observes for
  // identical input. Bug L2 (plans/bug-and-testing-part3.md): the S3 adapter silently dropped a
  // caller-provided `etag`, returning the server etag while memory/FS returned the caller value —
  // so this loop now spans all three adapters (was [memory, filesystem] only at :126).
  it('passes caller-provided ETags identically across memory, filesystem, and S3 storage', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-etag-'));
    try {
      const memory = createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') });
      const filesystem = createFileSystemStorage({ root });
      const s3 = createS3CompatibleStorage({ bucket: 'kovo-test', client: new MockS3Client() });

      for (const storage of [memory, filesystem, s3]) {
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

  // SPEC §12/§13 cross-backend parity. Bug L1 (plans/bug-and-testing-part3.md): a user key whose
  // final segment ends with the FS metadata sidecar suffix (`.kovo-storage.json`) collided with
  // another object's sidecar on the filesystem backend (cross-object corruption + metadata
  // disclosure). The reserved-suffix rejection must hold UNIFORMLY across all three adapters so a
  // key that is illegal on one backend is illegal on every backend.
  describe('rejects keys ending in the reserved metadata-sidecar suffix (L1)', () => {
    const reservedKeys = [
      'x.kovo-storage.json',
      'photo.png.kovo-storage.json',
      'nested/dir/secret.kovo-storage.json',
      'X.KOVO-STORAGE.JSON', // case-insensitive
    ];

    async function adapters(): Promise<Array<{ name: string; storage: StorageCapability }>> {
      const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-reserved-'));
      return [
        {
          name: 'memory',
          storage: createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') }),
        },
        { name: 'filesystem', storage: createFileSystemStorage({ root }) },
        {
          name: 'S3',
          storage: createS3CompatibleStorage({ bucket: 'kovo-test', client: new MockS3Client() }),
        },
      ];
    }

    it('throws identically on put/get/stat/stream for every adapter', async () => {
      for (const { name, storage } of await adapters()) {
        for (const key of reservedKeys) {
          await expect(storage.put(key, 'HACK'), `${name} put(${key})`).rejects.toThrow(
            /reserved/u,
          );
          await expect(storage.get(key), `${name} get(${key})`).rejects.toThrow(/reserved/u);
          await expect(storage.stat(key), `${name} stat(${key})`).rejects.toThrow(/reserved/u);
          await expect(storage.stream(key), `${name} stream(${key})`).rejects.toThrow(/reserved/u);
        }
      }
    });

    it('a normalizeStorageKey caller sees the reserved-suffix error', () => {
      expect(() => normalizeStorageKey('a.kovo-storage.json')).toThrow(/reserved/u);
      // a non-final segment carrying the suffix is fine — only the final segment is reserved.
      expect(() => normalizeStorageKey('a.kovo-storage.json/photo.png')).not.toThrow();
      // the bare blob name is fine.
      expect(() => normalizeStorageKey('photo.png')).not.toThrow();
    });

    it('cannot overwrite another object’s metadata sidecar on the filesystem backend', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-poc-'));
      try {
        const storage = createFileSystemStorage({ root });
        const put = await storage.put('photo.png', 'IMG', { contentType: 'image/png' });

        // The attack: a key landing on photo.png's sidecar must be rejected, not written.
        await expect(storage.put('photo.png.kovo-storage.json', 'HACK')).rejects.toThrow(
          /reserved/u,
        );

        const get = await storage.get('photo.png');
        expect(bytesToText(get?.body)).toBe('IMG');
        expect(get?.contentType).toBe('image/png');
        expect(get?.etag).toBe(put.etag);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    });
  });

  it('keeps filesystem keys inside the configured root', async () => {
    const storage = createFileSystemStorage({ root: os.tmpdir() });

    expect(() => normalizeStorageKey('../escape.txt')).toThrow(/parent path/u);
    await expect(storage.put('/absolute.txt', 'x')).rejects.toThrow(/relative/u);
  });

  it('falls back to filesystem metadata when a sidecar is malformed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-sidecar-'));
    try {
      const storage = createFileSystemStorage({ root });
      await storage.put('docs/report.txt', 'report', {
        contentType: 'text/plain',
        metadata: { kind: 'report' },
      });
      await writeFile(path.join(root, 'docs/report.txt.kovo-storage.json'), '{not-json', 'utf8');

      const stat = await storage.stat('docs/report.txt');
      const get = await storage.get('docs/report.txt');

      expect(stat).toMatchObject({ key: 'docs/report.txt', size: 6 });
      expect(stat?.contentType).toBeUndefined();
      expect(stat?.metadata).toBeUndefined();
      expect(bytesToText(get?.body)).toBe('report');
      expect(get?.size).toBe(6);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('maps storage operations onto an injected S3-compatible client without network access', async () => {
    const client = new MockS3Client();
    const storage = createS3CompatibleStorage({
      bucket: 'bucket-a',
      client,
      prefix: '/tenant-a/',
    });

    const put = await storage.put('docs/report.bin', 'binary report', {
      contentType: 'application/octet-stream',
      metadata: { report: 'binary' },
    });
    const get = await storage.get('docs/report.bin');

    expect(client.calls).toEqual([
      'put bucket-a/tenant-a/docs/report.bin',
      'get bucket-a/tenant-a/docs/report.bin',
    ]);
    expect(put.etag).toBe('"mock-13"');
    expect(get?.etag).toBe('"mock-13"');
    expect(get?.contentType).toBe('application/octet-stream');
    expect(get?.metadata).toEqual({ report: 'binary' });
    expect(bytesToText(get?.body)).toBe('binary report');
  });

  // SPEC §12/§13 cross-backend parity. Bug L2-storage-3 (plans/bug-and-testing-part3.md): when an
  // S3-compatible client omits `contentLength`, `stat()`/`stream()` fabricated `size: 0` for a
  // non-empty object while memory/FS report the true byte length. The adapter must NOT fabricate a
  // bogus `0`; when the content length is genuinely unknown, `size` is left `undefined` rather than
  // misreporting the object as empty.
  it('does not fabricate size:0 when an S3 client omits contentLength', async () => {
    const client = new ContentLengthBlindS3Client();
    const storage = createS3CompatibleStorage({ bucket: 'bucket-a', client });

    await storage.put('docs/report.bin', 'binary report');

    const stat = await storage.stat('docs/report.bin');
    const stream = await storage.stream('docs/report.bin');

    expect(stat?.size).toBeUndefined();
    expect(stream?.size).toBeUndefined();

    // get() materializes the body, so the true size IS known there and must be reported.
    const get = await storage.get('docs/report.bin');
    expect(get?.size).toBe(textEncoder.encode('binary report').byteLength);
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
      // A conforming client persists + echoes a caller-supplied etag (Part 3 bug L2); otherwise the
      // server assigns one. Real S3/R2/MinIO stash a caller etag as object user-metadata.
      etag: input.etag ?? `"mock-${body.byteLength}"`,
      lastModified: new Date('2026-06-11T12:00:00.000Z'),
      ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
    this.objects.set(`${input.bucket}/${input.key}`, object);

    return mockS3Metadata(object);
  }
}

/**
 * A conforming-but-content-length-blind S3 client: it stores objects and returns metadata, but
 * deliberately omits `contentLength` from head/get/put outputs (some real S3-compatible clients do
 * not surface it on every code path). Used to prove the adapter never fabricates `size: 0` (L2-storage-3).
 */
class ContentLengthBlindS3Client implements S3CompatibleObjectClient {
  private readonly objects = new Map<string, MockS3Object>();

  async getObject(
    input: S3CompatibleGetObjectInput,
  ): Promise<S3CompatibleGetObjectOutput | undefined> {
    const object = this.objects.get(`${input.bucket}/${input.key}`);
    if (object === undefined) return undefined;
    return { body: bytesToReadableStream(object.body), ...blindMetadata(object) };
  }

  async headObject(
    input: S3CompatibleHeadObjectInput,
  ): Promise<S3CompatibleObjectMetadata | undefined> {
    const object = this.objects.get(`${input.bucket}/${input.key}`);
    return object === undefined ? undefined : blindMetadata(object);
  }

  async putObject(input: S3CompatiblePutObjectInput): Promise<S3CompatiblePutObjectOutput> {
    const body = await storageBodyToBytes(input.body);
    const object: MockS3Object = {
      body,
      etag: input.etag ?? `"mock-${body.byteLength}"`,
      lastModified: new Date('2026-06-11T12:00:00.000Z'),
      ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
    this.objects.set(`${input.bucket}/${input.key}`, object);
    return blindMetadata(object);
  }
}

function bytesToText(bytes: Uint8Array | undefined): string {
  return bytes === undefined ? '' : textDecoder.decode(bytes);
}

function blindMetadata(object: MockS3Object): S3CompatibleObjectMetadata {
  // Intentionally NO contentLength.
  return {
    etag: object.etag,
    lastModified: object.lastModified,
    ...(object.contentType === undefined ? {} : { contentType: object.contentType }),
    ...(object.metadata === undefined ? {} : { metadata: object.metadata }),
  };
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
