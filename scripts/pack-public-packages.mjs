#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { packWithoutLifecycleScripts } from './lib/pack-without-lifecycle.mjs';
import {
  assertNoPackSecurityFindings,
  assertSnapshotMatches,
  buildPackSecuritySnapshot,
  inspectPackedTarball,
  readPackSecuritySnapshot,
  rootNpmConfigPath,
  validateFirstPartyScopeRegistryPolicy,
} from './check-pack-security.mjs';
import {
  assertNoWorkspaceProtocols,
  manifestPath,
  repoRoot,
  releasePackages,
  tarballDir,
} from './release-packages.mjs';

export function packPublicPackages() {
  rmSync(tarballDir, { recursive: true, force: true });
  mkdirSync(tarballDir, { recursive: true });

  const packages = releasePackages();
  const packedPackages = [];
  const securityPackages = [];
  const inspectDir = mkdtempSync(path.join(os.tmpdir(), 'kovo-release-pack-security-'));
  const registryFindings = validateFirstPartyScopeRegistryPolicy({
    npmConfigText: readFileSync(rootNpmConfigPath, 'utf8'),
    npmConfigPath: path.relative(repoRoot, rootNpmConfigPath),
    packageNames: packages.map((pkg) => pkg.name),
  });
  assertNoPackSecurityFindings(registryFindings);

  try {
    for (const pkg of packages) {
      console.log(`Packing ${pkg.name}@${pkg.version} without lifecycle scripts`);
      const tarballPath = packWithoutLifecycleScripts(pkg, tarballDir);
      const {
        files: securityFiles,
        findings,
        manifest: packedManifest,
      } = inspectPackedTarball({
        extractBaseDir: inspectDir,
        packageJson: pkg.manifest,
        packageName: pkg.name,
        tarballPath,
      });
      assertNoPackSecurityFindings(findings);
      assertNoWorkspaceProtocols(packedManifest, `${pkg.name} packed manifest`);
      assertPackedLifecyclePolicy(packedManifest, pkg.name);
      const files = tarEntries(tarballPath);
      securityPackages.push({ files: securityFiles, name: pkg.name });
      packedPackages.push({
        dependencies: dependencySnapshot(packedManifest),
        files,
        manifest: packedManifest,
        name: pkg.name,
        sha512: `sha512-${sha512(readFileSync(tarballPath))}`,
        version: pkg.version,
        tarball: path.relative(repoRoot, tarballPath),
      });
    }

    assertSnapshotMatches(buildPackSecuritySnapshot(securityPackages), readPackSecuritySnapshot());
    writeFileSync(manifestPath, `${JSON.stringify({ packages: packedPackages }, null, 2)}\n`);
    console.log(
      `Packed and security-verified ${packedPackages.length} public packages into ${tarballDir}`,
    );
  } finally {
    rmSync(inspectDir, { recursive: true, force: true });
  }
}

function sha512(bytes) {
  return createHash('sha512').update(bytes).digest('base64');
}

function tarEntries(tarballPath) {
  return execFileSync('tar', ['-tf', tarballPath], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort();
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
