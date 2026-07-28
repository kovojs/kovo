import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';
import { afterEach, describe, expect, it } from 'vitest';

import { buildAgentDocsSnapshot } from '../../../scripts/agent-docs-snapshot.mjs';
import { decodeInstalledAgentDocsSnapshot } from './docs-snapshot.js';
import {
  installAgentDocsSnapshot,
  readActiveAgentDocsManifest,
  searchInstalledAgentDocs,
} from './docs-store.js';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('installed agent docs store', () => {
  it('selects a content-addressed snapshot only after every digest verifies', async () => {
    const root = fixtureRoot();
    const snapshot = fixtureSnapshot(root);

    const result = await installAgentDocsSnapshot({ cwd: root, snapshot });
    const manifest = await readActiveAgentDocsManifest({
      cwd: root,
      expectedVersion: '1.2.3',
    });
    const matches = await searchInstalledAgentDocs({
      cwd: root,
      expectedVersion: '1.2.3',
      task: 'quickstart page',
    });

    expect(result.directory).toBe(
      `.kovo/docs/snapshots/${snapshot.snapshotDigest.slice('sha256:'.length)}`,
    );
    expect(result.pointerPath).toBe('.kovo/docs/current.json');
    expect(manifest.snapshotDigest).toBe(snapshot.snapshotDigest);
    expect(matches[0]).toMatchObject({
      path: 'guides/quickstart.md',
      snapshotDigest: snapshot.snapshotDigest,
      version: '1.2.3',
    });
    expect(matches[0]?.excerpt).toContain('Build the first page');
  });

  it('keeps the prior pointer active when a later installation fails', async () => {
    const root = fixtureRoot();
    const first = fixtureSnapshot(root);
    await installAgentDocsSnapshot({ cwd: root, snapshot: first });
    writeFileSync(
      path.join(root, 'site/content/guides/quickstart.md'),
      '# Quickstart\n\nSecond snapshot content.\n',
    );
    const second = fixtureSnapshot(root);
    const realOutput = createFrameworkOutputFileSystemBoundary(root);
    let writes = 0;
    const failingOutput = {
      ...realOutput,
      async writeFile(relativePath: string, body: string | Uint8Array) {
        writes += 1;
        if (writes === 3) throw new Error('injected snapshot write failure');
        await realOutput.writeFile(relativePath, body);
      },
    };

    await expect(
      installAgentDocsSnapshot({
        cwd: root,
        output: failingOutput,
        snapshot: second,
      }),
    ).rejects.toThrow('injected snapshot write failure');
    expect(
      (await readActiveAgentDocsManifest({ cwd: root, expectedVersion: '1.2.3' })).snapshotDigest,
    ).toBe(first.snapshotDigest);
  });

  it('rejects a modified active file before returning a search result', async () => {
    const root = fixtureRoot();
    const snapshot = fixtureSnapshot(root);
    const installed = await installAgentDocsSnapshot({ cwd: root, snapshot });
    writeFileSync(
      path.join(root, installed.directory, 'guides/quickstart.md'),
      '# Quickstart\n\nModified after install.\n',
    );

    await expect(
      searchInstalledAgentDocs({
        cwd: root,
        expectedVersion: '1.2.3',
        task: 'quickstart',
      }),
    ).rejects.toThrow(/byte length mismatch|content digest mismatch/u);
  });

  it('does not install through a planted docs symlink', async () => {
    const root = fixtureRoot();
    const outside = mkdtempSync(path.join(tmpdir(), 'kovo-cli-docs-outside-'));
    roots.push(outside);
    mkdirSync(path.join(root, '.kovo'), { recursive: true });
    symlinkSync(outside, path.join(root, '.kovo/docs'), 'dir');

    await expect(
      installAgentDocsSnapshot({ cwd: root, snapshot: fixtureSnapshot(root) }),
    ).rejects.toThrow(/symbolic link/u);
    expect(existsSync(path.join(outside, 'current.json'))).toBe(false);
  });

  it('rejects stale installed versions and bounded-query abuse', async () => {
    const root = fixtureRoot();
    await installAgentDocsSnapshot({ cwd: root, snapshot: fixtureSnapshot(root) });

    await expect(
      readActiveAgentDocsManifest({ cwd: root, expectedVersion: '9.9.9' }),
    ).rejects.toThrow('does not match CLI');
    await expect(
      searchInstalledAgentDocs({ cwd: root, limit: 9, task: 'quickstart' }),
    ).rejects.toThrow('result limit');
    await expect(searchInstalledAgentDocs({ cwd: root, task: 'x'.repeat(257) })).rejects.toThrow(
      '1..256 UTF-8 bytes',
    );
  });
});

function fixtureSnapshot(root: string) {
  return decodeInstalledAgentDocsSnapshot(
    buildAgentDocsSnapshot({
      root,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    }).compressed,
    { expectedVersion: '1.2.3' },
  );
}

function fixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-cli-docs-store-'));
  roots.push(root);
  write(root, 'SPEC.md', '# Kovo fixture spec\n');
  write(root, 'spec/01-overview.md', '# Overview\n');
  write(
    root,
    'site/content/guides/quickstart.md',
    '# Quickstart\n\nBuild the first page with a route.\n',
  );
  write(root, 'site/gen/api/core.md', '# Core API\n\nUse `route()`.\n');
  write(
    root,
    'public-packages.json',
    `${JSON.stringify({
      packages: [
        {
          apiBoundary: { generated: [], internal: [], public: ['.'] },
          dir: 'core',
          kind: 'library',
          name: '@kovojs/core',
          visibility: 'public',
        },
      ],
    })}\n`,
  );
  write(
    root,
    'packages/core/package.json',
    `${JSON.stringify({
      exports: { '.': './src/index.ts' },
      name: '@kovojs/core',
      version: '1.2.3',
    })}\n`,
  );
  write(
    root,
    'packages/cli/package.json',
    `${JSON.stringify({ name: '@kovojs/cli', version: '1.2.3' })}\n`,
  );
  return root;
}

function write(root: string, relativePath: string, source: string): void {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}
