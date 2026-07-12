import crypto from 'node:crypto';
import fs, {
  close as closeFileDescriptor,
  fstat as statFileDescriptor,
  open as openFileDescriptor,
} from 'node:fs';
import fsPromises, { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createFrameworkFileSystemBoundary,
  createFrameworkOutputFileSystemBoundary,
} from './filesystem.js';
import { fileSystemCreateReadableStream } from './filesystem-intrinsics.js';

function openDescriptor(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    openFileDescriptor(filePath, fs.constants.O_RDONLY, (error, fileDescriptor) => {
      if (error === null) resolve(fileDescriptor);
      else reject(error);
    });
  });
}

function closeDescriptor(fileDescriptor: number): Promise<void> {
  return new Promise((resolve, reject) => {
    closeFileDescriptor(fileDescriptor, (error) => {
      if (error === null) resolve();
      else reject(error);
    });
  });
}

function statDescriptor(fileDescriptor: number): Promise<void> {
  return new Promise((resolve, reject) => {
    statFileDescriptor(fileDescriptor, (error) => {
      if (error === null) resolve();
      else reject(error);
    });
  });
}

describe('framework filesystem late intrinsic confinement', () => {
  it('C179 keeps atomic writes inside the pinned root after fs and crypto export replacement', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-late-operations-'));
    const root = join(base, 'root');
    const safeTarget = join(root, 'safe.txt');
    const outsideTarget = join(base, 'escaped.txt');
    await mkdir(root);
    const fileSystem = createFrameworkOutputFileSystemBoundary(root);

    const originalRandomUuid = crypto.randomUUID;
    const originalRename = fsPromises.rename;
    let randomUuidPoisonHits = 0;
    let renamePoisonHits = 0;
    let writeError: unknown;
    try {
      // SPEC §6.6/§10.6: evaluated app code shares this realm. Before C179,
      // syncBuiltinESMExports() rebound the boundary's named imports and this replacement moved the
      // framework-authored temporary file to an attacker-selected path outside the validated root.
      crypto.randomUUID = (...args: Parameters<typeof originalRandomUuid>) => {
        randomUuidPoisonHits += 1;
        return originalRandomUuid(...args);
      };
      fsPromises.rename = async (sourcePath, targetPath) => {
        if (targetPath === safeTarget) {
          renamePoisonHits += 1;
          await originalRename(sourcePath, outsideTarget);
          return;
        }
        await originalRename(sourcePath, targetPath);
      };
      syncBuiltinESMExports();

      try {
        await fileSystem.writeFile('safe.txt', 'SAFE');
      } catch (error) {
        writeError = error;
      }
    } finally {
      crypto.randomUUID = originalRandomUuid;
      fsPromises.rename = originalRename;
      syncBuiltinESMExports();
    }

    try {
      expect(writeError).toBeUndefined();
      expect(randomUuidPoisonHits).toBe(0);
      expect(renamePoisonHits).toBe(0);
      await expect(readFile(safeTarget, 'utf8')).resolves.toBe('SAFE');
      await expect(readFile(outsideTarget, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('C182 rejects staging-prefix traversal while preserving valid sibling prefixes', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-staging-prefix-'));
    const siblingParent = join(base, 'authority');
    const root = join(siblingParent, 'root');
    const outside = join(base, 'outside');
    await mkdir(root, { recursive: true });
    await mkdir(outside);
    const fileSystem = createFrameworkOutputFileSystemBoundary(root);

    try {
      // Before C182, this ordinary prefix created `<base>/outside/escaped-*` beyond the pinned
      // sibling parent even without realm poisoning.
      await expect(fileSystem.createStagingRoot('../outside/escaped-')).rejects.toThrow(
        /single filename segment/u,
      );
      await expect(readdir(outside)).resolves.toEqual([]);

      for (const invalidPrefix of [
        '',
        '.',
        '..',
        '/absolute-',
        'nested/escaped-',
        'nested\\escaped-',
        'control\0byte-',
        'control\nbyte-',
        'control\u007fbyte-',
      ]) {
        await expect(fileSystem.createStagingRoot(invalidPrefix)).rejects.toThrow(
          /staging prefix/u,
        );
      }

      const stagingRoot = await fileSystem.createStagingRoot('.kovo-valid-staging-');
      expect(dirname(stagingRoot)).toBe(siblingParent);
      expect(basename(stagingRoot).startsWith('.kovo-valid-staging-')).toBe(true);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('C185 ignores late ReadStream prototype byte substitution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-filesystem-read-stream-prototype-'));
    await writeFile(join(root, 'inside.txt'), 'INSIDE', 'utf8');
    const fileSystem = await createFrameworkFileSystemBoundary(root);
    const originalRead = fs.ReadStream.prototype._read;

    try {
      fs.ReadStream.prototype._read = function poisonedReadStream() {
        this.push(Buffer.from('FORGED'));
        this.push(null);
      };
      const result = await fileSystem.readFile('inside.txt', { body: 'stream' });
      await expect(new Response(result?.body).text()).resolves.toBe('INSIDE');
    } finally {
      fs.ReadStream.prototype._read = originalRead;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C185 closes the numeric descriptor at stream EOF', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-filesystem-stream-eof-'));
    const filePath = join(root, 'inside.txt');
    await writeFile(filePath, 'INSIDE', 'utf8');
    const fileDescriptor = await openDescriptor(filePath);
    try {
      await expect(
        new Response(fileSystemCreateReadableStream(fileDescriptor)).text(),
      ).resolves.toBe('INSIDE');
      await expect(statDescriptor(fileDescriptor)).rejects.toMatchObject({ code: 'EBADF' });
    } finally {
      await closeDescriptor(fileDescriptor).catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C185 closes the numeric descriptor when the stream is cancelled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-filesystem-stream-cancel-'));
    const filePath = join(root, 'inside.txt');
    await writeFile(filePath, 'INSIDE', 'utf8');
    const fileDescriptor = await openDescriptor(filePath);
    try {
      const reader = fileSystemCreateReadableStream(fileDescriptor).getReader();
      await reader.cancel('test cancellation');
      await expect(statDescriptor(fileDescriptor)).rejects.toMatchObject({ code: 'EBADF' });
    } finally {
      await closeDescriptor(fileDescriptor).catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C185 errors the stream and releases ownership after a descriptor read failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-filesystem-stream-error-'));
    const filePath = join(root, 'inside.txt');
    await writeFile(filePath, 'INSIDE', 'utf8');
    const fileDescriptor = await openDescriptor(filePath);
    await closeDescriptor(fileDescriptor);
    try {
      await expect(
        new Response(fileSystemCreateReadableStream(fileDescriptor)).text(),
      ).rejects.toMatchObject({ code: 'EBADF' });
      await expect(statDescriptor(fileDescriptor)).rejects.toMatchObject({ code: 'EBADF' });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
