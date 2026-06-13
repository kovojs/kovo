import type { ComponentExplain, FwExplainInput } from '@jiso/core';

import type { ComponentCssAsset } from './css.js';
import type { CompilerDiagnostic } from './diagnostics.js';
import type { PlatformSubstitution } from './lower/platform.js';
import { replaceExtension } from './shared.js';

export interface CompileComponentOptions {
  fileName: string;
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
  packagePrefixDiscoveryRoot?: string;
  queryShapeFacts?: readonly QueryShapeFact[];
  queryShapes?: Record<string, QueryShape>;
  registryFacts?: RegistryFacts;
  source: string;
  sourceProvenance?: 'app' | 'compiler-emitted';
}

export type ComponentGraphFact = Pick<ComponentExplain, 'fragments' | 'name' | 'queries'>;

export interface FragmentTargetFact {
  propsType: string;
  target: string;
}

export interface RegistryFacts {
  components?: readonly string[];
  domainKeys?: readonly string[];
  invalidations?: Readonly<Record<string, readonly string[]>>;
  mutations?: RegistryTypeFacts;
  queries?: RegistryTypeFacts;
  routes?: readonly string[];
}

export type RegistryTypeFacts = Readonly<Record<string, string>>;

export type RegistryGraphInput = Pick<
  FwExplainInput,
  'components' | 'mutations' | 'packageComponentPrefixes' | 'pages' | 'queries'
>;

export interface RegistryTypeFactOptions {
  mutations?: RegistryTypeFacts;
  queries?: RegistryTypeFacts;
}

export interface CompileAppGraphOptions {
  components?: readonly { componentGraphFacts: readonly ComponentGraphFact[] }[];
  graph?: RegistryGraphInput;
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
  registryTypes?: RegistryTypeFactOptions;
}

export interface CompileAppGraphResult {
  graph: RegistryGraphInput;
  registryFacts: RegistryFacts;
}

export interface EmittedFile {
  fileName: string;
  kind: 'client' | 'css' | 'registry' | 'server';
  source: string;
}

export interface CompileArtifactFileNames {
  client: string;
  css: string;
  registry: string;
  server: string;
}

export interface CompileResult {
  componentGraphFacts: readonly ComponentGraphFact[];
  cssAssets: readonly ComponentCssAsset[];
  diagnostics: readonly CompilerDiagnostic[];
  files: readonly EmittedFile[];
  handlerExports: readonly string[];
  platformSubstitutions: readonly PlatformSubstitution[];
  queryUpdatePlans: readonly QueryUpdatePlanFact[];
  renderEquivalenceChecks: readonly RenderEquivalenceCheck[];
  updateCoverage: readonly QueryUpdateCoverageFact[];
  viewTransitions: readonly ViewTransitionStamp[];
}

export interface HandlerLowering {
  exportName: string;
  attributeName: string;
  attributeEnd: number;
  attributeStart: number;
  attributeValue: string;
  arrowBody?: HandlerArrowBody;
  expression: string;
  params: ElementParam[];
  diagnostic?: CompilerDiagnostic;
  diagnostics?: readonly CompilerDiagnostic[];
}

export interface HandlerArrowBody {
  kind: 'block' | 'expression';
  propertyAccesses: readonly HandlerArrowBodyPropertyAccess[];
  references: readonly HandlerArrowBodyReference[];
  source: string;
  sourceStart: number;
}

export interface HandlerArrowBodyPropertyAccess {
  end: number;
  path: string;
  start: number;
}

export interface HandlerArrowBodyReference {
  end: number;
  name: string;
  start: number;
}

export interface ElementParam {
  attributeName: string;
  expression: string;
  type: ElementParamType;
  value: string;
}

export type ElementParamType = 'boolean' | 'number' | 'string';

export function emitElementParamTypes(params: readonly ElementParam[]): string {
  const typedParams = params.filter((param) => param.type !== 'string');
  if (typedParams.length === 0) return '';

  const entries = typedParams
    .map((param) => `${elementParamNameFromAttribute(param.attributeName)}:${param.type}`)
    .join(',');
  return `fw-param-types="${entries}"`;
}

export function elementParamAttributeNameFromPropertyName(name: string): string {
  return `data-p-${name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()}`;
}

export function elementParamNameFromAttribute(attributeName: string): string {
  return attributeName
    .replace(/^data-p-/, '')
    .replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

export function createEmptyCompileResult(): CompileResult {
  return {
    componentGraphFacts: [],
    cssAssets: [],
    diagnostics: [],
    files: [],
    handlerExports: [],
    platformSubstitutions: [],
    queryUpdatePlans: [],
    renderEquivalenceChecks: [],
    updateCoverage: [],
    viewTransitions: [],
  };
}

export function emittedFileKind(fileName: string): EmittedFile['kind'] {
  if (fileName.endsWith('.client.js')) return 'client';
  if (fileName.endsWith('.css')) return 'css';
  if (fileName.endsWith('.server.js')) return 'server';
  return 'registry';
}

export function compileArtifactFileNames(fileName: string): CompileArtifactFileNames {
  return {
    client: replaceExtension(fileName, '.client.js'),
    css: replaceExtension(fileName, '.css'),
    registry: 'generated/registries.d.ts',
    server: replaceExtension(fileName, '.server.js'),
  };
}

export interface ViewTransitionStamp {
  name: string;
}

export interface PackageComponentPrefixFact {
  idrefBehaviorAttributes?: readonly string[];
  effectivePrefix?: string;
  packageName: string;
  prefix?: string | null;
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
  itemBindingPlaceholders?: readonly QueryTemplateStampBindingPlaceholder[];
  key: string;
  list: string;
  listReadPath: string;
  listReadSegments: readonly BindingPathSegmentFact[];
  selector: string;
  template: string;
}

export interface QueryTemplateStampBindingPlaceholder {
  path: string;
  readPath: string;
  readSegments: readonly BindingPathSegmentFact[];
  templateEnd: number;
  templateStart: number;
  value: string;
}

export interface BindingPathSegmentFact {
  name: string;
  optional: boolean;
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
