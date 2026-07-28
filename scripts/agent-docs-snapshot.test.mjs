import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  agentDocsSnapshotFileName,
  agentDocsSnapshotSchema,
  buildAgentDocsSnapshot,
  decodeAgentDocsSnapshot,
  digestPublicManifest,
  writeAgentDocsSnapshot,
} from './agent-docs-snapshot.mjs';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('agent docs snapshot', () => {
  it('is byte-identical across clean roots and carries no checkout path', () => {
    const firstRoot = fixtureRoot('first');
    const secondRoot = fixtureRoot('second');

    const first = buildAgentDocsSnapshot({
      root: firstRoot,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    });
    const second = buildAgentDocsSnapshot({
      root: secondRoot,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    });

    expect(first.compressed.equals(second.compressed)).toBe(true);
    expect(first.snapshot).toEqual(second.snapshot);
    expect(first.snapshot.schema).toBe(agentDocsSnapshotSchema);
    expect(first.snapshot.files.map((file) => file.path)).toEqual([
      'api/core.md',
      'guides/quickstart.md',
      'kovo-rules.md',
      'llms-full.txt',
      'llms.txt',
      'spec.md',
      'spec/01-overview.md',
    ]);
    const decoded = decodeAgentDocsSnapshot(first.compressed, {
      expectedPublicManifestDigest: first.snapshot.publicManifestDigest,
      expectedVersion: '1.2.3',
    });
    expect(decoded.snapshotDigest).toBe(first.snapshot.snapshotDigest);
    expect(decoded.files.find((file) => file.path === 'guides/quickstart.md')?.content).toContain(
      'Build the first page.',
    );
    expect(gunzipSync(first.compressed).toString('utf8')).not.toContain(firstRoot);
    expect(gunzipSync(first.compressed).toString('utf8')).not.toContain(secondRoot);
  });

  it('binds source bytes and the public manifest to the snapshot digest', () => {
    const root = fixtureRoot('digest');
    const baseline = buildAgentDocsSnapshot({
      root,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    });

    writeFileSync(
      path.join(root, 'site/content/guides/quickstart.md'),
      '# Quickstart\n\nBuild a changed page.\n',
    );
    const docsChanged = buildAgentDocsSnapshot({
      root,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    });
    expect(docsChanged.snapshot.snapshotDigest).not.toBe(baseline.snapshot.snapshotDigest);
    expect(
      docsChanged.snapshot.files.find((file) => file.path === 'guides/quickstart.md')?.sha256,
    ).not.toBe(
      baseline.snapshot.files.find((file) => file.path === 'guides/quickstart.md')?.sha256,
    );

    const packageManifest = JSON.parse(
      readFileSync(path.join(root, 'packages/core/package.json'), 'utf8'),
    );
    packageManifest.exports['./new'] = './src/new.ts';
    writeFileSync(
      path.join(root, 'packages/core/package.json'),
      `${JSON.stringify(packageManifest, null, 2)}\n`,
    );
    const manifestChanged = buildAgentDocsSnapshot({
      root,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    });
    expect(manifestChanged.snapshot.publicManifestDigest).not.toBe(
      docsChanged.snapshot.publicManifestDigest,
    );
    expect(manifestChanged.snapshot.snapshotDigest).not.toBe(docsChanged.snapshot.snapshotDigest);
  });

  it('rejects content tampering, wrong versions, and wrong public manifests', () => {
    const root = fixtureRoot('tamper');
    const built = buildAgentDocsSnapshot({
      root,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    });
    const object = JSON.parse(gunzipSync(built.compressed).toString('utf8'));
    object.files[0].content += '\ntampered\n';
    const tampered = gzipSync(Buffer.from(`${JSON.stringify(object)}\n`), {
      level: 9,
      mtime: 0,
    });

    expect(() => decodeAgentDocsSnapshot(tampered)).toThrow('snapshot byte length is invalid');
    expect(() => decodeAgentDocsSnapshot(built.compressed, { expectedVersion: '1.2.4' })).toThrow(
      'does not match installed CLI',
    );
    expect(() =>
      decodeAgentDocsSnapshot(built.compressed, {
        expectedPublicManifestDigest:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    ).toThrow('public-manifest digest does not match');
  });

  it('rejects placeholder-only sources before packaging', () => {
    const root = fixtureRoot('placeholder');
    writeFileSync(
      path.join(root, 'site/gen/api/core.md'),
      '# Core\n\nBundled starter placeholder for https://kovo.sh/api/core.\n',
    );
    expect(() =>
      buildAgentDocsSnapshot({
        root,
        sourceCommit: SOURCE_COMMIT,
        version: '1.2.3',
      }),
    ).toThrow('placeholder content cannot enter');
  });

  it('writes the bounded artifact and reports its authenticated measurements', async () => {
    const root = fixtureRoot('write');
    const output = path.join(root, 'out', agentDocsSnapshotFileName);
    const report = await writeAgentDocsSnapshot({
      output,
      prepareApi: false,
      root,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    });

    expect(report.output).toBe(output);
    expect(report.files).toBe(7);
    expect(report.compressedBytes).toBeGreaterThan(0);
    expect(report.uncompressedFileBytes).toBeGreaterThan(report.compressedBytes);
    expect(report.publicManifestDigest).toBe(digestPublicManifest(root));
    expect(
      decodeAgentDocsSnapshot(readFileSync(output), { expectedVersion: '1.2.3' }).snapshotDigest,
    ).toBe(report.snapshotDigest);
  });
});

function fixtureRoot(label) {
  const root = mkdtempSync(path.join(tmpdir(), `kovo-agent-docs-${label}-`));
  roots.push(root);
  write(root, 'SPEC.md', '# Kovo fixture spec\n\nNormative root.\n');
  write(root, 'spec/01-overview.md', '# Overview\n\nNormative detail.\n');
  write(
    root,
    'site/content/guides/quickstart.md',
    [
      '---',
      'title: Quickstart',
      'description: Build the first page.',
      '---',
      '',
      '# Quickstart',
      '',
      'Build the first page.',
      '',
    ].join('\n'),
  );
  write(
    root,
    'site/gen/api/core.md',
    ['---', 'title: Core API', '---', '', '# Core API', '', 'Use `route()`.', ''].join('\n'),
  );
  write(
    root,
    'public-packages.json',
    `${JSON.stringify(
      {
        packages: [
          {
            apiBoundary: { generated: [], internal: [], public: ['.'] },
            dir: 'core',
            kind: 'library',
            name: '@kovojs/core',
            visibility: 'public',
          },
          {
            apiBoundary: { generated: [], internal: [], public: [] },
            dir: 'private',
            kind: 'library',
            name: '@kovojs/private',
            visibility: 'private',
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  write(
    root,
    'packages/core/package.json',
    `${JSON.stringify(
      {
        exports: { '.': './src/index.ts' },
        name: '@kovojs/core',
        version: '1.2.3',
      },
      null,
      2,
    )}\n`,
  );
  write(
    root,
    'packages/cli/package.json',
    `${JSON.stringify({ name: '@kovojs/cli', version: '1.2.3' }, null, 2)}\n`,
  );
  return root;
}

function write(root, relativePath, source) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}
