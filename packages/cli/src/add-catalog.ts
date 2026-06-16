import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface VendoredUiComponent {
  fileName: `${string}.tsx`;
  source: string;
}

interface UiPackageManifest {
  exports?: Record<string, string>;
  kovo?: { vendoredSource?: boolean };
  name?: string;
}

const catalogModuleDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
const catalogRequire = createRequire(import.meta.url);
const uiPackageRoot = findUiPackageRoot(catalogModuleDir);
const uiPackageManifestPath = join(uiPackageRoot, 'package.json');
const uiPackageManifest = readUiPackageManifest();

export const vendoredUiComponents = Object.freeze(
  Object.fromEntries(
    uiPackageComponentEntries(uiPackageManifest).map(([name, sourcePath]) => [
      name,
      {
        fileName: `${name}.tsx`,
        source: readVendoredSource(sourcePath),
      },
    ]),
  ),
) as Readonly<Record<string, VendoredUiComponent>>;

export type AddComponentName = keyof typeof vendoredUiComponents;

export function availableAddComponents(): string {
  return Object.keys(vendoredUiComponents).sort().join(', ');
}

export function isAddComponentName(value: string): value is AddComponentName {
  return Object.hasOwn(vendoredUiComponents, value);
}

function readUiPackageManifest(): UiPackageManifest {
  const parsed = JSON.parse(readFileSync(uiPackageManifestPath, 'utf8')) as unknown;
  if (!isUiPackageManifest(parsed)) {
    throw new Error(`@kovojs/ui vendored catalog manifest is invalid: ${uiPackageManifestPath}`);
  }
  if (parsed.name !== '@kovojs/ui' || parsed.kovo?.vendoredSource !== true) {
    throw new Error(
      `@kovojs/ui package must declare kovo.vendoredSource: ${uiPackageManifestPath}`,
    );
  }
  return parsed;
}

function findUiPackageRoot(moduleDir: string): string {
  const packageRoot = resolveInstalledUiPackageRoot();
  if (packageRoot !== undefined) return packageRoot;

  for (const candidate of [
    join(moduleDir, '..', '..', 'ui'),
    join(moduleDir, '..', '..', '..', 'packages', 'ui'),
  ]) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }

  throw new Error(`@kovojs/ui package source was not found from ${moduleDir}`);
}

function resolveInstalledUiPackageRoot(): string | undefined {
  try {
    return findPackageRoot(dirname(realpathSync(catalogRequire.resolve('@kovojs/ui'))));
  } catch {
    return undefined;
  }
}

function findPackageRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`package root was not found from ${startDir}`);
    current = parent;
  }
}

function uiPackageComponentEntries(manifest: UiPackageManifest): readonly [string, string][] {
  return Object.entries(manifest.exports ?? {})
    .flatMap(([subpath, target]): [string, string][] => {
      if (subpath === '.' || !subpath.startsWith('./')) return [];
      const name = subpath.slice(2);
      if (!isAddComponentFileName(name) || target !== `./src/${name}.tsx`) {
        throw new Error(`@kovojs/ui export ${subpath} must point at ./src/${name}.tsx`);
      }
      return [[name, join(uiPackageRoot, target)]];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function readVendoredSource(sourcePath: string): string {
  const source = readFileSync(sourcePath, 'utf8');
  if (source.includes('@kovojs/ui')) {
    throw new Error(`vendored @kovojs/ui source must not import @kovojs/ui: ${sourcePath}`);
  }
  // SPEC.md §5.2 requires kovo add to vendor app-authored TSX source, not lowered IR artifacts.
  if (
    source.includes('kovo-c=') ||
    source.includes('data-bind=') ||
    source.includes('@kovojs-ir')
  ) {
    throw new Error(`vendored @kovojs/ui source must be TSX, not lowered IR: ${sourcePath}`);
  }
  return source.endsWith('\n') ? source : `${source}\n`;
}

function isUiPackageManifest(value: unknown): value is UiPackageManifest {
  if (!isRecord(value)) return false;
  const exportsValue = value.exports;
  const kovoValue = value.kovo;
  return (
    typeof value.name === 'string' &&
    (exportsValue === undefined ||
      (isRecord(exportsValue) &&
        Object.values(exportsValue).every((entry) => typeof entry === 'string'))) &&
    (kovoValue === undefined ||
      (isRecord(kovoValue) &&
        (kovoValue.vendoredSource === undefined || typeof kovoValue.vendoredSource === 'boolean')))
  );
}

function isAddComponentFileName(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
