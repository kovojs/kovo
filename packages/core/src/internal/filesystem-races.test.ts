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
import { setTimeout as delay } from 'node:timers/promises';

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

  it('serializes concurrent framework commits within one prepared root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-concurrent-commit-'));
    const root = join(base, 'root');
    await mkdir(root);
    const targetPath = join(await realpath(root), 'manifest.json');
    let targetIdentityChecks = 0;

    mockFileSystemIntrinsics((actual) => ({
      async fileSystemLstat(filePath) {
        if (filePath === targetPath) {
          targetIdentityChecks += 1;
          await delay(20);
        }
        return await actual.fileSystemLstat(filePath);
      },
    }));

    try {
      const { createFrameworkOutputFileSystemBoundary } = await freshFileSystemModule();
      const first = createFrameworkOutputFileSystemBoundary(root);
      const second = createFrameworkOutputFileSystemBoundary(root);
      await expect(
        Promise.all([
          first.writeFile('manifest.json', 'first'),
          second.writeFile('manifest.json', 'second'),
        ]),
      ).resolves.toEqual([undefined, undefined]);
      expect(['first', 'second']).toContain(await readFile(targetPath, 'utf8'));
      expect(targetIdentityChecks).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('keeps root commits serialized after late Promise.prototype.then replacement', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-promise-queue-'));
    const root = join(base, 'root');
    await mkdir(root);
    const targetPath = join(await realpath(root), 'manifest.json');
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
    let targetRenames = 0;
    let thirdStarted = false;

    mockFileSystemIntrinsics((actual) => ({
      async fileSystemRename(sourcePath, destinationPath) {
        await actual.fileSystemRename(sourcePath, destinationPath);
        if (destinationPath !== targetPath) return;
        targetRenames += 1;
        if (targetRenames === 1) {
          signalFirst();
          await firstGate;
        } else if (targetRenames === 2) {
          signalSecond();
          await secondGate;
        } else {
          thirdStarted = true;
        }
      },
    }));

    try {
      const { createFrameworkOutputFileSystemBoundary } = await freshFileSystemModule();
      const boundary = createFrameworkOutputFileSystemBoundary(root);
      const first = boundary.writeFile('manifest.json', 'first');
      await firstStarted;

      const nativeThen = Promise.prototype.then;
      let second!: Promise<void>;
      let third!: Promise<void>;
      try {
        Promise.prototype.then = function settleAssimilatedGate(
          this: Promise<unknown>,
          onFulfilled,
        ) {
          if (typeof onFulfilled === 'function') onFulfilled(undefined);
          return this;
        } as typeof Promise.prototype.then;
        second = boundary.writeFile('manifest.json', 'second');
        releaseFirst();
        await secondStarted;
        third = boundary.writeFile('manifest.json', 'third');
      } finally {
        Promise.prototype.then = nativeThen;
      }

      await delay(20);
      expect(thirdStarted).toBe(false);
      releaseSecond();
      await expect(Promise.all([first, second, third])).resolves.toEqual([
        undefined,
        undefined,
        undefined,
      ]);
      expect(thirdStarted).toBe(true);
      await expect(readFile(targetPath, 'utf8')).resolves.toBe('third');
    } finally {
      releaseFirst();
      releaseSecond();
      await rm(base, { force: true, recursive: true });
    }
  });

  it('serializes identical targets reached through overlapping prepared roots', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-overlapping-roots-'));
    const root = join(base, 'root');
    const nestedRoot = join(root, 'sub');
    await mkdir(nestedRoot, { recursive: true });
    const targetPath = join(await realpath(nestedRoot), 'same.txt');
    let releaseFirst!: () => void;
    let signalFirst!: () => void;
    const firstGate = new Promise<void>((resolveGate) => {
      releaseFirst = resolveGate;
    });
    const firstStarted = new Promise<void>((resolveStarted) => {
      signalFirst = resolveStarted;
    });
    let targetRenames = 0;

    mockFileSystemIntrinsics((actual) => ({
      async fileSystemRename(sourcePath, destinationPath) {
        await actual.fileSystemRename(sourcePath, destinationPath);
        if (destinationPath !== targetPath) return;
        targetRenames += 1;
        if (targetRenames === 1) {
          signalFirst();
          await firstGate;
        }
      },
    }));

    try {
      const { createFrameworkOutputFileSystemBoundary } = await freshFileSystemModule();
      const parent = createFrameworkOutputFileSystemBoundary(root);
      const nested = createFrameworkOutputFileSystemBoundary(nestedRoot);
      const first = parent.writeFile('sub/same.txt', 'parent');
      await firstStarted;
      const second = nested.writeFile('same.txt', 'nested');

      await delay(20);
      expect(targetRenames).toBe(1);
      releaseFirst();
      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
      expect(targetRenames).toBe(2);
      await expect(readFile(targetPath, 'utf8')).resolves.toBe('nested');
    } finally {
      releaseFirst();
      await rm(base, { force: true, recursive: true });
    }
  });

  it('keeps deletion in the same root replacement queue as an atomic write', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-write-delete-'));
    const root = join(base, 'root');
    await mkdir(root);
    const targetPath = join(await realpath(root), 'manifest.json');
    let renamed!: () => void;
    const committed = new Promise<void>((resolveCommitted) => {
      renamed = resolveCommitted;
    });
    let signaled = false;
    mockFileSystemIntrinsics((actual) => ({
      async fileSystemRename(sourcePath, destinationPath) {
        await actual.fileSystemRename(sourcePath, destinationPath);
        if (!signaled && destinationPath === targetPath) {
          signaled = true;
          renamed();
          await delay(20);
        }
      },
    }));

    try {
      const { createFrameworkOutputFileSystemBoundary } = await freshFileSystemModule();
      const boundary = createFrameworkOutputFileSystemBoundary(root);
      const write = boundary.writeFile('manifest.json', 'reviewed');
      await committed;
      const deletion = boundary.deleteFile('manifest.json');
      await expect(Promise.all([write, deletion])).resolves.toEqual([undefined, undefined]);
      await expect(readFile(targetPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('keeps renameFrom in the same root replacement queue as an atomic write', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-write-rename-'));
    const root = join(base, 'root');
    const replacementPath = join(base, 'replacement.json');
    await mkdir(root);
    await writeFile(replacementPath, 'replacement', 'utf8');
    const targetPath = join(await realpath(root), 'manifest.json');
    let renamed!: () => void;
    const committed = new Promise<void>((resolveCommitted) => {
      renamed = resolveCommitted;
    });
    let signaled = false;
    mockFileSystemIntrinsics((actual) => ({
      async fileSystemRename(sourcePath, destinationPath) {
        await actual.fileSystemRename(sourcePath, destinationPath);
        if (!signaled && destinationPath === targetPath) {
          signaled = true;
          renamed();
          await delay(20);
        }
      },
    }));

    try {
      const { createFrameworkOutputFileSystemBoundary } = await freshFileSystemModule();
      const boundary = createFrameworkOutputFileSystemBoundary(root);
      const write = boundary.writeFile('manifest.json', 'reviewed');
      await committed;
      const replacement = boundary.renameFrom(replacementPath, 'manifest.json');
      await expect(Promise.all([write, replacement])).resolves.toEqual([undefined, undefined]);
      await expect(readFile(targetPath, 'utf8')).resolves.toBe('replacement');
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('serializes case aliases that name one target on a case-folding filesystem', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-case-alias-'));
    const root = join(base, 'root');
    await mkdir(root);
    await writeFile(join(root, 'case-probe'), 'probe', 'utf8');
    try {
      await realpath(join(root, 'CASE-PROBE'));
    } catch {
      await rm(base, { force: true, recursive: true });
      return;
    }

    const canonicalRoot = await realpath(root);
    const lowerTarget = join(canonicalRoot, 'manifest.json');
    const upperTarget = join(canonicalRoot, 'MANIFEST.json');
    let targetIdentityChecks = 0;
    mockFileSystemIntrinsics((actual) => ({
      async fileSystemLstat(filePath) {
        if (filePath === lowerTarget || filePath === upperTarget) {
          targetIdentityChecks += 1;
          await delay(20);
        }
        return await actual.fileSystemLstat(filePath);
      },
    }));

    try {
      const { createFrameworkOutputFileSystemBoundary } = await freshFileSystemModule();
      const first = createFrameworkOutputFileSystemBoundary(root);
      const second = createFrameworkOutputFileSystemBoundary(root);
      await expect(
        Promise.all([
          first.writeFile('manifest.json', 'lower'),
          second.writeFile('MANIFEST.json', 'upper'),
        ]),
      ).resolves.toEqual([undefined, undefined]);
      expect(['lower', 'upper']).toContain(await readFile(lowerTarget, 'utf8'));
      expect(targetIdentityChecks).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });
});
