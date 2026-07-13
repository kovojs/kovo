import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isRootedFileServeCapability, rootedFiles } from './file.js';
import { routeOutcomeResponse } from './response.js';

describe('server rooted file primitive', () => {
  it('serves a normal file through the response sink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-'));
    try {
      await mkdir(join(root, 'docs'));
      await writeFile(join(root, 'docs', 'readme.txt'), 'hello from root\n', 'utf8');
      const files = await rootedFiles(root);
      expect(isRootedFileServeCapability(files)).toBe(true);

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

  it('pins inline-safety options before the asynchronous rooted read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-'));
    try {
      await writeFile(join(root, 'active.svg'), '<svg onload="alert(1)"></svg>', 'utf8');
      const files = await rootedFiles(root);
      const options = {
        contentType: 'image/svg+xml',
        disposition: 'attachment' as 'attachment' | 'inline',
        verifiedSafe: false,
      };
      const pending = files.serve('active.svg', options);
      options.disposition = 'inline';
      options.verifiedSafe = true;

      const outcome = await pending;
      expect(outcome?.contentDisposition).toBe('attachment; filename="active.svg"');
      expect(outcome?.contentType).toBe('image/svg+xml');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('refuses accessor-backed rooted serve options without invoking them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-'));
    try {
      await writeFile(join(root, 'active.svg'), '<svg onload="alert(1)"></svg>', 'utf8');
      const files = await rootedFiles(root);
      let getterCalls = 0;
      const options = {} as Parameters<typeof files.serve>[1];
      Object.defineProperty(options, 'contentType', {
        configurable: true,
        get() {
          getterCalls += 1;
          return 'image/svg+xml';
        },
      });
      await expect(files.serve('active.svg', options)).rejects.toThrow('own data property');
      expect(getterCalls).toBe(0);
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

  it('does not accept forged or copied rooted file-serve capabilities as blessed witnesses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-'));
    try {
      const files = await rootedFiles(root);
      const forged = {
        root: files.root,
        serve: files.serve,
        __kovoBlessedSink: 'rooted-file-serve',
      };

      expect(isRootedFileServeCapability(files)).toBe(true);
      expect(Object.isFrozen(files)).toBe(true);
      expect(Reflect.set(files, 'serve', async () => undefined)).toBe(false);
      expect(isRootedFileServeCapability({ ...files })).toBe(false);
      expect(isRootedFileServeCapability(forged)).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('pins a rooted file capability after app code replaces ambient Object.freeze', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-rooted-files-'));
    const originalFreeze = Object.freeze;
    let interceptedCapability = false;
    Object.freeze = ((value: unknown) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { root?: unknown }).root === 'string' &&
        typeof (value as { serve?: unknown }).serve === 'function'
      ) {
        interceptedCapability = true;
        return value;
      }
      return originalFreeze(value);
    }) as typeof Object.freeze;

    let files: Awaited<ReturnType<typeof rootedFiles>>;
    try {
      files = await rootedFiles(root);
    } finally {
      Object.freeze = originalFreeze;
      await rm(root, { force: true, recursive: true });
    }

    expect(interceptedCapability).toBe(false);
    expect(isRootedFileServeCapability(files)).toBe(true);
    expect(Object.isFrozen(files)).toBe(true);
    expect(Reflect.set(files, 'serve', async () => undefined)).toBe(false);
  });
});
