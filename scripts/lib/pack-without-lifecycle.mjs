import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

export function packWithoutLifecycleScripts(pkg, destination, { exec = execFileSync } = {}) {
  const before = new Set(readdirSync(destination).filter((file) => file.endsWith('.tgz')));
  exec('pnpm', ['--config.ignore-scripts=true', 'pack', '--pack-destination', destination], {
    cwd: pkg.dirPath,
    stdio: 'inherit',
  });
  const after = readdirSync(destination).filter((file) => file.endsWith('.tgz'));
  const created = after.filter((file) => !before.has(file));
  if (created.length !== 1) {
    throw new Error(`Expected one tarball for ${pkg.name}; found ${created.length}`);
  }
  return path.join(destination, created[0]);
}
