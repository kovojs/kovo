#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyKovoCertificateSignature } from './kovo-certificate-signature.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'security/hermetic-proof-stage.json');
const certificatePath = path.join(repoRoot, 'security/kovo-certificate-v1.json');
const workflowPath = path.join(repoRoot, '.github/workflows/ci.yml');
const packagePath = path.join(repoRoot, 'package.json');
const publicPackagesPath = path.join(repoRoot, 'public-packages.json');
const snapshotPath = path.join(repoRoot, 'scripts/pack-security.files.json');
const posturePath = path.join(repoRoot, 'security/framework-public-runtime-export-posture.json');
const doorPosturePath = path.join(repoRoot, 'security/certificate-door-posture.json');
const lexicalAuthorityPath = path.join(repoRoot, 'security/certificate-lexical-authority.json');
const linuxDockerPath = '/usr/bin/docker';
const macSandboxExecPath = '/usr/bin/sandbox-exec';
const linuxNodeImage =
  'docker.io/library/node@sha256:d45d78e7929b46875bbd4e29bea672d5bc48186c6c3588306521c815e78352d6';

const workerPath = 'scripts/hermetic-proof-stage-worker.mjs';
const analysisToolFiles = Object.freeze([
  workerPath,
  'packages/compiler/src/security/capability-closure-model.ts',
  'packages/icons/scripts/icon-plan.mjs',
  'scripts/certificate-module-identity-probe.mjs',
  'scripts/kovo-certificate-format.mjs',
  'scripts/kovo-certificate.mjs',
  'scripts/lib/cli-entry.mjs',
  'scripts/lib/repo-root.mjs',
  'scripts/lib/source-files.mjs',
  'scripts/package-exports.mjs',
  'scripts/public-packages.mjs',
]);
const generationToolFiles = Object.freeze([workerPath, 'scripts/kovo-certificate-format.mjs']);
const signingToolFiles = Object.freeze([workerPath, 'scripts/kovo-certificate-signature.mjs']);
const typescriptRuntimeFiles = Object.freeze(['package.json', 'lib/typescript.js']);

const expectedStageContracts = {
  analysis: {
    childProcess: 'denied',
    name: 'analysis',
    reads: ['sealed production certificate analyzer', 'inert published-artifact subject snapshot'],
    secrets: [],
    writes: ['certificate analysis record'],
  },
  'certificate-generation': {
    childProcess: 'denied',
    name: 'certificate-generation',
    reads: ['sealed production certificate generator', 'certificate analysis record'],
    secrets: [],
    writes: ['unsigned kovo.certificate/v1'],
  },
  signing: {
    childProcess: 'denied',
    name: 'signing',
    reads: [
      'sealed dependency-free Ed25519 certificate signer',
      'unsigned kovo.certificate/v1',
      'signing key',
    ],
    secrets: ['signing key'],
    writes: ['detached kovo.certificate-signature/v1'],
  },
};

export function readHermeticProofManifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export function hermeticProofToolingDigests() {
  return {
    analysis: sourceTreeSha256(analysisToolFiles, { includeTypeScript: true }),
    certificateGeneration: sourceTreeSha256(generationToolFiles),
    orchestrator: sha256(readFileSync(fileURLToPath(import.meta.url))),
    signing: sourceTreeSha256(signingToolFiles),
  };
}

export function validateHermeticProofContract({ manifest, packageJson, workflow }) {
  const findings = [];
  if (manifest?.schema !== 'kovo.hermetic-proof-stage/v1') {
    findings.push('hermetic proof manifest schema must be kovo.hermetic-proof-stage/v1');
  }
  if (manifest?.toolingBinding !== 'kovo-certificate-v1-signed') {
    findings.push(
      'hermetic proof tooling must be bound to kovo.certificate/v1 analysis, generation, and signing',
    );
  }
  const digests = hermeticProofToolingDigests();
  const expectedTooling = {
    analysis: {
      implementation: 'scripts/kovo-certificate.mjs#analyzeKovoCertificate',
      sourceTreeSha256: digests.analysis,
    },
    certificateGeneration: {
      implementation: 'scripts/kovo-certificate-format.mjs#generateKovoCertificateFromAnalysis',
      sourceTreeSha256: digests.certificateGeneration,
    },
    orchestratorSha256: digests.orchestrator,
    signing: {
      implementation: 'scripts/kovo-certificate-signature.mjs#signKovoCertificate',
      sourceTreeSha256: digests.signing,
    },
  };
  if (canonicalJson(manifest?.tooling) !== canonicalJson(expectedTooling)) {
    findings.push('hermetic proof tooling identities differ from the exact sealed source closures');
  }
  const image = manifest?.linuxRunner?.image;
  if (image !== linuxNodeImage) {
    findings.push('Linux proof runner image must equal the exact reviewed sha256 digest');
  }
  if (
    manifest?.linuxRunner?.network !== 'none' ||
    manifest?.linuxRunner?.pull !== 'never' ||
    manifest?.linuxRunner?.readOnlyRoot !== true
  ) {
    findings.push('Linux proof runner must be network=none, pull=never, and read-only');
  }
  const expectedStages = ['analysis', 'certificate-generation', 'signing'];
  if (
    !Array.isArray(manifest?.stages) ||
    JSON.stringify(manifest.stages.map((stage) => stage?.name)) !== JSON.stringify(expectedStages)
  ) {
    findings.push(`hermetic proof stages must be exactly ${expectedStages.join(', ')}`);
  } else {
    for (const stage of manifest.stages) {
      const expected = expectedStageContracts[stage.name];
      if (expected === undefined || canonicalJson(stage) !== canonicalJson(expected)) {
        findings.push(`${String(stage.name)} does not match the exact reviewed stage contract`);
      }
    }
  }
  if (
    packageJson?.scripts?.['check:hermetic-proof-stage'] !== 'node scripts/hermetic-proof-stage.mjs'
  ) {
    findings.push('package.json must expose the exact check:hermetic-proof-stage command');
  }
  if (
    !workflow.includes('name: Hermetic certificate proof stage') ||
    !workflow.includes(String(image))
  ) {
    findings.push(
      'CI must run the hermetic certificate proof stage with the reviewed pinned image',
    );
  }
  if (!workflow.includes('vp install --frozen-lockfile --ignore-scripts')) {
    findings.push('CI must install the proof toolchain without lifecycle scripts');
  }
  if (
    !workflow.includes('name: kovo-package-dist') ||
    !workflow.includes('kovo-package-dist.tgz')
  ) {
    findings.push('CI must supply the published dist subject as an inert cross-job artifact');
  }
  if (
    !/hermetic-proof:[\s\S]{0,500}?needs:\s*(?:publish-readiness|\n\s*-\s*publish-readiness)/u.test(
      workflow,
    )
  ) {
    findings.push('CI hermetic proof job must depend on the separately built publish artifact');
  }
  if (!workflow.includes('vp exec node scripts/hermetic-proof-stage.mjs')) {
    findings.push('CI hermetic proof job must invoke the fixed Node entrypoint directly');
  }
  if (!workflow.includes('- hermetic-proof')) {
    findings.push('CI aggregate check must require the hermetic proof job');
  }
  return findings;
}

export function assertHermeticDockerArgs(args, stage, context) {
  const joined = args.join('\n');
  if (joined.includes('--allow-child-process') || /\b(?:npm|pnpm|yarn|vp)\b/u.test(joined)) {
    throw new Error(`${stage} Docker stage could execute a package lifecycle command`);
  }
  const expected = expectedDockerArgs(stage, context);
  if (JSON.stringify(args) !== JSON.stringify(expected)) {
    throw new Error(`${stage} Docker option and execution vector differs from the exact review`);
  }
}

async function main() {
  const manifest = readHermeticProofManifest();
  const findings = validateHermeticProofContract({
    manifest,
    packageJson: JSON.parse(readFileSync(packagePath, 'utf8')),
    workflow: readFileSync(workflowPath, 'utf8'),
  });
  if (findings.length > 0) {
    throw new Error(`Hermetic proof contract failed:\n  - ${findings.join('\n  - ')}`);
  }

  const root = mkdtempSync(path.join(tmpdir(), 'kovo-hermetic-proof-'));
  const canary = net.createServer((socket) => socket.end('reachable'));
  try {
    const launcher = trustedHostLauncher();
    const paths = prepareStagePaths(root);
    const port = await listen(canary);
    if (process.platform === 'linux') {
      runDockerStages(paths, manifest.linuxRunner.image, port, launcher);
    } else if (process.platform === 'darwin') {
      runMacStages(paths, port, launcher);
    } else {
      throw new Error(`No reviewed hermetic proof runner for ${process.platform}.`);
    }
    verifyOutputs(paths);
    process.stdout.write(
      'hermetic-proof-stage/v1 sandbox=closed proof-tooling=kovo-certificate-v1-signed BOUND OK\n',
    );
  } finally {
    await close(canary);
    rmSync(root, { force: true, recursive: true });
  }
}

function prepareStagePaths(root) {
  const directories = [
    'sealed-analysis',
    'sealed-generation',
    'sealed-signing',
    'subject',
    'analysis',
    'unsigned',
    'signing',
    'signature',
    'app',
  ];
  for (const directory of directories) {
    const fullPath = path.join(root, directory);
    mkdirSync(fullPath, { recursive: true });
    chmodSync(fullPath, 0o700);
  }
  const paths = {
    analysis: path.join(root, 'analysis/analysis.json'),
    appCanary: path.join(root, 'app/node_modules/untrusted-app/canary'),
    key: path.join(root, 'signing/key.pkcs8'),
    repoCanary: path.join(repoRoot, 'package.json'),
    root,
    sealedAnalysis: path.join(root, 'sealed-analysis'),
    sealedGeneration: path.join(root, 'sealed-generation'),
    sealedSigning: path.join(root, 'sealed-signing'),
    signature: path.join(root, 'signature/signature.json'),
    subject: path.join(root, 'subject/subject.json'),
    unsigned: path.join(root, 'unsigned/certificate.json'),
  };
  mkdirSync(path.dirname(paths.appCanary), { recursive: true });
  writeFileSync(paths.appCanary, 'untrusted-app-dependency\n', 'utf8');
  copyToolClosure(paths.sealedAnalysis, analysisToolFiles, { includeTypeScript: true });
  copyToolClosure(paths.sealedGeneration, generationToolFiles);
  copyToolClosure(paths.sealedSigning, signingToolFiles);
  prepareHermeticCertificateSubject(path.dirname(paths.subject));
  const { privateKey } = generateKeyPairSync('ed25519');
  const privateKeyBytes = privateKey.export({ format: 'der', type: 'pkcs8' });
  writeFileSync(paths.key, privateKeyBytes, { mode: 0o600 });
  chmodSync(paths.key, 0o600);
  return paths;
}

export function prepareHermeticCertificateSubject(subjectRoot) {
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const posture = JSON.parse(readFileSync(posturePath, 'utf8'));
  const internalDoorPosture = JSON.parse(readFileSync(doorPosturePath, 'utf8'));
  const lexicalAuthority = JSON.parse(readFileSync(lexicalAuthorityPath, 'utf8'));
  const publicPackages = JSON.parse(readFileSync(publicPackagesPath, 'utf8')).packages;
  const committedCertificate = JSON.parse(readFileSync(certificatePath, 'utf8'));
  const packageNames = new Set(
    committedCertificate.artifacts.map((entry) => entry.path.split('/').slice(0, 2).join('/')),
  );
  const packagesByName = new Map(publicPackages.map((entry) => [entry.name, entry]));
  const packageConfigs = publicPackages
    .filter((entry) => entry.visibility === 'public' && entry.name.startsWith('@kovojs/'))
    .map((entry) => {
      const manifest = JSON.parse(
        readFileSync(path.join(repoRoot, 'packages', entry.dir, 'package.json'), 'utf8'),
      );
      const relativeRoot = `packages/${entry.dir}`;
      copySubjectFile(`packages/${entry.dir}/package.json`, subjectRoot);
      return {
        name: entry.name,
        publishExports: manifest.publishConfig?.exports,
        rootDir: relativeRoot,
      };
    })
    .sort((left, right) => compareStrings(left.name, right.name));

  for (const packageName of [...packageNames].sort(compareStrings)) {
    const entry = packagesByName.get(packageName);
    const files = snapshot?.packages?.[packageName];
    if (entry === undefined || !Array.isArray(files)) {
      throw new Error(`Hermetic certificate subject has no package census for ${packageName}`);
    }
    for (const relativePath of files) {
      if (relativePath === 'package.json') continue;
      copySubjectFile(`packages/${entry.dir}/${canonicalSubjectPath(relativePath)}`, subjectRoot);
    }
  }
  for (const door of internalDoorPosture.doors ?? []) {
    const entry = packagesByName.get(door.packageName);
    if (entry === undefined) {
      throw new Error(
        `Hermetic certificate internal door names unknown package ${door.packageName}`,
      );
    }
    copySubjectFile(`packages/${entry.dir}/${canonicalSubjectPath(door.source)}`, subjectRoot);
  }

  const subject = {
    internalDoorPosture,
    lexicalAuthority,
    packageConfigs,
    posture,
    schema: 'kovo.hermetic-certificate-subject/v1',
    seedPackageNames: ['@kovojs/better-auth', '@kovojs/server'],
    snapshot,
  };
  writeFileSync(path.join(subjectRoot, 'subject.json'), `${JSON.stringify(subject, null, 2)}\n`);
  return subject;
}

function copySubjectFile(relativePath, subjectRoot) {
  const canonical = canonicalSubjectPath(relativePath);
  const source = path.join(repoRoot, canonical);
  const target = path.join(subjectRoot, canonical);
  const resolved = realpathSync(source);
  if (resolved !== path.resolve(source) || !lstatSync(source).isFile()) {
    throw new Error(
      `Hermetic certificate subject source must be a regular non-symlink file: ${canonical}`,
    );
  }
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, 0o400);
}

function canonicalSubjectPath(value) {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value === '..' ||
    value.startsWith('../')
  ) {
    throw new Error(`Hermetic certificate subject path is not canonical: ${String(value)}`);
  }
  return value;
}

function copyToolClosure(targetRoot, files, { includeTypeScript = false } = {}) {
  for (const relativePath of files) copyToolFile(relativePath, targetRoot);
  if (includeTypeScript) {
    const packageRoot = typescriptPackageRoot();
    for (const relativePath of typescriptRuntimeFiles) {
      const source = path.join(packageRoot, relativePath);
      const target = path.join(targetRoot, 'node_modules/typescript', relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(source, target);
      chmodSync(target, 0o400);
    }
  }
}

function copyToolFile(relativePath, targetRoot) {
  const source = path.join(repoRoot, relativePath);
  const target = path.join(targetRoot, relativePath);
  if (realpathSync(source) !== path.resolve(source) || !lstatSync(source).isFile()) {
    throw new Error(`Hermetic proof tool must be a regular non-symlink file: ${relativePath}`);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, 0o400);
}

function runDockerStages(paths, image, port, dockerPath) {
  const context = {
    gid: process.getgid(),
    port,
    root: paths.root,
    uid: process.getuid(),
  };
  const common = [
    `KOVO_HERMETIC_STAGE_ROOT=${paths.root}`,
    'run',
    '--rm',
    '--pull=never',
    '--network=none',
    '--add-host=kovo-network-canary:host-gateway',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
    `--user=${process.getuid()}:${process.getgid()}`,
    '--entrypoint=/usr/local/bin/node',
    `--env=KOVO_HERMETIC_NETWORK_CANARY=kovo-network-canary:${port}`,
  ];
  runDockerStage(
    dockerPath,
    'analysis',
    image,
    common,
    [
      mount(paths.sealedAnalysis, '/sealed', true),
      mount(path.join(paths.root, 'subject'), '/subject', true),
      mount(path.join(paths.root, 'analysis'), '/analysis', false),
    ],
    [
      '/sealed/scripts/hermetic-proof-stage-worker.mjs',
      'analyze',
      '/subject/subject.json',
      '/analysis/analysis.json',
      '/key/key.pkcs8',
      '/app/node_modules/untrusted-app/canary',
    ],
    ['/sealed', '/subject'],
    ['/analysis'],
    context,
  );
  runDockerStage(
    dockerPath,
    'certificate-generation',
    image,
    common,
    [
      mount(paths.sealedGeneration, '/sealed', true),
      mount(path.join(paths.root, 'analysis'), '/analysis', true),
      mount(path.join(paths.root, 'unsigned'), '/unsigned', false),
    ],
    [
      '/sealed/scripts/hermetic-proof-stage-worker.mjs',
      'generate',
      '/analysis/analysis.json',
      '/unsigned/certificate.json',
      '/key/key.pkcs8',
      '/app/node_modules/untrusted-app/canary',
    ],
    ['/sealed', '/analysis'],
    ['/unsigned'],
    context,
  );
  runDockerStage(
    dockerPath,
    'signing',
    image,
    common,
    [
      mount(paths.sealedSigning, '/sealed', true),
      mount(path.join(paths.root, 'unsigned'), '/unsigned', true),
      mount(path.join(paths.root, 'signing'), '/key', true),
      mount(path.join(paths.root, 'signature'), '/signature', false),
    ],
    [
      '/sealed/scripts/hermetic-proof-stage-worker.mjs',
      'sign',
      '/unsigned/certificate.json',
      '/key/key.pkcs8',
      '/signature/signature.json',
      '/repo/package.json',
      '/app/node_modules/untrusted-app/canary',
    ],
    ['/sealed', '/unsigned', '/key'],
    ['/signature'],
    context,
  );
}

function runDockerStage(
  dockerPath,
  stage,
  image,
  common,
  mounts,
  workerArgs,
  reads,
  writes,
  context,
) {
  const args = [
    ...common,
    ...mounts,
    image,
    '--preserve-symlinks',
    '--preserve-symlinks-main',
    '--permission',
    ...permissionFlags(reads, writes),
    ...workerArgs,
  ];
  assertHermeticDockerArgs(args, stage, context);
  execFileSync(dockerPath, args.slice(1), { stdio: 'inherit' });
}

function runMacStages(paths, port, sandboxExecPath) {
  const networkCanary = `127.0.0.1:${port}`;
  runMacStage(
    'analysis',
    paths,
    [
      path.join(paths.sealedAnalysis, workerPath),
      'analyze',
      paths.subject,
      paths.analysis,
      paths.key,
      paths.appCanary,
    ],
    [paths.sealedAnalysis, path.dirname(paths.subject)],
    [path.dirname(paths.analysis)],
    networkCanary,
    sandboxExecPath,
  );
  runMacStage(
    'certificate-generation',
    paths,
    [
      path.join(paths.sealedGeneration, workerPath),
      'generate',
      paths.analysis,
      paths.unsigned,
      paths.key,
      paths.appCanary,
    ],
    [paths.sealedGeneration, path.dirname(paths.analysis)],
    [path.dirname(paths.unsigned)],
    networkCanary,
    sandboxExecPath,
  );
  runMacStage(
    'signing',
    paths,
    [
      path.join(paths.sealedSigning, workerPath),
      'sign',
      paths.unsigned,
      paths.key,
      paths.signature,
      paths.repoCanary,
      paths.appCanary,
    ],
    [paths.sealedSigning, path.dirname(paths.unsigned), path.dirname(paths.key)],
    [path.dirname(paths.signature)],
    networkCanary,
    sandboxExecPath,
  );
}

function runMacStage(stage, paths, workerArgs, reads, writes, networkCanary, sandboxExecPath) {
  if (stage === 'signing' && reads.includes(paths.repoCanary)) {
    throw new Error('signing macOS stage can reach the repository');
  }
  if (stage !== 'signing' && reads.some((entry) => paths.key.startsWith(`${entry}${path.sep}`))) {
    throw new Error(`${stage} macOS stage can reach signing material`);
  }
  if (reads.some((entry) => paths.appCanary.startsWith(`${entry}${path.sep}`))) {
    throw new Error(`${stage} macOS stage can reach the app dependency closure`);
  }
  const args = [
    '-p',
    '(version 1)(allow default)(deny network*)',
    process.execPath,
    '--preserve-symlinks',
    '--preserve-symlinks-main',
    '--permission',
    ...permissionFlags(reads, writes),
    ...workerArgs,
  ];
  if (args.includes('--allow-child-process')) {
    throw new Error(`${stage} macOS stage can execute child processes`);
  }
  execFileSync(sandboxExecPath, args, {
    env: { KOVO_HERMETIC_NETWORK_CANARY: networkCanary },
    stdio: 'inherit',
  });
}

function permissionFlags(reads, writes) {
  return [
    ...reads.map((entry) => `--allow-fs-read=${entry}`),
    ...writes.map((entry) => `--allow-fs-write=${entry}`),
  ];
}

function mount(source, destination, readonly) {
  return `--mount=type=bind,src=${source},dst=${destination}${readonly ? ',readonly' : ''}`;
}

function dockerStageMounts(root, stage) {
  const stageMounts = {
    analysis: [
      mount(path.join(root, 'sealed-analysis'), '/sealed', true),
      mount(path.join(root, 'subject'), '/subject', true),
      mount(path.join(root, 'analysis'), '/analysis', false),
    ],
    'certificate-generation': [
      mount(path.join(root, 'sealed-generation'), '/sealed', true),
      mount(path.join(root, 'analysis'), '/analysis', true),
      mount(path.join(root, 'unsigned'), '/unsigned', false),
    ],
    signing: [
      mount(path.join(root, 'sealed-signing'), '/sealed', true),
      mount(path.join(root, 'unsigned'), '/unsigned', true),
      mount(path.join(root, 'signing'), '/key', true),
      mount(path.join(root, 'signature'), '/signature', false),
    ],
  };
  const mounts = stageMounts[stage];
  if (mounts === undefined) throw new Error(`Unknown hermetic Docker stage ${stage}`);
  return mounts;
}

function expectedDockerArgs(stage, context) {
  if (
    context === null ||
    typeof context !== 'object' ||
    typeof context.root !== 'string' ||
    !path.isAbsolute(context.root) ||
    !Number.isSafeInteger(context.uid) ||
    context.uid < 0 ||
    !Number.isSafeInteger(context.gid) ||
    context.gid < 0 ||
    !Number.isSafeInteger(context.port) ||
    context.port < 1 ||
    context.port > 65_535
  ) {
    throw new Error(`${stage} Docker stage has an invalid sealed invocation context`);
  }
  const nodeArgs = dockerStageNodeArgs(stage);
  return [
    `KOVO_HERMETIC_STAGE_ROOT=${context.root}`,
    'run',
    '--rm',
    '--pull=never',
    '--network=none',
    '--add-host=kovo-network-canary:host-gateway',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
    `--user=${context.uid}:${context.gid}`,
    '--entrypoint=/usr/local/bin/node',
    `--env=KOVO_HERMETIC_NETWORK_CANARY=kovo-network-canary:${context.port}`,
    ...dockerStageMounts(context.root, stage),
    linuxNodeImage,
    '--preserve-symlinks',
    '--preserve-symlinks-main',
    '--permission',
    ...permissionFlags(nodeArgs.reads, nodeArgs.writes),
    ...nodeArgs.workerArgs,
  ];
}

function dockerStageNodeArgs(stage) {
  const nodeArgs = {
    analysis: {
      reads: ['/sealed', '/subject'],
      workerArgs: [
        '/sealed/scripts/hermetic-proof-stage-worker.mjs',
        'analyze',
        '/subject/subject.json',
        '/analysis/analysis.json',
        '/key/key.pkcs8',
        '/app/node_modules/untrusted-app/canary',
      ],
      writes: ['/analysis'],
    },
    'certificate-generation': {
      reads: ['/sealed', '/analysis'],
      workerArgs: [
        '/sealed/scripts/hermetic-proof-stage-worker.mjs',
        'generate',
        '/analysis/analysis.json',
        '/unsigned/certificate.json',
        '/key/key.pkcs8',
        '/app/node_modules/untrusted-app/canary',
      ],
      writes: ['/unsigned'],
    },
    signing: {
      reads: ['/sealed', '/unsigned', '/key'],
      workerArgs: [
        '/sealed/scripts/hermetic-proof-stage-worker.mjs',
        'sign',
        '/unsigned/certificate.json',
        '/key/key.pkcs8',
        '/signature/signature.json',
        '/repo/package.json',
        '/app/node_modules/untrusted-app/canary',
      ],
      writes: ['/signature'],
    },
  };
  const value = nodeArgs[stage];
  if (value === undefined) throw new Error(`Unknown hermetic Docker stage ${stage}`);
  return value;
}

function trustedHostLauncher() {
  const expectedPath =
    process.platform === 'linux'
      ? linuxDockerPath
      : process.platform === 'darwin'
        ? macSandboxExecPath
        : undefined;
  if (expectedPath === undefined) {
    throw new Error(`No reviewed hermetic proof launcher for ${process.platform}.`);
  }
  const resolved = realpathSync(expectedPath);
  const stat = statSync(resolved);
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) !== 0 || (stat.mode & 0o111) === 0) {
    throw new Error(
      `Hermetic proof launcher is not a root-owned, non-writable executable: ${resolved}`,
    );
  }
  return resolved;
}

function sourceTreeSha256(files, { includeTypeScript = false } = {}) {
  const entries = files.map((relativePath) => ({
    bytes: readFileSync(path.join(repoRoot, relativePath)),
    path: relativePath,
  }));
  if (includeTypeScript) {
    const packageRoot = typescriptPackageRoot();
    for (const relativePath of typescriptRuntimeFiles) {
      entries.push({
        bytes: readFileSync(path.join(packageRoot, relativePath)),
        path: `node_modules/typescript/${relativePath}`,
      });
    }
  }
  entries.sort((left, right) => compareStrings(left.path, right.path));
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(`${Buffer.byteLength(entry.path)}:`);
    hash.update(entry.path);
    hash.update(`${entry.bytes.length}:`);
    hash.update(entry.bytes);
  }
  return hash.digest('hex');
}

function typescriptPackageRoot() {
  const require = createRequire(import.meta.url);
  return realpathSync(path.dirname(require.resolve('typescript/package.json')));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function verifyOutputs(paths) {
  const analysis = JSON.parse(readFileSync(paths.analysis, 'utf8'));
  if (analysis.schema !== 'kovo.certificate-analysis/v1') {
    throw new Error('Hermetic analyzer did not emit the production analysis schema.');
  }
  const unsigned = readFileSync(paths.unsigned);
  const committed = readFileSync(certificatePath);
  if (!unsigned.equals(committed)) {
    throw new Error('Hermetic generator output differs from the committed kovo.certificate/v1.');
  }
  const signature = JSON.parse(readFileSync(paths.signature, 'utf8'));
  if (!verifyKovoCertificateSignature(unsigned, signature)) {
    throw new Error('Hermetic Ed25519 signer output did not verify.');
  }
  const privateKey = createPrivateKey({
    format: 'der',
    key: readFileSync(paths.key),
    type: 'pkcs8',
  });
  const expectedPublicKey = createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .toString('base64url');
  if (signature.publicKeySpki !== expectedPublicKey) {
    throw new Error('Hermetic signer substituted a different signing identity.');
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Hermetic network canary did not bind a TCP port.'));
      } else {
        resolve(address.port);
      }
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve(undefined)));
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
