// Shared internals for the query-update analysis modules (FN10 decomposition of
// `analyze/query-updates.ts`). These helpers are used across `query-bindings.ts`,
// `query-derives.ts`, and `query-coverage.ts`. SPEC.md §5.x query-update facts.
//
// IMPORTANT: `withOutputContext` / `withOutputContexts` attach a hidden,
// non-enumerable `outputContext` / `outputContexts` side-channel via
// `Object.defineProperty`. This channel is deliberately excluded from
// `JSON.stringify` and `factHash`; it is load-bearing for byte/fact-hash
// stability. Do not convert it to a plain enumerable field.
import { isRelativeBindingPath, queryNameFromPath, relativeBindingPath } from './query-shapes.js';
import {
  compilerArrayAppend,
  compilerDefineOwnDataProperty,
  compilerSnapshotDenseArray,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
import { jsxElements, type ComponentModuleModel, type JsxElementModel } from '../scan/parse.js';
import type { GeneratedOutputWriteFact } from '../output-context-facts.js';

export interface DataBindAttribute {
  end?: number;
  name: string;
  path: string;
  query: string | null;
  relativeReadPath: string | null;
  start?: number;
}

export function dataBindAttributeFact(name: string, path: string): DataBindAttribute {
  return {
    name,
    path,
    query: isRelativeBindingPath(path) ? null : queryNameFromPath(path),
    relativeReadPath: isRelativeBindingPath(path) ? relativeBindingPath(path) : null,
  };
}

export function coveragePathKey(source: 'query' | 'state', path: string): string {
  return `${source}\0${path}`;
}

export function withOutputContext<Value extends object>(
  value: Value,
  outputContext: GeneratedOutputWriteFact,
): Value & { outputContext: GeneratedOutputWriteFact } {
  compilerDefineOwnDataProperty(value, 'outputContext', outputContext, false);
  return value as Value & { outputContext: GeneratedOutputWriteFact };
}

export function withOutputContexts<Value extends object>(
  value: Value,
  outputContexts: readonly GeneratedOutputWriteFact[],
): Value & { outputContexts: readonly GeneratedOutputWriteFact[] } {
  compilerDefineOwnDataProperty(value, 'outputContexts', outputContexts, false);
  return value as Value & { outputContexts: readonly GeneratedOutputWriteFact[] };
}

export function jsxAttributes(model: ComponentModuleModel) {
  const attributes: ReturnType<typeof jsxElements>[number]['attributes'][number][] = [];
  const elements = compilerSnapshotDenseArray(jsxElements(model), 'Compiler query JSX elements');
  for (let index = 0; index < elements.length; index += 1) {
    const source = compilerSnapshotDenseArray(
      elements[index]!.attributes,
      'Compiler query JSX element attributes',
    );
    for (let attributeIndex = 0; attributeIndex < source.length; attributeIndex += 1) {
      compilerArrayAppend(attributes, source[attributeIndex]!, 'Compiler query JSX attributes');
    }
  }
  return attributes;
}

export function hasJsxAttribute(element: JsxElementModel, name: string): boolean {
  return jsxAttribute(element, name) !== undefined;
}

export function jsxStaticAttributeValue(
  element: JsxElementModel,
  name: string,
): string | undefined {
  return jsxAttribute(element, name)?.value;
}

export function isWithinElement(candidate: JsxElementModel, container: JsxElementModel): boolean {
  return candidate.start > container.start && candidate.end < container.end;
}

export function isBindingAttribute(name: string): boolean {
  return name === 'data-bind' || compilerStringStartsWith(name, 'data-bind:');
}

export function isStatePath(path: string): boolean {
  return compilerStringStartsWith(path, 'state.');
}

function jsxAttribute(
  element: JsxElementModel,
  name: string,
): JsxElementModel['attributes'][number] | undefined {
  const attributes = compilerSnapshotDenseArray(
    element.attributes,
    'Compiler query JSX attribute lookup',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    if (attributes[index]!.name === name) return attributes[index]!;
  }
  return undefined;
}
