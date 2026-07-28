import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { buildAgentDocsSnapshot } from '../../../scripts/agent-docs-snapshot.mjs';
import {
  agentDocsSnapshotSchema,
  decodeInstalledAgentDocsSnapshot,
  readInstalledAgentDocsSnapshot,
} from './docs-snapshot.js';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('installed CLI docs snapshot', () => {
  it('consumes the exact pack-time producer format', () => {
    const root = fixtureRoot();
    const built = buildAgentDocsSnapshot({
      root,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    });

    const decoded = decodeInstalledAgentDocsSnapshot(built.compressed, {
      expectedVersion: '1.2.3',
    });

    expect(decoded.schema).toBe(agentDocsSnapshotSchema);
    expect(decoded.snapshotDigest).toBe(built.snapshot.snapshotDigest);
    expect(decoded.publicManifestDigest).toBe(built.snapshot.publicManifestDigest);
    expect(decoded.files.map((file) => file.path)).toEqual([
      'api/core.md',
      'guides/quickstart.md',
      'kovo-rules.md',
      'llms-full.txt',
      'llms.txt',
      'spec.md',
      'spec/01-overview.md',
    ]);
  });

  it('reads the installed artifact by URL and rejects a wrong CLI version', () => {
    const root = fixtureRoot();
    const built = buildAgentDocsSnapshot({
      root,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    });
    const snapshotPath = path.join(root, 'dist/kovo-docs.snapshot.json.gz');
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, built.compressed);

    expect(
      readInstalledAgentDocsSnapshot({
        expectedVersion: '1.2.3',
        snapshotUrl: pathToFileURL(snapshotPath),
      }).sourceCommit,
    ).toBe(SOURCE_COMMIT);
    expect(() =>
      readInstalledAgentDocsSnapshot({
        expectedVersion: '1.2.4',
        snapshotUrl: pathToFileURL(snapshotPath),
      }),
    ).toThrow('does not match installed CLI');
  });

  it('rejects a partial or digest-mismatched artifact before exposing files', () => {
    const root = fixtureRoot();
    const built = buildAgentDocsSnapshot({
      root,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    });
    const contentTamper = JSON.parse(gunzipSync(built.compressed).toString('utf8')) as {
      files: Array<{ bytes: number; content: string; path: string; sha256: string }>;
    };
    contentTamper.files[0]!.content += '\ntampered';
    contentTamper.files[0]!.bytes = Buffer.byteLength(contentTamper.files[0]!.content);
    const tamperedBytes = gzipSync(Buffer.from(`${JSON.stringify(contentTamper)}\n`), {
      level: 9,
      mtime: 0,
    });
    expect(() => decodeInstalledAgentDocsSnapshot(tamperedBytes)).toThrow(
      'snapshot digest does not match its content',
    );

    const partial = JSON.parse(gunzipSync(built.compressed).toString('utf8')) as {
      files: Array<{ path: string }>;
    };
    partial.files = partial.files.filter((file) => file.path !== 'llms-full.txt');
    const partialBytes = gzipSync(Buffer.from(`${JSON.stringify(partial)}\n`), {
      level: 9,
      mtime: 0,
    });
    expect(() => decodeInstalledAgentDocsSnapshot(partialBytes)).toThrow(
      'snapshot is missing llms-full.txt',
    );
  });
});

function fixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-cli-docs-snapshot-'));
  roots.push(root);
  write(root, 'SPEC.md', '# Kovo fixture spec\n');
  write(root, 'spec/01-overview.md', '# Overview\n');
  write(
    root,
    'site/content/guides/quickstart.md',
    '---\ntitle: Quickstart\ndescription: Build a page.\n---\n\n# Quickstart\n',
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
