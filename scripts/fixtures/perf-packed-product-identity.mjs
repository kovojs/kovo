import { createHash } from 'node:crypto';

import { canonicalJson } from '../lib/perf-host.mjs';
import {
  PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA,
  PACKED_KOVO_PRODUCT_WORKLOAD_POLICY,
} from '../lib/perf-packed-kovo-product.mjs';

export { PACKED_KOVO_PRODUCT_WORKLOAD_POLICY };

/** Deterministic, structurally complete packed-product evidence for policy tests. */
export function fixturePackedKovoProductIdentity({ locks, seed = 'fixture', sourceCommit }) {
  const loadedFiles = ['@kovojs/cli/dist/bin.mjs'];
  const artifact = {
    files: 2,
    manifestSha256: digest(`${seed}:manifest`),
    name: '@kovojs/cli',
    packageContentSha256: digest(`${seed}:content`),
    tarballBytes: 128,
    tarballFile: 'kovojs-cli-0.3.0.tgz',
    tarballSha256: digest(`${seed}:tarball`),
    unpackedBytes: 64,
    version: '0.3.0',
  };
  const identity = {
    artifacts: [artifact],
    build: {
      commands: [],
      packages: ['@kovojs/cli'],
      rootFrozenInstall: { argv: ['pnpm', 'install', '--frozen-lockfile'] },
    },
    consumer: {
      frozenInstall: {
        argv: ['pnpm', 'install', '--frozen-lockfile'],
        lockSha256: digest(`${seed}:consumer-lock`),
      },
      lockResolution: { argv: ['pnpm', 'install', '--no-frozen-lockfile'] },
      manifestSha256: digest(`${seed}:consumer-manifest`),
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
      installedBinSha256: digest(`${seed}:bin`),
      name: '@kovojs/cli',
      packageContentSha256: artifact.packageContentSha256,
      tarballSha256: artifact.tarballSha256,
      version: artifact.version,
    },
    resolutionProof: {
      confined: true,
      loadedFileCount: loadedFiles.length,
      loadedFiles,
      normalizedTraceSha256: digest(JSON.stringify(loadedFiles)),
      schema: 'kovo-packed-cli-resolution-proof/v1',
      workspaceSourceLoaded: false,
    },
    schema: PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA,
    source: { commit: sourceCommit, locks },
    typescript: {
      bytes: 64,
      contentSha256: digest(`${seed}:typescript`),
      files: 2,
      name: 'typescript',
      version: '6.0.3',
    },
  };
  return {
    digest: digest(canonicalJson(identity)),
    identity,
    schema: PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA,
  };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
