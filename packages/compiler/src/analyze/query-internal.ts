// Shared internals for the query-update analysis modules (FN10 decomposition of
// `analyze/query-updates.ts`). These helpers are used across `query-bindings.ts`,
// `query-derives.ts`, and `query-coverage.ts`. SPEC.md §5.x query-update facts.
//
// IMPORTANT: `withOutputContext` / `withOutputContexts` attach a hidden,
// non-enumerable `outputContext` / `outputContexts` side-channel via
// `Object.defineProperty`. This channel is deliberately excluded from
// `JSON.stringify` and `factHash`; it is load-bearing for byte/fact-hash
// stability. Do not convert it to a plain enumerable field.
import {
  isRelativeBindingPath,
  queryNameFromPath,
  relativeBindingPath,
} from './query-shapes.js';
import {
  jsxElements,
  type ComponentModuleModel,
  type JsxElementModel,
} from '../scan/parse.js';
import type { GeneratedOutputWriteFact } from '../output-context-facts.js';

export interface DataBindAttribute {
  name: string;
  path: string;
  query: string | null;
  relativeReadPath: string | null;
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
  Object.defineProperty(value, 'outputContext', { enumerable: false, value: outputContext });
  return value as Value & { outputContext: GeneratedOutputWriteFact };
}

export function withOutputContexts<Value extends object>(
  value: Value,
  outputContexts: readonly GeneratedOutputWriteFact[],
): Value & { outputContexts: readonly GeneratedOutputWriteFact[] } {
  Object.defineProperty(value, 'outputContexts', { enumerable: false, value: outputContexts });
  return value as Value & { outputContexts: readonly GeneratedOutputWriteFact[] };
}

export function jsxAttributes(model: ComponentModuleModel) {
  return jsxElements(model).flatMap((element) => [...element.attributes]);
}

export function hasJsxAttribute(element: JsxElementModel, name: string): boolean {
  return element.attributes.some((attribute) => attribute.name === name);
}

export function jsxStaticAttributeValue(element: JsxElementModel, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

export function isWithinElement(candidate: JsxElementModel, container: JsxElementModel): boolean {
  return candidate.start > container.start && candidate.end < container.end;
}

export function isBindingAttribute(name: string): boolean {
  return name === 'data-bind' || name.startsWith('data-bind:');
}

export function isStatePath(path: string): boolean {
  return path.startsWith('state.');
}
