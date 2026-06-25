#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  assertNoWorkspaceProtocols,
  manifestPath,
  repoRoot,
  releasePackages,
  tarballDir,
} from './release-packages.mjs';

rmSync(tarballDir, { recursive: true, force: true });
mkdirSync(tarballDir, { recursive: true });

const packedPackages = [];

for (const pkg of releasePackages()) {
  console.log(`Packing ${pkg.name}@${pkg.version}`);
  const before = new Set(readdirSync(tarballDir).filter((file) => file.endsWith('.tgz')));
  execFileSync('pnpm', ['pack', '--pack-destination', tarballDir], {
    cwd: pkg.dirPath,
    stdio: 'inherit',
  });
  const after = readdirSync(tarballDir).filter((file) => file.endsWith('.tgz'));
  const created = after.filter((file) => !before.has(file));
  if (created.length !== 1) {
    throw new Error(`Expected one tarball for ${pkg.name}; found ${created.length}`);
  }
  const tarballPath = path.join(tarballDir, created[0]);
  const packedManifest = JSON.parse(
    execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], { encoding: 'utf8' }),
  );
  assertNoWorkspaceProtocols(packedManifest, `${pkg.name} packed manifest`);
  assertPackedLifecyclePolicy(packedManifest, pkg.name);
  const files = tarEntries(tarballPath);
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

writeFileSync(manifestPath, `${JSON.stringify({ packages: packedPackages }, null, 2)}\n`);
console.log(`Packed ${packedPackages.length} public packages into ${tarballDir}`);

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
    throw new Error(`${label} packed manifest contains unapproved lifecycle scripts:\n  ${findings.join('\n  ')}`);
  }
}
