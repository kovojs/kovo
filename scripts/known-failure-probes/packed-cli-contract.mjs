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
const manifestArgument = process.argv.indexOf('--packed-manifest');
if (
  !['help', 'empty-check'].includes(mode) ||
  manifestArgument === -1 ||
  !process.argv[manifestArgument + 1]
) {
  process.stderr.write(
    'Usage: node packed-cli-contract.mjs <help|empty-check> --packed-manifest <path>\n',
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

  const result =
    mode === 'help'
      ? command(process.execPath, [cli, '--help'], appRoot)
      : command(process.execPath, [cli, 'check'], appRoot);
  if (result.error || result.signal || result.status === null) {
    infrastructureFailure(`kovo ${mode}`, result);
  }
  if (
    /(?:ERR_MODULE_NOT_FOUND|Cannot find package|node:internal\/|SyntaxError:|ReferenceError:)/u.test(
      `${result.stdout}\n${result.stderr}`,
    )
  ) {
    infrastructureFailure(`kovo ${mode} runtime`, result);
  }

  if (mode === 'help') {
    const combined = `${result.stdout}\n${result.stderr}`;
    const renderedHelp = /(?:usage|commands):/iu.test(combined);
    const desired = result.status === 0 && renderedHelp && result.stderr.trim().length === 0;
    if (desired) {
      process.stdout.write('packed kovo --help satisfies the desired exit/stdout contract\n');
      process.exitCode = 0;
    } else if (
      result.status === 1 &&
      (renderedHelp || /unknown command ["']--help["']/iu.test(combined))
    ) {
      process.stderr.write(
        `reproduced: packed kovo --help exit=${String(result.status)} stdout=${JSON.stringify(
          result.stdout.slice(0, 240),
        )} stderr=${JSON.stringify(result.stderr.slice(0, 240))}\n`,
      );
      process.exitCode = 1;
    } else {
      infrastructureFailure('packed kovo --help returned an unclassified contract shape', result);
    }
  } else {
    const combined = `${result.stdout}\n${result.stderr}`;
    const desired = result.status !== 0 && !/^\s*OK\s*$/mu.test(combined);
    if (desired) {
      process.stdout.write('packed kovo check fails closed without graph input\n');
      process.exitCode = 0;
    } else if (result.status === 0 && /^\s*OK\s*$/mu.test(combined)) {
      process.stderr.write(
        `reproduced: packed empty kovo check exit=${String(result.status)} output=${JSON.stringify(
          combined.slice(0, 240),
        )}\n`,
      );
      process.exitCode = 1;
    } else {
      infrastructureFailure(
        'packed empty kovo check returned an unclassified contract shape',
        result,
      );
    }
  }
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

function infrastructureFailure(label, result) {
  const detail =
    result.error?.message ??
    result.signal ??
    (result.stderr || result.stdout || `exit ${String(result.status)}`).trim();
  process.stderr.write(`${label} infrastructure failure: ${detail}\n`);
  process.exit(2);
}
