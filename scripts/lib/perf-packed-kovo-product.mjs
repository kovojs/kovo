import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
export const PACKED_KOVO_PRODUCT_WORKLOAD_POLICY_SCHEMA = 'kovo-packed-product-workload-policy/v1';

export const PACKED_KOVO_PRODUCT_WORKLOAD_POLICY = Object.freeze({
  concreteIdentity: 'report-bound',
  corpusIsolation: 'external-root-without-ancestor-node-modules',
  kovo: 'required',
  nextjs: 'forbidden',
  preparationTiming: 'before-quiet-host-admission-and-outside-samples',
  schema: PACKED_KOVO_PRODUCT_WORKLOAD_POLICY_SCHEMA,
});

const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const DESCRIPTOR_FILE = '.kovo-perf-packed-product.json';
const PRODUCT_CLI_ENTRY = 'node_modules/@kovojs/cli/dist/bin.mjs';
const CORPUS_SCHEMA = 'kovo-dev-corpus/v1';
const ARTIFACT_PROVENANCE_LOCK = 'pnpm-lock.yaml';
const MAX_DESCRIPTOR_BYTES = 4 * 1024 * 1024;
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
let corpusManifestReseal = 0;

/**
 * Seal the path-bearing result of the shared packed-CLI preparation for dev/build adapters.
 *
 * The returned identity is deliberately path-independent. Temporary roots are execution
 * capabilities stored only in the private descriptor, so two clean preparations of the same
 * commit, locks, tarballs, frozen consumer, and installed bytes have the same workload identity.
 */
export function createPackedKovoProductFixture({
  prepared,
  source,
  sourceAfter,
  sourceRoot = workspaceRoot,
}) {
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
      assertPackedCorpusIsolation(appRoot);
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
        const provenance = bindPackedKovoCorpusArtifactProvenanceLock({
          expectedSha256: source.locks[ARTIFACT_PROVENANCE_LOCK],
          manifestPath,
          sourceRoot,
        });
        bindings.add(appRoot);
        return provenance;
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

/**
 * Give one externally isolated packed-product corpus an app-local copy of the exact measured
 * source lock, then authenticate that copy through the corpus manifest. Kovo build deliberately
 * requires the nearest pnpm lock for artifact provenance (SPEC §5.2.3); an external corpus cannot
 * inherit the repository lock through filesystem ancestry.
 */
export function bindPackedKovoCorpusArtifactProvenanceLock({
  expectedSha256,
  manifestPath,
  sourceRoot,
}) {
  if (!validSha256(expectedSha256)) {
    throw new TypeError('expected source artifact-provenance lock digest is invalid');
  }
  const measuredSourceRoot = canonicalDirectory(sourceRoot, 'measured source root');
  const resolvedManifest = path.resolve(requiredString(manifestPath, 'corpus manifest'));
  const corpusRoot = canonicalDirectory(path.dirname(resolvedManifest), 'external corpus root');
  const manifestMetadata = lstatSync(resolvedManifest);
  if (
    !manifestMetadata.isFile() ||
    manifestMetadata.isSymbolicLink() ||
    manifestMetadata.nlink !== 1 ||
    path.dirname(realpathSync(resolvedManifest)) !== corpusRoot
  ) {
    throw new Error(
      'external corpus manifest must be a single-link regular file inside its canonical parent',
    );
  }

  const sourceLock = path.join(measuredSourceRoot, ARTIFACT_PROVENANCE_LOCK);
  const sourceMetadata = lstatSync(sourceLock);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink() || sourceMetadata.nlink !== 1) {
    throw new Error('measured source pnpm lock must be a single-link regular non-symlink file');
  }
  const lockBytes = readFileSync(sourceLock);
  const lockSha256 = sha256(lockBytes);
  if (lockSha256 !== expectedSha256) {
    throw new Error('measured source pnpm lock differs from authenticated source provenance');
  }

  const manifestBytes = readFileSync(resolvedManifest);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest?.schema !== CORPUS_SCHEMA || manifest.framework !== 'kovo') {
    throw new Error('packed product binding requires one generated Kovo corpus manifest');
  }
  authenticateCorpusSourceFiles(corpusRoot, manifest);

  const targetLock = path.join(corpusRoot, ARTIFACT_PROVENANCE_LOCK);
  const enrolledEntries = manifest.sourceFiles.filter(
    (entry) => entry.file === ARTIFACT_PROVENANCE_LOCK,
  );
  const targetExists = existsSync(targetLock);
  if (targetExists || enrolledEntries.length > 0) {
    if (!targetExists || enrolledEntries.length !== 1) {
      throw new Error('external corpus artifact-provenance lock enrollment is partial');
    }
    const targetMetadata = lstatSync(targetLock);
    const expectedEvidence = artifactProvenanceLockEvidence(lockBytes, lockSha256);
    if (
      !targetMetadata.isFile() ||
      targetMetadata.isSymbolicLink() ||
      targetMetadata.nlink !== 1 ||
      canonicalJson(enrolledEntries[0]) !== canonicalJson(expectedEvidence) ||
      !readFileSync(targetLock).equals(lockBytes)
    ) {
      throw new Error(
        'external corpus artifact-provenance lock differs from authenticated source provenance',
      );
    }
    return normalizedArtifactProvenanceLockEvidence(lockBytes, lockSha256);
  }

  const lockEvidence = artifactProvenanceLockEvidence(lockBytes, lockSha256);
  const resealedManifest = {
    ...manifest,
    sourceFiles: [...manifest.sourceFiles, lockEvidence].sort((left, right) =>
      bytewise(left.file, right.file),
    ),
  };
  resealedManifest.sourceDigest = sha256(Buffer.from(JSON.stringify(resealedManifest.sourceFiles)));
  const resealedManifestBytes = Buffer.from(`${JSON.stringify(resealedManifest, null, 2)}\n`);
  const resealPath = corpusManifestResealPath(corpusRoot, resolvedManifest);
  let targetCreated = false;
  let resealCreated = false;
  let manifestReplaced = false;
  try {
    writeFileSync(targetLock, lockBytes, { flag: 'wx', mode: 0o600 });
    targetCreated = true;
    writeFileSync(resealPath, resealedManifestBytes, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    resealCreated = true;
    renameSync(resealPath, resolvedManifest);
    resealCreated = false;
    manifestReplaced = true;
    const observedManifest = JSON.parse(readFileSync(resolvedManifest, 'utf8'));
    authenticateCorpusSourceFiles(corpusRoot, observedManifest);
    if (!readFileSync(resolvedManifest).equals(resealedManifestBytes)) {
      throw new Error('resealed external corpus manifest bytes are not canonical');
    }
  } catch (error) {
    const rollbackErrors = rollbackCorpusProvenanceEnrollment({
      corpusRoot,
      manifestBytes,
      manifestPath: resolvedManifest,
      manifestReplaced,
      resealCreated,
      resealPath,
      targetCreated,
      targetLock,
    });
    if (rollbackErrors.length > 0) {
      throw new Error(
        `${errorMessage(error)}; corpus provenance enrollment rollback failed: ${rollbackErrors.join(
          '; ',
        )}`,
      );
    }
    throw error;
  }

  return normalizedArtifactProvenanceLockEvidence(lockBytes, lockSha256);
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

/**
 * The measured app must not have the repository's workspace install anywhere in its Node ancestor
 * search chain. An app-local consumer link alone is insufficient: Node continues walking parents
 * whenever one dependency is absent, which can silently turn a packed-product lane back into a
 * source-checkout lane.
 */
export function assertPackedCorpusIsolation(appRootValue) {
  const appRoot = realpathSync(path.resolve(requiredString(appRootValue, 'packed corpus root')));
  const relativeToWorkspace = path.relative(realpathSync(workspaceRoot), appRoot);
  if (
    relativeToWorkspace === '' ||
    (!relativeToWorkspace.startsWith(`..${path.sep}`) &&
      relativeToWorkspace !== '..' &&
      !path.isAbsolute(relativeToWorkspace))
  ) {
    throw new Error('packed Kovo corpus must execute outside the repository workspace');
  }
  let ancestor = path.dirname(appRoot);
  while (true) {
    const dependencyRoot = path.join(ancestor, 'node_modules');
    if (existsSync(dependencyRoot)) {
      throw new Error(
        `packed Kovo corpus ancestor dependency root is not isolated: ${dependencyRoot}`,
      );
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return appRoot;
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
  assertPackedCorpusIsolation(appRoot);
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

export function packedKovoProductWorkloadPolicyFindings(value) {
  return canonicalJson(value) === canonicalJson(PACKED_KOVO_PRODUCT_WORKLOAD_POLICY)
    ? []
    : ['packed product workload policy is incomplete'];
}

/** Independently validate report-bound packed evidence at budget/publication boundaries. */
export function packedComparisonProductEvidenceFindings(
  report,
  label = 'report',
  { required = false } = {},
) {
  const findings = [];
  const prefix = label.length === 0 ? '' : `${label} `;
  const identity = report?.workloadIdentity?.identity;
  const declared = Array.isArray(identity?.cells)
    ? identity.cells.some((cell) => cell === 'dev' || cell === 'build')
    : false;
  if (!required && !declared) return findings;
  if (!declared) findings.push(`${prefix}workload does not select packed-product measurement`);
  findings.push(
    ...packedKovoProductWorkloadPolicyFindings(identity?.productArtifactPolicy).map(
      (finding) => `${prefix}${finding}`,
    ),
  );
  const source = report?.source;
  findings.push(
    ...packedKovoProductIdentityFindings(report?.productArtifact, source).map(
      (finding) => `${prefix}${finding}`,
    ),
  );
  const expected = report?.productArtifact;
  const cells = Array.isArray(report?.rawCells)
    ? report.rawCells.filter((cell) => cell?.cell === 'dev' || cell?.cell === 'build')
    : [];
  if (cells.length === 0) findings.push(`${prefix}packed product raw cell census is unavailable`);
  for (const framework of ['kovo', 'nextjs']) {
    if (!cells.some((cell) => cell?.framework === framework)) {
      findings.push(`${prefix}packed product ${framework} raw cell evidence is unavailable`);
    }
  }
  for (const cell of cells) {
    const cellLabel = `${prefix}${cell?.lane ?? 'unknown'}/${cell?.framework ?? 'unknown'}/${
      cell?.mode ?? cell?.cell ?? 'unknown'
    }`;
    const integrity = cell?.report?.integrity?.productArtifact;
    if (cell?.framework === 'kovo') {
      if (
        canonicalJson(cell?.report?.productArtifact) !== canonicalJson(expected) ||
        canonicalJson(integrity) !==
          canonicalJson({ afterVerified: true, beforeVerified: true, required: true })
      ) {
        findings.push(`${cellLabel} packed product evidence is incomplete`);
      }
    } else if (cell?.framework === 'nextjs') {
      if (
        cell?.report?.productArtifact !== null ||
        canonicalJson(integrity) !==
          canonicalJson({ afterVerified: true, beforeVerified: false, required: false })
      ) {
        findings.push(`${cellLabel} carried Kovo product evidence`);
      }
    } else {
      findings.push(`${cellLabel} has an unknown entrant identity`);
    }
  }
  return [...new Set(findings)];
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

function canonicalDirectory(value, label) {
  const absolute = path.resolve(requiredString(value, label));
  const metadata = lstatSync(absolute);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
  return realpathSync(absolute);
}

function authenticateCorpusSourceFiles(corpusRoot, manifest) {
  if (!Array.isArray(manifest?.sourceFiles) || manifest.sourceFiles.length === 0) {
    throw new Error('external corpus sourceFiles are absent');
  }
  let prior = '';
  const observed = [];
  for (const entry of manifest.sourceFiles) {
    if (
      canonicalJson(Object.keys(entry ?? {}).sort()) !== canonicalJson(['bytes', 'file', 'sha256'])
    ) {
      throw new Error('external corpus sourceFiles entry has an unexpected shape');
    }
    const file = confinedCorpusSourcePath(corpusRoot, entry.file);
    if (entry.file <= prior) {
      throw new Error('external corpus sourceFiles must be unique and sorted');
    }
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !validSha256(entry.sha256)) {
      throw new Error(`external corpus source evidence is invalid for ${entry.file}`);
    }
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new Error(`external corpus source ${entry.file} is not a single-link regular file`);
    }
    const bytes = readFileSync(file);
    const evidence = { bytes: bytes.byteLength, file: entry.file, sha256: sha256(bytes) };
    if (canonicalJson(evidence) !== canonicalJson(entry)) {
      throw new Error(`external corpus source integrity mismatch for ${entry.file}`);
    }
    observed.push(evidence);
    prior = entry.file;
  }
  if (
    !validSha256(manifest.sourceDigest) ||
    manifest.sourceDigest !== sha256(Buffer.from(JSON.stringify(observed)))
  ) {
    throw new Error('external corpus sourceDigest does not authenticate current source bytes');
  }
}

function confinedCorpusSourcePath(corpusRoot, value) {
  const relative = requiredString(value, 'external corpus source path');
  const parts = relative.split('/');
  if (
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`external corpus source path is unsafe: ${relative}`);
  }
  const resolved = path.resolve(corpusRoot, ...parts);
  const confined = path.relative(corpusRoot, resolved);
  if (
    confined === '' ||
    confined === '..' ||
    confined.startsWith(`..${path.sep}`) ||
    path.isAbsolute(confined)
  ) {
    throw new Error(`external corpus source path escaped its root: ${relative}`);
  }
  return resolved;
}

function artifactProvenanceLockEvidence(lockBytes, lockSha256) {
  return {
    bytes: lockBytes.byteLength,
    file: ARTIFACT_PROVENANCE_LOCK,
    sha256: lockSha256,
  };
}

function normalizedArtifactProvenanceLockEvidence(lockBytes, lockSha256) {
  return {
    bytes: lockBytes.byteLength,
    path: ARTIFACT_PROVENANCE_LOCK,
    sha256: lockSha256,
    source: 'measured-source-root-lock',
  };
}

function corpusManifestResealPath(corpusRoot, manifestPath) {
  corpusManifestReseal += 1;
  return path.join(
    corpusRoot,
    `.${path.basename(manifestPath)}.provenance-${String(process.pid)}-${String(
      corpusManifestReseal,
    )}`,
  );
}

function rollbackCorpusProvenanceEnrollment({
  manifestBytes,
  manifestPath,
  manifestReplaced,
  resealCreated,
  resealPath,
  targetCreated,
  targetLock,
}) {
  const errors = [];
  if (resealCreated) {
    try {
      unlinkSync(resealPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') errors.push(errorMessage(error));
    }
  }
  if (manifestReplaced) {
    try {
      writeFileSync(resealPath, manifestBytes, { flag: 'wx', mode: 0o600 });
      renameSync(resealPath, manifestPath);
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
  if (targetCreated && (!manifestReplaced || errors.length === 0)) {
    try {
      unlinkSync(targetLock);
    } catch (error) {
      if (error?.code !== 'ENOENT') errors.push(errorMessage(error));
    }
  }
  return errors;
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
