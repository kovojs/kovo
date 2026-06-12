import type { RegistryFacts } from './graph.js';
import type { PackageComponentPrefixFact } from './validate/package-prefixes.js';

export interface CompileComponentOptions {
  fileName: string;
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
  queryShapeFacts?: readonly QueryShapeFact[];
  queryShapes?: Record<string, QueryShape>;
  registryFacts?: RegistryFacts;
  source: string;
  sourceProvenance?: 'app' | 'compiler-emitted';
}

export interface QueryUpdatePlanFact {
  componentName: string;
  derives?: readonly QueryDeriveFact[];
  paths: readonly string[];
  query: string;
  stamps?: readonly QueryStampFact[];
  templateStamps?: readonly QueryTemplateStampFact[];
}

export interface QueryDeriveFact {
  expression: string;
  exportName: string;
  input: string;
  name: string;
  param: string;
  selector: string;
}

export interface QueryStampFact {
  attr: string;
  derive: QueryDeriveFact;
  selector: string;
}

export interface QueryTemplateStampFact {
  itemBindings: readonly string[];
  itemBindingPlaceholders?: readonly QueryTemplateStampBindingPlaceholder[];
  key: string;
  list: string;
  selector: string;
  template: string;
}

export interface QueryTemplateStampBindingPlaceholder {
  path: string;
  value: string;
}

export interface QueryUpdateCoverageFact {
  componentName: string;
  detail?: string;
  position: string;
  query: string;
  sourceSpan?: { length: number; start: number };
  status: 'UNHANDLED' | 'fragment' | 'isomorphic' | 'plan' | 'renderOnce';
}

export interface RenderEquivalenceCheck {
  actual: string;
  artifact: string;
  expected: string;
  ok: boolean;
}

export type QueryShape =
  | 'array'
  | 'boolean'
  | 'number'
  | 'object'
  | 'string'
  | QueryShapeWrapper
  | readonly QueryShape[]
  | {
      readonly [key: string]: QueryShape;
    };

export interface QueryShapeWrapper {
  kind: 'nullable' | 'optional';
  shape: QueryShape;
}

export interface QueryShapeFact {
  query: string;
  shape: QueryShape;
  source: string;
}

export function queryShapesFromFacts(facts: readonly QueryShapeFact[]): Record<string, QueryShape> {
  return Object.fromEntries(facts.map((fact) => [fact.query, fact.shape]));
}

export function isArrayQueryShape(shape: QueryShape): shape is readonly QueryShape[] {
  return Array.isArray(shape);
}

export function unwrapQueryShape(shape: QueryShape): QueryShape {
  let current = shape;
  while (isQueryShapeWrapper(current)) current = current.shape;
  return current;
}

export function isQueryShapeWrapper(shape: QueryShape): shape is QueryShapeWrapper {
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) return false;
  const record = shape as Record<string, unknown>;
  return (record.kind === 'nullable' || record.kind === 'optional') && 'shape' in shape;
}

export function isQueryShapeObject(
  shape: QueryShape,
): shape is { readonly [key: string]: QueryShape } {
  return (
    typeof shape === 'object' &&
    shape !== null &&
    !Array.isArray(shape) &&
    !isQueryShapeWrapper(shape)
  );
}
