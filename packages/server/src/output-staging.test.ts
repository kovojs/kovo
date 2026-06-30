import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ArtifactOutputCheckError, writeArtifactOutput } from './output-staging.js';

async function* enumerateTxt(root: string): AsyncGenerator<string> {
  yield path.join(root, 'old.txt');
  yield path.join(root, 'keep.txt');
}

describe('manifest-backed artifact output staging', () => {
  it('rejects targets outside the output root before writing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-output-staging-root-'));
    try {
      await expect(
        writeArtifactOutput(root, [
          {
            content: 'escape',
            label: '../escape.txt',
            targetPath: path.join(root, '..', 'escape.txt'),
          },
        ]),
      ).rejects.toThrow(/escapes output root/);
      await expect(readFile(path.join(path.dirname(root), 'escape.txt'))).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('reports check-mode drift without writing planned content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-output-staging-check-'));
    try {
      const target = path.join(root, 'app.txt');
      await writeFile(target, 'old', 'utf8');

      await expect(
        writeArtifactOutput(root, [{ content: 'new', label: 'app.txt', targetPath: target }], {
          mode: 'check',
        }),
      ).rejects.toMatchObject({
        changed: [
          expect.objectContaining({
            relativePath: 'app.txt',
            targetPath: target,
          }),
        ],
      });
      await expect(readFile(target, 'utf8')).resolves.toBe('old');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('removes stale planned outputs after committing current artifacts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-output-staging-cleanup-'));
    try {
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, 'old.txt'), 'stale', 'utf8');
      await writeFile(path.join(root, 'keep.txt'), 'previous', 'utf8');

      const result = await writeArtifactOutput(
        root,
        [{ content: 'current', label: 'keep.txt', targetPath: path.join(root, 'keep.txt') }],
        { cleanup: { enumerate: enumerateTxt } },
      );

      expect(result.stale).toEqual([path.join(root, 'old.txt')]);
      await expect(readFile(path.join(root, 'keep.txt'), 'utf8')).resolves.toBe('current');
      await expect(readFile(path.join(root, 'old.txt'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('surfaces stale files as check-mode drift', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-output-staging-stale-check-'));
    try {
      await writeFile(path.join(root, 'old.txt'), 'stale', 'utf8');
      await writeFile(path.join(root, 'keep.txt'), 'current', 'utf8');

      await expect(
        writeArtifactOutput(
          root,
          [{ content: 'current', label: 'keep.txt', targetPath: path.join(root, 'keep.txt') }],
          { cleanup: { enumerate: enumerateTxt }, mode: 'check' },
        ),
      ).rejects.toBeInstanceOf(ArtifactOutputCheckError);
      await expect(readFile(path.join(root, 'old.txt'), 'utf8')).resolves.toBe('stale');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
