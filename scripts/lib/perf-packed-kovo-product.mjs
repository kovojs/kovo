import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { canonicalJson } from './perf-host.mjs';
import {
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from './deterministic-tarball.mjs';
import {
  assertInstalledPackedPackages,
  installedDependencySnapshot,
} from '../perf-cli-startup-benchmark.mjs';

export const PACKED_KOVO_PRODUCT_DESCRIPTOR_SCHEMA = 'kovo-packed-product-descriptor/v1';
export const PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA = 'kovo-packed-product-identity/v1';

const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const DESCRIPTOR_FILE = '.kovo-perf-packed-product.json';
const PRODUCT_CLI_ENTRY = 'node_modules/@kovojs/cli/dist/bin.mjs';
const MAX_DESCRIPTOR_BYTES = 4 * 1024 * 1024;

/**
 * Seal the path-bearing result of the shared packed-CLI preparation for dev/build adapters.
 *
 * The returned identity is deliberately path-independent. Temporary roots are execution
 * capabilities stored only in the private descriptor, so two clean preparations of the same
 * commit, locks, tarballs, frozen consumer, and installed bytes have the same workload identity.
 */
export function createPackedKovoProductFixture({ prepared, source, sourceAfter }) {
  assertPreparedBoundary(prepared);
  assertExactCleanSource(source, 'packed product source');
  assertExactCleanSource(sourceAfter, 'packed product post-prepare source');
  if (!sameSourceState(source, sourceAfter)) {
    throw new Error('packed product preparation changed source or dependency-lock provenance');
  }

  const internal = prepared.internal;
  const consumerRoot = path.resolve(requiredString(internal.consumerRoot, 'consumer root'));
  const temporaryRoot = path.resolve(requiredString(internal.temporaryRoot, 'temporary root'));
  if (consumerRoot !== path.join(temporaryRoot, 'consumer')) {
    throw new Error('packed product consumer root is not the fixed preparation child');
  }
  assertNonSymlinkDirectory(temporaryRoot, 'packed product temporary root');
  assertNonSymlinkDirectory(consumerRoot, 'packed product consumer root');
  if (
    realpathSync(path.join(consumerRoot, ...PRODUCT_CLI_ENTRY.split('/'))) !==
    realpathSync(requiredString(internal.installedCli, 'installed CLI'))
  ) {
    throw new Error('packed product preparation substituted its installed CLI entry');
  }

  const evidenceArtifacts = [...prepared.evidence.artifacts].sort((left, right) =>
    bytewise(left.name, right.name),
  );
  const artifacts = internal.runtimeArtifacts
    .map((artifact) => ({
      evidence: artifact.evidence,
      name: artifact.name,
      tarballFile: path.basename(artifact.tarballPath),
    }))
    .sort((left, right) => bytewise(left.name, right.name));
  if (
    artifacts.length === 0 ||
    artifacts.some(
      (artifact, index) =>
        artifact.name !== evidenceArtifacts[index]?.name ||
        canonicalJson(artifact.evidence) !== canonicalJson(evidenceArtifacts[index]),
    )
  ) {
    throw new Error('packed product runtime artifacts differ from preparation evidence');
  }

  const normalized = {
    artifacts: evidenceArtifacts,
    build: prepared.evidence.build,
    consumer: prepared.evidence.consumer,
    integrity: prepared.evidence.integrity,
    pack: prepared.evidence.pack,
    primaryCli: prepared.evidence.primaryCli,
    resolutionProof: normalizedResolutionProof(prepared.evidence.resolutionProof),
    schema: PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA,
    source: {
      commit: source.commit,
      locks: Object.fromEntries(LOCK_FILES.map((file) => [file, source.locks[file]])),
    },
    typescript: prepared.evidence.typescript,
  };
  const identity = {
    digest: sha256(Buffer.from(canonicalJson(normalized))),
    identity: normalized,
    schema: PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA,
  };
  const descriptor = {
    artifacts,
    consumerRoot,
    identity,
    schema: PACKED_KOVO_PRODUCT_DESCRIPTOR_SCHEMA,
    temporaryRoot,
  };
  const descriptorPath = path.join(consumerRoot, DESCRIPTOR_FILE);
  writeFileSync(descriptorPath, `${canonicalJson(descriptor)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });

  // Authenticate the serialized descriptor, the installed tree, and its exact CLI entry before
  // exposing it to a corpus. This is also the same verifier each adapter runs before and after.
  verifyPackedKovoProductFixture(descriptorPath, identity.digest, source);
  const bindings = new Set();
  let cleaned = false;
  return {
    bindCorpus(manifestPath) {
      if (cleaned) throw new Error('packed product fixture is already cleaned');
      const appRoot = path.dirname(path.resolve(manifestPath));
      const link = path.join(appRoot, 'node_modules');
      let current;
      try {
        current = lstatSync(link);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (current !== undefined) {
        throw new Error(`packed product corpus dependency path already exists: ${link}`);
      }
      try {
        symlinkSync(path.join(consumerRoot, 'node_modules'), link, 'dir');
        assertCorpusBinding(appRoot, consumerRoot);
        bindings.add(appRoot);
      } catch (error) {
        try {
          if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
        } catch (cleanupError) {
          if (cleanupError?.code !== 'ENOENT') {
            throw new Error(
              `${errorMessage(error)}; packed product binding rollback failed: ${errorMessage(
                cleanupError,
              )}`,
            );
          }
        }
        throw error;
      }
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      const errors = [];
      for (const appRoot of [...bindings].reverse()) {
        const link = path.join(appRoot, 'node_modules');
        try {
          const stat = lstatSync(link);
          if (!stat.isSymbolicLink()) {
            throw new Error(`owned packed product binding became a non-symlink: ${link}`);
          }
          unlinkSync(link);
        } catch (error) {
          if (error?.code !== 'ENOENT') errors.push(errorMessage(error));
        }
      }
      try {
        prepared.cleanup();
      } catch (error) {
        errors.push(errorMessage(error));
      }
      if (errors.length > 0) throw new Error(`packed product cleanup failed: ${errors.join('; ')}`);
    },
    descriptorPath,
    identity,
  };
}

/** Re-authenticate one descriptor and every package byte it names. */
export function verifyPackedKovoProductFixture(descriptorPathValue, expectedDigest, source) {
  const descriptorPath = path.resolve(
    requiredString(descriptorPathValue, 'packed product descriptor'),
  );
  const descriptorStat = lstatSync(descriptorPath);
  if (!descriptorStat.isFile() || descriptorStat.isSymbolicLink()) {
    throw new Error('packed product descriptor must be a regular non-symlink file');
  }
  if (descriptorStat.size <= 0 || descriptorStat.size > MAX_DESCRIPTOR_BYTES) {
    throw new Error('packed product descriptor is empty or exceeds its evidence bound');
  }
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  if (
    descriptor?.schema !== PACKED_KOVO_PRODUCT_DESCRIPTOR_SCHEMA ||
    canonicalJson(Object.keys(descriptor).sort()) !==
      canonicalJson(['artifacts', 'consumerRoot', 'identity', 'schema', 'temporaryRoot'])
  ) {
    throw new Error('packed product descriptor schema is invalid');
  }
  const temporaryRoot = path.resolve(requiredString(descriptor.temporaryRoot, 'temporary root'));
  const consumerRoot = path.resolve(requiredString(descriptor.consumerRoot, 'consumer root'));
  if (
    consumerRoot !== path.join(temporaryRoot, 'consumer') ||
    descriptorPath !== path.join(consumerRoot, DESCRIPTOR_FILE)
  ) {
    throw new Error('packed product descriptor path or consumer root was substituted');
  }
  assertNonSymlinkDirectory(temporaryRoot, 'packed product temporary root');
  assertNonSymlinkDirectory(consumerRoot, 'packed product consumer root');
  assertContainedRealPath(temporaryRoot, consumerRoot, 'packed product consumer');

  const identity = validateProductIdentity(descriptor.identity, expectedDigest, source);
  const evidenceArtifacts = identity.identity.artifacts;
  const tarballRoot = path.join(temporaryRoot, 'tarballs');
  assertNonSymlinkDirectory(tarballRoot, 'packed product tarball root');
  assertContainedRealPath(temporaryRoot, tarballRoot, 'packed product tarball root');
  if (
    !Array.isArray(descriptor.artifacts) ||
    descriptor.artifacts.length !== evidenceArtifacts.length
  ) {
    throw new Error('packed product descriptor artifact census is incomplete');
  }
  const runtimeArtifacts = descriptor.artifacts.map((descriptorArtifact, index) => {
    const expected = evidenceArtifacts[index];
    if (
      canonicalJson(Object.keys(descriptorArtifact ?? {}).sort()) !==
        canonicalJson(['evidence', 'name', 'tarballFile']) ||
      descriptorArtifact?.name !== expected?.name ||
      descriptorArtifact?.tarballFile !== expected?.tarballFile ||
      canonicalJson(descriptorArtifact?.evidence) !== canonicalJson(expected)
    ) {
      throw new Error('packed product descriptor artifact identity was substituted');
    }
    const tarballPath = path.join(tarballRoot, expected.tarballFile);
    if (path.basename(tarballPath) !== expected.tarballFile) {
      throw new Error('packed product tarball filename is not canonical');
    }
    const tarballBytes = readPackageTarballSnapshot(tarballPath);
    const entries = validatedPackageTarballEntries(tarballBytes);
    const observed = packedArtifactEvidence(entries, tarballBytes, expected.tarballFile);
    if (canonicalJson(observed) !== canonicalJson(expected)) {
      throw new Error(`${expected.name}: packed tarball bytes differ from sealed preparation`);
    }
    return { entries, name: expected.name };
  });

  const consumerManifest = path.join(consumerRoot, 'package.json');
  const consumerLock = path.join(consumerRoot, 'pnpm-lock.yaml');
  if (sha256(readFileSync(consumerManifest)) !== identity.identity.consumer.manifestSha256) {
    throw new Error('packed product consumer manifest changed after preparation');
  }
  if (sha256(readFileSync(consumerLock)) !== identity.identity.consumer.frozenInstall.lockSha256) {
    throw new Error('packed product frozen consumer lock changed after preparation');
  }
  const installation = assertInstalledPackedPackages(consumerRoot, runtimeArtifacts);
  if (
    installation.packageCensusMatched !== identity.identity.consumer.packageCensusMatched ||
    installation.packageFilesMatched !== identity.identity.consumer.packageFilesMatched ||
    installation.installedCliSha256 !== identity.identity.primaryCli.installedBinSha256
  ) {
    throw new Error('packed product installed package census changed after preparation');
  }
  const typescript = installedDependencySnapshot(consumerRoot, 'typescript');
  if (canonicalJson(typescript) !== canonicalJson(identity.identity.typescript)) {
    throw new Error('packed product installed TypeScript bytes changed after preparation');
  }
  const cliEntry = path.join(consumerRoot, ...PRODUCT_CLI_ENTRY.split('/'));
  if (realpathSync(cliEntry) !== installation.installedCli) {
    throw new Error('packed product CLI dist entry was substituted');
  }
  const consumerDependencyRoot = path.join(consumerRoot, 'node_modules');
  const cliPackageRoot = path.dirname(path.dirname(installation.installedCli));
  const dependencyRoot = path.dirname(path.dirname(cliPackageRoot));
  if (path.basename(dependencyRoot) !== 'node_modules') {
    throw new Error('packed product CLI does not have a canonical dependency scope');
  }
  assertContainedOrEqualRealPath(
    consumerDependencyRoot,
    dependencyRoot,
    'packed product CLI dependency scope',
  );
  for (const packageName of ['@kovojs/cli', 'vite-plus']) {
    const manifestPath = path.join(dependencyRoot, ...packageName.split('/'), 'package.json');
    assertContainedRealPath(
      consumerDependencyRoot,
      manifestPath,
      `packed product ${packageName} manifest`,
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== packageName || typeof manifest.version !== 'string') {
      throw new Error(`packed product ${packageName} manifest identity is invalid`);
    }
  }
  return {
    cliEntry,
    consumerDependencyRoot,
    consumerRoot,
    dependencyRoot,
    identity,
  };
}

export function materializePackedKovoCommand(command, fixture, appRoot) {
  if (
    !fixture ||
    fixture.identity?.schema !== PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA ||
    typeof fixture.cliEntry !== 'string' ||
    typeof fixture.consumerDependencyRoot !== 'string' ||
    typeof fixture.dependencyRoot !== 'string'
  ) {
    throw new TypeError('authenticated packed product fixture is required');
  }
  if (!Array.isArray(command?.argv) || command.argv.length === 0) {
    throw new TypeError('declared Kovo command is unavailable');
  }
  const declaredExecutable = path.resolve(command.cwd, command.argv[0]);
  if (path.basename(declaredExecutable) !== 'kovo') {
    throw new TypeError('declared Kovo command does not target the kovo executable');
  }
  assertCorpusBinding(appRoot, fixture.consumerRoot);
  return {
    ...command,
    argv: [process.execPath, fixture.cliEntry, ...command.argv.slice(1)],
    packedProduct: {
      cliEntry: fixture.cliEntry,
      consumerDependencyRoot: fixture.consumerDependencyRoot,
      dependencyRoot: fixture.dependencyRoot,
      identity: fixture.identity,
    },
  };
}

export function normalizedPackedKovoCommand(command, appRoot) {
  if (command?.packedProduct === undefined) {
    return {
      argv: command.argv,
      cwd: path.relative(appRoot, command.cwd) || '.',
      env: command.env,
    };
  }
  return {
    argv: ['node', '<packed-kovo>/node_modules/@kovojs/cli/dist/bin.mjs', ...command.argv.slice(2)],
    cwd: path.relative(appRoot, command.cwd) || '.',
    env: command.env,
    productArtifactDigest: command.packedProduct.identity.digest,
  };
}

export function assertCorpusBinding(appRoot, consumerRoot) {
  const link = path.join(appRoot, 'node_modules');
  const stat = lstatSync(link);
  if (!stat.isSymbolicLink()) {
    throw new Error('packed Kovo corpus node_modules must be an app-local symlink');
  }
  const expected = realpathSync(path.join(consumerRoot, 'node_modules'));
  if (realpathSync(link) !== expected) {
    throw new Error('packed Kovo corpus node_modules resolves outside the authenticated consumer');
  }
}

export function packedKovoProductIdentityFindings(value, source = null) {
  const findings = [];
  if (
    value?.schema !== PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA ||
    value?.identity?.schema !== PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA ||
    !validSha256(value?.digest) ||
    canonicalJson(Object.keys(value ?? {}).sort()) !==
      canonicalJson(['digest', 'identity', 'schema'])
  ) {
    return ['packed product identity is malformed'];
  }
  if (value.digest !== sha256(Buffer.from(canonicalJson(value.identity)))) {
    findings.push('packed product identity digest is not canonical');
  }
  const identity = value.identity;
  const expectedKeys = [
    'artifacts',
    'build',
    'consumer',
    'integrity',
    'pack',
    'primaryCli',
    'resolutionProof',
    'schema',
    'source',
    'typescript',
  ];
  if (canonicalJson(Object.keys(identity).sort()) !== canonicalJson(expectedKeys)) {
    findings.push('packed product identity field census is not exact');
  }
  if (
    !Array.isArray(identity.artifacts) ||
    identity.artifacts.length === 0 ||
    identity.artifacts.some(
      (artifact, index) =>
        typeof artifact?.name !== 'string' ||
        canonicalJson(Object.keys(artifact ?? {}).sort()) !==
          canonicalJson([
            'files',
            'manifestSha256',
            'name',
            'packageContentSha256',
            'tarballBytes',
            'tarballFile',
            'tarballSha256',
            'unpackedBytes',
            'version',
          ]) ||
        path.basename(artifact?.tarballFile ?? '') !== artifact?.tarballFile ||
        !validSha256(artifact?.tarballSha256) ||
        !validSha256(artifact?.packageContentSha256) ||
        (index > 0 && bytewise(identity.artifacts[index - 1].name, artifact.name) >= 0),
    )
  ) {
    findings.push('packed product artifact census is invalid');
  }
  if (
    identity.integrity?.artifactAuthenticated !== true ||
    identity.integrity?.consumerFrozen !== true ||
    identity.integrity?.firstInstallMatchesFrozen !== true ||
    identity.integrity?.installedBytesMatchTarballs !== true ||
    identity.integrity?.packedResolutionConfined !== true ||
    identity.integrity?.workspaceSourceLoaded !== false ||
    identity.consumer?.root !== '<isolated-consumer>' ||
    identity.primaryCli?.installedBin !== PRODUCT_CLI_ENTRY ||
    !validSha256(identity.primaryCli?.installedBinSha256) ||
    !validNormalizedResolutionProof(identity.resolutionProof) ||
    identity.typescript?.name !== 'typescript' ||
    !validSha256(identity.typescript?.contentSha256)
  ) {
    findings.push('packed product preparation integrity is incomplete');
  }
  if (
    !/^[0-9a-f]{40}$/u.test(identity.source?.commit ?? '') ||
    LOCK_FILES.some((file) => !validSha256(identity.source?.locks?.[file])) ||
    Object.keys(identity.source?.locks ?? {})
      .sort()
      .join('\n') !== [...LOCK_FILES].sort().join('\n')
  ) {
    findings.push('packed product source identity is incomplete');
  }
  if (pathBearingIdentityString(identity)) {
    findings.push('packed product normalized identity contains a host-absolute path');
  }
  if (source !== null) {
    try {
      assertExactCleanSource(source, 'adapter source');
      if (
        identity.source.commit !== source.commit ||
        canonicalJson(identity.source.locks) !==
          canonicalJson(Object.fromEntries(LOCK_FILES.map((file) => [file, source.locks[file]])))
      ) {
        findings.push(
          'packed product source or dependency-lock identity does not match the adapter',
        );
      }
    } catch (error) {
      findings.push(errorMessage(error));
    }
  }
  return [...new Set(findings)];
}

function validateProductIdentity(value, expectedDigest, source) {
  const findings = packedKovoProductIdentityFindings(value, source);
  if (findings.length > 0) throw new Error(findings.join('; '));
  if (value.digest !== expectedDigest) {
    throw new Error('packed product identity digest does not match the expected preparation');
  }
  return value;
}

function pathBearingIdentityString(value) {
  if (typeof value === 'string') {
    return path.isAbsolute(value) || /^file:/u.test(value) || /^[A-Za-z]:[\\/]/u.test(value);
  }
  if (Array.isArray(value)) return value.some(pathBearingIdentityString);
  if (value && typeof value === 'object') {
    return Object.values(value).some(pathBearingIdentityString);
  }
  return false;
}

function normalizedResolutionProof(proof) {
  const normalized = {
    confined: proof?.confined,
    loadedFileCount: proof?.loadedFileCount,
    loadedFiles: proof?.loadedFiles,
    normalizedTraceSha256: proof?.normalizedTraceSha256,
    schema: proof?.schema,
    workspaceSourceLoaded: proof?.workspaceSourceLoaded,
  };
  if (!validNormalizedResolutionProof(normalized)) {
    throw new Error('packed product normalized resolution proof is incomplete');
  }
  return normalized;
}

function validNormalizedResolutionProof(proof) {
  if (
    proof?.schema !== 'kovo-packed-cli-resolution-proof/v1' ||
    proof.confined !== true ||
    proof.workspaceSourceLoaded !== false ||
    !Number.isSafeInteger(proof.loadedFileCount) ||
    proof.loadedFileCount < 1 ||
    !Array.isArray(proof.loadedFiles) ||
    proof.loadedFiles.length !== proof.loadedFileCount ||
    proof.loadedFiles.some(
      (file, index) =>
        typeof file !== 'string' ||
        file.length === 0 ||
        path.isAbsolute(file) ||
        file.includes('\\') ||
        file.split('/').some((part) => part === '' || part === '.' || part === '..') ||
        (index > 0 && bytewise(proof.loadedFiles[index - 1], file) >= 0),
    )
  ) {
    return false;
  }
  return proof.normalizedTraceSha256 === sha256(Buffer.from(JSON.stringify(proof.loadedFiles)));
}

function packedArtifactEvidence(entries, tarballBytes, tarballFile) {
  const manifestEntry = entries.find((entry) => entry.name === 'package/package.json');
  if (manifestEntry === undefined) throw new Error('packed product tarball omitted package.json');
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  const packageContentHash = createHash('sha256');
  let unpackedBytes = 0;
  for (const entry of entries) {
    packageContentHash.update(entry.name);
    packageContentHash.update('\0');
    packageContentHash.update(entry.executable ? 'x' : '-');
    packageContentHash.update('\0');
    packageContentHash.update(String(entry.data.byteLength));
    packageContentHash.update('\0');
    packageContentHash.update(entry.data);
    unpackedBytes += entry.data.byteLength;
  }
  return {
    files: entries.length,
    manifestSha256: sha256(manifestEntry.data),
    name: manifest.name,
    packageContentSha256: `sha256:${packageContentHash.digest('hex')}`,
    tarballBytes: tarballBytes.byteLength,
    tarballFile,
    tarballSha256: sha256(tarballBytes),
    unpackedBytes,
    version: manifest.version,
  };
}

function assertPreparedBoundary(prepared) {
  const integrity = prepared?.evidence?.integrity;
  if (
    integrity?.artifactAuthenticated !== true ||
    integrity?.consumerFrozen !== true ||
    integrity?.firstInstallMatchesFrozen !== true ||
    integrity?.installedBytesMatchTarballs !== true ||
    integrity?.packedResolutionConfined !== true ||
    integrity?.workspaceSourceLoaded !== false ||
    !Array.isArray(prepared?.internal?.runtimeArtifacts)
  ) {
    throw new Error('packed CLI preparation evidence is incomplete');
  }
}

function assertExactCleanSource(source, label) {
  if (
    source?.dirty !== false ||
    !/^[0-9a-f]{40}$/u.test(source?.commit ?? '') ||
    source.dirtyPaths?.length !== 0 ||
    LOCK_FILES.some((file) => !validSha256(source?.locks?.[file]))
  ) {
    throw new Error(`${label} must be one clean committed source with exact lock digests`);
  }
}

function sameSourceState(left, right) {
  return (
    left.commit === right.commit &&
    canonicalJson(left.dirtyPaths) === canonicalJson(right.dirtyPaths) &&
    canonicalJson(left.locks) === canonicalJson(right.locks)
  );
}

function assertNonSymlinkDirectory(directory, label) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
}

function assertContainedRealPath(root, candidate, label) {
  const relative = path.relative(realpathSync(root), realpathSync(candidate));
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} resolves outside its authenticated root`);
  }
}

function assertContainedOrEqualRealPath(root, candidate, label) {
  const relative = path.relative(realpathSync(root), realpathSync(candidate));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside its authenticated root`);
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`);
  return value;
}

function validSha256(value) {
  return /^sha256:[0-9a-f]{64}$/u.test(value ?? '');
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function bytewise(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
