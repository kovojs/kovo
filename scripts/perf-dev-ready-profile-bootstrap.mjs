#!/usr/bin/env node
/**
 * Minimal immutable-source bootstrap for the cold first-ready diagnostic.
 *
 * This file intentionally imports only Node built-ins. It authenticates one exact controller
 * commit, materializes that commit with `git archive`, makes the private tree read-only, and only
 * then starts the dependency-bearing controller module from that tree. Evidence is staged until
 * the source HEAD/ref guards and every bound source/snapshot file survive the child run.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEV_READY_PROFILE_CONTROLLER_BINDING_SCHEMA =
  'kovo-dev-ready-profile-controller-binding/v1';
export const DEV_READY_PROFILE_BOOTSTRAP_ATTESTATION_SCHEMA =
  'kovo-dev-ready-profile-bootstrap-attestation/v1';

const MANIFEST_FILE = 'package.json';
const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const CONTROLLER_FILES = Object.freeze([
  'benchmarks/corpora/dev-loop.mjs',
  'benchmarks/corpora/dev-process-marker.mjs',
  'benchmarks/corpora/generate.mjs',
  'benchmarks/harness/dev-port-allocation.mjs',
  'scripts/lib/cli-entry.mjs',
  'scripts/lib/perf-dev-session-evidence.mjs',
  'scripts/lib/perf-execution.mjs',
  'scripts/lib/perf-host.mjs',
  'scripts/lib/perf-packed-kovo-product.mjs',
  'scripts/lib/perf-provenance.mjs',
  'scripts/lib/perf-ready-route.mjs',
  'scripts/lib/process-tree-rss.mjs',
  'scripts/perf-dev-edit-profile.mjs',
  'scripts/perf-dev-generation-spike.mjs',
  'scripts/perf-dev-ready-profile-bootstrap.mjs',
  'scripts/perf-dev-ready-profile.mjs',
]);
const BOUND_PATHS = Object.freeze([MANIFEST_FILE, ...LOCK_FILES, ...CONTROLLER_FILES].sort());
const MAX_BOUND_FILE_BYTES = 32 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_REPORT_BYTES = 512 * 1024 * 1024;
const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

export function authenticateReadyProfileControllerSource(options = {}, dependencies = {}) {
  const root = canonicalDirectory(options.root ?? sourceRoot, 'controller source root');
  const gitText = dependencies.gitText ?? checkedGitText;
  const gitBytes = dependencies.gitBytes ?? checkedGitBytes;
  const readStable = dependencies.readStable ?? readBootstrapStableFile;
  const capturedCommit = gitText(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const commit = options.expectedCommit ?? capturedCommit;
  if (!validGitObjectId(commit) || capturedCommit !== commit) {
    throw new Error('controller HEAD does not equal the single bound commit');
  }
  const guards = captureHeadGuards(root, gitText, readStable);
  const tree = gitText(root, ['rev-parse', '--verify', `${commit}^{tree}`]);
  if (!validGitObjectId(tree)) throw new Error('controller commit tree is malformed');
  const status = gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status !== '') throw new Error('controller source checkout is dirty');
  const committedFileBytes = new Map();
  const files = Object.fromEntries(
    BOUND_PATHS.map((relativePath) => {
      const gitBlob = gitText(root, ['rev-parse', '--verify', `${commit}:${relativePath}`]);
      if (!validGitObjectId(gitBlob)) {
        throw new Error(`controller committed blob is malformed: ${relativePath}`);
      }
      const committedBytes = gitBytes(root, ['cat-file', 'blob', gitBlob]);
      const observed = readStable(
        path.join(root, ...relativePath.split('/')),
        MAX_BOUND_FILE_BYTES,
        `controller source ${relativePath}`,
      );
      if (!observed.bytes.equals(committedBytes)) {
        throw new Error(`controller filesystem bytes differ from committed blob: ${relativePath}`);
      }
      committedFileBytes.set(relativePath, committedBytes);
      return [
        relativePath,
        {
          bytes: committedBytes.byteLength,
          gitBlob,
          sha256: sha256(committedBytes),
          sourceIdentity: observed.identity,
        },
      ];
    }),
  );
  const manifest = JSON.parse(committedFileBytes.get(MANIFEST_FILE).toString('utf8'));
  const pnpmVersion = String(
    dependencies.pnpmVersion ??
      execFileSync('pnpm', ['--version'], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
  ).trim();
  if (manifest.packageManager !== `pnpm@${pnpmVersion}`) {
    throw new Error('controller packageManager does not equal the executing pnpm identity');
  }
  verifyReadyProfileControllerSource(
    { commit, files, guards, root, tree },
    { gitText, readStable },
  );
  return {
    commit,
    files,
    guards,
    packageManager: manifest.packageManager,
    pnpmVersion,
    root,
    tree,
  };
}

export function verifyReadyProfileControllerSource(authenticated, dependencies = {}) {
  const gitText = dependencies.gitText ?? checkedGitText;
  const readStable = dependencies.readStable ?? readBootstrapStableFile;
  const current = gitText(authenticated.root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (current !== authenticated.commit) throw new Error('controller HEAD moved during profiling');
  const tree = gitText(authenticated.root, [
    'rev-parse',
    '--verify',
    `${authenticated.commit}^{tree}`,
  ]);
  if (tree !== authenticated.tree) throw new Error('bound controller commit tree changed');
  if (gitText(authenticated.root, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
    throw new Error('controller source checkout changed during profiling');
  }
  for (const [relativePath, expected] of Object.entries(authenticated.files)) {
    const observed = readStable(
      path.join(authenticated.root, ...relativePath.split('/')),
      MAX_BOUND_FILE_BYTES,
      `controller source ${relativePath}`,
    );
    if (
      observed.bytes.byteLength !== expected.bytes ||
      sha256(observed.bytes) !== expected.sha256 ||
      canonicalJson(observed.identity) !== canonicalJson(expected.sourceIdentity)
    ) {
      throw new Error(`controller source path changed during profiling: ${relativePath}`);
    }
  }
  verifyHeadGuards(authenticated.guards, readStable);
}

export function materializeReadyProfileController(authenticated, dependencies = {}) {
  const spawn = dependencies.spawn ?? checkedSpawn;
  const parent = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'kovo-ready-controller-')));
  const privateRoot = path.join(parent, 'controller');
  const archive = path.join(parent, 'controller.tar');
  mkdirSync(privateRoot, { mode: 0o700 });
  try {
    spawn(
      'git',
      [
        '-C',
        authenticated.root,
        'archive',
        '--format=tar',
        `--output=${archive}`,
        authenticated.commit,
      ],
      'controller archive',
    );
    spawn('tar', ['-xf', archive, '-C', privateRoot], 'controller archive extraction');
    rmSync(archive, { force: true });
    verifyArchivedSymlinksConfined(privateRoot);
    const dependencyRoot = path.join(authenticated.root, 'node_modules');
    const dependencyStat = lstatSync(dependencyRoot);
    if (!dependencyStat.isDirectory() || dependencyStat.isSymbolicLink()) {
      throw new Error('controller dependency root is not a non-symlink directory');
    }
    symlinkSync(dependencyRoot, path.join(privateRoot, 'node_modules'), 'dir');
    const committedFiles = Object.fromEntries(
      Object.entries(authenticated.files).map(([file, evidence]) => [
        file,
        {
          bytes: evidence.bytes,
          gitBlob: evidence.gitBlob,
          sha256: evidence.sha256,
        },
      ]),
    );
    const preliminaryBinding = {
      commit: authenticated.commit,
      files: committedFiles,
      packageManager: authenticated.packageManager,
      pnpmVersion: authenticated.pnpmVersion,
      privateRoot,
      schema: DEV_READY_PROFILE_CONTROLLER_BINDING_SCHEMA,
      tree: authenticated.tree,
    };
    const readStable = dependencies.readStable ?? readBootstrapStableFile;
    verifyPrivateController(preliminaryBinding, readStable);
    makeTreeReadOnly(privateRoot);
    const binding = {
      ...preliminaryBinding,
      files: Object.fromEntries(
        Object.entries(committedFiles).map(([relativePath, evidence]) => {
          const observed = readStable(
            path.join(privateRoot, ...relativePath.split('/')),
            MAX_BOUND_FILE_BYTES,
            `immutable controller ${relativePath}`,
          );
          return [relativePath, { ...evidence, snapshotIdentity: observed.identity }];
        }),
      ),
    };
    verifyPrivateController(binding, readStable);
    const bindingPath = path.join(parent, 'controller-binding.json');
    const bindingBytes = Buffer.from(`${canonicalJson(binding)}\n`);
    writeFileSync(bindingPath, bindingBytes, { flag: 'wx', mode: 0o400 });
    const observedBinding = readBootstrapStableFile(
      bindingPath,
      4 * 1024 * 1024,
      'controller binding',
    );
    if (!observedBinding.bytes.equals(bindingBytes)) {
      throw new Error('controller binding changed while materialized');
    }
    return {
      binding,
      bindingPath,
      bindingSha256: sha256(bindingBytes),
      cleanup() {
        makeTreeWritable(privateRoot);
        rmSync(parent, { force: true, recursive: true });
      },
      privateRoot,
    };
  } catch (error) {
    makeTreeWritable(privateRoot);
    rmSync(parent, { force: true, recursive: true });
    throw error;
  }
}

export async function runReadyProfileBootstrap(argv = process.argv.slice(2), dependencies = {}) {
  const targets = parseEvidenceTargets(argv);
  const authenticated = authenticateReadyProfileControllerSource({}, dependencies);
  const materialized = materializeReadyProfileController(authenticated, dependencies);
  const nonce = randomBytes(12).toString('hex');
  const stagedOut = path.join(
    path.dirname(targets.out),
    `.${path.basename(targets.out)}.${nonce}.controller-stage`,
  );
  const stagedProfiles = path.join(
    path.dirname(targets.profileDir),
    `.${path.basename(targets.profileDir)}.${nonce}.controller-stage`,
  );
  const childArgv = rewriteEvidenceTargets(argv, stagedOut, stagedProfiles);
  try {
    const child = (dependencies.spawnController ?? spawnSync)(
      process.execPath,
      [path.join(materialized.privateRoot, 'scripts/perf-dev-ready-profile.mjs'), ...childArgv],
      {
        cwd: materialized.privateRoot,
        env: {
          ...process.env,
          KOVO_DEV_READY_PROFILE_CONTROLLER_BINDING: materialized.bindingPath,
          KOVO_DEV_READY_PROFILE_CONTROLLER_BINDING_SHA256: materialized.bindingSha256,
        },
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    );
    if (child.error || child.signal || child.status !== 0) {
      throw new Error(
        `immutable controller exited ${String(child.status)} signal ${String(child.signal)}`,
      );
    }
    verifyReadyProfileControllerSource(authenticated, dependencies);
    verifyPrivateController(
      materialized.binding,
      dependencies.readStable ?? readBootstrapStableFile,
    );
    const stagedReport = readBootstrapStableFile(
      stagedOut,
      MAX_REPORT_BYTES,
      'staged diagnostic report',
    );
    const report = JSON.parse(stagedReport.bytes.toString('utf8'));
    if (
      report?.schema !== 'kovo-dev-ready-profile/v1' ||
      report.controller?.before?.commit !== authenticated.commit ||
      report.controller?.before?.tree !== authenticated.tree ||
      report.controller?.stable !== true
    ) {
      throw new Error('staged diagnostic report is not bound to the bootstrap commit');
    }
    verifyStagedArtifactCustody(report, stagedProfiles);
    report.controller.bootstrap = {
      bindingSha256: sha256(Buffer.from(canonicalJson(publicBinding(materialized.binding)))),
      commit: authenticated.commit,
      headStableThroughPublication: true,
      schema: DEV_READY_PROFILE_BOOTSTRAP_ATTESTATION_SCHEMA,
      tree: authenticated.tree,
    };
    const finalBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    const finalStage = `${stagedOut}.sealed`;
    writeFileSync(finalStage, finalBytes, { flag: 'wx', mode: 0o600 });
    const stagedFinalReport = readBootstrapStableFile(
      finalStage,
      MAX_REPORT_BYTES,
      'bootstrap-sealed diagnostic report',
    );
    if (!stagedFinalReport.bytes.equals(finalBytes)) {
      throw new Error('bootstrap-sealed diagnostic report changed before publication');
    }
    verifyReadyProfileControllerSource(authenticated, dependencies);
    verifyPrivateController(
      materialized.binding,
      dependencies.readStable ?? readBootstrapStableFile,
    );
    verifyStagedArtifactCustody(report, stagedProfiles);
    if (existsSync(targets.out) || existsSync(targets.profileDir)) {
      throw new Error('diagnostic evidence target appeared before publication');
    }
    rmSync(stagedOut, { force: true });
    renameSync(stagedProfiles, targets.profileDir);
    renameSync(finalStage, targets.out);
    process.stdout.write(finalBytes);
    return report.verdict?.status === 'diagnostic-only' ? 0 : 1;
  } finally {
    rmSync(stagedOut, { force: true });
    rmSync(`${stagedOut}.sealed`, { force: true });
    rmSync(stagedProfiles, { force: true, recursive: true });
    materialized.cleanup();
  }
}

function verifyStagedArtifactCustody(report, profileDir) {
  const seal = report.artifactSeal;
  const expectedFiles = seal?.directory?.files;
  const reportCells = report.cells;
  if (
    report.verdict?.status !== 'diagnostic-only' ||
    report.integrity?.complete !== true ||
    report.integrity?.artifactsSealed !== true ||
    report.integrity?.exactSchedule !== true ||
    !Array.isArray(reportCells) ||
    reportCells.length !== 4 ||
    seal?.schema !== 'kovo-dev-ready-profile-artifact-seal/v1' ||
    !Array.isArray(seal.cells) ||
    seal.cells.length !== 4 ||
    !Array.isArray(expectedFiles) ||
    expectedFiles.length !== 8
  ) {
    throw new Error('staged report omitted the exact artifact seal');
  }
  const root = canonicalDirectory(profileDir, 'staged profile directory');
  const directoryBefore = lstatSync(root, { bigint: true });
  if (canonicalJson(identity(directoryBefore)) !== canonicalJson(seal.directory?.identity)) {
    throw new Error('staged profile directory identity differs from its controller seal');
  }
  const names = readdirSync(root).sort((left, right) => left.localeCompare(right));
  if (
    canonicalJson(names) !== canonicalJson([...expectedFiles].sort((a, b) => a.localeCompare(b)))
  ) {
    throw new Error('staged profile directory differs from its exact eight-file seal');
  }
  const inodes = new Set();
  for (const [cellIndex, cell] of seal.cells.entries()) {
    const reportCell = reportCells[cellIndex];
    if (
      canonicalJson(cell.binding) !== canonicalJson(reportCell?.profile?.binding) ||
      cell.binding?.cell?.scheduleIndex !== cellIndex
    ) {
      throw new Error('staged report cell differs from its artifact-seal binding');
    }
    for (const [kind, artifact] of Object.entries(cell.artifacts ?? {})) {
      const reportedArtifact = reportCell.profile.artifact?.[kind];
      const controllerArtifact = { ...artifact };
      delete controllerArtifact.sealed;
      if (
        (kind !== 'cpu' && kind !== 'coverage') ||
        typeof artifact?.file !== 'string' ||
        path.basename(artifact.file) !== artifact.file ||
        !expectedFiles.includes(artifact.file) ||
        !Number.isSafeInteger(artifact.bytes) ||
        !/^sha256:[0-9a-f]{64}$/u.test(artifact.sha256 ?? '') ||
        artifact.sealed !== true ||
        canonicalJson(controllerArtifact) !== canonicalJson(reportedArtifact)
      ) {
        throw new Error('staged artifact seal entry is malformed');
      }
      const observed = readBootstrapStableFile(
        path.join(root, artifact.file),
        kind === 'cpu' ? 256 * 1024 * 1024 : 128 * 1024 * 1024,
        `staged ${kind} artifact`,
      );
      const inode = `${observed.identity.dev}:${observed.identity.ino}`;
      const envelope = JSON.parse(observed.bytes.toString('utf8'));
      const schema =
        kind === 'cpu' ? 'kovo-dev-ready-profile-cpu/v1' : 'kovo-dev-ready-profile-coverage/v1';
      if (
        inodes.has(inode) ||
        observed.bytes.byteLength !== artifact.bytes ||
        observed.identity.dev !== artifact.dev ||
        observed.identity.ino !== artifact.ino ||
        observed.identity.mode !== artifact.mode ||
        observed.identity.nlink !== artifact.nlink ||
        observed.identity.mtimeNs !== artifact.mtimeNs ||
        observed.identity.ctimeNs !== artifact.ctimeNs ||
        sha256(observed.bytes) !== artifact.sha256 ||
        artifact.schema !== schema ||
        envelope?.schema !== schema ||
        canonicalJson(envelope.binding) !== canonicalJson(cell.binding) ||
        (kind === 'cpu' &&
          canonicalJson(envelope.attribution) !==
            canonicalJson(reportCell.profile.attribution?.cpu)) ||
        (kind === 'coverage' &&
          (canonicalJson(envelope.attribution) !==
            canonicalJson(reportCell.profile.attribution?.coverage) ||
            canonicalJson(envelope.calls) !== canonicalJson(reportCell.profile.calls) ||
            canonicalJson(envelope.product) !== canonicalJson(reportCell.profile.product)))
      ) {
        throw new Error('staged artifact changed after controller sealing');
      }
      inodes.add(inode);
    }
  }
  if (inodes.size !== 8) throw new Error('staged artifact seal is incomplete or aliases inodes');
  const directoryAfter = lstatSync(root, { bigint: true });
  if (
    !sameStat(directoryBefore, directoryAfter) ||
    canonicalJson(identity(directoryAfter)) !== canonicalJson(seal.directory.identity)
  ) {
    throw new Error('staged profile directory changed during bootstrap custody verification');
  }
}

function verifyPrivateController(binding, readStable) {
  for (const [relativePath, expected] of Object.entries(binding.files)) {
    const observed = readStable(
      path.join(binding.privateRoot, ...relativePath.split('/')),
      MAX_BOUND_FILE_BYTES,
      `immutable controller ${relativePath}`,
    );
    if (
      observed.bytes.byteLength !== expected.bytes ||
      sha256(observed.bytes) !== expected.sha256 ||
      (expected.snapshotIdentity !== undefined &&
        canonicalJson(observed.identity) !== canonicalJson(expected.snapshotIdentity))
    ) {
      throw new Error(`immutable controller differs from committed blob: ${relativePath}`);
    }
  }
}

function captureHeadGuards(root, gitText, readStable) {
  const candidates = new Set([
    gitText(root, ['rev-parse', '--git-path', 'HEAD']),
    gitText(root, ['rev-parse', '--git-path', 'logs/HEAD']),
  ]);
  let symbolic = null;
  try {
    symbolic = gitText(root, ['symbolic-ref', '-q', 'HEAD']);
  } catch {}
  if (symbolic !== null) {
    candidates.add(gitText(root, ['rev-parse', '--git-path', symbolic]));
    candidates.add(gitText(root, ['rev-parse', '--git-path', `logs/${symbolic}`]));
  }
  return [...candidates]
    .map((candidate) => (path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate)))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => {
      if (!existsSync(file)) return { exists: false, file };
      const snapshot = readStable(file, MAX_BOUND_FILE_BYTES, 'controller HEAD/ref guard');
      return {
        exists: true,
        file,
        identity: snapshot.identity,
        sha256: sha256(snapshot.bytes),
      };
    });
}

function verifyHeadGuards(guards, readStable) {
  for (const guard of guards) {
    if (!guard.exists) {
      if (existsSync(guard.file)) throw new Error('controller HEAD/ref guard appeared');
      continue;
    }
    const observed = readStable(guard.file, MAX_BOUND_FILE_BYTES, 'controller HEAD/ref guard');
    if (
      sha256(observed.bytes) !== guard.sha256 ||
      canonicalJson(observed.identity) !== canonicalJson(guard.identity)
    ) {
      throw new Error('controller HEAD/ref guard changed during profiling');
    }
  }
}

export function readBootstrapStableFile(file, maximum, label, dependencies = {}) {
  const absolute = path.resolve(file);
  const beforePath = lstatSync(absolute, { bigint: true });
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.nlink !== 1n ||
    beforePath.size < 1n ||
    beforePath.size > BigInt(maximum) ||
    realpathSync(absolute) !== absolute
  ) {
    throw new Error(`${label} is not a bounded uniquely linked regular file`);
  }
  dependencies.afterLstat?.({ file: absolute, stat: beforePath });
  let descriptor;
  try {
    descriptor = openSync(
      absolute,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0),
    );
    const beforeHandle = fstatSync(descriptor, { bigint: true });
    if (!beforeHandle.isFile() || !sameStat(beforePath, beforeHandle)) {
      throw new Error(`${label} changed identity while being opened`);
    }
    const buffer = Buffer.alloc(Number(beforeHandle.size) + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (!Number.isSafeInteger(count) || count < 0 || count > buffer.byteLength - offset) {
        throw new Error(`${label} returned an invalid read count`);
      }
      if (count === 0) break;
      offset += count;
    }
    const afterHandle = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(absolute, { bigint: true });
    if (
      offset !== Number(afterHandle.size) ||
      realpathSync(absolute) !== absolute ||
      !sameStat(beforeHandle, afterHandle) ||
      !sameStat(afterHandle, afterPath)
    ) {
      throw new Error(`${label} changed while being read`);
    }
    return { bytes: Buffer.from(buffer.subarray(0, offset)), identity: identity(afterHandle) };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseEvidenceTargets(argv) {
  let out = null;
  let profileDir = null;
  let diagnose = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--diagnose') diagnose = true;
    if (value === '--out' || value === '--profile-dir') {
      if ((value === '--out' ? out : profileDir) !== null) {
        throw new Error(`duplicate ${value}`);
      }
      const target = argv[++index];
      if (typeof target !== 'string' || target.length === 0)
        throw new Error(`${value} is required`);
      if (value === '--out') out = path.resolve(target);
      else profileDir = path.resolve(target);
    }
  }
  if (!diagnose || out === null) throw new Error('--diagnose and --out are required');
  profileDir ??= `${out}.profiles`;
  if (out === profileDir) {
    throw new Error('diagnostic report and profile directory targets must differ');
  }
  for (const target of [out, profileDir]) {
    if (existsSync(target)) throw new Error(`diagnostic evidence target already exists: ${target}`);
    canonicalDirectory(path.dirname(target), 'diagnostic evidence parent');
  }
  return { out, profileDir };
}

function rewriteEvidenceTargets(argv, out, profileDir) {
  const result = [];
  let sawProfile = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--out' || value === '--profile-dir') {
      result.push(value, value === '--out' ? out : profileDir);
      sawProfile ||= value === '--profile-dir';
      index += 1;
    } else {
      result.push(value);
    }
  }
  if (!sawProfile) result.push('--profile-dir', profileDir);
  return result;
}

function publicBinding(binding) {
  return {
    commit: binding.commit,
    files: binding.files,
    packageManager: binding.packageManager,
    pnpmVersion: binding.pnpmVersion,
    schema: binding.schema,
    tree: binding.tree,
  };
}

function makeTreeReadOnly(root) {
  const directories = [];
  walkTree(root, (target, stat) => {
    if (stat.isDirectory()) directories.push(target);
    else if (!stat.isSymbolicLink()) chmodSync(target, stat.mode & 0o111 ? 0o500 : 0o400);
  });
  for (const directory of directories.reverse()) chmodSync(directory, 0o500);
}

function verifyArchivedSymlinksConfined(root) {
  walkTree(root, (target, stat) => {
    if (!stat.isSymbolicLink()) return;
    let resolved;
    try {
      resolved = realpathSync(target);
    } catch {
      throw new Error(`immutable controller archive contains a broken symlink: ${target}`);
    }
    if (!isWithinOrEqual(root, resolved)) {
      throw new Error(`immutable controller archive symlink escapes its root: ${target}`);
    }
  });
}

function makeTreeWritable(root) {
  if (!existsSync(root)) return;
  try {
    chmodSync(root, 0o700);
  } catch {}
  walkTree(root, (target, stat) => {
    if (!stat.isSymbolicLink()) {
      try {
        chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
      } catch {}
    }
  });
}

function walkTree(root, visit) {
  const pending = [root];
  while (pending.length > 0) {
    const target = pending.pop();
    const stat = lstatSync(target);
    visit(target, stat);
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    for (const name of readdirSync(target)) pending.push(path.join(target, name));
  }
}

function sameStat(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function identity(stat) {
  return {
    bytes: Number(stat.size),
    ctimeNs: String(stat.ctimeNs),
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    mtimeNs: String(stat.mtimeNs),
    nlink: Number(stat.nlink),
  };
}

function checkedGitText(root, args) {
  return String(
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ).trim();
}

function checkedGitBytes(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'buffer',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function checkedSpawn(command, args, label) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`${label} failed: ${String(result.stderr).slice(0, 4096)}`);
  }
}

function canonicalDirectory(value, label) {
  const absolute = path.resolve(value);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
  return realpathSync(absolute);
}

function isWithinOrEqual(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function validGitObjectId(value) {
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value ?? '');
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = await runReadyProfileBootstrap();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
