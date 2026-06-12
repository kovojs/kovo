import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface VendoredUiComponent {
  fileName: `${string}.tsx`;
  source: string;
}

interface UiPackageManifest {
  exports?: Record<string, string>;
  jiso?: { vendoredSource?: boolean };
  name?: string;
}

const catalogModuleDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
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
    throw new Error(`@jiso/ui vendored catalog manifest is invalid: ${uiPackageManifestPath}`);
  }
  if (parsed.name !== '@jiso/ui' || parsed.jiso?.vendoredSource !== true) {
    throw new Error(`@jiso/ui package must declare jiso.vendoredSource: ${uiPackageManifestPath}`);
  }
  return parsed;
}

function findUiPackageRoot(moduleDir: string): string {
  for (const candidate of [
    join(moduleDir, '..', '..', 'ui'),
    join(moduleDir, '..', '..', '..', 'packages', 'ui'),
  ]) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }

  throw new Error(`@jiso/ui package source was not found from ${moduleDir}`);
}

function uiPackageComponentEntries(manifest: UiPackageManifest): readonly [string, string][] {
  return Object.entries(manifest.exports ?? {})
    .flatMap(([subpath, target]): [string, string][] => {
      if (subpath === '.' || !subpath.startsWith('./')) return [];
      const name = subpath.slice(2);
      if (!isAddComponentFileName(name) || target !== `./src/${name}.tsx`) {
        throw new Error(`@jiso/ui export ${subpath} must point at ./src/${name}.tsx`);
      }
      return [[name, join(uiPackageRoot, target)]];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function readVendoredSource(sourcePath: string): string {
  const source = readFileSync(sourcePath, 'utf8');
  if (source.includes('@jiso/ui')) {
    throw new Error(`vendored @jiso/ui source must not import @jiso/ui: ${sourcePath}`);
  }
  // SPEC.md §5.2 requires fw add to vendor app-authored TSX source, not lowered IR artifacts.
  if (source.includes('fw-c=') || source.includes('data-bind=') || source.includes('@jiso-ir')) {
    throw new Error(`vendored @jiso/ui source must be TSX, not lowered IR: ${sourcePath}`);
  }
  return source.endsWith('\n') ? source : `${source}\n`;
}

function isUiPackageManifest(value: unknown): value is UiPackageManifest {
  if (!isRecord(value)) return false;
  const exportsValue = value.exports;
  const jisoValue = value.jiso;
  return (
    typeof value.name === 'string' &&
    (exportsValue === undefined ||
      (isRecord(exportsValue) &&
        Object.values(exportsValue).every((entry) => typeof entry === 'string'))) &&
    (jisoValue === undefined ||
      (isRecord(jisoValue) &&
        (jisoValue.vendoredSource === undefined || typeof jisoValue.vendoredSource === 'boolean')))
  );
}

function isAddComponentFileName(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
