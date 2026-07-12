import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createFrameworkFileSystemBoundary,
  createFrameworkOutputFileSystemBoundary,
  isFrameworkFileSystemBoundary,
} from './filesystem.js';

const require = createRequire(import.meta.url);

describe('framework filesystem boundary', () => {
  it('reads only files confined under the real root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-filesystem-boundary-'));
    const outside = await mkdtemp(join(tmpdir(), 'kovo-filesystem-boundary-outside-'));
    try {
      await mkdir(join(root, 'docs'));
      await writeFile(join(root, 'docs/readme.txt'), 'inside', 'utf8');
      await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
      await symlink(outside, join(root, 'linked-outside'), 'dir');

      const fileSystem = await createFrameworkFileSystemBoundary(root);
      expect(isFrameworkFileSystemBoundary(fileSystem)).toBe(true);

      const readme = await fileSystem.readFile('docs/readme.txt');
      expect(new TextDecoder().decode(readme?.body as Uint8Array)).toBe('inside');
      await expect(
        fileSystem.readFile(`../${basename(outside)}/secret.txt`),
      ).resolves.toBeUndefined();
      await expect(fileSystem.readFile('linked-outside/secret.txt')).resolves.toBeUndefined();
      await expect(fileSystem.readFile(join(outside, 'secret.txt'))).resolves.toBeUndefined();
      await expect(fileSystem.readFile('docs\0/readme.txt')).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('streams from the validated open handle when the root name changes after open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-filesystem-stream-root-'));
    const parkedRoot = `${root}-parked`;
    const outside = await mkdtemp(join(tmpdir(), 'kovo-filesystem-stream-outside-'));
    try {
      await writeFile(join(root, 'data.txt'), 'inside stream', 'utf8');
      await writeFile(join(outside, 'data.txt'), 'outside stream', 'utf8');
      const fileSystem = await createFrameworkFileSystemBoundary(root);
      const opened = await fileSystem.readFile('data.txt', { body: 'stream' });

      await rename(root, parkedRoot);
      await symlink(outside, root, 'dir');

      await expect(new Response(opened?.body).text()).resolves.toBe('inside stream');
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(parkedRoot, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('keeps output writes inside the root and rejects symlink parents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-filesystem-output-boundary-'));
    const outside = await mkdtemp(join(tmpdir(), 'kovo-filesystem-output-boundary-outside-'));
    try {
      await symlink(outside, join(root, 'linked-outside'), 'dir');
      const fileSystem = createFrameworkOutputFileSystemBoundary(root);

      await fileSystem.writeFile('safe/output.txt', 'safe');
      await expect(fileSystem.fileBytes('safe/output.txt')).resolves.toBeInstanceOf(Uint8Array);
      await expect(fileSystem.writeFile('../escape.txt', 'escape')).rejects.toThrow(/escapes/u);
      await expect(fileSystem.writeFile('linked-outside/secret.txt', 'secret')).rejects.toThrow(
        /symbolic link/u,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('keeps output writes confined after late String/Array prototype poisoning', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-intrinsic-confinement-'));
    const root = join(base, 'root');
    const outside = join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    const fileSystem = createFrameworkOutputFileSystemBoundary(root);
    const outsideTarget = resolve(outside, 'escaped.txt');
    const rootPrefix = `${resolve(root)}${sep}`;
    const originalStartsWith = String.prototype.startsWith;
    const originalIncludes = Array.prototype.includes;
    let outcome: unknown;
    try {
      String.prototype.startsWith = function (search, position) {
        if (this.valueOf() === outsideTarget && search === rootPrefix) return true;
        if (originalStartsWith.call(this.valueOf(), '..') && search === `..${sep}`) return false;
        return originalStartsWith.call(this, search, position);
      };
      Array.prototype.includes = function (search, fromIndex) {
        if (search === '..') return false;
        return originalIncludes.call(this, search, fromIndex);
      };
      outcome = await fileSystem
        .writeFile(`../${basename(outside)}/escaped.txt`, 'ESCAPED')
        .catch((error: unknown) => error);
    } finally {
      String.prototype.startsWith = originalStartsWith;
      Array.prototype.includes = originalIncludes;
    }

    try {
      expect(outcome).toBeInstanceOf(Error);
      await expect(readFile(outsideTarget, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await fileSystem.writeFile('safe.txt', 'safe');
      await expect(readFile(join(root, 'safe.txt'), 'utf8')).resolves.toBe('safe');
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('keeps output writes confined after late filesystem-stat prototype poisoning', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-stat-confinement-'));
    const root = join(base, 'root');
    const outside = join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await symlink(outside, join(root, 'linked-outside'), 'dir');
    const fileSystem = createFrameworkOutputFileSystemBoundary(root);
    const statPrototype = Object.getPrototypeOf(await lstat(root)) as {
      isDirectory(): boolean;
      isSymbolicLink(): boolean;
    };
    const originalIsDirectory = statPrototype.isDirectory;
    const originalIsSymbolicLink = statPrototype.isSymbolicLink;
    let outcome: unknown;
    try {
      statPrototype.isSymbolicLink = () => false;
      statPrototype.isDirectory = () => true;
      outcome = await fileSystem
        .writeFile('linked-outside/escaped.txt', 'ESCAPED')
        .catch((error: unknown) => error);
    } finally {
      statPrototype.isDirectory = originalIsDirectory;
      statPrototype.isSymbolicLink = originalIsSymbolicLink;
    }

    try {
      expect(outcome).toBeInstanceOf(Error);
      await expect(readFile(join(outside, 'escaped.txt'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('reads bytes from the validated file handle under late FileHandle method poisoning', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-handle-confinement-'));
    const root = join(base, 'root');
    const outside = join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(root, 'safe.txt'), 'inside', 'utf8');
    await writeFile(join(outside, 'secret.txt'), 'outside secret', 'utf8');
    const fileSystem = await createFrameworkFileSystemBoundary(root);
    const controlHandle = await open(join(root, 'safe.txt'));
    const handlePrototype = Object.getPrototypeOf(controlHandle) as {
      readFile(...args: unknown[]): Promise<Uint8Array>;
    };
    const originalReadFile = handlePrototype.readFile;
    let poisonHits = 0;
    let result: Awaited<ReturnType<typeof fileSystem.readFile>>;
    try {
      handlePrototype.readFile = async () => {
        poisonHits += 1;
        return await readFile(join(outside, 'secret.txt'));
      };
      result = await fileSystem.readFile('safe.txt');
    } finally {
      handlePrototype.readFile = originalReadFile;
      await controlHandle.close();
    }

    try {
      expect(new TextDecoder().decode(result?.body as Uint8Array)).toBe('inside');
      expect(poisonHits).toBe(0);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('keeps output writes confined after late node:path binding replacement', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-path-binding-'));
    const root = join(base, 'root');
    const outside = join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    const fileSystem = createFrameworkOutputFileSystemBoundary(root);
    const canonicalRoot = fileSystem.root;
    const relativeEscape = '../outside/escaped.txt';
    const outsideTarget = join(outside, 'escaped.txt');
    const mutablePath = require('node:path') as typeof import('node:path');
    const originalResolve = mutablePath.resolve;
    let expectedContainmentRoot = root;
    let poisonHits = 0;
    let outcome: unknown;
    try {
      mutablePath.resolve = ((...parts: string[]) => {
        if (
          parts.length === 2 &&
          (parts[0] === root || parts[0] === canonicalRoot) &&
          parts[1] === relativeEscape
        ) {
          poisonHits += 1;
          expectedContainmentRoot = parts[0]!;
          return outsideTarget;
        }
        if (parts.length === 1 && parts[0] === outsideTarget) {
          poisonHits += 1;
          return join(expectedContainmentRoot, 'forged-inside.txt');
        }
        if (parts.length === 1 && parts[0] === outside) {
          poisonHits += 1;
          return expectedContainmentRoot;
        }
        return originalResolve(...parts);
      }) as typeof mutablePath.resolve;
      syncBuiltinESMExports();
      outcome = await fileSystem.writeFile(relativeEscape, 'ESCAPED').catch((error) => error);
    } finally {
      mutablePath.resolve = originalResolve;
      syncBuiltinESMExports();
    }

    try {
      expect(outcome).toBeInstanceOf(Error);
      expect(poisonHits).toBe(0);
      await expect(readFile(outsideTarget, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('C223 binds recursive directory entries and file bytes to observed filesystem identity', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-entry-identity-'));
    const root = join(base, 'root');
    const publicDir = join(root, 'public');
    const parkedPublicDir = join(root, 'public-parked');
    const outside = join(base, 'outside');
    try {
      await mkdir(publicDir, { recursive: true });
      await mkdir(outside);
      await writeFile(join(publicDir, 'safe.txt'), 'SAFE', 'utf8');
      await writeFile(join(outside, 'secret.txt'), 'SECRET', 'utf8');
      await symlink(join(outside, 'secret.txt'), join(publicDir, 'linked-secret.txt'));
      const fileSystem = createFrameworkOutputFileSystemBoundary(root);

      const rootEntries = await fileSystem.entries('.');
      const publicEntry = rootEntries.find((entry) => entry.name === 'public')!;
      const publicEntries = await fileSystem.entriesOf(publicEntry);
      const safeEntry = publicEntries.find((entry) => entry.name === 'safe.txt')!;
      const linkedEntry = publicEntries.find((entry) => entry.name === 'linked-secret.txt')!;

      await expect(fileSystem.fileBytesOf(safeEntry)).resolves.toEqual(
        new TextEncoder().encode('SAFE'),
      );
      expect(linkedEntry.kind).toBe('other');
      await expect(fileSystem.fileBytesOf(linkedEntry)).rejects.toThrow(/identity-bound result/u);

      await rename(join(publicDir, 'safe.txt'), join(publicDir, 'safe-parked.txt'));
      await writeFile(join(publicDir, 'safe.txt'), 'ATTACKER', 'utf8');
      await expect(fileSystem.fileBytesOf(safeEntry)).rejects.toThrow(/entry identity changed/u);

      await rename(publicDir, parkedPublicDir);
      await mkdir(publicDir);
      await expect(fileSystem.entriesOf(publicEntry)).rejects.toThrow(/entry identity changed/u);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('replaces final-component links when copying instead of writing through them', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-copy-target-'));
    const root = join(base, 'root');
    const outside = join(base, 'outside');
    const source = join(base, 'source.txt');
    try {
      await mkdir(root);
      await mkdir(outside);
      await writeFile(source, 'copied', 'utf8');
      await writeFile(join(outside, 'symlink-victim.txt'), 'outside symlink', 'utf8');
      await writeFile(join(outside, 'hardlink-victim.txt'), 'outside hardlink', 'utf8');
      await symlink(join(outside, 'symlink-victim.txt'), join(root, 'symlink-destination.txt'));
      await symlink(join(outside, 'created-by-link.txt'), join(root, 'dangling-destination.txt'));
      await link(join(outside, 'hardlink-victim.txt'), join(root, 'hardlink-destination.txt'));
      const fileSystem = createFrameworkOutputFileSystemBoundary(root);

      await fileSystem.copyFile(source, 'symlink-destination.txt');
      await fileSystem.copyFile(source, 'dangling-destination.txt');
      await fileSystem.copyFile(source, 'hardlink-destination.txt');

      await expect(readFile(join(outside, 'symlink-victim.txt'), 'utf8')).resolves.toBe(
        'outside symlink',
      );
      await expect(lstat(join(outside, 'created-by-link.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(readFile(join(outside, 'hardlink-victim.txt'), 'utf8')).resolves.toBe(
        'outside hardlink',
      );
      for (const name of [
        'symlink-destination.txt',
        'dangling-destination.txt',
        'hardlink-destination.txt',
      ]) {
        await expect(readFile(join(root, name), 'utf8')).resolves.toBe('copied');
        await expect(lstat(join(root, name))).resolves.toMatchObject({ nlink: 1 });
      }
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('pins the root identity before every open, write, copy, rename, delete, and tree removal', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-root-identity-'));
    const root = join(base, 'root');
    const parkedRoot = join(base, 'root-parked');
    const outside = join(base, 'outside');
    const copySource = join(base, 'copy-source.txt');
    const renameSource = join(base, 'rename-source.txt');
    try {
      await mkdir(root);
      await mkdir(outside);
      await writeFile(join(root, 'inside.txt'), 'inside', 'utf8');
      await writeFile(join(outside, 'inside.txt'), 'outside', 'utf8');
      await writeFile(copySource, 'copy', 'utf8');
      await writeFile(renameSource, 'rename', 'utf8');
      const fileSystem = createFrameworkOutputFileSystemBoundary(root);

      await rename(root, parkedRoot);
      await symlink(outside, root, 'dir');

      expect(() => fileSystem.confinedPath('inside.txt')).toThrow(/root identity changed/u);
      expect(() => fileSystem.pathForExistingChild('inside.txt')).toThrow(/root identity changed/u);
      await expect(fileSystem.fileBytes('inside.txt')).rejects.toThrow(/root identity changed/u);
      await expect(fileSystem.writeFile('written.txt', 'unsafe')).rejects.toThrow(
        /root identity changed/u,
      );
      await expect(fileSystem.copyFile(copySource, 'copied.txt')).rejects.toThrow(
        /root identity changed/u,
      );
      await expect(fileSystem.renameFrom(renameSource, 'renamed.txt')).rejects.toThrow(
        /root identity changed/u,
      );
      await expect(fileSystem.deleteFile('inside.txt')).rejects.toThrow(/root identity changed/u);
      await expect(fileSystem.removeTree()).rejects.toThrow(/root identity changed/u);

      await expect(readFile(join(outside, 'inside.txt'), 'utf8')).resolves.toBe('outside');
      await expect(readFile(copySource, 'utf8')).resolves.toBe('copy');
      await expect(readFile(renameSource, 'utf8')).resolves.toBe('rename');
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('rejects ancestor substitution after the root identity is pinned', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-ancestor-identity-'));
    const ancestor = join(base, 'ancestor');
    const parkedAncestor = join(base, 'ancestor-parked');
    const root = join(ancestor, 'root');
    const outsideAncestor = join(base, 'outside-ancestor');
    const outsideRoot = join(outsideAncestor, 'root');
    try {
      await mkdir(root, { recursive: true });
      await mkdir(outsideRoot, { recursive: true });
      await writeFile(join(outsideRoot, 'victim.txt'), 'outside', 'utf8');
      const fileSystem = createFrameworkOutputFileSystemBoundary(root);

      await rename(ancestor, parkedAncestor);
      await symlink(outsideAncestor, ancestor, 'dir');

      await expect(fileSystem.deleteFile('victim.txt')).rejects.toThrow(/root identity changed/u);
      await expect(readFile(join(outsideRoot, 'victim.txt'), 'utf8')).resolves.toBe('outside');
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('pins a missing root through safe creation and rejects a planted intermediate symlink', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-missing-root-'));
    const root = join(base, 'missing', 'nested', 'root');
    const plantedRoot = join(base, 'planted', 'root');
    const outside = join(base, 'outside');
    try {
      const fileSystem = createFrameworkOutputFileSystemBoundary(root);
      expect(fileSystem.confinedPath('missing.txt')).toBe(join(fileSystem.root, 'missing.txt'));
      expect(fileSystem.pathForExistingChild('missing.txt')).toBeUndefined();
      await expect(fileSystem.deleteFile('missing.txt')).resolves.toBeUndefined();
      await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });

      await fileSystem.writeFile('safe.txt', 'safe');
      expect(fileSystem.pathForExistingChild('safe.txt')).toBe(join(fileSystem.root, 'safe.txt'));
      await expect(fileSystem.fileBytes('safe.txt')).resolves.toBeInstanceOf(Uint8Array);
      await expect(readFile(join(root, 'safe.txt'), 'utf8')).resolves.toBe('safe');

      await mkdir(outside);
      const planted = createFrameworkOutputFileSystemBoundary(plantedRoot);
      await symlink(outside, join(base, 'planted'), 'dir');
      await expect(planted.writeFile('escape.txt', 'escape')).rejects.toThrow(/symbolic link/u);
      await expect(lstat(join(outside, 'escape.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('rejects replacement of the pinned ancestor for an initially missing root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-missing-anchor-'));
    const anchor = join(base, 'anchor');
    const parkedAnchor = join(base, 'anchor-parked');
    const outsideAnchor = join(base, 'outside-anchor');
    const root = join(anchor, 'missing-root');
    try {
      await mkdir(anchor);
      await mkdir(outsideAnchor);
      const fileSystem = createFrameworkOutputFileSystemBoundary(root);

      await rename(anchor, parkedAnchor);
      await symlink(outsideAnchor, anchor, 'dir');

      await expect(fileSystem.writeFile('escape.txt', 'escape')).rejects.toThrow(
        /root identity changed/u,
      );
      await expect(lstat(join(outsideAnchor, 'escape.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('allows a pinned canonical ancestor symlink but rejects a final root symlink', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kovo-filesystem-canonical-anchor-'));
    const canonicalParent = join(base, 'canonical-parent');
    const lexicalAnchor = join(base, 'lexical-anchor');
    const root = join(lexicalAnchor, 'missing-root');
    const finalRootLink = join(base, 'final-root-link');
    try {
      await mkdir(canonicalParent);
      await symlink(canonicalParent, lexicalAnchor, 'dir');
      const fileSystem = createFrameworkOutputFileSystemBoundary(root);
      expect(fileSystem.root).toBe(join(await realpath(canonicalParent), 'missing-root'));
      await fileSystem.writeFile('safe.txt', 'safe');
      await expect(
        readFile(join(canonicalParent, 'missing-root', 'safe.txt'), 'utf8'),
      ).resolves.toBe('safe');

      await symlink(join(canonicalParent, 'missing-root'), finalRootLink, 'dir');
      const finalRoot = createFrameworkOutputFileSystemBoundary(finalRootLink);
      await expect(finalRoot.ensureDirectory()).rejects.toThrow(/non-symbolic-link directory/u);
      await expect(createFrameworkFileSystemBoundary(finalRootLink)).rejects.toThrow(
        /non-symbolic-link directory/u,
      );
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it('preserves normal, missing, and final-component symlink deletion semantics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-filesystem-delete-controls-'));
    const outside = await mkdtemp(join(tmpdir(), 'kovo-filesystem-delete-controls-outside-'));
    try {
      const fileSystem = createFrameworkOutputFileSystemBoundary(root);
      await expect(fileSystem.deleteFile('missing.txt')).resolves.toBeUndefined();
      await fileSystem.writeFile('normal.txt', 'normal');
      await fileSystem.deleteFile('normal.txt');
      await expect(lstat(join(root, 'normal.txt'))).rejects.toMatchObject({ code: 'ENOENT' });

      await writeFile(join(outside, 'victim.txt'), 'outside', 'utf8');
      await symlink(join(outside, 'victim.txt'), join(root, 'final-link.txt'));
      await fileSystem.deleteFile('final-link.txt');
      await expect(readFile(join(outside, 'victim.txt'), 'utf8')).resolves.toBe('outside');
      await expect(lstat(join(root, 'final-link.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });
});
