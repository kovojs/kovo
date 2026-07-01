import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createFrameworkFileSystemBoundary,
  createFrameworkOutputFileSystemBoundary,
  isFrameworkFileSystemBoundary,
} from './filesystem.js';

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
});
