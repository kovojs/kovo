import { kebabCase } from './shared.js';
import type { ComponentModel } from './scan/parse.js';

export interface DerivedComponentNames {
  domName: string;
  registryKey: string;
}

export function deriveComponentNames(
  fileName: string,
  component: Pick<ComponentModel, 'localName'> | null | undefined,
): DerivedComponentNames {
  const domName = kebabCase(component?.localName ?? fallbackComponentBindingName(fileName));
  const namespace = componentRegistryNamespace(fileName);
  return {
    domName,
    registryKey: namespace ? `${namespace}/${domName}` : domName,
  };
}

export function componentRegistryNamespace(fileName: string): string {
  const normalized = fileName.replaceAll('\\', '/').replace(/\.[^./]+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  const fixtureRoot = fixtureRootIndex(parts);
  const srcRoot = nearestSrcRootIndex(parts);
  const root = fixtureRoot ?? srcRoot;
  const relative = root === undefined ? parts : parts.slice(root + 1);
  return relative.map(kebabCase).join('/');
}

function fixtureRootIndex(parts: readonly string[]): number | undefined {
  for (let index = 0; index <= parts.length - 3; index += 1) {
    if (
      parts[index] === 'tests' &&
      parts[index + 1] === 'integration' &&
      parts[index + 2] === 'fixtures'
    ) {
      return index + 2;
    }
  }
  return undefined;
}

function nearestSrcRootIndex(parts: readonly string[]): number | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index] === 'src') return index;
  }
  return undefined;
}

function fallbackComponentBindingName(fileName: string): string {
  const baseName =
    fileName
      .replace(/\.[^.]+$/, '')
      .split(/[\\/]/)
      .at(-1) ?? 'component';
  return baseName
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
}
