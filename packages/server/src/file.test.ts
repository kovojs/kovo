import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { rootedFiles } from './file.js';
import { routeOutcomeResponse } from './response.js';

describe('server rooted file primitive', () => {
  it('serves a normal file through the response sink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-'));
    try {
      await mkdir(join(root, 'docs'));
      await writeFile(join(root, 'docs', 'readme.txt'), 'hello from root\n', 'utf8');
      const files = await rootedFiles(root);

      const outcome = await files.serve('docs/readme.txt', {
        contentType: 'text/plain; charset=utf-8',
      });
      expect(outcome).toBeDefined();
      if (outcome === undefined) throw new Error('expected rooted file outcome');

      const response = routeOutcomeResponse(outcome, { method: 'GET' });
      expect(response.headers['Content-Disposition']).toBe('attachment; filename="readme.txt"');
      expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8');
      expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(new TextDecoder().decode(response.body as Uint8Array)).toBe('hello from root\n');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('treats traversal attempts as not found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-'));
    const outside = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
      const files = await rootedFiles(root);

      await expect(
        files.serve(`../${basename(outside)}/secret.txt`, { contentType: 'text/plain' }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('treats symlink escape as not found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-'));
    const outside = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
      await symlink(outside, join(root, 'linked-outside'), 'dir');
      const files = await rootedFiles(root);

      await expect(
        files.serve('linked-outside/secret.txt', { contentType: 'text/plain' }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('treats missing files as not found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-'));
    try {
      const files = await rootedFiles(root);

      await expect(
        files.serve('missing.txt', { contentType: 'text/plain' }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('treats absolute paths, NUL bytes, and directories as not found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-'));
    const outside = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-outside-'));
    try {
      await mkdir(join(root, 'docs'));
      await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
      const files = await rootedFiles(root);

      await expect(
        files.serve(join(outside, 'secret.txt'), { contentType: 'text/plain' }),
      ).resolves.toBeUndefined();
      await expect(
        files.serve('docs\0/readme.txt', { contentType: 'text/plain' }),
      ).resolves.toBeUndefined();
      await expect(files.serve('docs', { contentType: 'text/plain' })).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });
});
