import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('./internal/filesystem.js');
  vi.resetModules();
});

it('keeps exact storage-key writes serialized after late Promise.prototype.then replacement', async () => {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  let signalFirst!: () => void;
  let signalSecond!: () => void;
  const firstGate = new Promise<void>((resolveGate) => {
    releaseFirst = resolveGate;
  });
  const secondGate = new Promise<void>((resolveGate) => {
    releaseSecond = resolveGate;
  });
  const firstStarted = new Promise<void>((resolveStarted) => {
    signalFirst = resolveStarted;
  });
  const secondStarted = new Promise<void>((resolveStarted) => {
    signalSecond = resolveStarted;
  });
  let blobWrites = 0;
  let thirdStarted = false;

  vi.doMock('./internal/filesystem.js', () => ({
    createFrameworkOutputFileSystemBoundary() {
      return {
        confinedPath(relativePath: string) {
          return `/reviewed-root/${relativePath}`;
        },
        async deleteFile() {},
        async fileBytes() {
          return undefined;
        },
        async statFile() {
          return undefined;
        },
        async writeFile(relativePath: string) {
          if (relativePath.endsWith('.kovo-storage.json')) return;
          blobWrites += 1;
          if (blobWrites === 1) {
            signalFirst();
            await firstGate;
          } else if (blobWrites === 2) {
            signalSecond();
            await secondGate;
          } else {
            thirdStarted = true;
          }
        },
      };
    },
  }));

  const { createFileSystemStorage } = await import('./storage.js');
  const storage = createFileSystemStorage({ root: '/reviewed-root' });
  const first = storage.put('same-key.txt', 'first');
  await firstStarted;

  const nativeThen = Promise.prototype.then;
  let second!: ReturnType<typeof storage.put>;
  let third!: ReturnType<typeof storage.put>;
  try {
    Promise.prototype.then = function settleAssimilatedGate(this: Promise<unknown>, onFulfilled) {
      if (typeof onFulfilled === 'function') onFulfilled(undefined);
      return this;
    } as typeof Promise.prototype.then;
    second = storage.put('same-key.txt', 'second');
    releaseFirst();
    await secondStarted;
    third = storage.put('same-key.txt', 'third');
  } finally {
    Promise.prototype.then = nativeThen;
  }

  await delay(20);
  expect(thirdStarted).toBe(false);
  releaseSecond();
  await expect(Promise.all([first, second, third])).resolves.toHaveLength(3);
  expect(thirdStarted).toBe(true);
});

it('publishes one body and metadata generation across independent same-root capabilities', async () => {
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let releaseNewSidecar!: () => void;
  let signalNewSidecar!: () => void;
  const newSidecarGate = new Promise<void>((resolveGate) => {
    releaseNewSidecar = resolveGate;
  });
  const newSidecarStarted = new Promise<void>((resolveStarted) => {
    signalNewSidecar = resolveStarted;
  });
  let sidecarBlocked = false;
  let readDuringBlocked = false;

  vi.doMock('./internal/filesystem.js', () => ({
    createFrameworkOutputFileSystemBoundary() {
      return {
        confinedPath(relativePath: string) {
          return `/shared-root/${relativePath}`;
        },
        async deleteFile(relativePath: string) {
          files.delete(relativePath);
        },
        async fileBytes(relativePath: string) {
          if (sidecarBlocked) readDuringBlocked = true;
          return files.get(relativePath);
        },
        async statFile(relativePath: string) {
          if (sidecarBlocked) readDuringBlocked = true;
          const value = files.get(relativePath);
          return value === undefined ? undefined : { mtime: new Date(0), size: value.byteLength };
        },
        async writeFile(relativePath: string, body: string | Uint8Array) {
          const bytes = typeof body === 'string' ? encoder.encode(body) : new Uint8Array(body);
          if (
            relativePath.endsWith('.kovo-storage.json') &&
            decoder.decode(bytes).includes('text/new')
          ) {
            sidecarBlocked = true;
            signalNewSidecar();
            await newSidecarGate;
            sidecarBlocked = false;
          }
          files.set(relativePath, bytes);
        },
      };
    },
  }));

  const { createFileSystemStorage, storageBodyToBytes } = await import('./storage.js');
  const writer = createFileSystemStorage({ root: '/shared-root' });
  const reader = createFileSystemStorage({ root: '/shared-root' });
  await writer.put('same.txt', 'old', { contentType: 'text/old', etag: 'old' });

  const replacing = writer.put('same.txt', 'new', { contentType: 'text/new', etag: 'new' });
  await newSidecarStarted;
  const get = reader.get('same.txt');
  const stat = reader.stat('same.txt');
  const stream = reader.stream('same.txt');
  await delay(20);
  expect(readDuringBlocked).toBe(false);

  releaseNewSidecar();
  await replacing;
  const [got, stated, streamed] = await Promise.all([get, stat, stream]);
  expect(decoder.decode(got?.body)).toBe('new');
  expect(got).toMatchObject({ contentType: 'text/new', etag: 'new', size: 3 });
  expect(stated).toMatchObject({ contentType: 'text/new', etag: 'new', size: 3 });
  expect(streamed).toMatchObject({ contentType: 'text/new', etag: 'new', size: 3 });
  expect(decoder.decode(await storageBodyToBytes(streamed!.body))).toBe('new');
});

it('keeps the prior generation readable when publishing the new sidecar fails', async () => {
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let failNewSidecar = false;

  vi.doMock('./internal/filesystem.js', () => ({
    createFrameworkOutputFileSystemBoundary() {
      return {
        confinedPath(relativePath: string) {
          return `/failure-root/${relativePath}`;
        },
        async deleteFile(relativePath: string) {
          files.delete(relativePath);
        },
        async fileBytes(relativePath: string) {
          return files.get(relativePath);
        },
        async statFile(relativePath: string) {
          const value = files.get(relativePath);
          return value === undefined ? undefined : { mtime: new Date(0), size: value.byteLength };
        },
        async writeFile(relativePath: string, body: string | Uint8Array) {
          const bytes = typeof body === 'string' ? encoder.encode(body) : new Uint8Array(body);
          if (
            failNewSidecar &&
            relativePath.endsWith('.kovo-storage.json') &&
            decoder.decode(bytes).includes('text/new')
          ) {
            throw new Error('simulated atomic pointer failure');
          }
          files.set(relativePath, bytes);
        },
      };
    },
  }));

  const { createFileSystemStorage } = await import('./storage.js');
  const first = createFileSystemStorage({ root: '/failure-root' });
  const second = createFileSystemStorage({ root: '/failure-root' });
  await first.put('same.txt', 'old', { contentType: 'text/old', etag: 'old' });
  failNewSidecar = true;
  await expect(
    first.put('same.txt', 'new', { contentType: 'text/new', etag: 'new' }),
  ).rejects.toThrow('simulated atomic pointer failure');

  const got = await second.get('same.txt');
  expect(decoder.decode(got?.body)).toBe('old');
  expect(got).toMatchObject({ contentType: 'text/old', etag: 'old', size: 3 });
});

it('reclaims the prior generation when a reported failure is proven committed', async () => {
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let commitThenThrow = false;

  vi.doMock('./internal/filesystem.js', () => ({
    createFrameworkOutputFileSystemBoundary() {
      return {
        confinedPath(relativePath: string) {
          return `/known-commit-root/${relativePath}`;
        },
        async deleteFile(relativePath: string) {
          files.delete(relativePath);
        },
        async fileBytes(relativePath: string) {
          return files.get(relativePath);
        },
        async statFile(relativePath: string) {
          const value = files.get(relativePath);
          return value === undefined ? undefined : { mtime: new Date(0), size: value.byteLength };
        },
        async writeFile(relativePath: string, body: string | Uint8Array) {
          const bytes = typeof body === 'string' ? encoder.encode(body) : new Uint8Array(body);
          files.set(relativePath, bytes);
          if (
            commitThenThrow &&
            relativePath.endsWith('.kovo-storage.json') &&
            decoder.decode(bytes).includes('text/new')
          ) {
            throw new Error('simulated known post-commit failure');
          }
        },
      };
    },
  }));

  const { createFileSystemStorage } = await import('./storage.js');
  const writer = createFileSystemStorage({ root: '/known-commit-root' });
  const reader = createFileSystemStorage({ root: '/known-commit-root' });
  await writer.put('same.txt', 'old', { contentType: 'text/old' });
  commitThenThrow = true;
  await expect(writer.put('same.txt', 'new', { contentType: 'text/new' })).rejects.toThrow(
    'simulated known post-commit failure',
  );

  const generationKeys = [...files.keys()].filter((key) => key.includes('.kovo-generation-'));
  expect(generationKeys).toHaveLength(1);
  expect(decoder.decode((await reader.get('same.txt'))?.body)).toBe('new');
});

it('retains a possibly-published generation when commit verification also fails', async () => {
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let commitThenThrow = false;
  let verificationReadThrows = false;

  vi.doMock('./internal/filesystem.js', () => ({
    createFrameworkOutputFileSystemBoundary() {
      return {
        confinedPath(relativePath: string) {
          return `/uncertain-root/${relativePath}`;
        },
        async deleteFile(relativePath: string) {
          files.delete(relativePath);
        },
        async fileBytes(relativePath: string) {
          if (verificationReadThrows && relativePath.endsWith('.kovo-storage.json')) {
            verificationReadThrows = false;
            throw new Error('simulated verification read failure');
          }
          return files.get(relativePath);
        },
        async statFile(relativePath: string) {
          const value = files.get(relativePath);
          return value === undefined ? undefined : { mtime: new Date(0), size: value.byteLength };
        },
        async writeFile(relativePath: string, body: string | Uint8Array) {
          const bytes = typeof body === 'string' ? encoder.encode(body) : new Uint8Array(body);
          files.set(relativePath, bytes);
          if (
            commitThenThrow &&
            relativePath.endsWith('.kovo-storage.json') &&
            decoder.decode(bytes).includes('text/new')
          ) {
            verificationReadThrows = true;
            throw new Error('simulated post-commit failure');
          }
        },
      };
    },
  }));

  const { createFileSystemStorage } = await import('./storage.js');
  const first = createFileSystemStorage({ root: '/uncertain-root' });
  const second = createFileSystemStorage({ root: '/uncertain-root' });
  await first.put('same.txt', 'old', { contentType: 'text/old', etag: 'old' });
  commitThenThrow = true;
  await expect(
    first.put('same.txt', 'new', { contentType: 'text/new', etag: 'new' }),
  ).rejects.toThrow('simulated post-commit failure');
  commitThenThrow = false;

  const got = await second.get('same.txt');
  expect(decoder.decode(got?.body)).toBe('new');
  expect(got).toMatchObject({ contentType: 'text/new', etag: 'new', size: 3 });
});

it('keeps deletion retryable across reported pointer and generation commit failures', async () => {
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  const deleteCalls: string[] = [];
  let failSidecarDelete = false;
  let commitSidecarDeleteThenThrow = false;
  let failGenerationDelete = false;

  vi.doMock('./internal/filesystem.js', () => ({
    createFrameworkOutputFileSystemBoundary() {
      return {
        confinedPath(relativePath: string) {
          return `/delete-root/${relativePath}`;
        },
        async deleteFile(relativePath: string) {
          deleteCalls.push(relativePath);
          if (relativePath.endsWith('.kovo-storage.json') && failSidecarDelete) {
            throw new Error('simulated pointer delete failure');
          }
          if (!relativePath.endsWith('.kovo-storage.json') && failGenerationDelete) {
            throw new Error('simulated generation delete failure');
          }
          files.delete(relativePath);
          if (relativePath.endsWith('.kovo-storage.json') && commitSidecarDeleteThenThrow) {
            throw new Error('simulated post-commit pointer delete failure');
          }
        },
        async fileBytes(relativePath: string) {
          return files.get(relativePath);
        },
        async statFile(relativePath: string) {
          const value = files.get(relativePath);
          return value === undefined ? undefined : { mtime: new Date(0), size: value.byteLength };
        },
        async writeFile(relativePath: string, body: string | Uint8Array) {
          files.set(
            relativePath,
            typeof body === 'string' ? encoder.encode(body) : new Uint8Array(body),
          );
        },
      };
    },
  }));

  const { createFileSystemStorage } = await import('./storage.js');
  const storage = createFileSystemStorage({ root: '/delete-root' });
  await storage.put('same.txt', 'old', { contentType: 'text/old' });

  failSidecarDelete = true;
  await expect(storage.delete('same.txt')).rejects.toThrow('simulated pointer delete failure');
  expect(deleteCalls).toHaveLength(1);
  expect(deleteCalls[0]).toMatch(/\.kovo-storage\.json$/u);
  expect(new TextDecoder().decode((await storage.get('same.txt'))?.body)).toBe('old');

  deleteCalls.length = 0;
  failSidecarDelete = false;
  commitSidecarDeleteThenThrow = true;
  await expect(storage.delete('same.txt')).rejects.toThrow(
    'simulated post-commit pointer delete failure',
  );
  expect(deleteCalls).toHaveLength(2);
  expect(deleteCalls[0]).toMatch(/\.kovo-storage\.json$/u);
  expect(deleteCalls[1]).toContain('.kovo-generation-');
  expect([...files.keys()].filter((key) => key.includes('.kovo-generation-'))).toEqual([]);
  await expect(storage.get('same.txt')).resolves.toBeUndefined();

  commitSidecarDeleteThenThrow = false;
  await storage.put('same.txt', 'retryable', { contentType: 'text/retryable' });
  deleteCalls.length = 0;
  failGenerationDelete = true;
  await expect(storage.delete('same.txt')).rejects.toThrow('simulated generation delete failure');
  expect(deleteCalls).toHaveLength(2);
  expect(deleteCalls[0]).toMatch(/\.kovo-storage\.json$/u);
  expect(deleteCalls[1]).toContain('.kovo-generation-');
  expect(new TextDecoder().decode((await storage.get('same.txt'))?.body)).toBe('retryable');

  failGenerationDelete = false;
  await storage.delete('same.txt');
  await expect(storage.get('same.txt')).resolves.toBeUndefined();
});
