import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyApiReferenceManifest } from './content.js';

const roots: string[] = [];

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function record(pathname: string, source: string) {
  return { bytes: Buffer.byteLength(source), path: pathname, sha256: sha256(source) };
}

function digest(records: ReturnType<typeof record>[]): string {
  return sha256(
    [...records]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`)
      .join('\n'),
  );
}

async function fixture() {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'kovo-api-manifest-repo-'));
  roots.push(repositoryRoot);
  const apiDir = path.join(repositoryRoot, 'site/gen/api');
  await mkdir(path.join(repositoryRoot, 'packages/core/src'), { recursive: true });
  await mkdir(apiDir, { recursive: true });

  const publicManifest = '{"packages":[]}\n';
  const packageManifest = '{"name":"@kovojs/core"}\n';
  const source = 'export const component = 1;\n';
  const page = '# @kovojs/core\n';
  const sidebar = '{"package":"@kovojs/core"}\n';
  await writeFile(path.join(repositoryRoot, 'public-packages.json'), publicManifest);
  await writeFile(path.join(repositoryRoot, 'packages/core/package.json'), packageManifest);
  await writeFile(path.join(repositoryRoot, 'packages/core/src/index.ts'), source);
  await writeFile(path.join(apiDir, 'core.md'), page);
  await writeFile(path.join(apiDir, 'core.sidebar.json'), sidebar);

  const packages = [record('packages/core/package.json', packageManifest)];
  const sources = [record('packages/core/src/index.ts', source)];
  const files = [record('core.md', page), record('core.sidebar.json', sidebar)];
  const manifest = {
    schema: 'kovo-api-reference-manifest/v1',
    digests: {
      outputs: digest(files),
      packages: digest(packages),
      publicManifest: sha256(publicManifest),
      sources: digest(sources),
    },
    inputs: {
      packages,
      publicManifest: record('public-packages.json', publicManifest),
      sources,
    },
    files,
  };
  await writeFile(
    path.join(apiDir, 'api-reference.manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { apiDir, repositoryRoot };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('generated API reference manifest consumption', () => {
  it('accepts the exact sealed input and generated file set', async () => {
    const paths = await fixture();
    expect(verifyApiReferenceManifest(paths).digests.outputs).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects stale generated pages and stale source inputs', async () => {
    const paths = await fixture();
    await writeFile(path.join(paths.apiDir, 'core.md'), '# stale\n');
    expect(() => verifyApiReferenceManifest(paths)).toThrow(
      'generated digest mismatch for core.md',
    );

    const fresh = await fixture();
    const sourcePath = path.join(fresh.repositoryRoot, 'packages/core/src/index.ts');
    const original = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, `${original}// drift\n`);
    expect(() => verifyApiReferenceManifest(fresh)).toThrow(
      'source digest mismatch for packages/core/src/index.ts',
    );
  });
});
