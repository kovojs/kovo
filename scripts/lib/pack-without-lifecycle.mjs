import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import {
  canonicalizePackedTarball,
  deterministicPackEnvironment,
} from './deterministic-tarball.mjs';

export function packWithoutLifecycleScripts(
  pkg,
  destination,
  { env = process.env, exec = execFileSync } = {},
) {
  const before = new Set(readdirSync(destination).filter((file) => file.endsWith('.tgz')));
  exec('pnpm', ['--config.ignore-scripts=true', 'pack', '--pack-destination', destination], {
    cwd: pkg.dirPath,
    env: deterministicPackEnvironment(env),
    stdio: 'inherit',
  });
  const after = readdirSync(destination).filter((file) => file.endsWith('.tgz'));
  const created = after.filter((file) => !before.has(file));
  if (created.length !== 1) {
    throw new Error(`Expected one tarball for ${pkg.name}; found ${created.length}`);
  }
  const tarballPath = path.join(destination, created[0]);
  canonicalizePackedTarball(tarballPath);
  return tarballPath;
}
