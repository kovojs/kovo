import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';

const requireFromCli = createRequire(import.meta.url);

/** @internal Resolve and authenticate the pinned implementation runner behind Kovo commands. */
export function resolveVitePlusBin(): string {
  const { manifest, manifestPath } = vitePlusManifest();
  if (
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

export interface VitePlusQualityBin {
  readonly configModule: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly executable: string;
}

/**
 * Resolve the exact formatter/linter implementation pinned by Vite Plus without loading its
 * umbrella CLI. The package-level pin remains the authority; callers cannot substitute a
 * separately hoisted tool or version.
 */
export function resolveVitePlusQualityBin(tool: 'oxfmt' | 'oxlint'): VitePlusQualityBin {
  const { manifest: vitePlus, manifestPath: vitePlusManifestPath } = vitePlusManifest();
  const expectedVersion = vitePlus.dependencies?.[tool];
  if (
    typeof vitePlus.version !== 'string' ||
    vitePlus.version.length === 0 ||
    typeof expectedVersion !== 'string' ||
    !expectedVersion.startsWith('=') ||
    expectedVersion.length === 1
  ) {
    throw new TypeError(`vite-plus package does not exactly pin ${tool}`);
  }

  const requireFromVitePlus = createRequire(vitePlusManifestPath);
  const toolManifestPath = requireFromVitePlus.resolve(`${tool}/package.json`);
  const toolManifest = packageManifest(toolManifestPath, tool);
  if (toolManifest.name !== tool || `=${String(toolManifest.version)}` !== expectedVersion) {
    throw new TypeError(`vite-plus ${tool} dependency does not match its exact package pin`);
  }
  if (
    typeof toolManifest.bin !== 'object' ||
    toolManifest.bin === null ||
    toolManifest.bin[tool] === undefined ||
    typeof toolManifest.bin[tool] !== 'string'
  ) {
    throw new TypeError(`${tool} package does not declare its ${tool} executable`);
  }

  const packageRoot = realpathSync(dirname(toolManifestPath));
  const unresolvedExecutable = resolve(packageRoot, toolManifest.bin[tool]);
  const relativeExecutable = relative(packageRoot, unresolvedExecutable);
  if (
    relativeExecutable.length === 0 ||
    relativeExecutable === '..' ||
    relativeExecutable.startsWith(`..${sep}`)
  ) {
    throw new TypeError(`${tool} package executable escapes its package root`);
  }
  const stats = lstatSync(unresolvedExecutable);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new TypeError(`${tool} package executable is not a regular package file`);
  }
  const executable = realpathSync(unresolvedExecutable);
  if (executable !== unresolvedExecutable) {
    throw new TypeError(`${tool} package executable does not have stable package identity`);
  }
  const vitePlusRoot = realpathSync(dirname(vitePlusManifestPath));
  const configModule = realpathSync(requireFromVitePlus.resolve('vite-plus'));
  if (configModule !== vitePlusRoot && !configModule.startsWith(`${vitePlusRoot}${sep}`)) {
    throw new TypeError('vite-plus config module escapes its package root');
  }
  const configModuleStats = lstatSync(configModule);
  if (!configModuleStats.isFile() || configModuleStats.isSymbolicLink()) {
    throw new TypeError('vite-plus config module is not a regular package file');
  }
  const environment: Record<string, string> = {};
  if (tool === 'oxlint') {
    const tsgolintPath = realpathSync(requireFromVitePlus.resolve('oxlint-tsgolint/bin/tsgolint'));
    const tsgolintStats = lstatSync(tsgolintPath);
    if (!tsgolintStats.isFile() || tsgolintStats.isSymbolicLink()) {
      throw new TypeError('oxlint-tsgolint executable is not a regular package file');
    }
    const tsgolintManifestPath = requireFromVitePlus.resolve('oxlint-tsgolint/package.json');
    const tsgolintManifest = packageManifest(tsgolintManifestPath, 'oxlint-tsgolint');
    if (vitePlus.dependencies?.['oxlint-tsgolint'] !== `=${String(tsgolintManifest.version)}`) {
      throw new TypeError(
        'vite-plus oxlint-tsgolint dependency does not match its exact package pin',
      );
    }
    environment.OXLINT_TSGOLINT_PATH = tsgolintPath;
  }
  return { configModule, environment, executable };
}

function vitePlusManifest(): {
  readonly manifest: PackageManifest;
  readonly manifestPath: string;
} {
  const manifestPath = requireFromCli.resolve('vite-plus/package.json');
  return { manifest: packageManifest(manifestPath, 'vite-plus'), manifestPath };
}

interface PackageManifest {
  readonly bin?: Record<string, unknown>;
  readonly dependencies?: Record<string, unknown>;
  readonly name?: unknown;
  readonly version?: unknown;
}

function packageManifest(path: string, label: string): PackageManifest {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new TypeError(`${label} package manifest is not a regular package file`);
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new TypeError(`${label} package manifest is invalid`);
  }
  return manifest;
}
