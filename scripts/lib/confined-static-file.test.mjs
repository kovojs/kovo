import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveConfinedStaticFile } from './confined-static-file.mjs';

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

    await expect(resolveConfinedStaticFile(root, '/assets/safe.js', '/assets/')).resolves.toBe(
      await realpath(safe),
    );
    await expect(
      resolveConfinedStaticFile(
        root,
        '/assets/%2e%2e%2f%2e%2e%2fdist-evil%2fsecret.js',
        '/assets/',
      ),
    ).resolves.toBeUndefined();
    await expect(
      resolveConfinedStaticFile(root, '/assets/escape.js', '/assets/'),
    ).resolves.toBeUndefined();
    await expect(
      resolveConfinedStaticFile(root, '/assets/%not-an-escape', '/assets/'),
    ).resolves.toBeUndefined();
  });
});
