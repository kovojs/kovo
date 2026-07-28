#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from '../lib/deterministic-tarball.mjs';
import { packedCliContractOutcome } from '../lib/known-failure-probe-classifier.mjs';
import {
  validatePackedReleaseManifest,
  verifyPackedAttestationBytes,
} from '../publish-packed-packages.mjs';
import { releasePackages } from '../release-packages.mjs';

let consumerRoot = null;
process.once('exit', () => {
  if (consumerRoot !== null) rmSync(consumerRoot, { recursive: true, force: true });
});
process.once('uncaughtException', (error) => {
  process.stderr.write(
    `packed CLI probe infrastructure failure: ${error.stack ?? error.message}\n`,
  );
  process.exitCode = 2;
});

const mode = process.argv[2];
const idArgument = process.argv.indexOf('--id');
const manifestArgument = process.argv.indexOf('--packed-manifest');
const id = process.argv[idArgument + 1];
if (
  !['help', 'empty-check', 'starter-test-surface', 'offline-docs'].includes(mode) ||
  idArgument === -1 ||
  !/^KF-DEVEX-\d{3}$/u.test(id ?? '') ||
  manifestArgument === -1 ||
  !process.argv[manifestArgument + 1]
) {
  process.stderr.write(
    'Usage: node packed-cli-contract.mjs <help|empty-check|starter-test-surface|offline-docs> --id <KF-DEVEX-NNN> --packed-manifest <path>\n',
  );
  process.exit(2);
}

const packedManifestPath = path.resolve(process.argv[manifestArgument + 1]);
const packedManifest = JSON.parse(readFileSync(packedManifestPath, 'utf8'));
if (packedManifest.schema !== 'kovo.packed-public-packages/v2') {
  process.stderr.write('packed CLI probe requires kovo.packed-public-packages/v2\n');
  process.exit(2);
}

let packedPackages;
const expectedPackages = releasePackages();
try {
  packedPackages = validatePackedReleaseManifest(packedManifest, expectedPackages);
} catch (error) {
  infrastructureFailure('packed CLI manifest', { error });
}

const manifestDirectory = path.dirname(packedManifestPath);
const repositoryRoot = path.resolve(manifestDirectory, '..');
consumerRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-known-failure-cli-'));
try {
  const nodeModules = path.join(consumerRoot, 'node_modules');
  mkdirSync(nodeModules);
  linkExternalWorkspaceDependencies(
    path.join(repositoryRoot, 'node_modules'),
    nodeModules,
    new Set(packedPackages.map((pkg) => pkg.name)),
  );
  linkDeclaredExternalDependencies(expectedPackages, repositoryRoot, nodeModules);
  for (const pkg of packedPackages) {
    materializePackedPackage(pkg, repositoryRoot, nodeModules);
  }

  const appRoot = path.join(consumerRoot, 'app');
  mkdirSync(appRoot);
  writeFileSync(
    path.join(appRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'kovo-known-failure-cli-consumer',
        version: '0.0.0',
        private: true,
        kovoInventory: { consumerKind: 'throwaway-app' },
      },
      null,
      2,
    )}\n`,
  );
  const cli = path.join(nodeModules, '@kovojs', 'cli', 'dist', 'bin.mjs');
  if (!existsSync(cli)) {
    infrastructureFailure('packed CLI materialization', {
      status: null,
      stderr: `missing ${cli}`,
    });
  }

  let result = null;
  let outcome = null;
  if (mode === 'help' || mode === 'empty-check') {
    result =
      mode === 'help'
        ? command(process.execPath, [cli, '--help'], appRoot)
        : command(process.execPath, [cli, 'check'], appRoot);
    if (result.error || result.signal || result.status === null) {
      infrastructureFailure(`kovo ${mode}`, result);
    }
    outcome = packedCliContractOutcome(mode, result);
  } else if (mode === 'starter-test-surface') {
    outcome = starterTestSurfaceOutcome(nodeModules);
  } else {
    result = command(process.execPath, [cli, 'update-docs'], appRoot);
    if (result.error || result.signal || result.status === null) {
      infrastructureFailure('kovo offline-docs', result);
    }
    outcome = offlineDocsOutcome(result, appRoot);
  }
  if (outcome === null) {
    infrastructureFailure(`packed kovo ${mode} returned an unclassified contract shape`, {
      ...(result ?? {}),
      status: result?.status ?? null,
      stderr: result?.stderr ?? '',
      stdout: result?.stdout ?? '',
    });
  }
  emitResult(id, outcome);
} finally {
  rmSync(consumerRoot, { recursive: true, force: true });
  consumerRoot = null;
}

function materializePackedPackage(pkg, repositoryRoot, nodeModules) {
  const destination = packageDestination(nodeModules, pkg.name);
  mkdirSync(destination, { recursive: true });
  const tarballPath = path.resolve(repositoryRoot, pkg.tarball);
  if (tarballPath === repositoryRoot || !tarballPath.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new TypeError(`${pkg.name}: packed tarball path escapes the repository`);
  }
  const compressed = readPackageTarballSnapshot(tarballPath);
  verifyPackedAttestationBytes(pkg, compressed);
  for (const entry of validatedPackageTarballEntries(compressed)) {
    const relative = entry.name.slice('package/'.length);
    const output = path.join(destination, ...relative.split('/'));
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, entry.data, {
      flag: 'wx',
      mode: entry.executable ? 0o755 : 0o644,
    });
  }
}

function packageDestination(nodeModules, packageName) {
  const match = /^(?:@([a-z0-9][a-z0-9._-]*)\/)?([a-z0-9][a-z0-9._-]*)$/u.exec(packageName);
  if (!match) throw new TypeError(`invalid packed package name: ${String(packageName)}`);
  return match[1]
    ? path.join(nodeModules, `@${match[1]}`, match[2])
    : path.join(nodeModules, match[2]);
}

/**
 * Runtime dependencies come from the already-frozen repository install; every first-party Kovo
 * package is instead materialized from its authenticated tarball. This probe performs no install
 * and therefore cannot mutate a lockfile or bypass lifecycle/frozen-lock policy.
 */
function linkExternalWorkspaceDependencies(source, destination, packedNames) {
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new TypeError('repository node_modules is required for the no-install packed probe');
  }
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);
    if (!entry.name.startsWith('@')) {
      if (!packedNames.has(entry.name)) linkResolvedDirectory(sourceEntry, destinationEntry);
      continue;
    }

    const packedScopeNames = [...packedNames].filter((name) => name.startsWith(`${entry.name}/`));
    if (packedScopeNames.length === 0) {
      linkResolvedDirectory(sourceEntry, destinationEntry);
      continue;
    }
    mkdirSync(destinationEntry);
    for (const scopedEntry of readdirSync(sourceEntry, { withFileTypes: true })) {
      const packageName = `${entry.name}/${scopedEntry.name}`;
      if (packedNames.has(packageName)) continue;
      linkResolvedDirectory(
        path.join(sourceEntry, scopedEntry.name),
        path.join(destinationEntry, scopedEntry.name),
      );
    }
  }
}

function linkDeclaredExternalDependencies(packages, repositoryRoot, nodeModules) {
  const packedNames = new Set(packages.map((pkg) => pkg.name));
  for (const pkg of packages) {
    for (const dependencyName of declaredDependencyNames(pkg.manifest)) {
      if (packedNames.has(dependencyName)) continue;
      const destination = packageDestination(nodeModules, dependencyName);
      if (existsSync(destination)) continue;
      const candidates = [
        path.join(pkg.dirPath, 'node_modules', ...dependencyName.split('/')),
        path.join(repositoryRoot, 'node_modules', ...dependencyName.split('/')),
      ];
      const source = candidates.find((candidate) => existsSync(candidate));
      if (!source) {
        throw new TypeError(
          `${pkg.name}: frozen workspace install cannot resolve ${dependencyName}`,
        );
      }
      mkdirSync(path.dirname(destination), { recursive: true });
      linkResolvedDirectory(source, destination);
    }
  }
}

function declaredDependencyNames(manifest) {
  const names = new Set();
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) names.add(name);
  }
  return [...names];
}

function linkResolvedDirectory(source, destination) {
  const resolved = realpathSync(source);
  if (!statSync(resolved).isDirectory()) return;
  symlinkSync(resolved, destination, 'dir');
}

function command(executable, args, cwd) {
  return spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  });
}

function starterTestSurfaceOutcome(nodeModules) {
  const templateRoot = path.join(nodeModules, 'create-kovo', 'templates');
  const testPath = path.join(templateRoot, 'src', 'app.test.ts');
  const setupPath = path.join(templateRoot, 'src', 'test-setup.ts');
  if (!existsSync(testPath)) return null;
  const source = readFileSync(testPath, 'utf8');
  const internalMock =
    existsSync(setupPath) ||
    source.includes('@kovojs/compiler/internal') ||
    source.includes('vi.mock(') ||
    source.includes('isKovoApp');
  if (internalMock) return 'defect-reproduced';
  if (
    source.includes("spawn('kovo', ['dev', './src/app.tsx']") &&
    source.includes("fetch(`${appOrigin}/api/health`)") &&
    source.includes("fetch(`${appOrigin}/login`)")
  ) {
    return 'desired-behavior';
  }
  return null;
}

function offlineDocsOutcome(result, appRoot) {
  if (result.status !== 0 || result.stderr.trim().length > 0) return null;
  if (
    !/^kovo-update-docs\/v1\r?\nOK source=installed-package version=\S+ files=\d+\r?\nOK snapshot=sha256:[0-9a-f]{64} current=\.kovo\/docs\/current\.json\r?\n?$/u.test(
      result.stdout,
    )
  ) {
    return null;
  }
  const docsRoot = path.join(appRoot, '.kovo', 'docs');
  const currentPath = path.join(docsRoot, 'current.json');
  if (!existsSync(currentPath)) return null;
  const current = JSON.parse(readFileSync(currentPath, 'utf8'));
  if (
    current.schema !== 'kovo.installed-agent-docs-current/v1' ||
    !/^sha256:[0-9a-f]{64}$/u.test(current.snapshotDigest ?? '')
  ) {
    return null;
  }
  const snapshotRoot = path.join(
    docsRoot,
    'snapshots',
    current.snapshotDigest.slice('sha256:'.length),
  );
  const files = recursiveRegularFiles(snapshotRoot);
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  if (
    source.includes('Bundled starter placeholder') ||
    source.includes('Upgrade and run kovo update-docs')
  ) {
    return 'defect-reproduced';
  }
  const relativeFiles = files.map((file) =>
    path.relative(snapshotRoot, file).split(path.sep).join('/'),
  );
  const installedBytes = files.reduce((total, file) => total + statSync(file).size, 0);
  if (
    relativeFiles.length >= 70 &&
    installedBytes >= 100_000 &&
    ['llms.txt', 'tutorial/01-first-page.md', 'api/server.md'].every((file) =>
      relativeFiles.includes(file),
    )
  ) {
    return 'desired-behavior';
  }
  return files.length > 0 ? 'defect-reproduced' : null;
}

function recursiveRegularFiles(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) return [];
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  return files.sort();
}

function emitResult(id, outcome) {
  process.stdout.write(
    `${JSON.stringify({
      schema: 'kovo-known-failure-probe-result/v1',
      id,
      outcome,
    })}\n`,
  );
  process.exitCode = outcome === 'desired-behavior' ? 0 : 1;
}

function infrastructureFailure(label, result) {
  const detail =
    result.error?.message ??
    result.signal ??
    (result.stderr || result.stdout || `exit ${String(result.status)}`).trim();
  process.stderr.write(`${label} infrastructure failure: ${detail}\n`);
  process.exit(2);
}
