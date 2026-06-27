import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';

import type { ComponentCssAsset } from './css.js';
import { diagnosticFor, type CompilerDiagnostic } from './diagnostics.js';
import type { PlatformSubstitution } from './lower/platform.js';
import type { GeneratedOutputWriteFact } from './output-context-facts.js';
import { normalizeComponentFileName, replaceExtension } from './shared.js';
import type { CompilerEmittedSourceProvenance } from './source-provenance.js';

/**
 * Input to {@link compileComponentModule}: the source file name and contents plus optional
 * graph context (query shapes, registry facts, package prefixes) and provenance. Public
 * build/codegen contract for compiler entrypoints (SPEC.md §5.2).
 */
export interface CompileComponentOptions {
  fileName: string;
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
  packagePrefixDiscoveryRoot?: string;
  previousRegistryFacts?: RegistryFacts;
  productionRenderPlanGate?: ProductionRenderPlanGateOptions;
  queryShapeFacts?: readonly QueryShapeFact[];
  queryShapes?: Record<string, QueryShape>;
  registryFacts?: RegistryFacts;
  source: string;
  sourceProvenance?: 'app';
}

/** @internal Compiler-owned options used when re-reading emitted artifacts for SPEC.md §5.2. */
export interface InternalCompileComponentOptions extends Omit<
  CompileComponentOptions,
  'sourceProvenance'
> {
  sourceProvenance?: 'app' | CompilerEmittedSourceProvenance;
}

/**
 * @internal Build-facing KV416 inputs for SPEC §5.2.2. A production caller supplies the previous
 * projected query-shape token input; the compiler computes the current input from this compile's
 * query-shape facts and fails the compile if a shape change does not move the render-plan token.
 */
export interface ProductionRenderPlanGateOptions {
  previous: Record<string, string>;
  tokenFn?: (input: Record<string, string>) => string;
}

/**
 * @internal Per-component graph fact (name, queries, fragment targets) the compiler derives
 * and {@link deriveAppGraph} merges. Lowered-IR fact shape; in-repo use only (SPEC.md §5.2).
 */
export type ComponentGraphFact = Pick<
  CoreGraph.ComponentExplain,
  | 'disambiguatedDomName'
  | 'clocks'
  | 'domName'
  | 'exportName'
  | 'fragments'
  | 'mutableLocalState'
  | 'name'
  | 'mutationForms'
  | 'queries'
  | 'styleRules'
>;

/**
 * @internal A component's fragment-target fact (target name + props type) used when building
 * the registry. Lowered-IR fact shape; in-repo use only (SPEC.md §5.2).
 */
export interface FragmentTargetFact {
  propsType: string;
  target: string;
}

/**
 * @internal Generated reconstruction metadata for one server-refreshable live target. The server
 * uses these facts to reload declared queries and render full fragments after enhanced mutations.
 */
export interface LiveTargetFact {
  component: string;
  coverage: readonly LiveTargetCoverageFact[];
  identityProps: readonly string[];
  propsType: string;
  queryBindings: readonly LiveTargetQueryBindingFact[];
  queries: readonly string[];
  target: string;
  targetBase: string;
}

/** @internal Compact update-coverage fact emitted into generated live-target registry metadata. */
export interface LiveTargetCoverageFact {
  position: string;
  query: string;
  status: QueryUpdateCoverageFact['status'];
}

/** @internal One declared component query binding, including optional prop-derived args. */
export interface LiveTargetQueryBindingFact {
  argsExpression?: string;
  argsParam?: string;
  argsPropertyAccesses?: readonly string[];
  hasRefresh?: boolean;
  name: string;
  queryExpression: string;
}

/**
 * @internal Derived registry facts for an app graph (components, domain keys, invalidations,
 * mutation/query type maps, routes). Produced by {@link deriveAppGraph}; lowered-IR shape,
 * in-repo use only (SPEC.md §5.2).
 */
export interface RegistryFacts {
  components?: readonly string[];
  diagnostics?: readonly CompilerDiagnostic[];
  domainKeys?: readonly string[];
  fragmentTargets?: readonly string[];
  invalidations?: Readonly<Record<string, readonly string[]>>;
  liveTargets?: readonly LiveTargetFact[];
  mutationInputs?: RegistryMutationInputFacts;
  mutations?: RegistryTypeFacts;
  queries?: RegistryTypeFacts;
  routes?: readonly string[];
  statefulComponents?: readonly string[];
  viewTransitions?: readonly string[];
}

/** @internal Map of registry entry name to its emitted TypeScript type source. In-repo use only. */
export type RegistryTypeFacts = Readonly<Record<string, string>>;

/** @internal Field-level facts for one mutation input schema. In-repo use only. */
export interface MutationInputFieldFact {
  coercion: MutationInputFieldCoercion;
  defaulted: boolean;
  name: string;
  optional: boolean;
  provenance: 'local-mutation' | 'registry';
  required: boolean;
  source?: {
    fileName: string;
    length?: number;
    start?: number;
  };
}

/** @internal Declared FormData coercion family for a mutation input field. */
export type MutationInputFieldCoercion = 'boolean' | 'number' | 'string' | 'unknown';

/** @internal Registry-level field facts keyed by mutation key. */
export type RegistryMutationInputFacts = Readonly<
  Record<string, readonly MutationInputFieldFact[]>
>;

/**
 * @internal Cross-module dependency footprint for one component compile. It records the fact
 * slices lowering or diagnostics read so the incremental compiler can later hash only relevant
 * inputs while preserving SPEC.md §5.2 determinism.
 */
export interface CompileDependencyFootprint {
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
  packagePrefixDiscoveryRoot?: string;
  previousRegistryFacts?: RegistryFacts;
  queryShapeFacts?: readonly QueryShapeFact[];
  queryShapes?: Record<string, QueryShape>;
  reads?: CompileDependencyReads;
  registryFacts?: RegistryFacts;
}

/** @internal Fact keys read even when the current fact value is absent. */
export interface CompileDependencyReads {
  fragmentTargets?: readonly string[];
  mutationInputKeys?: readonly string[];
  previousRegistryComponentDomLeaves?: readonly string[];
  queryShapeNames?: readonly string[];
  viewTransitions?: readonly string[];
}

/**
 * @internal The graph slice {@link deriveRegistryFactsFromGraph} reads from a Kovo explain
 * input. Lowered-IR shape; in-repo use only (SPEC.md §5.2).
 */
export type RegistryGraphInput = Pick<
  CoreGraph.KovoExplainInput,
  | 'access'
  | 'capabilities'
  | 'components'
  | 'endpoints'
  | 'mutations'
  | 'packageComponentPrefixes'
  | 'pages'
  | 'queries'
  // SPEC §10.2/§11.2: by-construction SQL-safety (KV422) diagnostics ride from `compile
  // drizzle-static` (analyzeSqlSafetyFromProject) through `deriveAppGraph` into the real-app-build
  // check graph so `kovo check` fires end-to-end, not only at the `compile drizzle-static` gate.
  | 'sqlSafetyDiagnostics'
  // SPEC §6.6: trust escapes (KV426 `--trust`, audit-only) and app dangerous-sink writes (KV424,
  // error-severity) ride from `compile drizzle-static` through `deriveAppGraph` into the check graph.
  | 'trustEscapes'
  | 'unregisteredSinks'
>;

/** @internal Optional mutation/query type maps threaded into registry-fact derivation. */
export interface RegistryTypeFactOptions {
  mutations?: RegistryTypeFacts;
  queries?: RegistryTypeFacts;
}

export interface CompileAppGraphOptions {
  components?: readonly {
    componentGraphFacts: readonly ComponentGraphFact[];
    publishToClientFacts?: readonly PublishToClientFact[];
  }[];
  graph?: RegistryGraphInput;
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
  registryTypes?: RegistryTypeFactOptions;
  routePages?: readonly { routePageFacts: readonly RoutePageFact[] }[];
}

export interface CompileAppGraphResult {
  diagnostics: readonly CompilerDiagnostic[];
  graph: RegistryGraphInput;
  registryFacts: RegistryFacts;
}

/**
 * Input to {@link compileRouteModule}: a route module's authored source. Route pages that return
 * JSX are compiler-processed Kovo source; this entrypoint extracts the route-to-component facts the
 * generated live-target registry will consume (SPEC.md §4.5/§9.1).
 */
export interface CompileRouteModuleOptions {
  artifactFileName?: string;
  componentImportRewrites?: readonly RouteComponentImportRewrite[];
  fileName: string;
  source: string;
}

/**
 * Route-IR import rewrite from an authored component symbol to its generated component artifact.
 * Build tools provide these when emitting executable route modules from JSX-authored pages
 * (SPEC.md §4.5/§5.2).
 */
export interface RouteComponentImportRewrite {
  /** Local import binding used by the authored route module, for example `QuestionListRegion`. */
  localName: string;
  /** Generated artifact specifier the emitted route module should import, for example `./question-list.js`. */
  specifier: string;
}

/**
 * Result of {@link compileRouteModule}: route-page facts plus executable lowered route IR
 * artifacts for JSX-authored pages.
 */
export interface CompileRouteModuleResult {
  diagnostics: readonly CompilerDiagnostic[];
  files: readonly EmittedFile[];
  routePageFacts: readonly RoutePageFact[];
}

/** Compiler-derived facts for one JSX-authored `route().page`. */
export interface RoutePageFact {
  access?: CoreGraph.AccessDecisionFact;
  css?: RoutePageCssFact;
  components: readonly RoutePageComponentFact[];
  fileName: string;
  guards?: readonly string[];
  layouts?: readonly RoutePageLayoutFact[];
  navigationSegments?: readonly RouteNavigationSegmentFact[];
  regions?: readonly RouteRegionFact[];
  route: string;
}

/** CSS reachability facts derived from a JSX-authored route page. */
export interface RoutePageCssFact {
  fragmentTargets?: readonly string[];
  sourceFileNames?: readonly string[];
}

/** One layout segment in the compiler-derived route layout chain. */
export interface RoutePageLayoutFact {
  localName: string;
  queries: readonly string[];
}

/** One compiler-derived navigation segment for future enhanced navigation proofs. */
export interface RouteNavigationSegmentFact {
  components?: readonly string[];
  id: string;
  kind: 'layout' | 'page' | 'region';
  localName: string;
  queries?: readonly string[];
}

/** One public route-level parallel region declared under `route({ regions })`. */
export interface RouteRegionFact {
  components: readonly RoutePageComponentFact[];
  name: string;
}

/** One component invocation found under a JSX-authored route page. */
export interface RoutePageComponentFact {
  exportName?: string;
  keyExpression?: string;
  localName: string;
  props: readonly RoutePageComponentPropFact[];
  propsExpression: string;
  serializedPropsExpression: string;
}

/** A serializable prop/key expression passed from a route page into a component. */
export interface RoutePageComponentPropFact {
  expression: string;
  name: string;
  propertyAccesses?: readonly string[];
  staticValue?: import('./scan/object.js').StaticLiteralValue;
}

/**
 * @internal One emitted lowered-IR artifact (server/client/css/registry file name, kind, and
 * source). Carried in {@link CompileResult}; in-repo use only (SPEC.md §5.2).
 */
export interface EmittedFile {
  fileName: string;
  kind: 'client' | 'css' | 'registry' | 'route' | 'server';
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
 * The full result of {@link compileComponentModule}: emitted artifacts, graph facts,
 * diagnostics, lowered source, CSS assets, platform substitutions, query update plans/
 * coverage, render-equivalence checks, and view-transition stamps. Public build/codegen
 * contract for compiler entrypoints; app-authored source still stays TSX/JSX and must not
 * hand-write these lowered artifacts (SPEC.md §5.2).
 */
export interface CompileResult {
  clientExports: readonly string[];
  componentGraphFacts: readonly ComponentGraphFact[];
  cssAssets: readonly ComponentCssAsset[];
  dependencyFootprint: CompileDependencyFootprint;
  diagnostics: readonly CompilerDiagnostic[];
  files: readonly EmittedFile[];
  handlerExports: readonly string[];
  hmrImpact: HmrImpactMetadata | null;
  loweredSource: string | null;
  outputContextFacts: readonly GeneratedOutputWriteFact[];
  platformSubstitutions: readonly PlatformSubstitution[];
  publishToClientFacts: readonly PublishToClientFact[];
  queryUpdatePlans: readonly QueryUpdatePlanFact[];
  renderPlanFingerprint?: string | null;
  renderEquivalenceChecks: readonly RenderEquivalenceCheck[];
  updateCoverage: readonly QueryUpdateCoverageFact[];
  viewTransitions: readonly ViewTransitionStamp[];
}

/** One audited `publishToClient(import, { reason })` escape for graph capabilities. */
export interface PublishToClientFact {
  fileName: string;
  localName: string;
  moduleSpecifier: string;
  reason: string;
  site: string;
  start?: number;
}

/** Compiler-owned HMR impact metadata derived from parsed/lowered facts (SPEC.md §5.2). */
export interface HmrImpactMetadata {
  clientHref: string | null;
  component: HmrImpactComponentFact | null;
  diagnostics: readonly HmrImpactDiagnosticFact[];
  factHash: string;
  liveTargetFacts: readonly LiveTargetFact[];
  liveTargetFactsHash: string;
  queryUpdatePlanHash: string;
  routeShellHash: string | null;
  sourceFileName: string;
  sourceKind: 'component' | 'route-shell' | 'unknown';
  stylesheetAssets: readonly HmrImpactStylesheetFact[];
  stylesheetAssetsHash: string;
  renderOutputHash: string;
}

/** Component identity facts used to decide whether a hot edit can target the same DOM boundary. */
export interface HmrImpactComponentFact {
  domLeaf: string;
  registryKey: string;
}

/** Diagnostic summary carried by compiler HMR metadata and `kovo:diagnostics` events. */
export interface HmrImpactDiagnosticFact {
  code: CompilerDiagnostic['code'];
  message: string;
  severity: CompilerDiagnostic['severity'];
}

/** Stylesheet facts used to detect route-shell/style refresh requirements during dev HMR. */
export interface HmrImpactStylesheetFact {
  contentHash?: string;
  cspHash?: string;
  href: string;
  sourceFileName: string;
  styleRuleUsages?: readonly {
    className: string;
    moduleFileName: string;
    source: string;
    styleRef: string;
  }[];
}

/** Conservative hot-update action class selected from compiler-owned typed facts. */
export type HmrImpactClass = 'componentRefresh' | 'diagnosticError' | 'fullReload' | 'routeRefresh';

/** Machine-readable reason explaining why an HMR action class was selected. */
export type HmrImpactReason =
  | 'diagnostics'
  | 'handler-only'
  | 'live-target'
  | 'missing-facts'
  | 'query-plan'
  | 'render-output'
  | 'route-shell'
  | 'style'
  | 'topology';

/** Result of comparing previous and next HMR impact metadata for one source file. */
export interface HmrImpactClassification {
  impact: HmrImpactClass;
  reasons: readonly HmrImpactReason[];
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

// SPEC §4.3 / §4.6 (KV231): when two element-params in one handler share a terminal property name
// (e.g. `item.id` and `item.parent.id` both terminate in `id`), the default terminal-derived name
// collides — the browser would keep only the first `data-p-*` attribute and both `ctx.params` reads
// would resolve to the same value. Derive a unique, human-readable param name from the full member
// path (dropping the binding root) so each member gets its own distinct attribute and slot. The
// result is normalized identically to `elementParamAttributeNameFromPropertyName` so the
// `elementParamNameFromAttribute` round-trip used by client emit yields a valid `ctx.params.<name>`.
export function elementParamAttributeNameFromPath(path: string): string {
  // Drop the binding root (`item.parent.id` → `parent.id`); a single-segment path keeps as-is.
  const segments = path.split('.');
  const withoutRoot = segments.length > 1 ? segments.slice(1) : segments;
  return elementParamAttributeNameFromPropertyName(withoutRoot.join('-'));
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
    dependencyFootprint: {},
    diagnostics: [],
    files: [],
    handlerExports: [],
    hmrImpact: null,
    loweredSource: null,
    outputContextFacts: [],
    platformSubstitutions: [],
    publishToClientFacts: [],
    queryUpdatePlans: [],
    renderPlanFingerprint: null,
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
  const confinedFileName = normalizeComponentFileName(fileName);
  return {
    client: replaceExtension(confinedFileName, '.client.js'),
    css: replaceExtension(confinedFileName, '.css'),
    registry: 'generated/registries.d.ts',
    server: replaceExtension(confinedFileName, '.server.js'),
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
  outputContexts?: readonly GeneratedOutputWriteFact[];
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
  inputs?: readonly string[];
  name: string;
  param: string;
  params?: readonly string[];
  selector: string;
}

export interface StateDeriveFact {
  attr?: string;
  expression: string;
  exportName: string;
  input: 'state';
  name: string;
  outputContext: GeneratedOutputWriteFact;
  param: 'state';
  placeholder: string;
}

/**
 * @internal Lowered-IR fact that records where generated state derive placeholders are
 * rewritten to versioned client imports. In-repo compiler analysis use only (SPEC.md §5.2).
 */
export interface StateDeriveReferenceFact {
  attr: string;
  clientHref: string;
  exportName: string;
  placeholder: string;
  target: { end: number; start: number };
  value: string;
  writer: 'state derive URL versioning';
}

/**
 * @internal A DOM stamp fact binding a derived value to an element attribute/selector within
 * a query update plan. Lowered-IR fact; in-repo use only (SPEC.md §5.2).
 */
export interface QueryStampFact {
  attr: string;
  derive: QueryDeriveFact;
  outputContext: GeneratedOutputWriteFact;
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
  outputContext: GeneratedOutputWriteFact;
  selector: string;
  template: string;
}

export interface QueryTemplateStampBindingPlaceholder {
  outputContext: GeneratedOutputWriteFact;
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

/** @internal Declared client clock cadence emitted for browser tick-bus wiring. */
export interface ClockUpdatePlanFact {
  clocks: readonly ClockUpdatePlanClockFact[];
  componentName: string;
}

/** @internal One named component clock spec source preserved for generated runtime code. */
export interface ClockUpdatePlanClockFact {
  name: string;
  spec: string;
}

/**
 * @internal One render-equivalence check result (artifact name, expected vs actual render,
 * pass flag) consumed by {@link assertRenderEquivalence}. Lowered-IR fact; in-repo use only
 * (SPEC.md §5.2 rule 3).
 */
export interface RenderEquivalenceCheck {
  actual: string;
  artifact: string;
  detail?: string;
  expected: string;
  ok: boolean;
}

/**
 * @internal Structural shape of a query result (primitive kind, array, object, or
 * nullable/optional/secret wrapper) the compiler infers to type and stamp query bindings.
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

/** @internal Explain metadata for an audited confidentiality reveal. In-repo use only. */
export interface QueryShapeReveal {
  grade: 'audit' | 'proof';
  justification?: string;
  method: 'arbitrary-fn' | 'fixed-redactor' | 'server-projection';
  selectedSecret?: boolean;
  site?: string;
  source?: string;
}

/** @internal A metadata wrapper around a {@link QueryShape}. In-repo use only. */
export type QueryShapeWrapper =
  | {
      kind: 'nullable' | 'optional' | 'secret' | 'volatile-time';
      shape: QueryShape;
    }
  | {
      kind: 'table-row';
      shape: QueryShape;
      table: string;
    }
  | {
      kind: 'revealed';
      reveal: QueryShapeReveal;
      shape: QueryShape;
    };

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
  const shapes: Record<string, QueryShape> = {};
  const duplicateQueries = new Set<string>();

  for (const fact of facts) {
    if (fact.query in shapes) {
      duplicateQueries.add(fact.query);
      delete shapes[fact.query];
      continue;
    }
    if (!duplicateQueries.has(fact.query)) shapes[fact.query] = fact.shape;
  }

  return shapes;
}

/** @internal Convert projected query-shape facts into QueryRegistry type entries. */
export function queryShapeRegistryTypeFacts(
  shapes: Readonly<Record<string, QueryShape>>,
): RegistryTypeFacts {
  return Object.fromEntries(
    Object.entries(shapes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([query, shape]) => [query, queryShapeTypeExpression(shape)]),
  );
}

/** @internal Convert one projected query shape into an emitted TypeScript type expression. */
export function queryShapeTypeExpression(shape: QueryShape): string {
  return printTypeExpr(typeExprFromQueryShape(shape));
}

type TypeExpr =
  | { kind: 'array'; item: TypeExpr }
  | { kind: 'import-generic'; args: readonly TypeExpr[]; importPath: string; name: string }
  | { kind: 'object'; fields: readonly TypeExprField[] }
  | { kind: 'reference'; name: string }
  | { kind: 'union'; members: readonly TypeExpr[] };

const TypeExprPrecedence = {
  array: 2,
  none: 0,
  primary: 3,
  union: 1,
} as const;

type TypeExprPrecedence = (typeof TypeExprPrecedence)[keyof typeof TypeExprPrecedence];

interface TypeExprField {
  key: string;
  optional: boolean;
  type: TypeExpr;
}

function typeExprFromQueryShape(shape: QueryShape): TypeExpr {
  if (typeof shape === 'string') return primitiveQueryShapeTypeExpr(shape);
  if (Array.isArray(shape))
    return { kind: 'array', item: typeExprFromQueryShape(shape[0] ?? 'object') };
  if (isQueryShapeWrapper(shape)) return wrapperQueryShapeTypeExpr(shape);

  const fields = Object.entries(shape)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => queryShapeTypeExprField(key, value));
  return fields.length === 0
    ? { kind: 'reference', name: 'Record<string, unknown>' }
    : { kind: 'object', fields };
}

function primitiveQueryShapeTypeExpr(shape: string): TypeExpr {
  switch (shape) {
    case 'array':
      return { kind: 'array', item: { kind: 'reference', name: 'unknown' } };
    case 'boolean':
    case 'number':
    case 'string':
      return { kind: 'reference', name: shape };
    case 'object':
      return { kind: 'reference', name: 'Record<string, unknown>' };
    default:
      return { kind: 'reference', name: 'unknown' };
  }
}

function wrapperQueryShapeTypeExpr(shape: QueryShapeWrapper): TypeExpr {
  const inner = typeExprFromQueryShape(shape.shape);
  switch (shape.kind) {
    case 'nullable':
      return unionTypeExpr([inner, { kind: 'reference', name: 'null' }]);
    case 'optional':
      return unionTypeExpr([inner, { kind: 'reference', name: 'undefined' }]);
    case 'revealed':
      return typeExprFromRevealedQueryShape(shape.shape);
    case 'secret':
      return {
        args: [inner],
        importPath: '@kovojs/core',
        kind: 'import-generic',
        name: 'Secret',
      };
    case 'table-row':
      return inner;
    case 'volatile-time':
      return inner;
  }
}

function typeExprFromRevealedQueryShape(shape: QueryShape): TypeExpr {
  if (Array.isArray(shape)) {
    return { item: typeExprFromRevealedQueryShape(shape[0] ?? 'object'), kind: 'array' };
  }
  if (isQueryShapeWrapper(shape)) {
    switch (shape.kind) {
      case 'nullable':
        return unionTypeExpr([
          typeExprFromRevealedQueryShape(shape.shape),
          { kind: 'reference', name: 'null' },
        ]);
      case 'optional':
        return unionTypeExpr([
          typeExprFromRevealedQueryShape(shape.shape),
          { kind: 'reference', name: 'undefined' },
        ]);
      case 'revealed':
      case 'secret':
      case 'table-row':
      case 'volatile-time':
        return typeExprFromRevealedQueryShape(shape.shape);
    }
  }
  if (typeof shape === 'object' && shape !== null) {
    const fields = Object.entries(shape)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => {
        const optional = isQueryShapeWrapper(value) && value.kind === 'optional';
        return {
          key,
          optional,
          type: typeExprFromRevealedQueryShape(optional ? value.shape : value),
        };
      });
    if (fields.length === 0) return { kind: 'reference', name: 'Record<string, unknown>' };
    return { fields, kind: 'object' };
  }
  return typeExprFromQueryShape(shape);
}

function queryShapeTypeExprField(key: string, shape: QueryShape): TypeExprField {
  const optional = isQueryShapeWrapper(shape) && shape.kind === 'optional';
  return {
    key,
    optional,
    type: typeExprFromQueryShape(optional ? shape.shape : shape),
  };
}

function unionTypeExpr(members: readonly TypeExpr[]): TypeExpr {
  const flattened = members.flatMap((member) =>
    member.kind === 'union' ? member.members : [member],
  );
  return { kind: 'union', members: flattened };
}

function printTypeExpr(
  type: TypeExpr,
  parentPrecedence: TypeExprPrecedence = TypeExprPrecedence.none,
): string {
  const precedence = typeExprPrecedence(type);
  let printed: string;
  switch (type.kind) {
    case 'array': {
      const item = printTypeExpr(type.item, TypeExprPrecedence.array);
      printed = `${item}[]`;
      break;
    }
    case 'import-generic':
      printed = `import('${type.importPath}').${type.name}<${type.args
        .map((arg) => printTypeExpr(arg))
        .join(', ')}>`;
      break;
    case 'object':
      printed = `{ ${type.fields.map(printTypeExprField).join(' ')} }`;
      break;
    case 'reference':
      printed = type.name;
      break;
    case 'union': {
      printed = type.members
        .map((member) => printTypeExpr(member, TypeExprPrecedence.union))
        .join(' | ');
      break;
    }
  }
  return precedence < parentPrecedence ? `(${printed})` : printed;
}

function typeExprPrecedence(type: TypeExpr): TypeExprPrecedence {
  switch (type.kind) {
    case 'union':
      return TypeExprPrecedence.union;
    case 'array':
      return TypeExprPrecedence.array;
    case 'import-generic':
    case 'object':
    case 'reference':
      return TypeExprPrecedence.primary;
  }
}

function printTypeExprField(field: TypeExprField): string {
  return `${quotedTypePropertyKey(field.key)}${field.optional ? '?' : ''}: ${printTypeExpr(
    field.type,
  )};`;
}

function quotedTypePropertyKey(key: string): string {
  return /^[$A-Z_a-z][$\w]*$/u.test(key) ? key : JSON.stringify(key);
}

/**
 * @internal Report duplicate query-shape graph facts before indexing them by query name.
 * SPEC §4.8 validation needs one authoritative shape per query; last-write-wins would
 * make binding diagnostics depend on fact ordering.
 */
export function queryShapeFactDiagnostics(
  fileName: string,
  facts: readonly QueryShapeFact[],
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const factsByQuery = new Map<string, QueryShapeFact[]>();

  for (const fact of facts) {
    const queryFacts = factsByQuery.get(fact.query);
    if (queryFacts) {
      queryFacts.push(fact);
    } else {
      factsByQuery.set(fact.query, [fact]);
    }
  }

  for (const [query, queryFacts] of factsByQuery) {
    if (queryFacts.length < 2) continue;
    const sources = [...new Set(queryFacts.map((fact) => fact.source))].sort();
    const base = diagnosticFor(fileName, 'KV240');
    diagnostics.push({
      ...base,
      help: diagnosticDefinitions.KV240.help,
      message: `${base.message} query="${query}" sources=${sources.join(', ')}`,
    });
  }

  return diagnostics;
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
  return (
    'shape' in shape &&
    (record.kind === 'nullable' ||
      record.kind === 'optional' ||
      record.kind === 'secret' ||
      record.kind === 'table-row' ||
      record.kind === 'volatile-time' ||
      (record.kind === 'revealed' && 'reveal' in shape))
  );
}

export function isNullableQueryShapeWrapper(shape: QueryShape): shape is QueryShapeWrapper {
  return isQueryShapeWrapper(shape) && (shape.kind === 'nullable' || shape.kind === 'optional');
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
