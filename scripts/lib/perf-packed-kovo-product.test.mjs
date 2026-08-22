import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  canonicalizeTarballBytes,
  validatedPackageTarballEntries,
} from './deterministic-tarball.mjs';
import {
  assertCorpusBinding,
  assertPackedCorpusIsolation,
  createPackedKovoProductFixture,
  materializePackedKovoCommand,
  normalizedPackedKovoCommand,
  verifyPackedKovoProductFixture,
} from './perf-packed-kovo-product.mjs';
import { canonicalJson } from './perf-host.mjs';
import { generateCorpus } from '../../benchmarks/corpora/generate.mjs';
import { loadCorpusManifest, verifyCorpusSources } from '../../benchmarks/corpora/dev-loop.mjs';

const roots = [];
const lockFiles = [
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { force: true, recursive: true });
});

describe('authenticated packed Kovo product fixture', () => {
  it('normalizes independent temporary roots while binding only the isolated consumer', () => {
    const first = productFixture('first');
    const second = productFixture('second');
    expect(first.fixture.identity).toEqual(second.fixture.identity);
    expect(canonicalJson(first.fixture.identity)).not.toContain(first.root);
    expect(canonicalJson(second.fixture.identity)).not.toContain(second.root);

    const appRoot = path.join(first.root, 'app');
    const manifest = writeMinimalKovoCorpusManifest(appRoot);
    const provenance = first.fixture.bindCorpus(manifest);
    expect(provenance).toEqual({
      bytes: first.sourceLock.byteLength,
      path: 'pnpm-lock.yaml',
      sha256: sha256(first.sourceLock),
      source: 'measured-source-root-lock',
    });
    expect(() => assertCorpusBinding(appRoot, first.consumerRoot)).not.toThrow();
    const verified = verifyPackedKovoProductFixture(
      first.fixture.descriptorPath,
      first.fixture.identity.digest,
      first.source,
    );
    const command = materializePackedKovoCommand(
      { argv: ['./node_modules/.bin/kovo', 'build', './src/app.tsx'], cwd: appRoot, env: {} },
      verified,
      appRoot,
    );
    expect(command.argv).toEqual([
      process.execPath,
      path.join(first.consumerRoot, 'node_modules/@kovojs/cli/dist/bin.mjs'),
      'build',
      './src/app.tsx',
    ]);
    expect(normalizedPackedKovoCommand(command, appRoot)).toEqual({
      argv: [
        'node',
        '<packed-kovo>/node_modules/@kovojs/cli/dist/bin.mjs',
        'build',
        './src/app.tsx',
      ],
      cwd: '.',
      env: {},
      productArtifactDigest: first.fixture.identity.digest,
    });
    first.fixture.cleanup();
    expect(() => assertCorpusBinding(appRoot, first.consumerRoot)).toThrow();
  });

  it('rejects workspace ancestry and binds an externally isolated generated Kovo corpus', async () => {
    const test = productFixture('generated-corpus');
    const benchmarkKovoRoot = path.resolve(
      new URL('../../benchmarks/kovo/', import.meta.url).pathname,
    );
    const outputRoot = mkdtempSync(path.join(benchmarkKovoRoot, '.packed-product-test-'));
    roots.push(outputRoot);
    const workspaceManifest = await generateCorpus({
      framework: 'kovo',
      outDir: outputRoot,
      size: 24,
    });
    expect(() => test.fixture.bindCorpus(workspaceManifest)).toThrow(/outside the repository/u);

    const isolatedRoot = mkdtempSync(path.join(tmpdir(), 'kovo-packed-corpus-isolated-'));
    roots.push(isolatedRoot);
    const manifestPath = await generateCorpus({
      dependencyMode: 'deferred',
      framework: 'kovo',
      outDir: isolatedRoot,
      size: 24,
    });
    const appRoot = path.dirname(manifestPath);
    const manifestBeforeBinding = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(existsSync(path.join(appRoot, 'node_modules'))).toBe(false);
    expect(existsSync(path.join(appRoot, 'pnpm-lock.yaml'))).toBe(false);
    expect(() => assertPackedCorpusIsolation(appRoot)).not.toThrow();
    await expect(
      verifyCorpusSources(await loadCorpusManifest(manifestPath)),
    ).resolves.toBeUndefined();

    const provenance = test.fixture.bindCorpus(manifestPath);
    const boundManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(provenance).toEqual({
      bytes: test.sourceLock.byteLength,
      path: 'pnpm-lock.yaml',
      sha256: sha256(test.sourceLock),
      source: 'measured-source-root-lock',
    });
    expect(readFileSync(path.join(appRoot, 'pnpm-lock.yaml'))).toEqual(test.sourceLock);
    expect(boundManifest.sourceFiles).toHaveLength(manifestBeforeBinding.sourceFiles.length + 1);
    expect(boundManifest.sourceFiles).toContainEqual({
      bytes: test.sourceLock.byteLength,
      file: 'pnpm-lock.yaml',
      sha256: sha256(test.sourceLock),
    });
    expect(boundManifest.sourceDigest).toBe(
      sha256(Buffer.from(JSON.stringify(boundManifest.sourceFiles))),
    );
    expect(() => assertCorpusBinding(appRoot, test.consumerRoot)).not.toThrow();
    // Dependency links remain explicitly outside the authored-source census (SPEC §5.2 rule 9).
    await expect(
      verifyCorpusSources(await loadCorpusManifest(manifestPath)),
    ).resolves.toBeUndefined();
    expect(() =>
      createRequire(path.join(appRoot, 'resolution-proof.mjs')).resolve('@kovojs/test'),
    ).toThrow(/Cannot find module/u);
    test.fixture.cleanup();
    expect(existsSync(path.join(appRoot, 'node_modules'))).toBe(false);
    await expect(
      verifyCorpusSources(await loadCorpusManifest(manifestPath)),
    ).resolves.toBeUndefined();
  });

  it('fails closed before dependency binding on manifest tampering or partial lock enrollment', () => {
    const tampered = productFixture('tampered-corpus-manifest');
    const tamperedRoot = path.join(tampered.root, 'app');
    const tamperedManifestPath = writeMinimalKovoCorpusManifest(tamperedRoot);
    const tamperedManifest = JSON.parse(readFileSync(tamperedManifestPath, 'utf8'));
    tamperedManifest.sourceDigest = sha256('substituted source census');
    writeFileSync(tamperedManifestPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`);
    expect(() => tampered.fixture.bindCorpus(tamperedManifestPath)).toThrow(
      /sourceDigest does not authenticate/u,
    );
    expect(existsSync(path.join(tamperedRoot, 'pnpm-lock.yaml'))).toBe(false);
    expect(existsSync(path.join(tamperedRoot, 'node_modules'))).toBe(false);

    const partial = productFixture('partial-corpus-lock');
    const partialRoot = path.join(partial.root, 'app');
    const partialManifestPath = writeMinimalKovoCorpusManifest(partialRoot);
    writeFileSync(path.join(partialRoot, 'pnpm-lock.yaml'), partial.sourceLock);
    expect(() => partial.fixture.bindCorpus(partialManifestPath)).toThrow(/enrollment is partial/u);
    expect(existsSync(path.join(partialRoot, 'node_modules'))).toBe(false);
  });

  it('rejects fake identities, path substitution, source/lock mismatch, and symlink escapes', () => {
    for (const attack of [
      (test) => rewriteDescriptor(test, (value) => void (value.identity.digest = sha256('fake'))),
      (test) => rewriteDescriptor(test, (value) => void (value.consumerRoot = test.root)),
      (test) => writeFileSync(path.join(test.root, 'tarballs/kovojs-cli-0.3.0.tgz'), 'tampered'),
      (test) => {
        const tarball = path.join(test.root, 'tarballs/kovojs-cli-0.3.0.tgz');
        const outside = path.join(test.root, 'outside.tgz');
        writeFileSync(outside, readFileSync(tarball));
        unlinkSync(tarball);
        symlinkSync(outside, tarball);
      },
    ]) {
      const test = productFixture('attack');
      attack(test);
      expect(() =>
        verifyPackedKovoProductFixture(
          test.fixture.descriptorPath,
          test.fixture.identity.digest,
          test.source,
        ),
      ).toThrow();
    }

    const mismatch = productFixture('source-mismatch');
    expect(() =>
      verifyPackedKovoProductFixture(
        mismatch.fixture.descriptorPath,
        mismatch.fixture.identity.digest,
        { ...mismatch.source, commit: 'b'.repeat(40) },
      ),
    ).toThrow(/source or dependency-lock identity/u);
    expect(() =>
      verifyPackedKovoProductFixture(
        mismatch.fixture.descriptorPath,
        mismatch.fixture.identity.digest,
        {
          ...mismatch.source,
          locks: { ...mismatch.source.locks, 'pnpm-lock.yaml': sha256('different') },
        },
      ),
    ).toThrow(/source or dependency-lock identity/u);
  });

  it('detects installed-byte mutation and refuses source-command or corpus-link confusion', () => {
    const test = productFixture('mutation');
    writeFileSync(
      path.join(test.consumerRoot, 'node_modules/@kovojs/cli/dist/bin.mjs'),
      'tampered\n',
    );
    expect(() =>
      verifyPackedKovoProductFixture(
        test.fixture.descriptorPath,
        test.fixture.identity.digest,
        test.source,
      ),
    ).toThrow(/differs from its authenticated tarball/u);

    const typescriptMutation = productFixture('typescript-mutation');
    writeFileSync(
      path.join(typescriptMutation.consumerRoot, 'node_modules/typescript/typescript.js'),
      'tampered\n',
    );
    expect(() =>
      verifyPackedKovoProductFixture(
        typescriptMutation.fixture.descriptorPath,
        typescriptMutation.fixture.identity.digest,
        typescriptMutation.source,
      ),
    ).toThrow(/installed TypeScript bytes changed/u);

    const clean = productFixture('command');
    const appRoot = path.join(clean.root, 'app');
    const manifest = writeMinimalKovoCorpusManifest(appRoot);
    clean.fixture.bindCorpus(manifest);
    const verified = verifyPackedKovoProductFixture(
      clean.fixture.descriptorPath,
      clean.fixture.identity.digest,
      clean.source,
    );
    expect(() =>
      materializePackedKovoCommand(
        { argv: ['node', 'packages/cli/src/bin.ts', 'build'], cwd: appRoot, env: {} },
        verified,
        appRoot,
      ),
    ).toThrow(/does not target the kovo executable/u);

    unlinkSync(path.join(appRoot, 'node_modules'));
    symlinkSync(path.join(clean.root, 'untrusted'), path.join(appRoot, 'node_modules'));
    mkdirSync(path.join(clean.root, 'untrusted'));
    expect(() => assertCorpusBinding(appRoot, clean.consumerRoot)).toThrow(/outside/u);
  });
});

function productFixture(label) {
  const root = mkdtempSync(path.join(tmpdir(), `kovo-packed-product-${label}-`));
  roots.push(root);
  const consumerRoot = path.join(root, 'consumer');
  const sourceRoot = path.join(root, 'source');
  const tarballRoot = path.join(root, 'tarballs');
  const cliRoot = path.join(consumerRoot, 'node_modules/@kovojs/cli');
  const typescriptRoot = path.join(consumerRoot, 'node_modules/typescript');
  const vitePlusRoot = path.join(consumerRoot, 'node_modules/vite-plus');
  mkdirSync(path.join(cliRoot, 'dist'), { recursive: true });
  mkdirSync(typescriptRoot, { recursive: true });
  mkdirSync(vitePlusRoot, { recursive: true });
  mkdirSync(tarballRoot);
  mkdirSync(sourceRoot);
  const manifestBytes = Buffer.from(
    `${JSON.stringify({ dependencies: { typescript: '6.0.3' }, name: '@kovojs/cli', version: '0.3.0' })}\n`,
  );
  const binBytes = Buffer.from("process.stdout.write('kovo 0.3.0\\n');\n");
  writeFileSync(path.join(cliRoot, 'package.json'), manifestBytes);
  writeFileSync(path.join(cliRoot, 'dist/bin.mjs'), binBytes);
  writeFileSync(
    path.join(typescriptRoot, 'package.json'),
    `${JSON.stringify({ name: 'typescript', version: '6.0.3' })}\n`,
  );
  writeFileSync(path.join(typescriptRoot, 'typescript.js'), 'export const fixture = true;\n');
  writeFileSync(
    path.join(vitePlusRoot, 'package.json'),
    `${JSON.stringify({ name: 'vite-plus', version: '0.1.24' })}\n`,
  );
  const tarballBytes = canonicalizeTarballBytes(
    fixtureTarball([
      { body: manifestBytes, name: 'package/package.json' },
      { body: binBytes, executable: true, name: 'package/dist/bin.mjs' },
    ]),
  );
  const tarballFile = 'kovojs-cli-0.3.0.tgz';
  const tarballPath = path.join(tarballRoot, tarballFile);
  writeFileSync(tarballPath, tarballBytes);
  const entries = validatedPackageTarballEntries(tarballBytes);
  for (const entry of entries) {
    const installed = path.join(cliRoot, entry.name.slice('package/'.length));
    mkdirSync(path.dirname(installed), { recursive: true });
    writeFileSync(installed, entry.data);
  }
  const artifactEvidence = evidence(entries, tarballBytes, tarballFile);
  const consumerManifest = Buffer.from('{}\n');
  const consumerLock = Buffer.from('lockfileVersion: 9.0\n');
  writeFileSync(path.join(consumerRoot, 'package.json'), consumerManifest);
  writeFileSync(path.join(consumerRoot, 'pnpm-lock.yaml'), consumerLock);
  const typescript = dependencyEvidence(typescriptRoot, 'typescript', '6.0.3');
  const prepared = {
    cleanup() {},
    evidence: {
      artifacts: [artifactEvidence],
      build: { commands: [], packages: ['@kovojs/cli'], rootFrozenInstall: { argv: [] } },
      consumer: {
        frozenInstall: { argv: [], lockSha256: sha256(consumerLock) },
        lockResolution: { argv: [] },
        manifestSha256: sha256(consumerManifest),
        packageCensusMatched: 1,
        packageFilesMatched: 2,
        packageManager: 'pnpm@10.12.1',
        pnpmVersion: '10.12.1',
        root: '<isolated-consumer>',
      },
      integrity: {
        artifactAuthenticated: true,
        consumerFrozen: true,
        firstInstallMatchesFrozen: true,
        installedBytesMatchTarballs: true,
        packedResolutionConfined: true,
        workspaceSourceLoaded: false,
      },
      pack: { commands: [] },
      primaryCli: {
        installedBin: 'node_modules/@kovojs/cli/dist/bin.mjs',
        installedBinSha256: sha256(
          entries.find((entry) => entry.name === 'package/dist/bin.mjs').data,
        ),
        name: '@kovojs/cli',
        packageContentSha256: artifactEvidence.packageContentSha256,
        tarballSha256: artifactEvidence.tarballSha256,
        version: '0.3.0',
      },
      resolutionProof: {
        confined: true,
        loadedFileCount: 1,
        loadedFiles: ['@kovojs/cli/dist/bin.mjs'],
        normalizedTraceSha256: sha256(JSON.stringify(['@kovojs/cli/dist/bin.mjs'])),
        schema: 'kovo-packed-cli-resolution-proof/v1',
        traceSha256: sha256(root),
        workspaceSourceLoaded: false,
      },
      typescript,
    },
    internal: {
      consumerRoot,
      installedCli: path.join(cliRoot, 'dist/bin.mjs'),
      runtimeArtifacts: [{ entries, evidence: artifactEvidence, name: '@kovojs/cli', tarballPath }],
      temporaryRoot: root,
    },
  };
  const sourceLock = Buffer.from('lockfileVersion: 9.0\n# measured source lock\n');
  writeFileSync(path.join(sourceRoot, 'pnpm-lock.yaml'), sourceLock);
  const source = {
    commit: 'a'.repeat(40),
    dirty: false,
    dirtyPaths: [],
    locks: Object.fromEntries(
      lockFiles.map((file) => [
        file,
        file === 'pnpm-lock.yaml' ? sha256(sourceLock) : sha256(file),
      ]),
    ),
  };
  const fixture = createPackedKovoProductFixture({
    prepared,
    source,
    sourceAfter: source,
    sourceRoot,
  });
  return { consumerRoot, fixture, root, source, sourceLock, sourceRoot };
}

function writeMinimalKovoCorpusManifest(appRoot) {
  mkdirSync(appRoot, { recursive: true });
  const packageBytes = Buffer.from('{}\n');
  writeFileSync(path.join(appRoot, 'package.json'), packageBytes);
  const sourceFiles = [
    { bytes: packageBytes.byteLength, file: 'package.json', sha256: sha256(packageBytes) },
  ];
  const manifest = {
    framework: 'kovo',
    schema: 'kovo-dev-corpus/v1',
    sourceDigest: sha256(Buffer.from(JSON.stringify(sourceFiles))),
    sourceFiles,
  };
  const manifestPath = path.join(appRoot, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

function rewriteDescriptor(test, mutate) {
  const descriptor = JSON.parse(readFileSync(test.fixture.descriptorPath, 'utf8'));
  mutate(descriptor);
  writeFileSync(test.fixture.descriptorPath, `${canonicalJson(descriptor)}\n`);
}

function evidence(entries, tarballBytes, tarballFile) {
  const manifestEntry = entries.find((entry) => entry.name === 'package/package.json');
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  const content = createHash('sha256');
  let unpackedBytes = 0;
  for (const entry of entries) {
    content.update(entry.name);
    content.update('\0');
    content.update(entry.executable ? 'x' : '-');
    content.update('\0');
    content.update(String(entry.data.byteLength));
    content.update('\0');
    content.update(entry.data);
    unpackedBytes += entry.data.byteLength;
  }
  return {
    files: entries.length,
    manifestSha256: sha256(manifestEntry.data),
    name: manifest.name,
    packageContentSha256: `sha256:${content.digest('hex')}`,
    tarballBytes: tarballBytes.byteLength,
    tarballFile,
    tarballSha256: sha256(tarballBytes),
    unpackedBytes,
    version: manifest.version,
  };
}

function dependencyEvidence(root, name, version) {
  const files = ['package.json', 'typescript.js'];
  const content = createHash('sha256');
  let bytes = 0;
  for (const file of files) {
    const data = readFileSync(path.join(root, file));
    content.update(file);
    content.update('\0');
    content.update(String(data.byteLength));
    content.update('\0');
    content.update(data);
    bytes += data.byteLength;
  }
  return { bytes, contentSha256: `sha256:${content.digest('hex')}`, files: 2, name, version };
}

function fixtureTarball(entries) {
  const blocks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    writeOctal(header, 100, 108, entry.executable ? 0o755 : 0o644);
    writeOctal(header, 108, 116, 501);
    writeOctal(header, 116, 124, 501);
    writeOctal(header, 124, 136, entry.body.byteLength);
    writeOctal(header, 136, 148, 123);
    header.fill(0x20, 148, 156);
    header[156] = '0'.charCodeAt(0);
    Buffer.from('ustar\0').copy(header, 257);
    Buffer.from('00').copy(header, 263);
    const checksum = header
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, '0');
    header.write(checksum, 148, 6, 'ascii');
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(
      header,
      entry.body,
      Buffer.alloc(Math.ceil(entry.body.byteLength / 512) * 512 - entry.body.byteLength),
    );
  }
  blocks.push(Buffer.alloc(1024));
  const compressed = gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
  compressed[9] = 255;
  return compressed;
}

function writeOctal(header, start, end, value) {
  header.write(value.toString(8).padStart(end - start - 1, '0'), start, end - start - 1, 'ascii');
  header[end - 1] = 0;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
