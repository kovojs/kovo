import { matchRoute } from '@kovojs/core/internal/route-pattern';

import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateSet,
  compilerFailClosed,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
  compilerStringIndexOf,
  compilerStringSlice,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import { jsxElements, type ComponentModuleModel } from '../scan/parse.js';
import type { CompileComponentOptions } from '../types.js';

interface LiteralNavigationTarget {
  index: number;
  length: number;
  value: string;
}

export function validateLiteralHrefs(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const routes = options.registryFacts?.routes;
  if (!routes) return [];

  const result: CompilerDiagnostic[] = [];
  const reported = compilerCreateSet<string>();
  const targets = literalNavigationTargets(model);
  const targetLength = compilerArrayLength(targets, 'Literal navigation targets');
  const routeLength = compilerArrayLength(routes, 'Registry route paths');
  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    const target = compilerOwnDataValue(targets, targetIndex, 'Literal navigation targets') as
      | LiteralNavigationTarget
      | undefined;
    if (!target) {
      compilerFailClosed(`Literal navigation targets[${targetIndex}] must be own data.`);
    }
    if (isExternalNavigationTarget(target.value)) continue;

    let matched = false;
    for (let routeIndex = 0; routeIndex < routeLength; routeIndex += 1) {
      const routePath = compilerOwnDataValue(routes, routeIndex, 'Registry route paths');
      if (typeof routePath !== 'string') {
        compilerFailClosed(`Registry route paths[${routeIndex}] must be a string.`);
      }
      if (routePathMatchesUrl(routePath, target.value)) {
        matched = true;
        break;
      }
    }
    if (matched || compilerSetHas(reported, target.value)) continue;
    compilerSetAdd(reported, target.value);
    compilerArrayAppend(
      result,
      diagnostics.at('KV220', { start: target.index, length: target.length }, target.value),
      'Literal navigation diagnostics',
    );
  }

  return result;
}

function literalNavigationTargets(model: ComponentModuleModel): LiteralNavigationTarget[] {
  const result: LiteralNavigationTarget[] = [];
  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Literal navigation elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(elements, elementIndex, 'Literal navigation elements') as
      | (typeof elements)[number]
      | undefined;
    if (!element) {
      compilerFailClosed(`Literal navigation elements[${elementIndex}] must be own data.`);
    }
    const attributeLength = compilerArrayLength(
      element.attributes,
      'Literal navigation attributes',
    );
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Literal navigation attributes',
      ) as (typeof element.attributes)[number] | undefined;
      if (!attribute) {
        compilerFailClosed(`Literal navigation attributes[${attributeIndex}] must be own data.`);
      }
      if ((attribute.name !== 'href' && attribute.name !== 'action') || !attribute.value) continue;
      compilerArrayAppend(
        result,
        {
          index: attribute.start,
          length: attribute.end - attribute.start,
          value: attribute.value,
        },
        'Literal navigation target facts',
      );
    }
  }
  return result;
}

function isExternalNavigationTarget(target: string): boolean {
  return (
    compilerStringStartsWith(target, '#') ||
    compilerStringStartsWith(target, 'mailto:') ||
    compilerStringStartsWith(target, 'tel:') ||
    compilerRegExpTest(/^[a-z][a-z0-9+.-]*:\/\//i, target)
  );
}

function routePathMatchesUrl(routePath: string, target: string): boolean {
  const queryIndex = compilerStringIndexOf(target, '?');
  const hashIndex = compilerStringIndexOf(target, '#');
  const boundary =
    queryIndex < 0
      ? hashIndex
      : hashIndex < 0
        ? queryIndex
        : queryIndex < hashIndex
          ? queryIndex
          : hashIndex;
  const pathname = boundary < 0 ? target : compilerStringSlice(target, 0, boundary);
  return matchRoute([{ path: routePath }], pathname) !== undefined;
}
