import {
  copyFile as nativeCopyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type FileSystemIntrinsics = typeof import('./filesystem-intrinsics.js');
type FileSystemIntrinsicOverrides = Partial<FileSystemIntrinsics> & {
  /** Historical path-based sink retained only so this regression fails against the vulnerable code. */
  fileSystemCopyFile?: (source: string, target: string) => Promise<void>;
};

function mockFileSystemIntrinsics(
  overrides: (actual: FileSystemIntrinsics) => FileSystemIntrinsicOverrides,
): void {
  vi.doMock('#filesystem-intrinsics', async () => {
    const actual = await vi.importActual<FileSystemIntrinsics>('./filesystem-intrinsics.js');
    return { ...actual, ...overrides(actual) };
  });
}

async function freshFileSystemModule() {
  vi.resetModules();
  return await import('./filesystem.js');
}

afterEach(() => {
  vi.doUnmock('#filesystem-intrinsics');
  vi.resetModules();
});

describe('framework filesystem pathname-race confinement (SPEC §10.6)', () => {
  it('binds statFile and fileExists metadata to the pre-open same-root entry identity', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-stat-race-'));
    const root = join(base, 'root');
    const statPath = join(root, 'stat.txt');
    const statParked = join(root, 'stat-parked.txt');
    const statSibling = join(root, 'stat-sibling.txt');
    const existsPath = join(root, 'exists.txt');
    const existsParked = join(root, 'exists-parked.txt');
    const existsSibling = join(root, 'exists-sibling.txt');
    await mkdir(root);
    await writeFile(statPath, 'A', 'utf8');
    await writeFile(statSibling, 'SIBLING-SECRET', 'utf8');
    await writeFile(existsPath, 'B', 'utf8');
    await writeFile(existsSibling, 'SECOND-SIBLING-SECRET', 'utf8');

    const canonicalRoot = await realpath(root);
    const canonicalStatPath = join(canonicalRoot, 'stat.txt');
    const canonicalExistsPath = join(canonicalRoot, 'exists.txt');

    const swaps = new Map<string, readonly [string, string]>([
      [canonicalStatPath, [statParked, statSibling]],
      [canonicalExistsPath, [existsParked, existsSibling]],
    ]);
    mockFileSystemIntrinsics((actual) => ({
      async fileSystemStat(filePath) {
        const swap = swaps.get(filePath);
        if (swap !== undefined) {
          swaps.delete(filePath);
          await rename(filePath, swap[0]);
          await rename(swap[1], filePath);
        }
        return await actual.fileSystemStat(filePath);
      },
    }));

    try {
      const { createFrameworkFileSystemBoundary } = await freshFileSystemModule();
      const boundary = await createFrameworkFileSystemBoundary(root);
      await expect(boundary.statFile('stat.txt')).resolves.toBeUndefined();
      await expect(boundary.fileExists('exists.txt')).resolves.toBe(false);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('does not read a same-root sibling swapped into place at descriptor open', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-read-race-'));
    const root = join(base, 'root');
    const safePath = join(root, 'safe.txt');
    const parkedPath = join(root, 'safe-parked.txt');
    const siblingPath = join(root, 'sibling-secret.txt');
    await mkdir(root);
    await writeFile(safePath, 'SAFE', 'utf8');
    await writeFile(siblingPath, 'SIBLING-SECRET', 'utf8');
    const canonicalSafePath = join(await realpath(root), 'safe.txt');

    let swapped = false;
    mockFileSystemIntrinsics((actual) => ({
      async fileSystemOpenFileDescriptor(filePath) {
        if (!swapped && filePath === canonicalSafePath) {
          swapped = true;
          await rename(safePath, parkedPath);
          await rename(siblingPath, safePath);
        }
        return await actual.fileSystemOpenFileDescriptor(filePath);
      },
    }));

    try {
      const { createFrameworkFileSystemBoundary } = await freshFileSystemModule();
      const boundary = await createFrameworkFileSystemBoundary(root);
      await expect(boundary.readFile('safe.txt')).resolves.toBeUndefined();
      expect(swapped).toBe(true);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('copies bytes from an identity-bound source descriptor instead of reopening its path', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-copy-source-race-'));
    const root = join(base, 'root');
    const sourcePath = join(base, 'source.txt');
    const parkedPath = join(base, 'source-parked.txt');
    const siblingPath = join(base, 'sibling-secret.txt');
    await mkdir(root);
    await writeFile(sourcePath, 'SAFE', 'utf8');
    await writeFile(siblingPath, 'SIBLING-SECRET', 'utf8');

    let pathCopyHits = 0;
    mockFileSystemIntrinsics((actual) => ({
      async fileSystemCopyFile(source, target) {
        if (source === sourcePath) {
          pathCopyHits += 1;
          await rename(sourcePath, parkedPath);
          await rename(siblingPath, sourcePath);
        }
        await nativeCopyFile(source, target);
      },
    }));

    try {
      const { createFrameworkOutputFileSystemBoundary } = await freshFileSystemModule();
      const boundary = createFrameworkOutputFileSystemBoundary(root);
      await boundary.copyFile(sourcePath, 'copied.txt');
      await expect(readFile(join(root, 'copied.txt'), 'utf8')).resolves.toBe('SAFE');
      expect(pathCopyHits).toBe(0);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('uses exclusive no-follow descriptors for write and copy temporary files', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-temp-race-'));
    const root = join(base, 'root');
    const outside = join(base, 'outside');
    const sourcePath = join(base, 'source.txt');
    const fixedUuid = '00000000-0000-4000-8000-000000000001';
    await mkdir(root);
    await mkdir(outside);
    await writeFile(sourcePath, 'COPY-SOURCE', 'utf8');
    const writeVictim = join(outside, 'write-victim.txt');
    const copyVictim = join(outside, 'copy-victim.txt');
    await writeFile(writeVictim, 'WRITE-VICTIM', 'utf8');
    await writeFile(copyVictim, 'COPY-VICTIM', 'utf8');
    await symlink(writeVictim, join(root, `.written.txt.${process.pid}.${fixedUuid}.tmp`));
    await symlink(copyVictim, join(root, `.copied.txt.${process.pid}.${fixedUuid}.tmp`));

    mockFileSystemIntrinsics(() => ({ fileSystemRandomUuid: () => fixedUuid }));
    try {
      const { createFrameworkOutputFileSystemBoundary } = await freshFileSystemModule();
      const boundary = createFrameworkOutputFileSystemBoundary(root);
      await expect(boundary.writeFile('written.txt', 'ATTACKER-WRITE')).rejects.toMatchObject({
        code: 'EEXIST',
      });
      await expect(boundary.copyFile(sourcePath, 'copied.txt')).rejects.toMatchObject({
        code: 'EEXIST',
      });
      await expect(readFile(writeVictim, 'utf8')).resolves.toBe('WRITE-VICTIM');
      await expect(readFile(copyVictim, 'utf8')).resolves.toBe('COPY-VICTIM');
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });
});
