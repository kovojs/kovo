import { execFileSync } from 'node:child_process';
import fs, { mkdtempSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createCompilerSourceFileSystem } from './source-filesystem.js';

describe('compiler source filesystem bounded reads', () => {
  it('admits the exact byte cap and rejects max plus one from the pinned descriptor', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compiler-bounded-read-'));
    try {
      const exact = join(root, 'exact.json');
      const over = join(root, 'over.json');
      writeFileSync(exact, '1234', 'utf8');
      writeFileSync(over, '12345', 'utf8');

      const fileSystem = createCompilerSourceFileSystem(root);
      expect(fileSystem?.readFileBounded(exact, 4)).toBe('1234');
      expect(fileSystem?.readFileBounded(over, 4)).toBeNull();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects outside symlinks and FIFOs without blocking the bounded read', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compiler-bounded-special-'));
    const outside = mkdtempSync(join(tmpdir(), 'kovo-compiler-bounded-outside-'));
    try {
      const outsideFile = join(outside, 'outside.json');
      const symlink = join(root, 'outside.json');
      const fifo = join(root, 'manifest.fifo');
      writeFileSync(outsideFile, '{}', 'utf8');
      symlinkSync(outsideFile, symlink);
      execFileSync('mkfifo', [fifo]);

      const fileSystem = createCompilerSourceFileSystem(root);
      expect(fileSystem?.readFileBounded(symlink, 256)).toBeNull();
      expect(fileSystem?.readFileBounded(fifo, 256)).toBeNull();
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it('rejects a deterministic same-inode same-size rewrite during a bounded read', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compiler-bounded-rewrite-'));
    const fileName = join(root, 'manifest.json');
    const originalReadSync = fs.readSync;
    let mutated = false;
    try {
      writeFileSync(fileName, 'A'.repeat(4_096), 'utf8');
      utimesSync(fileName, new Date(1_000), new Date(1_000));
      const before = statSync(fileName);

      Reflect.set(fs, 'readSync', ((fd, buffer, offset, length, position) => {
        const admittedLength = mutated ? length : Math.max(1, Math.floor(length / 2));
        const read = Reflect.apply(originalReadSync, fs, [
          fd,
          buffer,
          offset,
          admittedLength,
          position,
        ]);
        if (!mutated && read > 0) {
          writeFileSync(fileName, 'B'.repeat(4_096), 'utf8');
          mutated = true;
        }
        return read;
      }) as typeof fs.readSync);
      syncBuiltinESMExports();
      vi.resetModules();
      const fresh = await import('./source-filesystem.js');
      const fileSystem = fresh.createCompilerSourceFileSystem(root);

      expect(fileSystem?.readFileBounded(fileName, 4_096)).toBeNull();
      const after = statSync(fileName);
      expect(mutated).toBe(true);
      expect({ dev: after.dev, ino: after.ino, size: after.size }).toEqual({
        dev: before.dev,
        ino: before.ino,
        size: before.size,
      });
    } finally {
      Reflect.set(fs, 'readSync', originalReadSync);
      syncBuiltinESMExports();
      vi.resetModules();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
