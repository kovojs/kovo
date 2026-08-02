import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
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
import { fileURLToPath } from 'node:url';

import {
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from './deterministic-tarball.mjs';
import {
  validatePackedReleaseManifest,
  verifyPackedAttestationBytes,
} from '../publish-packed-packages.mjs';
import { releasePackages } from '../release-packages.mjs';
import { KNOWN_FAILURE_PACKED_SCAFFOLD_TIMEOUT_MS } from './known-failure-probe-deadlines.mjs';

const PACKED_RELEASE_SCHEMA = 'kovo.packed-public-packages/v2';
const PACKAGE_NAME = /^(?:@([a-z0-9][a-z0-9._-]*)\/)?([a-z0-9][a-z0-9._-]*)$/u;
const sourceRepositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Materialize every first-party package from its attested tarball while borrowing only external
 * dependencies from the repository's frozen install. Known-failure probes perform no dependency
 * install, so lifecycle policy and lockfile state cannot be bypassed by their throwaway apps.
 */
export function materializeKnownFailurePackedRelease(packedManifestPath) {
  const manifestPath = path.resolve(packedManifestPath);
  if (
    !existsSync(manifestPath) ||
    !lstatSync(manifestPath).isFile() ||
    lstatSync(manifestPath).isSymbolicLink()
  ) {
    throw new TypeError('packed release manifest must be a regular non-symlink file');
  }
  const packedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (packedManifest.schema !== PACKED_RELEASE_SCHEMA) {
    throw new TypeError(`known-failure probes require ${PACKED_RELEASE_SCHEMA}`);
  }

  const expectedPackages = releasePackages();
  const packedPackages = validatePackedReleaseManifest(packedManifest, expectedPackages);
  const repositoryRoot = path.resolve(path.dirname(manifestPath), '..');
  const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-known-failure-packed-'));
  const nodeModules = path.join(root, 'node_modules');
  mkdirSync(nodeModules);

  try {
    const packedNames = new Set(packedPackages.map((pkg) => pkg.name));
    linkExternalWorkspaceDependencies(
      path.join(repositoryRoot, 'node_modules'),
      nodeModules,
      packedNames,
    );
    linkDeclaredExternalDependencies(expectedPackages, repositoryRoot, nodeModules, packedNames);
    for (const pkg of packedPackages) {
      materializePackedPackage(pkg, repositoryRoot, nodeModules);
    }
    createPackedBinLinks(nodeModules);

    let cleaned = false;
    return {
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        rmSync(root, { recursive: true, force: true });
      },
      nodeModules,
      packageRoot(name) {
        const destination = packageDestination(nodeModules, name);
        if (!existsSync(destination) || !statSync(destination).isDirectory()) {
          throw new TypeError(`packed package was not materialized: ${name}`);
        }
        return destination;
      },
      repositoryRoot,
      root,
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/** Generate an ordinary app through the packed create-kovo executable, then bind packed modules. */
export function createKnownFailurePackedScaffold(release, options = {}) {
  const dialect = options.dialect ?? 'sqlite';
  if (dialect !== 'postgres' && dialect !== 'sqlite') {
    throw new TypeError(`unsupported known-failure scaffold dialect: ${String(dialect)}`);
  }
  const appRoot = path.join(release.root, options.directory ?? `app-${dialect}`);
  const createBin = path.join(release.packageRoot('create-kovo'), 'dist', 'index.mjs');
  const args = [
    createBin,
    appRoot,
    '--name',
    options.name ?? `known-failure-${dialect}`,
    '--dialect',
    dialect,
    '--disable-git',
  ];
  if (dialect === 'sqlite') args.push('--experimental-sqlite');
  const result = spawnSync(process.execPath, args, {
    cwd: release.root,
    encoding: 'utf8',
    env: knownFailurePackedEnvironment(release),
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? KNOWN_FAILURE_PACKED_SCAFFOLD_TIMEOUT_MS,
  });
  if (
    result.status !== 0 ||
    result.signal ||
    result.error ||
    !existsSync(path.join(appRoot, 'src', 'app.tsx'))
  ) {
    throw new Error(
      `packed create-kovo failed: ${
        result.error?.message ??
        result.signal ??
        result.stderr?.trim() ??
        result.stdout?.trim() ??
        `exit ${String(result.status)}`
      }`,
    );
  }
  symlinkSync(release.nodeModules, path.join(appRoot, 'node_modules'), 'dir');
  return appRoot;
}

export function knownFailurePackedEnvironment(release, overrides = {}) {
  const env = {
    ...process.env,
    ...overrides,
    PATH: `${path.join(release.nodeModules, '.bin')}${path.delimiter}${process.env.PATH ?? ''}`,
  };
  for (const name of optionsDeletedEnvironment(overrides)) delete env[name];
  return env;
}

/**
 * A `null` override means "delete even if the probe runner inherited it". This keeps first-run
 * probes honest when a developer shell happens to export a deployment-only Kovo variable.
 */
function optionsDeletedEnvironment(overrides) {
  return Object.entries(overrides)
    .filter(([, value]) => value === null)
    .map(([name]) => name);
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
  const match = PACKAGE_NAME.exec(packageName);
  if (!match) throw new TypeError(`invalid packed package name: ${String(packageName)}`);
  return match[1]
    ? path.join(nodeModules, `@${match[1]}`, match[2])
    : path.join(nodeModules, match[2]);
}

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

    const hasPackedScope = [...packedNames].some((name) => name.startsWith(`${entry.name}/`));
    if (!hasPackedScope) {
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

function linkDeclaredExternalDependencies(packages, repositoryRoot, nodeModules, packedNames) {
  for (const pkg of packages) {
    const packagePathInManifestRepository = path.join(
      repositoryRoot,
      path.relative(sourceRepositoryRoot, pkg.dirPath),
    );
    for (const dependencyName of declaredDependencyNames(pkg.manifest)) {
      if (packedNames.has(dependencyName)) continue;
      const destination = packageDestination(nodeModules, dependencyName);
      if (existsSync(destination)) continue;
      const candidates = [
        path.join(packagePathInManifestRepository, 'node_modules', ...dependencyName.split('/')),
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

function createPackedBinLinks(nodeModules) {
  const binDirectory = path.join(nodeModules, '.bin');
  mkdirSync(binDirectory);
  linkPackageBin(nodeModules, binDirectory, '@kovojs/cli', 'kovo');
  linkPackageBin(nodeModules, binDirectory, 'create-kovo', 'create-kovo');
  linkPackageBin(nodeModules, binDirectory, 'vite-plus', 'vp');
  linkPackageBin(nodeModules, binDirectory, 'vitest', 'vitest');
  linkPackageBin(nodeModules, binDirectory, 'typescript', 'tsc');
}

function linkPackageBin(nodeModules, binDirectory, packageName, commandName) {
  const packageRoot = packageDestination(nodeModules, packageName);
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const declared =
    typeof manifest.bin === 'string'
      ? manifest.bin
      : manifest.bin && typeof manifest.bin === 'object'
        ? manifest.bin[commandName]
        : undefined;
  if (typeof declared !== 'string') {
    throw new TypeError(`${packageName}: packed dependency does not declare bin ${commandName}`);
  }
  const target = path.resolve(packageRoot, declared);
  if (target === packageRoot || !target.startsWith(`${packageRoot}${path.sep}`)) {
    throw new TypeError(`${packageName}: bin ${commandName} escapes its package`);
  }
  if (!existsSync(target) || !lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()) {
    throw new TypeError(`${packageName}: bin ${commandName} is not a regular package file`);
  }
  symlinkSync(target, path.join(binDirectory, commandName), 'file');
}
