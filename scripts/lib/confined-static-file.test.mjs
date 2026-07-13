import { mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readConfinedStaticFile } from './confined-static-file.mjs';

describe('confined static file resolution', () => {
  let parent;

  afterEach(async () => {
    if (parent) await rm(parent, { force: true, recursive: true });
    parent = undefined;
  });

  it('accepts a real asset and rejects encoded sibling traversal and symlink escape', async () => {
    parent = await mkdtemp(path.join(tmpdir(), 'kovo-static-root-'));
    const root = path.join(parent, 'dist');
    const assets = path.join(root, 'assets');
    const sibling = path.join(parent, 'dist-evil');
    const safe = path.join(assets, 'safe.js');
    const secret = path.join(sibling, 'secret.js');
    await mkdir(assets, { recursive: true });
    await mkdir(sibling, { recursive: true });
    await writeFile(safe, 'safe');
    await writeFile(secret, 'secret');
    await symlink(secret, path.join(assets, 'escape.js'));

    const loaded = await readConfinedStaticFile(root, '/assets/safe.js', '/assets/');
    expect(loaded?.filePath).toBe(await realpath(safe));
    expect(loaded?.body?.toString('utf8')).toBe('safe');
    await expect(
      readConfinedStaticFile(root, '/assets/%2e%2e%2f%2e%2e%2fdist-evil%2fsecret.js', '/assets/'),
    ).resolves.toBeUndefined();
    await expect(
      readConfinedStaticFile(root, '/assets/escape.js', '/assets/'),
    ).resolves.toBeUndefined();
    await expect(
      readConfinedStaticFile(root, '/assets/%not-an-escape', '/assets/'),
    ).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'keeps serving the authenticated descriptor after its pathname is swapped',
    async () => {
      parent = await mkdtemp(path.join(tmpdir(), 'kovo-static-root-'));
      const root = path.join(parent, 'dist');
      const assets = path.join(root, 'assets');
      const outside = path.join(parent, 'outside');
      const safe = path.join(assets, 'safe.js');
      const checked = path.join(assets, 'safe.checked.js');
      const secret = path.join(outside, 'secret.js');
      await mkdir(assets, { recursive: true });
      await mkdir(outside, { recursive: true });
      await writeFile(safe, 'SAFE_ASSET');
      await writeFile(secret, 'OUTSIDE_SECRET');

      const loaded = await readConfinedStaticFile(root, '/assets/safe.js', '/assets/');
      expect(loaded).toBeDefined();
      if (loaded === undefined) throw new Error('Expected the safe static asset to load.');

      await rename(safe, checked);
      await symlink(secret, safe);

      expect(loaded.body?.toString('utf8')).toBe('SAFE_ASSET');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'keeps the boot-captured separator for traversal checks after builtin export poisoning',
    async () => {
      parent = await mkdtemp(path.join(tmpdir(), 'kovo-static-root-'));
      const root = path.join(parent, 'dist');
      const outside = path.join(parent, 'outside');
      await mkdir(path.join(root, 'assets'), { recursive: true });
      await mkdir(outside, { recursive: true });
      await writeFile(path.join(outside, 'secret.js'), 'OUTSIDE_SECRET');
      const originalSeparator = path.sep;
      path.sep = 'poisoned-separator';
      syncBuiltinESMExports();
      try {
        await expect(
          readConfinedStaticFile(root, '/assets/%2e%2e/%2e%2e/outside/secret.js', '/assets/'),
        ).resolves.toBeUndefined();
      } finally {
        path.sep = originalSeparator;
        syncBuiltinESMExports();
      }
    },
  );
});
