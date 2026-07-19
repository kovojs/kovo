#!/usr/bin/env node
import { createHmac, randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'security/hermetic-proof-stage.json');
const workerSourcePath = path.join(repoRoot, 'scripts/hermetic-proof-stage-worker.mjs');
const workflowPath = path.join(repoRoot, '.github/workflows/ci.yml');
const packagePath = path.join(repoRoot, 'package.json');
const linuxDockerPath = '/usr/bin/docker';
const macSandboxExecPath = '/usr/bin/sandbox-exec';
const linuxNodeImage =
  'docker.io/library/node@sha256:d45d78e7929b46875bbd4e29bea672d5bc48186c6c3588306521c815e78352d6';

const expectedStageContracts = {
  analysis: {
    childProcess: 'denied',
    name: 'analysis',
    reads: ['sealed framework analyzer', 'inert subject snapshot'],
    secrets: [],
    writes: ['analysis output'],
  },
  'certificate-generation': {
    childProcess: 'denied',
    name: 'certificate-generation',
    reads: ['sealed certificate generator', 'analysis output'],
    secrets: [],
    writes: ['unsigned certificate'],
  },
  signing: {
    childProcess: 'denied',
    name: 'signing',
    reads: ['sealed dependency-free signer', 'unsigned certificate', 'signing key'],
    secrets: ['signing key'],
    writes: ['detached signature'],
  },
};

export function readHermeticProofManifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export function validateHermeticProofContract({ manifest, packageJson, workflow }) {
  const findings = [];
  if (manifest?.schema !== 'kovo.hermetic-proof-stage/v1') {
    findings.push('hermetic proof manifest schema must be kovo.hermetic-proof-stage/v1');
  }
  if (manifest?.toolingBinding !== 'sandbox-self-test-unbound') {
    findings.push('hermetic proof tooling binding must honestly remain sandbox-self-test-unbound');
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
    !workflow.includes('name: Hermetic proof sandbox self-test') ||
    !workflow.includes(String(image))
  ) {
    findings.push(
      'CI must run the hermetic proof sandbox self-test with the reviewed pinned image',
    );
  }
  if (!workflow.includes('vp exec node scripts/hermetic-proof-stage.mjs')) {
    findings.push('CI hermetic proof job must invoke the fixed Node entrypoint directly');
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
      'hermetic-proof-stage/v1 sandbox-self-test=closed proof-tooling=UNBOUND OK\n',
    );
  } finally {
    await close(canary);
    rmSync(root, { force: true, recursive: true });
  }
}

function prepareStagePaths(root) {
  const directories = ['sealed', 'subject', 'analysis', 'unsigned', 'signing', 'signature', 'app'];
  for (const directory of directories) {
    const fullPath = path.join(root, directory);
    mkdirSync(fullPath, { recursive: true });
    chmodSync(fullPath, 0o700);
  }
  const paths = {
    analysis: path.join(root, 'analysis/analysis.json'),
    appCanary: path.join(root, 'app/node_modules/untrusted-app/canary'),
    key: path.join(root, 'signing/key.bin'),
    repoCanary: path.join(repoRoot, 'package.json'),
    signature: path.join(root, 'signature/signature.json'),
    subject: path.join(root, 'subject/subject.json'),
    unsigned: path.join(root, 'unsigned/certificate.json'),
    worker: path.join(root, 'sealed/worker.mjs'),
  };
  mkdirSync(path.dirname(paths.appCanary), { recursive: true });
  copyFileSync(workerSourcePath, paths.worker);
  writeFileSync(paths.subject, '{"app":"inert-source-snapshot"}\n', 'utf8');
  writeFileSync(paths.appCanary, 'untrusted-app-dependency\n', 'utf8');
  writeFileSync(paths.key, randomBytes(32));
  return paths;
}

function runDockerStages(paths, image, port, dockerPath) {
  const root = path.dirname(path.dirname(paths.worker));
  const context = {
    gid: process.getgid(),
    port,
    root,
    uid: process.getuid(),
  };
  const common = [
    `KOVO_HERMETIC_STAGE_ROOT=${root}`,
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
  const sealed = mount(path.join(root, 'sealed'), '/sealed', true);
  runDockerStage(
    dockerPath,
    'analysis',
    image,
    common,
    [
      sealed,
      mount(path.join(root, 'subject'), '/subject', true),
      mount(path.join(root, 'analysis'), '/analysis', false),
    ],
    [
      '/sealed/worker.mjs',
      'analyze',
      '/subject/subject.json',
      '/analysis/analysis.json',
      '/key/key.bin',
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
      sealed,
      mount(path.join(root, 'analysis'), '/analysis', true),
      mount(path.join(root, 'unsigned'), '/unsigned', false),
    ],
    [
      '/sealed/worker.mjs',
      'generate',
      '/analysis/analysis.json',
      '/unsigned/certificate.json',
      '/key/key.bin',
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
      sealed,
      mount(path.join(root, 'unsigned'), '/unsigned', true),
      mount(path.join(root, 'signing'), '/key', true),
      mount(path.join(root, 'signature'), '/signature', false),
    ],
    [
      '/sealed/worker.mjs',
      'sign',
      '/unsigned/certificate.json',
      '/key/key.bin',
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
  const permissionArgs = permissionFlags(reads, writes);
  const args = [...common, ...mounts, image, '--permission', ...permissionArgs, ...workerArgs];
  assertHermeticDockerArgs(args, stage, context);
  execFileSync(dockerPath, args.slice(1), { stdio: 'inherit' });
}

function runMacStages(paths, port, sandboxExecPath) {
  const networkCanary = `127.0.0.1:${port}`;
  runMacStage(
    'analysis',
    paths,
    [paths.worker, 'analyze', paths.subject, paths.analysis, paths.key, paths.appCanary],
    [paths.worker, paths.subject],
    [path.dirname(paths.analysis)],
    networkCanary,
    sandboxExecPath,
  );
  runMacStage(
    'certificate-generation',
    paths,
    [paths.worker, 'generate', paths.analysis, paths.unsigned, paths.key, paths.appCanary],
    [paths.worker, paths.analysis],
    [path.dirname(paths.unsigned)],
    networkCanary,
    sandboxExecPath,
  );
  runMacStage(
    'signing',
    paths,
    [
      paths.worker,
      'sign',
      paths.unsigned,
      paths.key,
      paths.signature,
      paths.repoCanary,
      paths.appCanary,
    ],
    [paths.worker, paths.unsigned, paths.key],
    [path.dirname(paths.signature)],
    networkCanary,
    sandboxExecPath,
  );
}

function runMacStage(stage, paths, workerArgs, reads, writes, networkCanary, sandboxExecPath) {
  if (stage === 'signing' && reads.includes(paths.repoCanary)) {
    throw new Error('signing macOS stage can reach the repository');
  }
  if (stage !== 'signing' && reads.includes(paths.key)) {
    throw new Error(`${stage} macOS stage can reach signing material`);
  }
  const args = [
    '-p',
    '(version 1)(allow default)(deny network*)',
    process.execPath,
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
      mount(path.join(root, 'sealed'), '/sealed', true),
      mount(path.join(root, 'subject'), '/subject', true),
      mount(path.join(root, 'analysis'), '/analysis', false),
    ],
    'certificate-generation': [
      mount(path.join(root, 'sealed'), '/sealed', true),
      mount(path.join(root, 'analysis'), '/analysis', true),
      mount(path.join(root, 'unsigned'), '/unsigned', false),
    ],
    signing: [
      mount(path.join(root, 'sealed'), '/sealed', true),
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
        '/sealed/worker.mjs',
        'analyze',
        '/subject/subject.json',
        '/analysis/analysis.json',
        '/key/key.bin',
        '/app/node_modules/untrusted-app/canary',
      ],
      writes: ['/analysis'],
    },
    'certificate-generation': {
      reads: ['/sealed', '/analysis'],
      workerArgs: [
        '/sealed/worker.mjs',
        'generate',
        '/analysis/analysis.json',
        '/unsigned/certificate.json',
        '/key/key.bin',
        '/app/node_modules/untrusted-app/canary',
      ],
      writes: ['/unsigned'],
    },
    signing: {
      reads: ['/sealed', '/unsigned', '/key'],
      workerArgs: [
        '/sealed/worker.mjs',
        'sign',
        '/unsigned/certificate.json',
        '/key/key.bin',
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
  const unsigned = readFileSync(paths.unsigned);
  const key = readFileSync(paths.key);
  const signature = JSON.parse(readFileSync(paths.signature, 'utf8'));
  const expected = createHmac('sha256', key).update(unsigned).digest('hex');
  if (signature.signature !== expected) throw new Error('Hermetic signer output did not verify.');
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

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
