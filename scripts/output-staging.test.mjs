import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ScriptArtifactCheckError, writeScriptArtifacts } from './output-staging.mjs';

async function* enumerateArtifacts(root) {
  yield path.join(root, 'stale.txt');
  yield path.join(root, 'fresh.txt');
}

describe('script artifact output staging', () => {
  it('rejects traversal outside the output root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-script-output-root-'));
    try {
      await expect(
        writeScriptArtifacts(root, [{ content: 'bad', path: '../bad.txt' }]),
      ).rejects.toThrow(/escapes output root/);
      await expect(readFile(path.join(path.dirname(root), 'bad.txt'))).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('detects check-mode drift without writing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-script-output-check-'));
    try {
      await writeFile(path.join(root, 'fresh.txt'), 'old', 'utf8');
      await expect(
        writeScriptArtifacts(root, [{ content: 'new', path: 'fresh.txt' }], { mode: 'check' }),
      ).rejects.toMatchObject({
        changed: [expect.objectContaining({ relativePath: 'fresh.txt' })],
      });
      await expect(readFile(path.join(root, 'fresh.txt'), 'utf8')).resolves.toBe('old');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('cleans up stale planned outputs after commit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-script-output-cleanup-'));
    try {
      await writeFile(path.join(root, 'stale.txt'), 'stale', 'utf8');
      await writeFile(path.join(root, 'fresh.txt'), 'old', 'utf8');
      const result = await writeScriptArtifacts(root, [{ content: 'new', path: 'fresh.txt' }], {
        cleanup: { enumerate: enumerateArtifacts },
      });
      expect(result.stale).toEqual([path.join(root, 'stale.txt')]);
      await expect(readFile(path.join(root, 'fresh.txt'), 'utf8')).resolves.toBe('new');
      await expect(readFile(path.join(root, 'stale.txt'))).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('reports stale files as check-mode drift', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-script-output-stale-check-'));
    try {
      await writeFile(path.join(root, 'stale.txt'), 'stale', 'utf8');
      await writeFile(path.join(root, 'fresh.txt'), 'new', 'utf8');
      await expect(
        writeScriptArtifacts(root, [{ content: 'new', path: 'fresh.txt' }], {
          cleanup: { enumerate: enumerateArtifacts },
          mode: 'check',
        }),
      ).rejects.toBeInstanceOf(ScriptArtifactCheckError);
      await expect(readFile(path.join(root, 'stale.txt'), 'utf8')).resolves.toBe('stale');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
