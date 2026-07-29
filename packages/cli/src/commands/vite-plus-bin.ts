import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const requireFromCli = createRequire(import.meta.url);

/** @internal Resolve and authenticate the pinned implementation runner behind Kovo commands. */
export function resolveVitePlusBin(): string {
  const manifestPath = requireFromCli.resolve('vite-plus/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('bin' in manifest) ||
    typeof manifest.bin !== 'object' ||
    manifest.bin === null ||
    !('vp' in manifest.bin) ||
    typeof manifest.bin.vp !== 'string'
  ) {
    throw new TypeError('vite-plus package does not declare its vp executable');
  }
  const path = resolve(dirname(manifestPath), manifest.bin.vp);
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new TypeError('vite-plus vp executable is not a regular package file');
  }
  return realpathSync(path);
}
