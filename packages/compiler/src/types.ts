import type { ComponentExplain, KovoExplainInput } from '@kovojs/core';

import type { ComponentCssAsset } from './css.js';
import type { CompilerDiagnostic } from './diagnostics.js';
import type { PlatformSubstitution } from './lower/platform.js';
import { replaceExtension } from './shared.js';

/**
 * @internal Input to {@link compileComponentModule}: the source file name and contents plus
 * optional graph context (query shapes, registry facts, package prefixes) and provenance.
 * Lowered-IR pipeline shape; in-repo callers only (SPEC.md §5.2).
 */
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

/**
 * @internal Per-component graph fact (name, queries, fragment targets) the compiler derives
 * and {@link deriveAppGraph} merges. Lowered-IR fact shape; in-repo use only (SPEC.md §5.2).
 */
export type ComponentGraphFact = Pick<ComponentExplain, 'fragments' | 'name' | 'queries'>;

/**
 * @internal A component's fragment-target fact (target name + props type) used when building
 * the registry. Lowered-IR fact shape; in-repo use only (SPEC.md §5.2).
 */
export interface FragmentTargetFact {
  propsType: string;
  target: string;
}

/**
 * @internal Derived registry facts for an app graph (components, domain keys, invalidations,
 * mutation/query type maps, routes). Produced by {@link deriveAppGraph}; lowered-IR shape,
 * in-repo use only (SPEC.md §5.2).
 */
export interface RegistryFacts {
  components?: readonly string[];
  domainKeys?: readonly string[];
  invalidations?: Readonly<Record<string, readonly string[]>>;
  mutations?: RegistryTypeFacts;
  queries?: RegistryTypeFacts;
  routes?: readonly string[];
}

/** @internal Map of registry entry name to its emitted TypeScript type source. In-repo use only. */
export type RegistryTypeFacts = Readonly<Record<string, string>>;

/**
 * @internal The graph slice {@link deriveRegistryFactsFromGraph} reads from a Kovo explain
 * input. Lowered-IR shape; in-repo use only (SPEC.md §5.2).
 */
export type RegistryGraphInput = Pick<
  KovoExplainInput,
  'components' | 'mutations' | 'packageComponentPrefixes' | 'pages' | 'queries'
>;

/** @internal Optional mutation/query type maps threaded into registry-fact derivation. */
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

/**
 * @internal One emitted lowered-IR artifact (server/client/css/registry file name, kind, and
 * source). Carried in {@link CompileResult}; in-repo use only (SPEC.md §5.2).
 */
export interface EmittedFile {
  fileName: string;
  kind: 'client' | 'css' | 'registry' | 'server';
  source: string;
}

/**
 * @internal The derived artifact file names for a compiled component (client/css/registry/
 * server). Lowered-IR pipeline shape; in-repo use only (SPEC.md §5.2).
 */
export interface CompileArtifactFileNames {
  client: string;
  css: string;
  registry: string;
  server: string;
}

/**
 * @internal The full result of {@link compileComponentModule}: emitted artifacts, graph
 * facts, diagnostics, lowered source, CSS assets, platform substitutions, query update
 * plans/coverage, render-equivalence checks, and view-transition stamps. App authors call
 * `compileComponentModule` but consume its result through the public assertion helpers;
 * this shape itself is lowered-IR detail (SPEC.md §5.2).
 */
export interface CompileResult {
  clientExports: readonly string[];
  componentGraphFacts: readonly ComponentGraphFact[];
  cssAssets: readonly ComponentCssAsset[];
  diagnostics: readonly CompilerDiagnostic[];
  files: readonly EmittedFile[];
  handlerExports: readonly string[];
  loweredSource: string | null;
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
  clientConstants?: readonly ClientConstantDependency[];
  clientImports?: readonly ClientImportDependency[];
  expression: string;
  // SPEC §5.2: typed fact (threaded from the parser) marking a bare-named-reference handler such as
  // `onClick={handleClick}`, so client emit chooses the call-through body without re-deciding from
  // the raw `expression` snippet.
  isBareNamedHandler: boolean;
  params: ElementParam[];
  diagnostic?: CompilerDiagnostic;
  diagnostics?: readonly CompilerDiagnostic[];
}

export interface ClientImportDependency {
  importedName: string;
  localName: string;
  moduleSpecifier: string;
}

export interface ClientConstantDependency {
  name: string;
  source: string;
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
  return `kovo-param-types="${entries}"`;
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

/**
 * @internal Construct an empty {@link CompileResult} (all collections empty, no lowered
 * source). Used internally as the base for pass-through/no-op compiles (SPEC.md §5.2).
 */
export function createEmptyCompileResult(): CompileResult {
  return {
    clientExports: [],
    componentGraphFacts: [],
    cssAssets: [],
    diagnostics: [],
    files: [],
    handlerExports: [],
    loweredSource: null,
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

/** @internal A view-transition stamp (transition name) emitted by the compiler. SPEC.md §5.2. */
export interface ViewTransitionStamp {
  name: string;
}

/**
 * @internal A package's component-name prefix fact (package name, configured/effective
 * prefix, idref behavior attributes) used during lowering and registry derivation. In-repo
 * use only (SPEC.md §5.2).
 */
export interface PackageComponentPrefixFact {
  idrefBehaviorAttributes?: readonly string[];
  effectivePrefix?: string;
  packageName: string;
  prefix?: string | null;
}

/**
 * @internal A compiled query-update plan for one component/query: the bound paths, derives,
 * and DOM stamps the client loader replays on data change. Lowered-IR fact; in-repo use only
 * (SPEC.md §5.2).
 */
export interface QueryUpdatePlanFact {
  componentName: string;
  derives?: readonly QueryDeriveFact[];
  paths: readonly string[];
  query: string;
  stamps?: readonly QueryStampFact[];
  templateStamps?: readonly QueryTemplateStampFact[];
}

/**
 * @internal A derived-value fact within a query update plan (selector expression, exported
 * client function, input/param names). Lowered-IR fact; in-repo use only (SPEC.md §5.2).
 */
export interface QueryDeriveFact {
  expression: string;
  exportName: string;
  input: string;
  name: string;
  param: string;
  selector: string;
}

export interface StateDeriveFact {
  attr?: string;
  expression: string;
  exportName: string;
  input: 'state';
  name: string;
  param: 'state';
  placeholder: string;
}

/**
 * @internal A DOM stamp fact binding a derived value to an element attribute/selector within
 * a query update plan. Lowered-IR fact; in-repo use only (SPEC.md §5.2).
 */
export interface QueryStampFact {
  attr: string;
  derive: QueryDeriveFact;
  selector: string;
}

/**
 * @internal A list-template stamp fact: the per-item template, key, and read paths a query
 * update plan uses to re-render a list on data change. Lowered-IR fact; in-repo use only
 * (SPEC.md §5.2).
 */
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

/**
 * @internal A coverage fact recording how one query/state binding site is handled by the
 * lowered update plan (isomorphic, fragment, plan, render-once, or UNHANDLED). Drives
 * verification; lowered-IR fact, in-repo use only (SPEC.md §5.2).
 */
export interface QueryUpdateCoverageFact {
  componentName: string;
  detail?: string;
  position: string;
  query: string;
  source?: 'query' | 'state';
  sourceSpan?: { length: number; start: number };
  status: 'UNHANDLED' | 'fragment' | 'isomorphic' | 'plan' | 'renderOnce';
}

/**
 * @internal One render-equivalence check result (artifact name, expected vs actual render,
 * pass flag) consumed by {@link assertRenderEquivalence}. Lowered-IR fact; in-repo use only
 * (SPEC.md §5.2 rule 3).
 */
export interface RenderEquivalenceCheck {
  actual: string;
  artifact: string;
  expected: string;
  ok: boolean;
}

/**
 * @internal Structural shape of a query result (primitive kind, array, object, or
 * nullable/optional wrapper) the compiler infers to type and stamp query bindings.
 * Lowered-IR fact; in-repo use only (SPEC.md §5.2).
 */
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

/** @internal A nullable/optional wrapper around a {@link QueryShape}. In-repo use only. */
export interface QueryShapeWrapper {
  kind: 'nullable' | 'optional';
  shape: QueryShape;
}

/**
 * @internal A query-shape fact (query name, inferred {@link QueryShape}, source) threaded
 * into compilation. Lowered-IR fact; in-repo use only (SPEC.md §5.2).
 */
export interface QueryShapeFact {
  query: string;
  shape: QueryShape;
  source: string;
}

/**
 * @internal Index {@link QueryShapeFact}s by query name into the record the compiler reads.
 * In-repo use only (SPEC.md §5.2).
 */
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
