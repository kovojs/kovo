import { mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openConfinedStaticFile } from './confined-static-file.mjs';

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

    const opened = await openConfinedStaticFile(root, '/assets/safe.js', '/assets/');
    expect(opened?.filePath).toBe(await realpath(safe));
    await opened?.fileHandle.close();
    await expect(
      openConfinedStaticFile(root, '/assets/%2e%2e%2f%2e%2e%2fdist-evil%2fsecret.js', '/assets/'),
    ).resolves.toBeUndefined();
    await expect(
      openConfinedStaticFile(root, '/assets/escape.js', '/assets/'),
    ).resolves.toBeUndefined();
    await expect(
      openConfinedStaticFile(root, '/assets/%not-an-escape', '/assets/'),
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

      const opened = await openConfinedStaticFile(root, '/assets/safe.js', '/assets/');
      expect(opened).toBeDefined();
      if (opened === undefined) throw new Error('Expected the safe static asset to open.');

      await rename(safe, checked);
      await symlink(secret, safe);

      await expect(opened.fileHandle.readFile('utf8')).resolves.toBe('SAFE_ASSET');
      await opened.fileHandle.close();
    },
  );
});
