import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createFileSystemStorage as createFileSystemStorageCapability,
  createMemoryStorage as createMemoryStorageCapability,
  createS3CompatibleStorage as createS3CompatibleStorageCapability,
  publicScopedKey,
  type S3CompatibleDeleteObjectInput,
  type S3CompatibleGetObjectInput,
  type S3CompatibleGetObjectOutput,
  type S3CompatibleHeadObjectInput,
  type S3CompatibleObjectClient,
  type S3CompatibleObjectMetadata,
  type S3CompatiblePutObjectInput,
  type S3CompatiblePutObjectOutput,
  type StorageCapability,
  type ScopedKey,
  type StorageReadCapability,
} from './index.js';
import {
  createReadOnlyStorageCapability,
  principalScopedKey,
  normalizeStorageKey,
  scopedKeyFactsFor,
  storageBodyToBytes,
} from './internal/storage.js';

interface StorageHarness {
  cleanup?: () => Promise<void>;
  storage: TestStorageCapability;
}

type TestStorageCapability = Omit<
  StorageCapability,
  'delete' | 'get' | 'put' | 'stat' | 'stream'
> & {
  delete(key: ScopedKey | string): Promise<void>;
  get(key: ScopedKey | string): ReturnType<StorageCapability['get']>;
  put(
    key: ScopedKey | string,
    body: Parameters<StorageCapability['put']>[1],
    options?: Parameters<StorageCapability['put']>[2],
  ): ReturnType<StorageCapability['put']>;
  stat(key: ScopedKey | string): ReturnType<StorageCapability['stat']>;
  stream(key: ScopedKey | string): ReturnType<StorageCapability['stream']>;
};

function testKey(key: ScopedKey | string): ScopedKey {
  return typeof key === 'string' ? publicScopedKey(key) : key;
}

function testStorage(storage: StorageCapability): TestStorageCapability {
  return {
    delete: (key) => storage.delete(testKey(key)),
    get: (key) => storage.get(testKey(key)),
    put: (key, body, options) => storage.put(testKey(key), body, options),
    stat: (key) => storage.stat(testKey(key)),
    stream: (key) => storage.stream(testKey(key)),
  };
}

function createMemoryStorage(
  ...args: Parameters<typeof createMemoryStorageCapability>
): TestStorageCapability {
  return testStorage(createMemoryStorageCapability(...args));
}

function createFileSystemStorage(
  ...args: Parameters<typeof createFileSystemStorageCapability>
): TestStorageCapability {
  return testStorage(createFileSystemStorageCapability(...args));
}

function createS3CompatibleStorage(
  ...args: Parameters<typeof createS3CompatibleStorageCapability>
): TestStorageCapability {
  return testStorage(createS3CompatibleStorageCapability(...args));
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
const fileSystemSidecarSuffix = '.kovo-storage.json';

function fileSystemPhysicalStorageKey(key: string): string {
  const frame = testKeyFrame(key);
  const digest = createHash('sha256').update(textEncoder.encode(frame)).digest('hex');
  return path.join('kovo-storage-v1', digest.slice(0, 2), digest.slice(2));
}

function s3PhysicalStorageKey(key: string): string {
  const digest = createHash('sha256')
    .update(textEncoder.encode(testKeyFrame(key)))
    .digest('hex');
  return `kovo-storage-v1/${digest}`;
}

function testKeyFrame(key: string): string {
  return scopedKeyFactsFor(publicScopedKey(key)).frame;
}

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
        await expect(harness.storage.delete('missing.txt')).resolves.toBeUndefined();
      } finally {
        await harness.cleanup?.();
      }
    });

    // Train A / SPEC §6.6 C9: the storage key is currently the whole physical namespace.
    // Two authenticated principals choosing the same app key therefore address one object. This
    // red test stays at the adapter door so memory, filesystem, and S3 cannot hide behind a
    // request-layer convention.
    it('keeps one app key isolated across principal owners', async () => {
      const harness = await createHarness();
      try {
        const appKey = 'avatars/current.png';
        const victimKey = principalScopedKey('victim', appKey);
        const attackerKey = principalScopedKey('attacker', appKey);

        await harness.storage.put(victimKey, 'victim bytes');
        await harness.storage.put(attackerKey, 'attacker bytes');

        expect(bytesToText((await harness.storage.get(victimKey))?.body)).toBe('victim bytes');
        expect(bytesToText((await harness.storage.get(attackerKey))?.body)).toBe('attacker bytes');
      } finally {
        await harness.cleanup?.();
      }
    });

    it('deletes stored objects and metadata by key', async () => {
      const harness = await createHarness();
      try {
        await harness.storage.put('receipts/delete-me.txt', 'remove me', {
          contentType: 'text/plain',
          metadata: { lifecycle: 'delete' },
        });
        await expect(harness.storage.get('receipts/delete-me.txt')).resolves.toBeDefined();

        await harness.storage.delete('receipts/delete-me.txt');

        await expect(harness.storage.stat('receipts/delete-me.txt')).resolves.toBeUndefined();
        await expect(harness.storage.get('receipts/delete-me.txt')).resolves.toBeUndefined();
        await expect(harness.storage.stream('receipts/delete-me.txt')).resolves.toBeUndefined();
      } finally {
        await harness.cleanup?.();
      }
    });
  });
}

storageConformance('memory', async () => ({
  storage: createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') }),
}));

describe('storage byte snapshots', () => {
  it('does not replace validated typed-array bytes through late ArrayBuffer.slice', async () => {
    const safe = textEncoder.encode('validated-safe-bytes');
    const attacker = textEncoder.encode('attacker-substitution');
    const safeBuffer = safe.buffer as ArrayBuffer;
    const originalSlice = ArrayBuffer.prototype.slice;
    let poisonHits = 0;
    let bytes: Uint8Array | undefined;

    try {
      ArrayBuffer.prototype.slice = function replaceValidatedBytes(start, end) {
        if (this === safeBuffer) {
          poisonHits += 1;
          return Reflect.apply(originalSlice, attacker.buffer, [
            attacker.byteOffset,
            attacker.byteOffset + attacker.byteLength,
          ]);
        }
        return Reflect.apply(originalSlice, this, [start, end]);
      };
      bytes = await storageBodyToBytes(safe);
    } finally {
      ArrayBuffer.prototype.slice = originalSlice;
    }

    expect(bytesToText(bytes)).toBe('validated-safe-bytes');
    expect(poisonHits).toBe(0);
  });

  it('pins raw-buffer and offset-view location and copy controls before app evaluation', async () => {
    const payload = textEncoder.encode('validated-safe-bytes');
    const padded = new Uint8Array(payload.byteLength + 4);
    padded.set(payload, 2);
    const offsetView = new Uint8Array(padded.buffer, 2, payload.byteLength);
    const rawBuffer = payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength,
    );
    const attacker = textEncoder.encode('attacker-substitution');
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const typedBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!;
    const typedByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!;
    const typedByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!;
    const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
      ArrayBuffer.prototype,
      'byteLength',
    )!;
    const originalIsView = ArrayBuffer.isView;
    const originalSlice = ArrayBuffer.prototype.slice;
    const originalSet = Uint8Array.prototype.set;
    let poisonHits = 0;
    let copiedView: Uint8Array | undefined;
    let copiedBuffer: Uint8Array | undefined;

    try {
      ArrayBuffer.isView = (() => {
        poisonHits += 1;
        return false;
      }) as unknown as typeof ArrayBuffer.isView;
      ArrayBuffer.prototype.slice = function substituteSlice() {
        poisonHits += 1;
        return attacker.buffer;
      };
      Object.defineProperty(typedArrayPrototype, 'buffer', {
        ...typedBuffer,
        get() {
          poisonHits += 1;
          return attacker.buffer;
        },
      });
      Object.defineProperty(typedArrayPrototype, 'byteLength', {
        ...typedByteLength,
        get() {
          poisonHits += 1;
          return attacker.byteLength;
        },
      });
      Object.defineProperty(typedArrayPrototype, 'byteOffset', {
        ...typedByteOffset,
        get() {
          poisonHits += 1;
          return 0;
        },
      });
      Object.defineProperty(ArrayBuffer.prototype, 'byteLength', {
        ...arrayBufferByteLength,
        get() {
          poisonHits += 1;
          return attacker.byteLength;
        },
      });
      Uint8Array.prototype.set = function substituteSet() {
        poisonHits += 1;
        Reflect.apply(originalSet, this, [attacker, 0]);
      };

      copiedView = await storageBodyToBytes(offsetView);
      copiedBuffer = await storageBodyToBytes(rawBuffer);
    } finally {
      ArrayBuffer.isView = originalIsView;
      ArrayBuffer.prototype.slice = originalSlice;
      Object.defineProperty(typedArrayPrototype, 'buffer', typedBuffer);
      Object.defineProperty(typedArrayPrototype, 'byteLength', typedByteLength);
      Object.defineProperty(typedArrayPrototype, 'byteOffset', typedByteOffset);
      Object.defineProperty(ArrayBuffer.prototype, 'byteLength', arrayBufferByteLength);
      Uint8Array.prototype.set = originalSet;
    }

    expect(bytesToText(copiedView)).toBe('validated-safe-bytes');
    expect(bytesToText(copiedBuffer)).toBe('validated-safe-bytes');
    expect(poisonHits).toBe(0);
  });

  it('pins stream acquisition, chunk reads, snapshots, and assembly controls', async () => {
    const first = textEncoder.encode('validated-');
    const second = textEncoder.encode('safe-bytes');
    const attacker = textEncoder.encode('attacker-substitution');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      },
    });
    const originalGetReader = ReadableStream.prototype.getReader;
    const originalRead = ReadableStreamDefaultReader.prototype.read;
    const originalReleaseLock = ReadableStreamDefaultReader.prototype.releaseLock;
    const originalSet = Uint8Array.prototype.set;
    let poisonHits = 0;
    let bytes: Uint8Array | undefined;

    try {
      ReadableStream.prototype.getReader = function substituteReader() {
        poisonHits += 1;
        throw new Error('late getReader reached');
      } as typeof ReadableStream.prototype.getReader;
      ReadableStreamDefaultReader.prototype.read = async function substituteRead() {
        poisonHits += 1;
        return { done: false, value: attacker };
      };
      ReadableStreamDefaultReader.prototype.releaseLock = function substituteRelease() {
        poisonHits += 1;
      };
      Uint8Array.prototype.set = function substituteSet() {
        poisonHits += 1;
        Reflect.apply(originalSet, this, [attacker, 0]);
      };

      bytes = await storageBodyToBytes(stream);
    } finally {
      ReadableStream.prototype.getReader = originalGetReader;
      ReadableStreamDefaultReader.prototype.read = originalRead;
      ReadableStreamDefaultReader.prototype.releaseLock = originalReleaseLock;
      Uint8Array.prototype.set = originalSet;
    }

    expect(bytesToText(bytes)).toBe('validated-safe-bytes');
    expect(poisonHits).toBe(0);
  });

  it('pins returned byte copies and stream construction controls', async () => {
    const storage = createMemoryStorage();
    await storage.put('receipts/safe.txt', 'validated-safe-bytes');
    const uint8ArrayDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Uint8Array')!;
    const readableStreamDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ReadableStream')!;
    const originalEnqueue = ReadableStreamDefaultController.prototype.enqueue;
    const originalClose = ReadableStreamDefaultController.prototype.close;
    let poisonHits = 0;
    let copied: Uint8Array | undefined;
    let streamed: ReadableStream<Uint8Array> | undefined;

    try {
      Object.defineProperty(globalThis, 'Uint8Array', {
        ...uint8ArrayDescriptor,
        value: function substituteUint8Array() {
          poisonHits += 1;
          throw new Error('late Uint8Array constructor reached');
        },
      });
      Object.defineProperty(globalThis, 'ReadableStream', {
        ...readableStreamDescriptor,
        value: function substituteReadableStream() {
          poisonHits += 1;
          throw new Error('late ReadableStream constructor reached');
        },
      });
      ReadableStreamDefaultController.prototype.enqueue = function substituteEnqueue() {
        poisonHits += 1;
      };
      ReadableStreamDefaultController.prototype.close = function substituteClose() {
        poisonHits += 1;
      };

      copied = (await storage.get('receipts/safe.txt'))?.body;
      streamed = (await storage.stream('receipts/safe.txt'))?.body;
    } finally {
      Object.defineProperty(globalThis, 'Uint8Array', uint8ArrayDescriptor);
      Object.defineProperty(globalThis, 'ReadableStream', readableStreamDescriptor);
      ReadableStreamDefaultController.prototype.enqueue = originalEnqueue;
      ReadableStreamDefaultController.prototype.close = originalClose;
    }

    expect(bytesToText(copied)).toBe('validated-safe-bytes');
    expect(bytesToText(await storageBodyToBytes(streamed!))).toBe('validated-safe-bytes');
    expect(poisonHits).toBe(0);
  });
});

describe('storage constructor and metadata authority', () => {
  it('does not inherit filesystem root authority from Object.prototype', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-inherited-root-'));
    Object.defineProperty(Object.prototype, 'root', { configurable: true, value: root });
    try {
      expect(() => createFileSystemStorage({} as { root: string })).toThrow(
        'root must be an own string data property',
      );
    } finally {
      delete (Object.prototype as { root?: unknown }).root;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not inherit per-put content metadata from Object.prototype', async () => {
    const storage = createMemoryStorage();
    Object.defineProperty(Object.prototype, 'contentType', {
      configurable: true,
      value: 'text/html',
    });
    try {
      await storage.put('safe.txt', '<script>not html</script>');
    } finally {
      delete (Object.prototype as { contentType?: unknown }).contentType;
    }
    await expect(storage.stat('safe.txt')).resolves.not.toHaveProperty('contentType');
  });

  it('does not synthesize metadata from late prototype pollution during memory reads', async () => {
    const storage = createMemoryStorage();
    await storage.put('safe.txt', 'plain text');
    Object.defineProperty(Object.prototype, 'contentType', {
      configurable: true,
      value: 'text/html',
    });
    try {
      await expect(storage.stat('safe.txt')).resolves.not.toHaveProperty('contentType');
      await expect(storage.get('safe.txt')).resolves.not.toHaveProperty('contentType');
      await expect(storage.stream('safe.txt')).resolves.not.toHaveProperty('contentType');
    } finally {
      delete (Object.prototype as { contentType?: unknown }).contentType;
    }
  });

  it('does not inherit active content metadata while reading a filesystem sidecar', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-sidecar-prototype-'));
    try {
      const storage = createFileSystemStorage({ root });
      await storage.put('safe.txt', '<script>not html</script>');
      Object.defineProperty(Object.prototype, 'contentType', {
        configurable: true,
        value: 'text/html',
      });
      try {
        await expect(storage.stat('safe.txt')).resolves.not.toHaveProperty('contentType');
      } finally {
        delete (Object.prototype as { contentType?: unknown }).contentType;
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not trust inherited metadata from S3-compatible client outputs', async () => {
    const client: S3CompatibleObjectClient = {
      async deleteObject() {},
      async getObject() {
        return { body: 'plain text' };
      },
      async headObject() {
        return {};
      },
      async putObject() {
        return {};
      },
    };
    const storage = createS3CompatibleStorage({ bucket: 'safe', client });
    await storage.put('safe.txt', 'plain text');
    Object.defineProperty(Object.prototype, 'contentType', {
      configurable: true,
      value: 'text/html',
    });
    try {
      await expect(storage.stat('safe.txt')).resolves.not.toHaveProperty('contentType');
      await expect(storage.get('safe.txt')).resolves.not.toHaveProperty('contentType');
      await expect(storage.stream('safe.txt')).resolves.not.toHaveProperty('contentType');
    } finally {
      delete (Object.prototype as { contentType?: unknown }).contentType;
    }
  });

  it('pins Date and etag scalar controls against late global and prototype replacement', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-date-intrinsics-'));
    const NativeDate = globalThis.Date;
    const originalGetTime = NativeDate.prototype.getTime;
    const originalToISOString = NativeDate.prototype.toISOString;
    const originalEncodeURIComponent = globalThis.encodeURIComponent;
    const fixed = new NativeDate('2026-06-11T12:00:00.000Z');
    try {
      const storage = createFileSystemStorage({ root });
      globalThis.Date = function PoisonedDate() {
        return new NativeDate(0);
      } as unknown as DateConstructor;
      NativeDate.prototype.getTime = () => 0;
      NativeDate.prototype.toISOString = () => 'forged-date';
      globalThis.encodeURIComponent = () => 'forged-key';

      const memory = createMemoryStorage({ now: () => fixed });
      const put = await memory.put('safe key.txt', 'plain text');
      await storage.put('safe.txt', 'plain text', { etag: '"fixed"' });

      expect(put.etag).toBe(`"kovo-safe%20key.txt-10-${fixed.valueOf()}"`);
    } finally {
      globalThis.Date = NativeDate;
      NativeDate.prototype.getTime = originalGetTime;
      NativeDate.prototype.toISOString = originalToISOString;
      globalThis.encodeURIComponent = originalEncodeURIComponent;
    }
    try {
      const sidecar = JSON.parse(
        await readFile(
          path.join(root, `${fileSystemPhysicalStorageKey('safe.txt')}${fileSystemSidecarSuffix}`),
          'utf8',
        ),
      ) as { lastModified?: unknown };
      expect(sidecar.lastModified).not.toBe('forged-date');
      expect(new NativeDate(sidecar.lastModified as string).valueOf()).not.toBe(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects invalid filesystem dates despite late Date and Number predicate poisoning', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-date-validation-'));
    const originalDateParse = Date.parse;
    const originalNumberIsFinite = Number.isFinite;
    try {
      const storage = createFileSystemStorage({ root });
      const key = 'safe.txt';
      await storage.put(key, 'plain text');
      await writeFile(
        path.join(root, `${fileSystemPhysicalStorageKey(key)}${fileSystemSidecarSuffix}`),
        JSON.stringify({ lastModified: 'not-a-date', scopedKeyFrame: testKeyFrame(key) }),
        'utf8',
      );
      Date.parse = () => 0;
      Number.isFinite = () => true;

      await expect(storage.stat(key)).resolves.toBeUndefined();
    } finally {
      Date.parse = originalDateParse;
      Number.isFinite = originalNumberIsFinite;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects S3 metadata coercion objects and invalid sizes without invoking attacker code', async () => {
    let coercions = 0;
    const hostileDate = {
      valueOf() {
        coercions += 1;
        return Date.now();
      },
    };
    const client: S3CompatibleObjectClient = {
      async deleteObject() {},
      async getObject() {
        return { body: 'plain text', lastModified: hostileDate as Date };
      },
      async headObject() {
        return { contentLength: Number.NaN, lastModified: hostileDate as Date };
      },
      async putObject() {
        return {};
      },
    };
    const storage = createS3CompatibleStorage({ bucket: 'safe', client });
    const originalNumberIsSafeInteger = Number.isSafeInteger;
    try {
      Number.isSafeInteger = () => true;
      await expect(storage.stat('safe.txt')).rejects.toThrow(/contentLength/u);
      await expect(storage.get('safe.txt')).rejects.toThrow(/lastModified/u);
    } finally {
      Number.isSafeInteger = originalNumberIsSafeInteger;
    }
    expect(coercions).toBe(0);
  });
});

describe('storage read/write authority split', () => {
  it('keeps read-only storage views fail-closed even when cast back to a write shape', async () => {
    const storage = createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') });
    await storage.put('receipts/order-1.txt', 'paid');

    const readOnly: StorageReadCapability = createReadOnlyStorageCapability(storage);
    await expect(readOnly.get(publicScopedKey('receipts/order-1.txt'))).resolves.toMatchObject({
      key: 'receipts/order-1.txt',
    });

    // @ts-expect-error Read-only storage views do not expose upload/write authority.
    void readOnly.put;
    // @ts-expect-error Read-only storage views do not expose delete authority.
    void readOnly.delete;

    const forged = readOnly as unknown as StorageCapability;
    await expect(forged.put(publicScopedKey('receipts/evil.txt'), 'evil')).rejects.toThrow(
      /KV433/u,
    );
    await expect(forged.delete(publicScopedKey('receipts/order-1.txt'))).rejects.toThrow(/KV433/u);
    await expect(
      (readOnly as unknown as Record<'store', (key: string, body: string) => Promise<unknown>>)[
        'store'
      ]('receipts/evil.txt', 'evil'),
    ).rejects.toThrow(/KV433/u);
    await expect(
      (readOnly as unknown as Record<'upload', (key: string, body: string) => Promise<unknown>>)[
        'upload'
      ]('receipts/evil.txt', 'evil'),
    ).rejects.toThrow(/KV433/u);
  });

  it('constructs read-only views without mutable function binding authority', async () => {
    const storage = createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') });
    await storage.put('receipts/order-1.txt', 'paid');
    const nativeBind = Function.prototype.bind;
    let bindHits = 0;
    let readOnly: StorageReadCapability;

    try {
      Function.prototype.bind = function turnReadIntoWrite(thisArg, ...args) {
        if (this.name === 'get' && thisArg === storage) {
          bindHits += 1;
          return async (key: ScopedKey) => {
            await storage.put('receipts/evil.txt', 'evil');
            return Reflect.apply(storage.get, storage, [key]);
          };
        }
        return Reflect.apply(nativeBind, this, [thisArg, ...args]);
      };
      readOnly = createReadOnlyStorageCapability(storage);
    } finally {
      Function.prototype.bind = nativeBind;
    }

    await expect(readOnly!.get(publicScopedKey('receipts/order-1.txt'))).resolves.toMatchObject({
      key: 'receipts/order-1.txt',
    });
    await expect(storage.stat('receipts/evil.txt')).resolves.toBeUndefined();
    expect(bindHits).toBe(0);
  });
});

storageConformance('filesystem', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-'));
  return {
    cleanup: () => rm(root, { force: true, recursive: true }),
    storage: createFileSystemStorage({ root }),
  };
});

describe('filesystem storage delete confinement (SPEC §10.6)', () => {
  it('rejects a symlinked parent without deleting an external blob or metadata sidecar', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-delete-root-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-delete-outside-'));
    try {
      const logicalKey = 'objects/linked-outside/victim.txt';
      const physicalKey = fileSystemPhysicalStorageKey(logicalKey);
      const physicalParent = path.dirname(physicalKey);
      const physicalName = path.basename(physicalKey);
      await mkdir(path.join(root, path.dirname(physicalParent)), { recursive: true });
      await symlink(outside, path.join(root, physicalParent), 'dir');
      await writeFile(path.join(outside, physicalName), 'external blob', 'utf8');
      await writeFile(
        path.join(outside, `${physicalName}${fileSystemSidecarSuffix}`),
        'external sidecar',
        'utf8',
      );

      const storage = createFileSystemStorage({ root });
      // Exact-key verification cannot read a valid owned sidecar through the symlink, so delete
      // retires as a no-op before it ever reaches the destructive filesystem sink.
      await expect(storage.delete(logicalKey)).resolves.toBeUndefined();

      await expect(readFile(path.join(outside, physicalName), 'utf8')).resolves.toBe(
        'external blob',
      );
      await expect(
        readFile(path.join(outside, `${physicalName}${fileSystemSidecarSuffix}`), 'utf8'),
      ).resolves.toBe('external sidecar');
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('rejects a renamed-and-replaced storage root without deleting the external blob or sidecar', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-delete-root-swap-'));
    const root = path.join(base, 'root');
    const parkedRoot = path.join(base, 'root-parked');
    const outside = path.join(base, 'outside');
    try {
      await mkdir(root);
      await mkdir(outside);
      const storage = createFileSystemStorage({ root });
      const logicalKey = 'victim.txt';
      const physicalKey = fileSystemPhysicalStorageKey(logicalKey);
      await mkdir(path.join(outside, path.dirname(physicalKey)), { recursive: true });
      await writeFile(path.join(outside, physicalKey), 'external blob', 'utf8');
      await writeFile(
        path.join(outside, `${physicalKey}${fileSystemSidecarSuffix}`),
        'external sidecar',
        'utf8',
      );

      await rename(root, parkedRoot);
      await symlink(outside, root, 'dir');

      await expect(storage.delete(logicalKey)).rejects.toThrow(/root identity changed/u);
      await expect(readFile(path.join(outside, physicalKey), 'utf8')).resolves.toBe(
        'external blob',
      );
      await expect(
        readFile(path.join(outside, `${physicalKey}${fileSystemSidecarSuffix}`), 'utf8'),
      ).resolves.toBe('external sidecar');
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });
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

    async function adapters(): Promise<Array<{ name: string; storage: TestStorageCapability }>> {
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

  it('keeps traversal normalization closed after late String/Array prototype poisoning', () => {
    const originalStartsWith = String.prototype.startsWith;
    const originalSome = Array.prototype.some;
    let outcome: unknown;
    try {
      String.prototype.startsWith = function (search, position) {
        if (this.valueOf() === '../escape.txt' && search === '/') return false;
        return originalStartsWith.call(this, search, position);
      };
      Array.prototype.some = function (callback, thisArg) {
        if (this.length === 2 && this[0] === '..' && this[1] === 'escape.txt') return false;
        return originalSome.call(this, callback, thisArg);
      };
      try {
        outcome = normalizeStorageKey('../escape.txt');
      } catch (error) {
        outcome = error;
      }
    } finally {
      String.prototype.startsWith = originalStartsWith;
      Array.prototype.some = originalSome;
    }

    expect(outcome).toBeInstanceOf(Error);
  });

  it('keeps memory object identity exact after late Map.get poisoning', async () => {
    const storage = createMemoryStorage();
    await storage.put('tenant/victim.txt', 'VICTIM');
    const originalGet = Map.prototype.get;
    let attackerRead: Awaited<ReturnType<typeof storage.get>>;
    try {
      Map.prototype.get = function (key) {
        if (key === 'tenant/attacker.txt') return originalGet.call(this, 'tenant/victim.txt');
        return originalGet.call(this, key);
      };
      attackerRead = await storage.get('tenant/attacker.txt');
    } finally {
      Map.prototype.get = originalGet;
    }

    expect(attackerRead).toBeUndefined();
    await expect(storage.get('tenant/victim.txt')).resolves.toMatchObject({
      key: 'tenant/victim.txt',
    });
  });

  it('fails closed instead of serving a blob when its exact-key sidecar is malformed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-sidecar-'));
    try {
      const storage = createFileSystemStorage({ root });
      const key = 'docs/report.txt';
      await storage.put(key, 'report', {
        contentType: 'text/plain',
        metadata: { kind: 'report' },
      });
      const physicalKey = fileSystemPhysicalStorageKey(key);
      await writeFile(
        path.join(root, `${physicalKey}${fileSystemSidecarSuffix}`),
        '{not-json',
        'utf8',
      );

      await expect(storage.stat(key)).resolves.toBeUndefined();
      await expect(storage.get(key)).resolves.toBeUndefined();
      await expect(storage.stream(key)).resolves.toBeUndefined();
      await expect(storage.put(key, 'replacement')).rejects.toThrow(/ownership mismatch/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects a sidecar generation that could retarget another in-root path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-generation-path-'));
    try {
      const storage = createFileSystemStorage({ root });
      const key = 'docs/report.txt';
      await storage.put(key, 'report', { contentType: 'text/plain' });
      const sidecarPath = path.join(
        root,
        `${fileSystemPhysicalStorageKey(key)}${fileSystemSidecarSuffix}`,
      );
      const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8')) as Record<string, unknown>;
      sidecar.generation = '../../other-object';
      await writeFile(sidecarPath, JSON.stringify(sidecar), 'utf8');

      await expect(storage.stat(key)).resolves.toBeUndefined();
      await expect(storage.get(key)).resolves.toBeUndefined();
      await expect(storage.stream(key)).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects a generation whose published size does not match its immutable body', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-generation-size-'));
    try {
      const storage = createFileSystemStorage({ root });
      const key = 'docs/report.txt';
      await storage.put(key, 'report', { contentType: 'text/plain' });
      const sidecarPath = path.join(
        root,
        `${fileSystemPhysicalStorageKey(key)}${fileSystemSidecarSuffix}`,
      );
      const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8')) as Record<string, unknown>;
      sidecar.size = 7;
      await writeFile(sidecarPath, JSON.stringify(sidecar), 'utf8');

      await expect(storage.stat(key)).resolves.toBeUndefined();
      await expect(storage.get(key)).resolves.toBeUndefined();
      await expect(storage.stream(key)).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('pins logical-key hashing and sidecar decoding against late codec substitution', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-codec-authority-'));
    const originalEncode = TextEncoder.prototype.encode;
    const originalDecode = TextDecoder.prototype.decode;
    try {
      const storage = createFileSystemStorage({ root });
      const victim = 'private/victim.txt';
      const attacker = 'public/attacker.txt';
      await storage.put(victim, 'VICTIM');

      TextEncoder.prototype.encode = function (value) {
        return Reflect.apply(originalEncode, this, [value === attacker ? victim : value]);
      };
      TextDecoder.prototype.decode = () =>
        `{"lastModified":"2026-07-11T00:00:00.000Z","scopedKeyFrame":"${testKeyFrame(attacker)}"}`;

      await expect(storage.get(attacker)).resolves.toBeUndefined();
      TextEncoder.prototype.encode = originalEncode;
      TextDecoder.prototype.decode = originalDecode;
      expect(bytesToText((await storage.get(victim))?.body)).toBe('VICTIM');
    } finally {
      TextEncoder.prototype.encode = originalEncode;
      TextDecoder.prototype.decode = originalDecode;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('pins physical-key hashing and slicing against late prototype substitution', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-hash-authority-'));
    const hashPrototype = Object.getPrototypeOf(createHash('sha256')) as {
      digest: typeof import('node:crypto').Hash.prototype.digest;
      update: typeof import('node:crypto').Hash.prototype.update;
    };
    const originalDigest = hashPrototype.digest;
    const originalUpdate = hashPrototype.update;
    const originalSlice = String.prototype.slice;
    let poisonHits = 0;
    try {
      const storage = createFileSystemStorage({ root });
      hashPrototype.update = function updatePoison(this: import('node:crypto').Hash) {
        poisonHits += 1;
        return this;
      } as typeof hashPrototype.update;
      hashPrototype.digest = function digestPoison() {
        poisonHits += 1;
        return 'f'.repeat(64);
      } as unknown as typeof hashPrototype.digest;
      String.prototype.slice = function slicePoison(start?: number) {
        poisonHits += 1;
        return start === 0 ? 'ff' : 'fixed-object-slot';
      };

      await storage.put('private/victim.txt', 'VICTIM');
      expect(bytesToText((await storage.get('private/victim.txt'))?.body)).toBe('VICTIM');
    } finally {
      hashPrototype.digest = originalDigest;
      hashPrototype.update = originalUpdate;
      String.prototype.slice = originalSlice;
    }

    try {
      const storage = createFileSystemStorage({ root });
      expect(bytesToText((await storage.get('private/victim.txt'))?.body)).toBe('VICTIM');
      expect(poisonHits).toBe(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not let Promise.all suppress exact filesystem slot ownership', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-promise-authority-'));
    const originalAll = Promise.all;
    try {
      const storage = createFileSystemStorage({ root });
      const firstKey = 'promise-collision/\ud800';
      const collidingKey = 'promise-collision/\ud801';
      await storage.put(firstKey, 'FIRST', { etag: '"first"' });

      Promise.all = (() => Promise.resolve([])) as typeof Promise.all;
      await expect(storage.put(collidingKey, 'SECOND', { etag: '"second"' })).rejects.toThrow(
        /collision/u,
      );
    } finally {
      Promise.all = originalAll;
    }

    try {
      const storage = createFileSystemStorage({ root });
      expect(bytesToText((await storage.get('promise-collision/\ud800'))?.body)).toBe('FIRST');
      await expect(storage.get('promise-collision/\ud801')).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('pins filesystem write-lock Promise.resolve before app evaluation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-lock-authority-'));
    const originalResolve = Promise.resolve;
    try {
      const storage = createFileSystemStorage({ root });
      Promise.resolve = function resolvePoison() {
        throw new Error('ambient Promise.resolve dispatched');
      } as typeof Promise.resolve;

      await storage.put('private/victim.txt', 'VICTIM');
      expect(bytesToText((await storage.get('private/victim.txt'))?.body)).toBe('VICTIM');
    } finally {
      Promise.resolve = originalResolve;
    }

    await rm(root, { force: true, recursive: true });
  });

  it('uses exact sidecar ownership to close physical digest collisions across every operation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-exact-key-'));
    try {
      const storage = createFileSystemStorage({ root });
      // TextEncoder replaces each lone surrogate with the same U+FFFD bytes, deliberately forcing
      // the two distinct JavaScript logical keys onto one physical SHA-256 index.
      const firstKey = 'ill-formed/\ud800';
      const collidingKey = 'ill-formed/\ud801';
      expect(fileSystemPhysicalStorageKey(firstKey)).toBe(
        fileSystemPhysicalStorageKey(collidingKey),
      );

      await storage.put(firstKey, 'FIRST', { etag: '"first"' });
      const sidecar = JSON.parse(
        await readFile(
          path.join(root, `${fileSystemPhysicalStorageKey(firstKey)}${fileSystemSidecarSuffix}`),
          'utf8',
        ),
      ) as { scopedKeyFrame?: unknown };
      expect(sidecar.scopedKeyFrame).toBe(testKeyFrame(firstKey));

      await expect(storage.get(collidingKey)).resolves.toBeUndefined();
      await expect(storage.stat(collidingKey)).resolves.toBeUndefined();
      await expect(storage.stream(collidingKey)).resolves.toBeUndefined();
      await storage.delete(collidingKey);
      expect(bytesToText((await storage.get(firstKey))?.body)).toBe('FIRST');
      await expect(storage.put(collidingKey, 'SECOND', { etag: '"second"' })).rejects.toThrow(
        /collision/u,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps host-equivalent logical keys distinct across memory, filesystem, and S3', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-storage-host-aliases-'));
    try {
      const adapters = [
        createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') }),
        createFileSystemStorage({ root }),
        createS3CompatibleStorage({ bucket: 'kovo-test', client: new MockS3Client() }),
      ];
      const distinctPairs = [
        ['Tenant/Victim.txt', 'tenant/victim.txt'],
        ['unicode/caf\u00e9.txt', 'unicode/cafe\u0301.txt'],
        ['windows/report.', 'windows/report'],
        ['windows/report ', 'windows/report'],
        ['windows/CON', 'windows/con'],
        ['windows/COM1.txt', 'windows/com1.txt'],
      ] as const;

      for (const storage of adapters) {
        for (const [firstKey, secondKey] of distinctPairs) {
          await storage.put(firstKey, 'FIRST');
          await storage.put(secondKey, 'SECOND');

          expect(bytesToText((await storage.get(firstKey))?.body)).toBe('FIRST');
          expect(bytesToText((await storage.get(secondKey))?.body)).toBe('SECOND');
          await expect(storage.stat(firstKey)).resolves.toMatchObject({ key: firstKey });
          await expect(storage.stat(secondKey)).resolves.toMatchObject({ key: secondKey });
          expect(
            bytesToText(await storageBodyToBytes((await storage.stream(firstKey))?.body ?? '')),
          ).toBe('FIRST');
          expect(
            bytesToText(await storageBodyToBytes((await storage.stream(secondKey))?.body ?? '')),
          ).toBe('SECOND');

          await storage.delete(secondKey);
          expect(bytesToText((await storage.get(firstKey))?.body)).toBe('FIRST');
          await expect(storage.get(secondKey)).resolves.toBeUndefined();
          await storage.delete(firstKey);
        }
      }
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

    const objectKey = s3PhysicalStorageKey('docs/report.bin');
    expect(client.calls).toEqual([
      `put bucket-a/tenant-a/${objectKey}`,
      `get bucket-a/tenant-a/${objectKey}`,
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

  async deleteObject(input: S3CompatibleDeleteObjectInput): Promise<void> {
    this.calls.push(`delete ${input.bucket}/${input.key}`);
    this.objects.delete(`${input.bucket}/${input.key}`);
  }

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

  async deleteObject(input: S3CompatibleDeleteObjectInput): Promise<void> {
    this.objects.delete(`${input.bucket}/${input.key}`);
  }

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
