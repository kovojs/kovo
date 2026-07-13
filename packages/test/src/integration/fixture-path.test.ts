import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveFixtureDirectory } from './fixture-path.js';

const cleanup: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  while (cleanup.length > 0) await rm(cleanup.pop()!, { force: true, recursive: true });
});

describe('Playwright fixture path confinement', () => {
  it('resolves a real child fixture beneath the configured root', async () => {
    const root = await scratch();
    const fixture = path.join(root, 'fixtures', 'shop');
    await mkdir(fixture, { recursive: true });
    await expect(resolveFixtureDirectory(path.join(root, 'fixtures'), 'shop')).resolves.toBe(
      await realpath(fixture),
    );
  });

  it('rejects lexical traversal, absolute names, and symlinked escapes', async () => {
    const root = await scratch();
    const fixtures = path.join(root, 'fixtures');
    const outside = path.join(root, 'outside');
    await mkdir(fixtures, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'app.tsx'), 'export default {}');
    await symlink(outside, path.join(fixtures, 'escape'));

    await expect(resolveFixtureDirectory(fixtures, '../outside')).rejects.toThrow(/stay beneath/u);
    await expect(resolveFixtureDirectory(fixtures, outside)).rejects.toThrow(/must be relative/u);
    await expect(resolveFixtureDirectory(fixtures, 'escape')).rejects.toThrow(
      /canonical fixtures root/u,
    );
  });
});

async function scratch(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-fixture-path-'));
  cleanup.push(root);
  return root;
}
