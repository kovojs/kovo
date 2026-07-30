import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  directorySubject,
  loadAuthenticatedPackedCompiler,
  type FreshArtifactSet,
  type PackedArtifact,
} from './artifacts-v6.ts';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('D1 v6 authenticated packed compiler module graph', () => {
  it('resolves compiler browser imports from the authenticated extracted browser package', async () => {
    const fixture = await createPackedArtifactFixture();

    const loaded = await loadAuthenticatedPackedCompiler(fixture.artifacts);

    expect(loaded.root.browserMarker).toBe('packed-browser-runtime');
    expect(loaded.internal.browserIdentity).toBe('packed-browser-identity');
    await expect(
      realpath(join(fixture.compilerRoot, 'node_modules', '@kovojs', 'browser')),
    ).resolves.toBe(await realpath(fixture.browserRoot));
  });

  it('refuses a browser dependency whose extracted bytes differ from its packed subject', async () => {
    const fixture = await createPackedArtifactFixture();
    await writeFile(
      join(fixture.browserRoot, 'dist', 'deferred-app-runtime-module.mjs'),
      "export const marker = 'tampered-workspace-fallback';\n",
    );

    await expect(loadAuthenticatedPackedCompiler(fixture.artifacts)).rejects.toThrow(
      '@kovojs/browser extracted bytes do not match the authenticated packed content subject',
    );
  });
});

async function createPackedArtifactFixture(): Promise<{
  readonly artifacts: FreshArtifactSet;
  readonly browserRoot: string;
  readonly compilerRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'kovo-d1-packed-graph-'));
  temporaryRoots.push(root);
  const browserRoot = join(root, 'browser');
  const compilerRoot = join(root, 'compiler');
  const coreRoot = join(root, 'core');
  const serverRoot = join(root, 'server');

  await Promise.all([
    writePackage(
      browserRoot,
      '@kovojs/browser',
      {
        'dist/deferred-app-runtime-identity.mjs':
          "export const identity = 'packed-browser-identity';\n",
        'dist/deferred-app-runtime-module.mjs': "export const marker = 'packed-browser-runtime';\n",
      },
      {
        './internal/deferred-app-runtime': './dist/deferred-app-runtime-module.mjs',
        './internal/deferred-app-runtime-identity': './dist/deferred-app-runtime-identity.mjs',
      },
    ),
    writePackage(compilerRoot, '@kovojs/compiler', {
      'dist/index.mjs': [
        "import { marker } from '@kovojs/browser/internal/deferred-app-runtime';",
        'export const browserMarker = marker;',
        '',
      ].join('\n'),
      'dist/internal.mjs': [
        "import { identity } from '@kovojs/browser/internal/deferred-app-runtime-identity';",
        'export const browserIdentity = identity;',
        '',
      ].join('\n'),
    }),
    writePackage(coreRoot, '@kovojs/core', {
      'dist/index.mjs': 'export const core = true;\n',
    }),
    writePackage(serverRoot, '@kovojs/server', {
      'dist/index.mjs': 'export const server = true;\n',
    }),
  ]);

  const [browser, compiler, core, server] = await Promise.all([
    packedArtifact('@kovojs/browser', browserRoot),
    packedArtifact('@kovojs/compiler', compilerRoot),
    packedArtifact('@kovojs/core', coreRoot),
    packedArtifact('@kovojs/server', serverRoot),
  ]);
  const frameworkSourceContents = await directorySubject(root);

  return {
    artifacts: {
      buildCommands: [],
      frameworkHeadCommit: '0'.repeat(40),
      frameworkSourceCommit: '0'.repeat(40),
      frameworkSourceContents,
      frameworkSourceTreeClean: true,
      packages: { browser, compiler, core, server },
    },
    browserRoot,
    compilerRoot,
  };
}

async function packedArtifact(name: string, root: string): Promise<PackedArtifact> {
  const packedContents = await directorySubject(root);
  return {
    extractedPackageRoot: await realpath(root),
    name,
    packedContents,
    sourceContents: packedContents,
    sourceSha256: packedContents.digest,
    tarball: join(root, 'unused.tgz'),
    tarballSha256: '0'.repeat(64),
  };
}

async function writePackage(
  root: string,
  name: string,
  files: Readonly<Record<string, string>>,
  exports?: Readonly<Record<string, string>>,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify({ exports, name, type: 'module' }, null, 2)}\n`,
  );
  for (const [fileName, source] of Object.entries(files)) {
    const destination = join(root, fileName);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, source);
  }
}
