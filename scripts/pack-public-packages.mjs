#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  deterministicPackContract,
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from './lib/deterministic-tarball.mjs';
import { packWithoutLifecycleScripts } from './lib/pack-without-lifecycle.mjs';
import {
  assertNoPackSecurityFindings,
  assertSnapshotMatches,
  buildPackSecuritySnapshot,
  inspectValidatedPackedEntries,
  readPackSecuritySnapshot,
  rootNpmConfigPath,
  validateFirstPartyScopeRegistryPolicy,
} from './check-pack-security.mjs';
import {
  assertNoWorkspaceProtocols,
  assertPackedManifestMatchesSource,
  manifestPath,
  repoRoot,
  releasePackages,
  tarballDir,
} from './release-packages.mjs';

export function packPublicPackages() {
  rmSync(tarballDir, { recursive: true, force: true });
  mkdirSync(tarballDir, { recursive: true });

  const packages = releasePackages();
  const releaseVersions = new Map(packages.map((pkg) => [pkg.name, pkg.version]));
  const packedPackages = [];
  const securityPackages = [];
  const registryFindings = validateFirstPartyScopeRegistryPolicy({
    npmConfigText: readFileSync(rootNpmConfigPath, 'utf8'),
    npmConfigPath: path.relative(repoRoot, rootNpmConfigPath),
    packageNames: packages.map((pkg) => pkg.name),
  });
  assertNoPackSecurityFindings(registryFindings);

  for (const pkg of packages) {
    console.log(`Packing ${pkg.name}@${pkg.version} without lifecycle scripts`);
    const tarballPath = packWithoutLifecycleScripts(pkg, tarballDir);
    const tarballBytes = readPackageTarballSnapshot(tarballPath);
    let validatedEntries;
    try {
      validatedEntries = validatedPackageTarballEntries(tarballBytes);
    } catch (error) {
      throw new Error(`${pkg.name} tarball violates the deterministic package contract`, {
        cause: error,
      });
    }
    const {
      files: securityFiles,
      findings,
      manifest: packedManifest,
    } = inspectValidatedPackedEntries({
      entries: validatedEntries,
      packageJson: pkg.manifest,
      packageName: pkg.name,
    });
    assertNoPackSecurityFindings(findings);
    assertPackedManifestMatchesSource(
      packedManifest,
      pkg.manifest,
      releaseVersions,
      `${pkg.name}@${pkg.version}`,
    );
    assertNoWorkspaceProtocols(packedManifest, `${pkg.name} packed manifest`);
    assertPackedLifecyclePolicy(packedManifest, pkg.name);
    const files = validatedEntries
      .map((entry) => entry.name)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    securityPackages.push({ files: securityFiles, name: pkg.name });
    packedPackages.push({
      dependencies: dependencySnapshot(packedManifest),
      files,
      manifest: packedManifest,
      name: pkg.name,
      sha512: `sha512-${sha512(tarballBytes)}`,
      version: pkg.version,
      tarball: path.relative(repoRoot, tarballPath),
    });
  }

  assertSnapshotMatches(buildPackSecuritySnapshot(securityPackages), readPackSecuritySnapshot());
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        buildEnvironment: packBuildEnvironment(),
        deterministicInputs: deterministicPackContract,
        packages: packedPackages,
        schema: 'kovo.packed-public-packages/v2',
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `Packed and security-verified ${packedPackages.length} public packages into ${tarballDir}`,
  );
}

function packBuildEnvironment() {
  const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const toolchain = Object.fromEntries(
    ['esbuild', 'ts-morph', 'typescript', 'vite-plus', 'vitest'].map((dependency) => [
      dependency,
      rootManifest.devDependencies?.[dependency],
    ]),
  );
  return {
    arch: process.arch,
    id: process.env.KOVO_REPRODUCIBLE_BUILD_ID ?? 'primary',
    node: process.version,
    packageManager: rootManifest.packageManager,
    platform: process.platform,
    toolchain,
  };
}

function sha512(bytes) {
  return createHash('sha512').update(bytes).digest('base64');
}

function dependencySnapshot(manifest) {
  const snapshot = {};
  for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (manifest[key]) snapshot[key] = manifest[key];
  }
  return snapshot;
}

function assertPackedLifecyclePolicy(manifest, label) {
  const allowed = { prepack: 'pnpm run build:dist' };
  const lifecycle = new Set([
    'preinstall',
    'install',
    'postinstall',
    'prepublish',
    'prepublishOnly',
    'prepare',
    'prepack',
    'postpack',
    'publish',
    'postpublish',
  ]);
  const findings = [];
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (!lifecycle.has(name)) continue;
    if (allowed[name] !== command) findings.push(`scripts.${name}=${command}`);
  }
  if (findings.length > 0) {
    throw new Error(
      `${label} packed manifest contains unapproved lifecycle scripts:\n  ${findings.join('\n  ')}`,
    );
  }
}

if (isMainEntry(import.meta.url)) await runGate(packPublicPackages);
