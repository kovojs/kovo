import { kebabCase } from './shared.js';
import type { ComponentModel } from './scan/parse.js';
import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerFailClosed,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringToUpperCase,
} from './compiler-security-intrinsics.js';

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
  const normalized = compilerRegExpReplace(
    /\.[^./]+$/u,
    compilerStringReplaceAll(fileName, '\\', '/'),
    '',
  );
  const rawParts = compilerStringSplit(normalized, '/');
  const parts: string[] = [];
  const rawPartLength = compilerArrayLength(rawParts, 'Component registry path parts');
  for (let index = 0; index < rawPartLength; index += 1) {
    const part = ownStringEntry(rawParts, index, 'Component registry path parts');
    if (part) compilerArrayAppend(parts, part, 'Component registry path parts');
  }
  const fixtureRoot = fixtureRootIndex(parts);
  const srcRoot = nearestSrcRootIndex(parts);
  const root = fixtureRoot ?? srcRoot;
  const names: string[] = [];
  const partLength = compilerArrayLength(parts, 'Component registry path parts');
  for (let index = root === undefined ? 0 : root + 1; index < partLength; index += 1) {
    compilerArrayAppend(
      names,
      kebabCase(ownStringEntry(parts, index, 'Component registry path parts')),
      'Component registry namespace parts',
    );
  }
  return compilerArrayJoin(names, '/');
}

function fixtureRootIndex(parts: readonly string[]): number | undefined {
  for (let index = 0; index <= parts.length - 3; index += 1) {
    if (
      ownStringEntry(parts, index, 'Component registry path parts') === 'tests' &&
      ownStringEntry(parts, index + 1, 'Component registry path parts') === 'integration' &&
      ownStringEntry(parts, index + 2, 'Component registry path parts') === 'fixtures'
    ) {
      return index + 2;
    }
  }
  return undefined;
}

function nearestSrcRootIndex(parts: readonly string[]): number | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (ownStringEntry(parts, index, 'Component registry path parts') === 'src') return index;
  }
  return undefined;
}

function fallbackComponentBindingName(fileName: string): string {
  const pathParts = compilerStringSplit(
    compilerStringReplaceAll(compilerRegExpReplace(/\.[^.]+$/u, fileName, ''), '\\', '/'),
    '/',
  );
  const pathPartLength = compilerArrayLength(pathParts, 'Component fallback path parts');
  const baseName =
    pathPartLength === 0
      ? 'component'
      : ownStringEntry(pathParts, pathPartLength - 1, 'Component fallback path parts');
  const rawWords = compilerStringSplit(compilerStringReplaceAll(baseName, '_', '-'), '-');
  const words: string[] = [];
  const rawWordLength = compilerArrayLength(rawWords, 'Component fallback name words');
  for (let index = 0; index < rawWordLength; index += 1) {
    const part = ownStringEntry(rawWords, index, 'Component fallback name words');
    if (!part) continue;
    compilerArrayAppend(
      words,
      `${compilerStringToUpperCase(compilerStringSlice(part, 0, 1))}${compilerStringSlice(part, 1)}`,
      'Component fallback name words',
    );
  }
  return compilerArrayJoin(words, '');
}

function ownStringEntry(values: readonly string[], index: number, label: string): string {
  const value = compilerOwnDataValue(values, index, label);
  if (typeof value !== 'string') compilerFailClosed(`${label}[${index}] must be a string.`);
  return value;
}
