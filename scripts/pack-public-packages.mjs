#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  packedPackages.push({
    name: pkg.name,
    version: pkg.version,
    tarball: path.relative(repoRoot, tarballPath),
  });
}

writeFileSync(manifestPath, `${JSON.stringify({ packages: packedPackages }, null, 2)}\n`);
console.log(`Packed ${packedPackages.length} public packages into ${tarballDir}`);
