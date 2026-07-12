import { dirname, join } from 'node:path';

import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import {
  deriveAccessExplainFacts,
  deriveAuthPostureFacts,
  deriveOwnershipPostureFacts,
  deriveSessionAuthorityFacts,
} from '@kovojs/core/internal/graph';
import type * as CoreGraph from '@kovojs/core/internal/graph';

import type { CompilerDiagnostic } from './diagnostics.js';
import { factHash } from './fact-hash.js';
import {
  compilerArrayIsArray,
  compilerCreateMap,
  compilerCreateNullRecord,
  compilerCreateSet,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerSnapshotJsonValue,
  compilerStringLocaleCompare,
  compilerStringStartsWith,
  compilerStringTrim,
} from './compiler-security-intrinsics.js';
import { deriveRegistryIdentity } from './registry-identities.js';
import {
  componentOptionObjectEntries,
  componentOptionObjectEntriesFor,
  componentDeclaresMutableLocalState,
  componentHasInferredFragmentTarget,
  firstComponentModel,
  type ComponentModel,
  type ComponentModuleModel,
  type NamedImportModel,
  type ObjectLiteralEntry,
} from './scan/parse.js';
import { queryBindingFromExpression, queryExpressionFromBinding } from './scan/query-binding.js';
import { uniqueSorted } from './shared.js';
import type {
  CompileAppGraphOptions,
  CompileAppGraphResult,
  ComponentGraphFact,
  FragmentTargetFact,
  LiveTargetFact,
  LiveTargetCoverageFact,
  LiveTargetQueryBindingFact,
  QueryUpdateCoverageFact,
  PublishToClientFact,
  RegistryFacts,
  RegistryGraphInput,
  RegistryTypeFactOptions,
  RoutePageFact,
} from './types.js';
import type { StyleRuleUsage } from './css.js';

/**
 * Derive an app-level component/registry graph from the per-component facts produced by
 * compileComponentModule, returning the merged graph plus the registry facts (component
 * list, domain keys, invalidations, routes) the server runtime indexes.
 *
 * Public entry point implemented behind `@kovojs/compiler/graph`. `create-kovo` templates
 * and the example apps call it from their graph-emit scripts to derive `generated/`
 * registries (SPEC.md §5.2).
 */
export function deriveAppGraph(options: CompileAppGraphOptions): CompileAppGraphResult {
  // SPEC.md §5.2: graph emission consumes one immutable exact lowered-fact snapshot. Authored code
  // has already evaluated in this realm, so no live carrier or prototype traversal can participate.
  const input = compilerSnapshotJsonValue(options, 'Compile app graph options');
  const graphInput = input.graph;
  const componentInputs = input.components ?? [];
  const packageComponentPrefixes = concatDense(
    graphInput?.packageComponentPrefixes ?? [],
    input.packageComponentPrefixes ?? [],
  );
  const components = disambiguateComponentDomNames(
    concatDense(
      graphInput?.components ?? [],
      flattenFactProperty<ComponentGraphFact>(
        componentInputs,
        'componentGraphFacts',
        'Component graph facts',
      ),
    ),
  );
  const tasks = mergeTaskExplainFacts(
    concatDense(
      graphInput?.tasks ?? [],
      flattenFactProperty<CoreGraph.TaskExplain>(componentInputs, 'taskGraphFacts', 'Task facts'),
    ),
  );
  const handlerWriteSinks = mergeHandlerWriteSinkFacts(
    concatDense(
      graphInput?.handlerWriteSinks ?? [],
      flattenFactProperty<CoreGraph.HandlerWriteSinkExplain>(
        componentInputs,
        'handlerWriteSinkFacts',
        'Handler write-sink facts',
      ),
    ),
  );
  const endpoints = mergeEndpointExplainFacts(
    concatDense(
      graphInput?.endpoints ?? [],
      flattenFactProperty<CoreGraph.EndpointExplain>(
        componentInputs,
        'endpointGraphFacts',
        'Endpoint graph facts',
      ),
    ),
  );
  const routePages = flattenFactProperty<RoutePageFact>(
    input.routePages ?? [],
    'routePageFacts',
    'Route-page facts',
  );
  const publishToClientCapabilities = publishToClientCapabilitiesFromFacts(
    flattenFactProperty<PublishToClientFact>(
      componentInputs,
      'publishToClientFacts',
      'Publish-to-client facts',
    ),
  );
  const capabilities = stableSortedCopy(
    concatDense(graphInput?.capabilities ?? [], publishToClientCapabilities),
    compareCapabilityFacts,
    'capability facts',
  );
  const derivedRoutePages = derivedPageFactsFromRoutePages(routePages, components);
  const mergedPages =
    derivedRoutePages.length > 0 || (graphInput?.pages?.length ?? 0) > 0
      ? mergeGraphPages(graphInput?.pages ?? [], derivedRoutePages)
      : undefined;
  // SPEC.md §10.2/§6.6: classify every query/mutation/route-page/endpoint/webhook
  // surface from producer-owned access facts and populate `graph.access` so the
  // KV436 consumer (`kovo check`) fires on any surface with no explicit decision.
  // By-construction: the proof is this static graph fact, not a TS brand. KV436
  // proves a decision EXISTS, never that it is correct.
  const pagesForAccess = mergedPages ?? graphInput?.pages;
  const derivedAccess = deriveAccessExplainFacts({
    ...(endpoints.length === 0 ? {} : { endpoints }),
    ...(graphInput?.mutations === undefined ? {} : { mutations: graphInput.mutations }),
    ...(pagesForAccess === undefined ? {} : { pages: pagesForAccess }),
    ...(graphInput?.queries === undefined ? {} : { queries: graphInput.queries }),
  });
  const access = mergeAccessExplainFacts(graphInput?.access ?? [], derivedAccess);
  const accessDerivationInput = {
    ...(endpoints.length === 0 ? {} : { endpoints }),
    ...(graphInput?.mutations === undefined ? {} : { mutations: graphInput.mutations }),
    ...(pagesForAccess === undefined ? {} : { pages: pagesForAccess }),
    ...(graphInput?.queries === undefined ? {} : { queries: graphInput.queries }),
  };
  const authPosture = mergeAuthPostureFacts(
    graphInput?.authPosture ?? [],
    deriveAuthPostureFacts(accessDerivationInput),
  );
  const sessionAuthority = mergeSessionAuthorityFacts(
    graphInput?.sessionAuthority ?? [],
    deriveSessionAuthorityFacts(accessDerivationInput),
  );
  const ownershipPosture = mergeOwnershipPostureFacts(
    graphInput?.ownershipPosture ?? [],
    deriveOwnershipPostureFacts(accessDerivationInput),
  );
  const graph: RegistryGraphInput = {
    ...graphInput,
    ...(access.length > 0 ? { access } : {}),
    ...(authPosture.length > 0 ? { authPosture } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    components,
    ...(endpoints.length > 0 ? { endpoints } : {}),
    ...(mergedPages === undefined ? {} : { pages: mergedPages }),
    ...(packageComponentPrefixes.length > 0 ? { packageComponentPrefixes } : {}),
    ...(tasks.length > 0 ? { tasks } : {}),
    ...(handlerWriteSinks.length > 0 ? { handlerWriteSinks } : {}),
    ...(ownershipPosture.length > 0 ? { ownershipPosture } : {}),
    ...(sessionAuthority.length > 0 ? { sessionAuthority } : {}),
    // SPEC §10.2/§11.2: preserve KV422 SQL-safety diagnostics from `compile drizzle-static`
    // (analyzeSqlSafetyFromProject) so the build→graph.json the `kovo check` consumer reads carries
    // them and the check fails end-to-end. By-construction at `kovo check`: an error-severity finding
    // here means request-derived text could reach executable SQL on a managed handle. (The spread
    // above already retains the field at runtime; this is the explicit, load-bearing thread.)
    ...(graphInput?.sqlSafetyDiagnostics === undefined
      ? {}
      : { sqlSafetyDiagnostics: graphInput.sqlSafetyDiagnostics }),
    // SPEC §6.6: preserve KV426 trust escapes (`kovo explain --trust`, audit-only) and KV424
    // app dangerous-sink facts (`kovo check` error gate) from `compile drizzle-static` so the
    // build→graph.json carries the trust surface and the imperative-DOM sink findings.
    ...(graphInput?.trustEscapes === undefined
      ? {}
      : { trustEscapes: graphInput.trustEscapes }),
    // SPEC §6.6/§9.1 (audit-only, threat-matrix M3): app-authored escape-hatch capability facts
    // (`--capabilities`) and credential-cookie downgrades (`--cookies`) collected by the static
    // producers ride from `compile drizzle-static` / the build-check graph through into graph.json.
    // `capabilities` is folded in above (with the publishToClient call-site facts); this threads the
    // typed cookie-downgrade surface, which previously had no static producer.
    ...(graphInput?.cookieDowngrades === undefined
      ? {}
      : { cookieDowngrades: graphInput.cookieDowngrades }),
    ...(graphInput?.unregisteredSinks === undefined
      ? {}
      : { unregisteredSinks: graphInput.unregisteredSinks }),
  };

  const registryFacts = deriveRegistryFactsFromGraph(graph, {
    ...input.registryTypes,
    ...(input.previousRegistryFacts === undefined
      ? {}
      : { previousRegistryFacts: input.previousRegistryFacts }),
  });

  return compilerSnapshotJsonValue(
    {
      diagnostics: registryFacts.diagnostics ?? [],
      graph,
      registryFacts,
    },
    'Compile app graph result',
  );
}

function mergeAccessExplainFacts(
  callerFacts: readonly CoreGraph.AccessExplainFact[],
  derivedFacts: readonly CoreGraph.AccessExplainFact[],
): CoreGraph.AccessExplainFact[] {
  return mergeFactsByKey(callerFacts, derivedFacts, accessExplainFactKey, compareAccessFacts);
}

function accessExplainFactKey(fact: CoreGraph.AccessExplainFact): string {
  return `${fact.kind}\0${fact.name}`;
}

function compareAccessFacts(
  left: CoreGraph.AccessExplainFact,
  right: CoreGraph.AccessExplainFact,
): number {
  return (
    compilerStringLocaleCompare(left.kind, right.kind) ||
    compilerStringLocaleCompare(left.name, right.name) ||
    compilerStringLocaleCompare(left.decision, right.decision)
  );
}

function mergeAuthPostureFacts(
  callerFacts: readonly CoreGraph.AuthPostureFact[],
  derivedFacts: readonly CoreGraph.AuthPostureFact[],
): CoreGraph.AuthPostureFact[] {
  return mergeFactsByKey(callerFacts, derivedFacts, authPostureFactKey, compareKindNameFacts);
}

function authPostureFactKey(fact: CoreGraph.AuthPostureFact): string {
  return `${fact.kind}\0${fact.name}`;
}

function mergeSessionAuthorityFacts(
  callerFacts: readonly CoreGraph.SessionAuthorityFact[],
  derivedFacts: readonly CoreGraph.SessionAuthorityFact[],
): CoreGraph.SessionAuthorityFact[] {
  const facts = compilerCreateMap<string, CoreGraph.SessionAuthorityFact>();
  const candidates = concatDense(derivedFacts, callerFacts);
  for (let index = 0; index < candidates.length; index += 1) {
    const fact = candidates[index]!;
    const key = sessionAuthorityFactKey(fact);
    const previous = compilerMapGet(facts, key);
    // Session authority is an OR lattice: a source-level negative proves only
    // that the handler body is clean and must never suppress a positive runtime
    // guard/session fact for the same mutation. Conversely, a positive handler
    // fact must override an ordinary derived negative.
    if (previous?.referencesSession === true && !fact.referencesSession) continue;
    compilerMapSet(facts, key, fact);
  }
  return stableSortedCopy(mapValues(facts), compareKindNameFacts, 'session-authority facts');
}

function sessionAuthorityFactKey(fact: CoreGraph.SessionAuthorityFact): string {
  return `${fact.kind}\0${fact.unresolvedName === true ? 'unresolved:*' : `name:${fact.name}`}`;
}

function mergeOwnershipPostureFacts(
  callerFacts: readonly CoreGraph.OwnershipPostureFact[],
  derivedFacts: readonly CoreGraph.OwnershipPostureFact[],
): CoreGraph.OwnershipPostureFact[] {
  return mergeFactsByKey(
    callerFacts,
    derivedFacts,
    ownershipPostureFactKey,
    compareOwnershipPostureFacts,
  );
}

function ownershipPostureFactKey(fact: CoreGraph.OwnershipPostureFact): string {
  return `${fact.kind}\0${fact.name}\0${fact.domain}\0${fact.key ?? ''}`;
}

function mergeFactsByKey<Fact>(
  callerFacts: readonly Fact[],
  derivedFacts: readonly Fact[],
  keyForFact: (fact: Fact) => string,
  compareFacts: (left: Fact, right: Fact) => number,
): Fact[] {
  const facts = compilerSnapshotDenseArray(callerFacts, 'Caller graph facts');
  const existing = compilerCreateSet<string>();
  for (let index = 0; index < facts.length; index += 1) {
    compilerSetAdd(existing, keyForFact(facts[index]!));
  }
  const derivedSnapshot = compilerSnapshotDenseArray(derivedFacts, 'Derived graph facts');
  for (let index = 0; index < derivedSnapshot.length; index += 1) {
    const fact = derivedSnapshot[index]!;
    const key = keyForFact(fact);
    if (compilerSetHas(existing, key)) continue;
    facts[facts.length] = fact;
    compilerSetAdd(existing, key);
  }
  return stableSortedCopy(facts, compareFacts, 'merged graph facts');
}

function compareKindNameFacts(
  left: { readonly kind: string; readonly name: string },
  right: { readonly kind: string; readonly name: string },
): number {
  return (
    compilerStringLocaleCompare(left.kind, right.kind) ||
    compilerStringLocaleCompare(left.name, right.name)
  );
}

function compareOwnershipPostureFacts(
  left: CoreGraph.OwnershipPostureFact,
  right: CoreGraph.OwnershipPostureFact,
): number {
  return (
    compilerStringLocaleCompare(left.kind, right.kind) ||
    compilerStringLocaleCompare(left.name, right.name) ||
    compilerStringLocaleCompare(left.domain, right.domain) ||
    compilerStringLocaleCompare(left.key ?? '', right.key ?? '')
  );
}

/** @internal Process-lifetime cache for app graph derivation keyed by contribution fingerprints. */
export class IncrementalAppGraphCache {
  readonly #results = compilerCreateMap<string, CompileAppGraphResult>();

  derive(options: CompileAppGraphOptions): CompileAppGraphResult {
    const key = appGraphContributionHash(options);
    const cached = compilerMapGet(this.#results, key);
    if (cached) return cached;

    const result = deriveAppGraph(options);
    compilerMapSet(this.#results, key, result);
    return result;
  }
}

/** @internal Stable multiset hash of the facts that contribute to {@link deriveAppGraph}. */
export function appGraphContributionHash(options: CompileAppGraphOptions): string {
  const input = compilerSnapshotJsonValue(options, 'App graph contribution options');
  const components = input.components ?? [];
  const componentHashes = hashFacts(
    flattenFactProperty(components, 'componentGraphFacts', 'Component graph facts'),
  );
  const taskHashes = hashFacts(flattenFactProperty(components, 'taskGraphFacts', 'Task facts'));
  const handlerWriteSinkHashes = hashFacts(
    flattenFactProperty(components, 'handlerWriteSinkFacts', 'Handler write-sink facts'),
  );
  const endpointHashes = hashFacts(
    flattenFactProperty(components, 'endpointGraphFacts', 'Endpoint graph facts'),
  );
  const routeHashes = hashFacts(
    flattenFactProperty(input.routePages ?? [], 'routePageFacts', 'Route-page facts'),
  );

  return factHash({
    components: componentHashes,
    endpoints: endpointHashes,
    graph: input.graph ?? null,
    handlerWriteSinks: handlerWriteSinkHashes,
    packageComponentPrefixes: input.packageComponentPrefixes ?? null,
    previousRegistryFacts: input.previousRegistryFacts ?? null,
    registryTypes: input.registryTypes ?? null,
    routes: routeHashes,
    tasks: taskHashes,
    publishToClientFacts: hashFacts(
      flattenFactProperty(components, 'publishToClientFacts', 'Publish-to-client facts'),
    ),
  });
}

function mergeTaskExplainFacts(tasks: readonly CoreGraph.TaskExplain[]): CoreGraph.TaskExplain[] {
  const byKey = compilerCreateMap<string, CoreGraph.TaskExplain>();
  const snapshot = compilerSnapshotDenseArray(tasks, 'Task explain facts');

  for (let index = 0; index < snapshot.length; index += 1) {
    const task = snapshot[index]!;
    const previous = compilerMapGet(byKey, task.key);
    const cron = previous?.cron ?? task.cron;
    const runMutations = mergeSortedStrings(previous?.runMutations, task.runMutations);
    const runQueries = mergeSortedStrings(previous?.runQueries, task.runQueries);
    const schedules = mergeSortedStrings(previous?.schedules, task.schedules);
    compilerMapSet(byKey, task.key, {
      ...(cron === undefined ? {} : { cron }),
      key: task.key,
      ...(runMutations.length === 0 ? {} : { runMutations }),
      ...(runQueries.length === 0 ? {} : { runQueries }),
      ...(schedules.length === 0 ? {} : { schedules }),
    });
  }

  const normalized: CoreGraph.TaskExplain[] = [];
  const values = mapValues(byKey);
  for (let index = 0; index < values.length; index += 1) {
    const task = values[index]!;
    normalized[normalized.length] = {
      ...(task.cron === undefined ? {} : { cron: task.cron }),
      key: task.key,
      ...(task.runMutations === undefined || task.runMutations.length === 0
        ? {}
        : { runMutations: task.runMutations }),
      ...(task.runQueries === undefined || task.runQueries.length === 0
        ? {}
        : { runQueries: task.runQueries }),
      ...(task.schedules === undefined || task.schedules.length === 0
        ? {}
        : { schedules: task.schedules }),
    };
  }
  return stableSortedCopy(
    normalized,
    (left, right) => compilerStringLocaleCompare(left.key, right.key),
    'task facts',
  );
}

function mergeHandlerWriteSinkFacts(
  facts: readonly CoreGraph.HandlerWriteSinkExplain[],
): CoreGraph.HandlerWriteSinkExplain[] {
  const byKey = compilerCreateMap<string, CoreGraph.HandlerWriteSinkExplain>();
  const snapshot = compilerSnapshotDenseArray(facts, 'Handler write-sink facts');
  for (let index = 0; index < snapshot.length; index += 1) {
    const fact = snapshot[index]!;
    compilerMapSet(byKey, factHash(fact), fact);
  }
  return stableSortedCopy(
    mapValues(byKey),
    compareHandlerWriteSinkFacts,
    'handler write-sink facts',
  );
}

function mergeEndpointExplainFacts(
  facts: readonly CoreGraph.EndpointExplain[],
): CoreGraph.EndpointExplain[] {
  const byKey = compilerCreateMap<string, CoreGraph.EndpointExplain>();
  const snapshot = compilerSnapshotDenseArray(facts, 'Endpoint explain facts');

  for (let index = 0; index < snapshot.length; index += 1) {
    const fact = snapshot[index]!;
    const key = endpointExplainMergeKey(fact);
    const previous = compilerMapGet(byKey, key);
    if (!previous) {
      compilerMapSet(byKey, key, normalizeEndpointExplainFact(fact));
      continue;
    }

    const runMutations = mergeSortedStrings(previous.runMutations, fact.runMutations);
    const writes = mergeSortedStrings(previous.writes, fact.writes);
    compilerMapSet(byKey, key, {
      ...previous,
      ...normalizeEndpointExplainFact(fact),
      ...(runMutations.length === 0 ? {} : { runMutations }),
      ...(writes.length === 0 ? {} : { writes }),
    });
  }

  return stableSortedCopy(mapValues(byKey), compareEndpointExplainFacts, 'endpoint facts');
}

function normalizeEndpointExplainFact(fact: CoreGraph.EndpointExplain): CoreGraph.EndpointExplain {
  return {
    ...fact,
    ...(fact.runMutations === undefined || fact.runMutations.length === 0
      ? {}
      : { runMutations: uniqueSorted(fact.runMutations) }),
    ...(fact.writes === undefined || fact.writes.length === 0
      ? {}
      : { writes: uniqueSorted(fact.writes) }),
  };
}

function endpointExplainMergeKey(fact: CoreGraph.EndpointExplain): string {
  return `${fact.surface ?? 'endpoint'}\0${fact.name ?? fact.path}\0${fact.path}`;
}

function compareEndpointExplainFacts(
  left: CoreGraph.EndpointExplain,
  right: CoreGraph.EndpointExplain,
): number {
  return (
    compilerStringLocaleCompare(left.name ?? left.path, right.name ?? right.path) ||
    compilerStringLocaleCompare(left.path, right.path) ||
    compilerStringLocaleCompare(left.surface ?? 'endpoint', right.surface ?? 'endpoint')
  );
}

function compareHandlerWriteSinkFacts(
  left: CoreGraph.HandlerWriteSinkExplain,
  right: CoreGraph.HandlerWriteSinkExplain,
): number {
  return (
    compilerStringLocaleCompare(left.surface, right.surface) ||
    compilerStringLocaleCompare(left.owner.kind, right.owner.kind) ||
    compilerStringLocaleCompare(left.owner.value, right.owner.value) ||
    left.span.start - right.span.start ||
    left.span.end - right.span.end ||
    compilerStringLocaleCompare(left.operationKind, right.operationKind) ||
    compilerStringLocaleCompare(left.path, right.path)
  );
}

function mergeSortedStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] {
  return uniqueSorted(concatDense(left ?? [], right ?? []));
}

function publishToClientCapabilitiesFromFacts(
  facts: readonly PublishToClientFact[],
): CoreGraph.CapabilityExplain[] {
  const snapshot = compilerSnapshotDenseArray(facts, 'Publish-to-client facts');
  const capabilities: CoreGraph.CapabilityExplain[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const fact = snapshot[index]!;
    capabilities[capabilities.length] = {
      justification: fact.reason,
      kind: 'publishToClient',
      moduleSpecifier: fact.moduleSpecifier,
      site: fact.site,
      target: fact.localName,
    };
  }
  return capabilities;
}

function compareCapabilityFacts(
  left: CoreGraph.CapabilityExplain,
  right: CoreGraph.CapabilityExplain,
): number {
  return (
    compilerStringLocaleCompare(left.kind, right.kind) ||
    compilerStringLocaleCompare(left.site, right.site) ||
    compilerStringLocaleCompare(left.moduleSpecifier ?? '', right.moduleSpecifier ?? '') ||
    compilerStringLocaleCompare(left.target ?? '', right.target ?? '')
  );
}

function concatDense<Value>(left: readonly Value[], right: readonly Value[]): Value[] {
  const leftSnapshot = compilerSnapshotDenseArray(left, 'Compiler graph facts');
  const rightSnapshot = compilerSnapshotDenseArray(right, 'Compiler graph facts');
  const combined: Value[] = [];
  for (let index = 0; index < leftSnapshot.length; index += 1) {
    combined[combined.length] = leftSnapshot[index]!;
  }
  for (let index = 0; index < rightSnapshot.length; index += 1) {
    combined[combined.length] = rightSnapshot[index]!;
  }
  return combined;
}

function flattenFactProperty<Value>(
  containers: readonly object[],
  property: string,
  label: string,
): Value[] {
  const containerSnapshot = compilerSnapshotDenseArray(containers, `${label} containers`);
  const flattened: Value[] = [];
  for (let containerIndex = 0; containerIndex < containerSnapshot.length; containerIndex += 1) {
    const values = compilerOwnDataValue(
      containerSnapshot[containerIndex],
      property,
      `${label}[${containerIndex}]`,
    );
    if (values === undefined) continue;
    if (!compilerArrayIsArray(values)) {
      throw new TypeError(`${label}[${containerIndex}].${property} must be an array.`);
    }
    const valueSnapshot = compilerSnapshotDenseArray(
      values,
      `${label}[${containerIndex}].${property}`,
    );
    for (let valueIndex = 0; valueIndex < valueSnapshot.length; valueIndex += 1) {
      flattened[flattened.length] = valueSnapshot[valueIndex] as Value;
    }
  }
  return flattened;
}

function stableSortedCopy<Value>(
  values: readonly Value[],
  compare: (left: Value, right: Value) => number,
  label: string,
): Value[] {
  const sorted = compilerSnapshotDenseArray(values, `Compiler ${label}`);
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index]!;
    let insertion = index;
    while (insertion > 0 && compare(sorted[insertion - 1]!, value) > 0) {
      sorted[insertion] = sorted[insertion - 1]!;
      insertion -= 1;
    }
    sorted[insertion] = value;
  }
  return sorted;
}

function mapValues<Key, Value>(map: ReadonlyMap<Key, Value>): Value[] {
  const values: Value[] = [];
  compilerMapForEach(map, (value) => {
    values[values.length] = value;
  });
  return values;
}

function sortedStringMapEntries<Value>(
  map: ReadonlyMap<string, Value>,
  label: string,
): [string, Value][] {
  const entries: [string, Value][] = [];
  compilerMapForEach(map, (value, key) => {
    entries[entries.length] = [key, value];
  });
  return stableSortedCopy(
    entries,
    ([left], [right]) => compilerStringLocaleCompare(left, right),
    label,
  );
}

function joinStrings(values: readonly string[], separator: string): string {
  const snapshot = compilerSnapshotDenseArray(values, 'Compiler strings');
  let output = '';
  for (let index = 0; index < snapshot.length; index += 1) {
    if (index > 0) output += separator;
    output += snapshot[index]!;
  }
  return output;
}

function hashFacts(facts: readonly unknown[]): string[] {
  const snapshot = compilerSnapshotDenseArray(facts, 'App graph hash facts');
  const hashes: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    hashes[hashes.length] = factHash(snapshot[index]);
  }
  return stableSortedCopy(hashes, compilerStringLocaleCompare, 'app graph fact hashes');
}

/**
 * @internal Extract the inferred fragment-target facts for a query-backed component,
 * used internally by {@link compileComponentModule} when building component graph facts.
 * Exported for in-repo callers only (SPEC.md §5.2).
 */
export function findFragmentTargetFacts(
  registryComponentName: string,
  model: ComponentModuleModel,
  component: ComponentModel | null = firstComponentModel(model),
): FragmentTargetFact[] {
  if (!component || !componentHasInferredFragmentTarget(component)) return [];

  return [
    {
      propsType: fragmentTargetPropsType(component),
      target: registryComponentName,
    },
  ];
}

/**
 * @internal Extract generated reconstruction facts for inferred server-refreshable targets. These
 * facts join target identity to component, props, and declared queries for §9.1 automatic full
 * fragment rendering.
 */
export function findLiveTargetFacts(
  domName: string,
  registryComponentName: string,
  model: ComponentModuleModel,
  updateCoverage: readonly QueryUpdateCoverageFact[] = [],
  component: ComponentModel | null = firstComponentModel(model),
): LiveTargetFact[] {
  if (!component || !componentHasInferredFragmentTarget(component)) return [];

  return [
    {
      component: registryComponentName,
      coverage: liveTargetCoverageFacts(updateCoverage, component),
      identityProps: componentPropNames(component),
      propsType: fragmentTargetPropsType(component),
      queryBindings: componentQueryBindingFacts(component),
      queries: componentQueryBindingNames(component),
      target: registryComponentName,
      targetBase: domName,
    },
  ];
}

/**
 * @internal Build the per-component graph fact (name, queries, fragment targets) that
 * {@link compileComponentModule} threads into a {@link CompileResult} and that
 * {@link deriveAppGraph} later merges. Lowered-IR fact shape; in-repo use only (SPEC.md §5.2).
 */
export function componentGraphFact(
  componentName: string,
  domName: string,
  model: ComponentModuleModel,
  fragmentTargets: readonly string[],
  styleRuleUsages: readonly StyleRuleUsage[] = [],
  exportName?: string,
  mutationForms: readonly CoreGraph.MutationFormExplain[] = [],
  component: ComponentModel | null = firstComponentModel(model),
  sourceFileName?: string,
): ComponentGraphFact {
  const queries = component
    ? componentQueryNames(component, model, sourceFileName)
    : componentQueryNamesForModule(model, sourceFileName);
  const clocks = component
    ? componentClockExplainFacts(component)
    : componentClockExplainFactsForModule(model);
  const styleRules: ComponentGraphFact['styleRules'] = [];
  const styleRuleSnapshot = compilerSnapshotDenseArray(styleRuleUsages, 'Component style rules');
  for (let index = 0; index < styleRuleSnapshot.length; index += 1) {
    const { className, source, styleRef } = styleRuleSnapshot[index]!;
    styleRules[styleRules.length] = { className, source, styleRef };
  }

  return {
    ...(clocks.length === 0 ? {} : { clocks }),
    domName,
    ...(exportName === undefined ? {} : { exportName }),
    ...(fragmentTargets.length === 0 ? {} : { fragments: fragmentTargets }),
    ...(mutationForms.length === 0 ? {} : { mutationForms }),
    ...(component
      ? componentDeclaresMutableLocalState(component, model)
        ? { mutableLocalState: true }
        : {}
      : firstComponentDeclaresMutableLocalState(model)
        ? { mutableLocalState: true }
        : {}),
    name: componentName,
    ...(queries.length === 0 ? {} : { queries }),
    ...(styleRules.length === 0 ? {} : { styleRules }),
  };
}

function componentClockExplainFactsForModule(
  model: ComponentModuleModel,
): CoreGraph.ClockExplain[] {
  return clockExplainFacts(componentOptionObjectEntries(model, 'clocks'));
}

function componentClockExplainFacts(component: ComponentModel): CoreGraph.ClockExplain[] {
  return clockExplainFacts(componentOptionObjectEntriesFor(component, 'clocks'));
}

function clockExplainFacts(entries: readonly ObjectLiteralEntry[]): CoreGraph.ClockExplain[] {
  const snapshot = compilerSnapshotDenseArray(entries, 'Component clock entries');
  const facts: CoreGraph.ClockExplain[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const entry = snapshot[index]!;
    if (entry.value) {
      facts[facts.length] = { cadence: clockCadenceSummary(entry), name: entry.key };
    }
  }
  return facts;
}

function firstComponentDeclaresMutableLocalState(model: ComponentModuleModel): boolean {
  const component = model.components[0];
  return component ? componentDeclaresMutableLocalState(component, model) : false;
}

function clockCadenceSummary(entry: Pick<ObjectLiteralEntry, 'objectEntries'>): string {
  const fields = compilerSnapshotDenseArray(entry.objectEntries ?? [], 'Clock cadence fields');
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (field.key === 'renderOnce' && field.value === 'true') return 'renderOnce';
  }

  const cadenceKeys = ['every', 'at', 'until'] as const;
  const parts: string[] = [];
  for (let keyIndex = 0; keyIndex < cadenceKeys.length; keyIndex += 1) {
    const key = cadenceKeys[keyIndex]!;
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      const field = fields[fieldIndex]!;
      if (field.key !== key || !field.value) continue;
      parts[parts.length] = `${key}=${compilerRegExpReplace(
        /\s+/g,
        compilerStringTrim(field.value),
        ' ',
      )}`;
      break;
    }
  }
  return parts.length > 0 ? joinStrings(parts, ',') : 'manual';
}

/**
 * @internal Derive the registry facts (components, domain keys, invalidations, routes) from
 * a merged graph input. Called by {@link deriveAppGraph}; exported for in-repo graph tooling
 * only, not for app authors (SPEC.md §5.2).
 */
export function deriveRegistryFactsFromGraph(
  graph: RegistryGraphInput,
  options: RegistryTypeFactOptions = {},
): RegistryFacts {
  const input = compilerSnapshotJsonValue(graph, 'Registry graph input');
  const typeOptions = compilerSnapshotJsonValue(options, 'Registry type options');
  const components = deriveComponentFactsFromGraph(input);
  let diagnostics = concatDense(routeFactDiagnostics(input), queryReadSetFactDiagnostics(input));
  diagnostics = concatDense(diagnostics, mutationFactDiagnostics(input));
  diagnostics = concatDense(
    diagnostics,
    registryTypeDriftDiagnostics(
      'mutation',
      typeOptions.mutations,
      typeOptions.previousRegistryFacts,
    ),
  );
  diagnostics = concatDense(
    diagnostics,
    registryTypeDriftDiagnostics('query', typeOptions.queries, typeOptions.previousRegistryFacts),
  );
  const fragmentTargets = deriveFragmentTargetsFromGraph(input);
  const statefulComponents = deriveStatefulComponentsFromGraph(input);
  const viewTransitions = deriveViewTransitionsFromGraph(input);
  const mutationTypes = typeOptions.mutations ?? {};
  const queryTypes = typeOptions.queries ?? {};
  const routes: string[] = [];
  const pages = compilerSnapshotDenseArray(input.pages ?? [], 'Registry graph pages');
  for (let index = 0; index < pages.length; index += 1) {
    routes[routes.length] = pages[index]!.route;
  }

  return compilerSnapshotJsonValue({
    ...(components.length > 0 ? { components } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    domainKeys: deriveDomainKeysFromGraph(input),
    ...(fragmentTargets.length > 0 ? { fragmentTargets } : {}),
    invalidations: deriveInvalidationFactsFromGraph(input),
    ...(compilerObjectKeys(mutationTypes).length > 0 ? { mutations: mutationTypes } : {}),
    ...(compilerObjectKeys(queryTypes).length > 0 ? { queries: queryTypes } : {}),
    routes: uniqueSorted(routes),
    ...(statefulComponents.length > 0 ? { statefulComponents } : {}),
    ...(viewTransitions.length > 0 ? { viewTransitions } : {}),
  }, 'Registry facts');
}

/**
 * @internal Report exact duplicate route facts before registry generation dedupes them.
 * SPEC §9.5 makes route-table ambiguity KV228; exact duplicates are ambiguous graph
 * authorship even though the runtime matcher would collapse them to one path.
 */
export function routeFactDiagnostics(graph: RegistryGraphInput): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const routeCounts = compilerCreateMap<string, number>();
  const pages = compilerSnapshotDenseArray(graph.pages ?? [], 'Registry graph pages');

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]!;
    compilerMapSet(routeCounts, page.route, (compilerMapGet(routeCounts, page.route) ?? 0) + 1);
  }

  const entries = sortedStringMapEntries(routeCounts, 'route counts');
  for (let index = 0; index < entries.length; index += 1) {
    const [route, count] = entries[index]!;
    if (count < 2) continue;
    diagnostics[diagnostics.length] = {
      code: 'KV228',
      fileName: 'app graph route table',
      help: diagnosticDefinitions.KV228.help,
      message: `${diagnosticDefinitions.KV228.message} duplicate route path "${route}" appears ${count} times in graph pages.`,
      severity: diagnosticDefinitions.KV228.severity,
    };
  }

  return diagnostics;
}

/**
 * @internal Report duplicate mutation-key facts before the invalidation registry indexes them.
 * SPEC §6.1 makes the mutation registry key-addressed and §9.5 dispatches a POST to exactly one
 * keyed handler. Two graph mutations sharing `mutation.key` is ambiguous graph authorship that
 * {@link deriveInvalidationFactsFromGraph} silently last-write-wins while the server dispatch
 * (`app-mutation-request.ts` `.find(...)`) first-match-wins — the same "duplicate facts silently
 * last-write-wins during graph indexing" failure mode every other registry identity is already
 * protected from (routes KV228, components KV237, fragment targets KV238, view transitions KV239,
 * query shapes KV240). Mutations were the only registry identity with no uniqueness diagnostic.
 */
export function mutationFactDiagnostics(graph: RegistryGraphInput): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const keyCounts = compilerCreateMap<string, number>();
  const mutations = compilerSnapshotDenseArray(graph.mutations ?? [], 'Registry graph mutations');

  for (let index = 0; index < mutations.length; index += 1) {
    const mutation = mutations[index]!;
    compilerMapSet(keyCounts, mutation.key, (compilerMapGet(keyCounts, mutation.key) ?? 0) + 1);
  }

  const entries = sortedStringMapEntries(keyCounts, 'mutation counts');
  for (let index = 0; index < entries.length; index += 1) {
    const [key, count] = entries[index]!;
    if (count < 2) continue;
    diagnostics[diagnostics.length] = {
      code: 'KV421',
      fileName: 'app graph mutation table',
      help: diagnosticDefinitions.KV421.help,
      message: `${diagnosticDefinitions.KV421.message} mutation key "${key}" appears ${count} times in graph mutations.`,
      severity: diagnosticDefinitions.KV421.severity,
    };
  }

  return diagnostics;
}

/**
 * @internal Report duplicate query read-set facts before invalidation derivation indexes them.
 * SPEC §4.1 makes app-authored query identities source-derived registry keys, while §10.2 makes
 * each query key the typed read surface and §10.3 depends on the resulting read-set graph for
 * mutation invalidation. A duplicate `query` fact is therefore not just a shape collision: it makes
 * one wire key name two read surfaces, so generated registries and invalidation derivation can
 * silently collapse facts before the server's `/_q/<key>` route ever sees the ambiguity.
 *
 * Drift/rename diagnostics need more provenance than this graph currently carries: query facts
 * expose only the resolved key and domains, with no exported binding/module identity and no
 * `previousRegistryFacts.queries` key list equivalent to `previousRegistryFacts.components`.
 */
export function queryReadSetFactDiagnostics(graph: RegistryGraphInput): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const queryCounts = compilerCreateMap<string, number>();
  const queries = compilerSnapshotDenseArray(graph.queries ?? [], 'Registry graph queries');

  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index]!;
    compilerMapSet(queryCounts, query.query, (compilerMapGet(queryCounts, query.query) ?? 0) + 1);
  }

  const entries = sortedStringMapEntries(queryCounts, 'query counts');
  for (let index = 0; index < entries.length; index += 1) {
    const [query, count] = entries[index]!;
    if (count < 2) continue;
    diagnostics[diagnostics.length] = {
      code: 'KV240',
      fileName: 'app graph query table',
      help: joinStrings([
        'Would lower to: one query read-set fact per source-derived query key for the generated query registry, /_q dispatch, kovo-query hydration, kovo-deps, and mutation invalidation graph.',
        'Blocked reason: two query declarations share one key, so graph indexing can silently collapse read sets and generated wire artifacts before the server read endpoint sees the ambiguity.',
        'Fixes: emit exactly one query fact per query key, or rename/move one exported query so its source-derived key is unique across the app graph.',
        'SPEC §4.1 derives query registry identities from source, §10.2 makes each query key a typed read surface, and §10.3 relies on those stable query identities when mutations compute invalidated reads.',
      ], '\n'),
      message: `Duplicate query key. query key "${query}" appears ${count} times in graph queries.`,
      severity: diagnosticDefinitions.KV240.severity,
    };
  }

  return diagnostics;
}

function registryTypeDriftDiagnostics(
  kind: 'mutation' | 'query',
  current: RegistryTypeFactOptions['mutations'],
  previousRegistryFacts: RegistryFacts | undefined,
): CompilerDiagnostic[] {
  const previous =
    kind === 'mutation' ? previousRegistryFacts?.mutations : previousRegistryFacts?.queries;
  if (!current || !previous) return [];

  const previousByType = compilerCreateMap<string, string[]>();
  const previousKeys = compilerObjectKeys(previous);
  for (let index = 0; index < previousKeys.length; index += 1) {
    const key = previousKeys[index]!;
    const typeSource = compilerOwnDataValue(previous, key, 'Previous registry types');
    if (typeof typeSource !== 'string') {
      throw new TypeError(`Previous registry type ${key} must be a string.`);
    }
    const keys = compilerMapGet(previousByType, typeSource) ?? [];
    keys[keys.length] = key;
    compilerMapSet(previousByType, typeSource, keys);
  }

  const diagnostics: CompilerDiagnostic[] = [];
  const currentKeys = stableSortedCopy(
    compilerObjectKeys(current),
    compilerStringLocaleCompare,
    'registry type keys',
  );
  for (let currentIndex = 0; currentIndex < currentKeys.length; currentIndex += 1) {
    const currentKey = currentKeys[currentIndex]!;
    const typeSource = compilerOwnDataValue(current, currentKey, 'Current registry types');
    if (typeof typeSource !== 'string') {
      throw new TypeError(`Current registry type ${currentKey} must be a string.`);
    }
    const matchingPreviousKeys = compilerMapGet(previousByType, typeSource) ?? [];
    const renamedKeys: string[] = [];
    for (let previousIndex = 0; previousIndex < matchingPreviousKeys.length; previousIndex += 1) {
      const previousKey = matchingPreviousKeys[previousIndex]!;
      if (previousKey !== currentKey) renamedKeys[renamedKeys.length] = previousKey;
    }
    const sortedPreviousKeys = stableSortedCopy(
      renamedKeys,
      compilerStringLocaleCompare,
      'previous registry type keys',
    );
    const previousCurrentType = compilerOwnDataValue(
      previous,
      currentKey,
      'Previous registry types',
    );
    if (sortedPreviousKeys.length !== 1 || previousCurrentType === typeSource) continue;

    diagnostics[diagnostics.length] = registryTypeDriftDiagnostic(
      kind,
      sortedPreviousKeys[0]!,
      currentKey,
      typeSource,
    );
  }
  return diagnostics;
}

function registryTypeDriftDiagnostic(
  kind: 'mutation' | 'query',
  previousKey: string,
  currentKey: string,
  typeSource: string,
): CompilerDiagnostic {
  const code = kind === 'mutation' ? 'KV246' : 'KV247';
  const definition = diagnosticDefinitions[code];
  return {
    code,
    fileName: `app graph ${kind} table`,
    help: joinStrings([
      definition.help,
      `Previous registry key: ${previousKey}`,
      `Current registry key: ${currentKey}`,
      `Registry type: ${typeSource}`,
      `Registry writer: previousRegistryFacts.${kind === 'mutation' ? 'mutations' : 'queries'}`,
    ], '\n'),
    message: `${definition.message} ${previousKey} -> ${currentKey}.`,
    severity: definition.severity,
  };
}

function deriveDomainKeysFromGraph(graph: RegistryGraphInput): string[] {
  const queryDomains = flattenFactProperty<string>(
    graph.queries ?? [],
    'domains',
    'Query domain facts',
  );
  const writes = flattenFactProperty<string>(
    graph.mutations ?? [],
    'writes',
    'Mutation write facts',
  );
  const invalidates = flattenFactProperty<string>(
    graph.mutations ?? [],
    'invalidates',
    'Mutation invalidation facts',
  );
  return uniqueSorted(concatDense(concatDense(queryDomains, writes), invalidates));
}

function deriveComponentFactsFromGraph(graph: RegistryGraphInput): string[] {
  const components = compilerSnapshotDenseArray(graph.components ?? [], 'Component graph facts');
  const names: string[] = [];
  for (let index = 0; index < components.length; index += 1) {
    names[names.length] = components[index]!.name;
  }
  return uniqueSorted(names);
}

function disambiguateComponentDomNames(
  components: readonly ComponentGraphFact[],
): ComponentGraphFact[] {
  const counts = compilerCreateMap<string, number>();
  const snapshot = compilerSnapshotDenseArray(components, 'Component graph facts');
  for (let index = 0; index < snapshot.length; index += 1) {
    const component = snapshot[index]!;
    const domName = component.domName;
    if (!domName) continue;
    compilerMapSet(counts, domName, (compilerMapGet(counts, domName) ?? 0) + 1);
  }

  const result: ComponentGraphFact[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const component = snapshot[index]!;
    const domName = component.domName;
    result[result.length] =
      !domName ||
      (compilerMapGet(counts, domName) ?? 0) < 2 ||
      component.disambiguatedDomName === component.name
        ? component
        : { ...component, disambiguatedDomName: component.name };
  }
  return result;
}

function deriveFragmentTargetsFromGraph(graph: RegistryGraphInput): string[] {
  return uniqueSorted(
    flattenFactProperty(graph.components ?? [], 'fragments', 'Component fragment facts'),
  );
}

function deriveStatefulComponentsFromGraph(graph: RegistryGraphInput): string[] {
  const components = compilerSnapshotDenseArray(graph.components ?? [], 'Component graph facts');
  const names: string[] = [];
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!;
    if (component.mutableLocalState === true) names[names.length] = component.name;
  }
  return uniqueSorted(names);
}

function deriveViewTransitionsFromGraph(graph: RegistryGraphInput): string[] {
  return uniqueSorted(
    flattenFactProperty(graph.pages ?? [], 'viewTransitions', 'Page view-transition facts'),
  );
}

function derivedPageFactsFromRoutePages(
  routePages: readonly RoutePageFact[],
  components: readonly ComponentGraphFact[],
): CoreGraph.PageExplain[] {
  const componentQueriesByExportName = componentQueryMap(components);
  const pages = compilerSnapshotDenseArray(routePages, 'Route-page facts');
  const results: CoreGraph.PageExplain[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]!;
    const queries = pageComponentQueries(page, componentQueriesByExportName);
    const componentQueryNamesByLocalName = routePageComponentQueryNamesByLocalName(
      page,
      componentQueriesByExportName,
    );
    const navigationSegmentFacts = compilerSnapshotDenseArray(
      page.navigationSegments ?? [],
      'Route-page navigation segments',
    );
    const navigationSegments: CoreGraph.PageNavigationSegmentExplain[] = [];
    for (let segmentIndex = 0; segmentIndex < navigationSegmentFacts.length; segmentIndex += 1) {
      const segment = navigationSegmentFacts[segmentIndex]!;
      let segmentQueries = compilerSnapshotDenseArray(
        segment.queries ?? [],
        'Route-page navigation queries',
      );
      if (segment.kind === 'page') {
        segmentQueries = [];
        const segmentComponents = compilerSnapshotDenseArray(
          segment.components ?? [],
          'Route-page navigation components',
        );
        for (let index = 0; index < segmentComponents.length; index += 1) {
          segmentQueries = concatDense(
            segmentQueries,
            compilerMapGet(componentQueryNamesByLocalName, segmentComponents[index]!) ?? [],
          );
        }
        segmentQueries = uniqueSorted(segmentQueries);
      }

      navigationSegments[navigationSegments.length] = {
        ...(segment.components === undefined ? {} : { components: segment.components }),
        id: segment.id,
        kind: segment.kind,
        name: segment.localName,
        ...(segmentQueries.length === 0 ? {} : { queries: segmentQueries }),
      };
    }

    const layouts: CoreGraph.PageLayoutExplain[] = [];
    const layoutFacts = compilerSnapshotDenseArray(page.layouts ?? [], 'Route-page layouts');
    for (let index = 0; index < layoutFacts.length; index += 1) {
      const layout = layoutFacts[index]!;
      layouts[layouts.length] = { name: layout.localName, queries: layout.queries };
    }

    results[results.length] = {
      ...(page.access === undefined ? {} : { access: page.access }),
      ...(page.guards === undefined || page.guards.length === 0 ? {} : { guards: page.guards }),
      ...(layouts.length > 0 ? { layouts } : {}),
      ...(navigationSegments.length > 0 ? { navigationSegments } : {}),
      ...(queries.length === 0 ? {} : { queries }),
      route: page.route,
    };
  }
  return results;
}

function mergeGraphPages(
  authoredPages: readonly CoreGraph.PageExplain[],
  routePages: readonly CoreGraph.PageExplain[],
): CoreGraph.PageExplain[] {
  const result = compilerSnapshotDenseArray(authoredPages, 'Authored graph pages');
  const derivedPages = compilerSnapshotDenseArray(routePages, 'Derived graph pages');
  const routeCounts = compilerCreateMap<string, number>();
  for (let index = 0; index < derivedPages.length; index += 1) {
    const page = derivedPages[index]!;
    compilerMapSet(routeCounts, page.route, (compilerMapGet(routeCounts, page.route) ?? 0) + 1);
  }

  for (let pageIndex = 0; pageIndex < derivedPages.length; pageIndex += 1) {
    const page = derivedPages[pageIndex]!;
    let matchIndex = -1;
    let matchCount = 0;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index]!.route !== page.route) continue;
      matchIndex = index;
      matchCount += 1;
    }
    if ((compilerMapGet(routeCounts, page.route) ?? 0) === 1 && matchCount === 1) {
      result[matchIndex] = mergeGraphPage(result[matchIndex]!, page);
    } else {
      result[result.length] = page;
    }
  }

  return result;
}

function mergeGraphPage(
  authoredPage: CoreGraph.PageExplain,
  derivedPage: CoreGraph.PageExplain,
): CoreGraph.PageExplain {
  return {
    ...authoredPage,
    ...(authoredPage.access === undefined && derivedPage.access !== undefined
      ? { access: derivedPage.access }
      : {}),
    ...(authoredPage.guards === undefined && derivedPage.guards !== undefined
      ? { guards: derivedPage.guards }
      : {}),
    ...(derivedPage.layouts === undefined ? {} : { layouts: derivedPage.layouts }),
    ...(derivedPage.navigationSegments === undefined
      ? {}
      : { navigationSegments: derivedPage.navigationSegments }),
    ...(authoredPage.queries === undefined && derivedPage.queries === undefined
      ? {}
      : {
          queries: uniqueSorted(
            concatDense(authoredPage.queries ?? [], derivedPage.queries ?? []),
          ),
        }),
  };
}

function componentQueryMap(
  components: readonly ComponentGraphFact[],
): ReadonlyMap<string, readonly string[]> {
  const queriesByExportName = compilerCreateMap<string, string[]>();
  const snapshot = compilerSnapshotDenseArray(components, 'Component graph facts');

  for (let index = 0; index < snapshot.length; index += 1) {
    const component = snapshot[index]!;
    const exportName = component.exportName;
    if (!exportName) continue;
    compilerMapSet(queriesByExportName, exportName, uniqueSorted(component.queries ?? []));
  }

  return queriesByExportName;
}

function pageComponentQueries(
  page: RoutePageFact,
  componentQueriesByExportName: ReadonlyMap<string, readonly string[]>,
): string[] {
  const components = compilerSnapshotDenseArray(page.components, 'Route-page components');
  let queries: string[] = [];
  for (let index = 0; index < components.length; index += 1) {
    queries = concatDense(
      queries,
      compilerMapGet(
        componentQueriesByExportName,
        routePageComponentExportName(components[index]!),
      ) ?? [],
    );
  }
  return uniqueSorted(queries);
}

function routePageComponentQueryNamesByLocalName(
  page: RoutePageFact,
  componentQueriesByExportName: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  const result = compilerCreateMap<string, readonly string[]>();
  const components = compilerSnapshotDenseArray(page.components, 'Route-page components');

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!;
    compilerMapSet(
      result,
      component.localName,
      compilerMapGet(componentQueriesByExportName, routePageComponentExportName(component)) ?? [],
    );
  }

  return result;
}

function routePageComponentExportName(component: RoutePageFact['components'][number]): string {
  return component.exportName ?? component.localName;
}

function componentQueryNamesForModule(
  model: ComponentModuleModel,
  sourceFileName?: string,
): string[] {
  return componentQueryNameFacts(
    componentOptionObjectEntries(model, 'queries'),
    model,
    sourceFileName,
  );
}

function componentQueryNames(
  component: ComponentModel,
  model?: ComponentModuleModel,
  sourceFileName?: string,
): string[] {
  return componentQueryNameFacts(
    componentOptionObjectEntriesFor(component, 'queries'),
    model,
    sourceFileName,
  );
}

function componentQueryNameFacts(
  entries: readonly ObjectLiteralEntry[],
  model: ComponentModuleModel | undefined,
  sourceFileName: string | undefined,
): string[] {
  const snapshot = compilerSnapshotDenseArray(entries, 'Component query entries');
  const names: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const entry = snapshot[index]!;
    names[names.length] = entry.key;
    const queryExpression = entry.value ? queryExpressionFromBinding(entry.value) : null;
    if (!queryExpression) continue;
    names[names.length] = queryExpression;
    const importedKey = derivedImportedQueryKey(
      sourceFileName,
      model?.namedImports ?? [],
      queryExpression,
    );
    if (importedKey !== undefined) names[names.length] = importedKey;
  }
  return uniqueSorted(names);
}

function derivedImportedQueryKey(
  fileName: string | undefined,
  imports: readonly NamedImportModel[],
  queryExpression: string,
): string | undefined {
  if (!fileName) return undefined;
  const importSnapshot = compilerSnapshotDenseArray(imports, 'Component named imports');
  let namedImport: NamedImportModel | undefined;
  for (let index = 0; index < importSnapshot.length; index += 1) {
    const entry = importSnapshot[index]!;
    if (
      entry.localName === queryExpression &&
      compilerStringStartsWith(entry.moduleSpecifier, '.')
    ) {
      namedImport = entry;
      break;
    }
  }
  if (!namedImport) return undefined;

  return deriveRegistryIdentity(
    resolveImportedSourceFileName(fileName, namedImport.moduleSpecifier),
    namedImport.importedName,
  ).key;
}

function resolveImportedSourceFileName(fileName: string, moduleSpecifier: string): string {
  return compilerRegExpReplace(/[\\/]/g, join(dirname(fileName), moduleSpecifier), '/');
}

function componentQueryBindingNames(component: ComponentModel): string[] {
  return objectEntryKeys(componentOptionObjectEntriesFor(component, 'queries'), 'query');
}

function componentPropNames(component: ComponentModel): string[] {
  return objectEntryKeys(componentOptionObjectEntriesFor(component, 'props'), 'prop');
}

function componentQueryBindingFacts(component: ComponentModel): LiveTargetQueryBindingFact[] {
  const entries = compilerSnapshotDenseArray(
    componentOptionObjectEntriesFor(component, 'queries'),
    'Component query entries',
  );
  const facts: LiveTargetQueryBindingFact[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const parsed = entry.value ? queryBindingFromExpression(entry.value) : null;
    facts[facts.length] = {
      name: entry.key,
      ...(parsed ?? { queryExpression: entry.value ?? entry.key }),
    };
  }
  return facts;
}

function fragmentTargetPropsType(component: ComponentModel): string {
  const entries = compilerSnapshotDenseArray(
    componentOptionObjectEntriesFor(component, 'props'),
    'Component prop entries',
  );
  const props: { key: string; type: string }[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    props[props.length] = { key: entry.key, type: entry.staticConstructorType ?? 'unknown' };
  }

  if (props.length === 0) return '{}';

  const parts: string[] = [];
  for (let index = 0; index < props.length; index += 1) {
    const prop = props[index]!;
    parts[parts.length] = `${prop.key}: ${prop.type}`;
  }
  return `{ ${joinStrings(parts, '; ')} }`;
}

function liveTargetCoverageFacts(
  coverage: readonly QueryUpdateCoverageFact[],
  component: ComponentModel,
): LiveTargetCoverageFact[] {
  const snapshot = compilerSnapshotDenseArray(coverage, 'Live-target coverage facts');
  const facts: LiveTargetCoverageFact[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const fact = snapshot[index]!;
    if (component.localName !== undefined && fact.componentName !== component.localName) continue;
    facts[facts.length] = {
      position: fact.position,
      query: fact.query,
      status: fact.status,
    };
  }
  return facts;
}

function objectEntryKeys(entries: readonly ObjectLiteralEntry[], label: string): string[] {
  const snapshot = compilerSnapshotDenseArray(entries, `Component ${label} entries`);
  const keys: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    keys[keys.length] = snapshot[index]!.key;
  }
  return keys;
}

function deriveInvalidationFactsFromGraph(
  graph: RegistryGraphInput,
): Readonly<Record<string, readonly string[]>> {
  const queries = compilerSnapshotDenseArray(graph.queries ?? [], 'Registry graph queries');
  const mutations = compilerSnapshotDenseArray(graph.mutations ?? [], 'Registry graph mutations');
  const invalidations = compilerCreateNullRecord<string[]>();

  for (let mutationIndex = 0; mutationIndex < mutations.length; mutationIndex += 1) {
    const mutation = mutations[mutationIndex]!;
    const invalidatedDomains = mutation.invalidates ?? mutation.writes ?? [];
    const invalidatedDomainSet = compilerCreateSet<string>();
    const domainSnapshot = compilerSnapshotDenseArray(
      invalidatedDomains,
      `Mutation ${mutation.key} invalidated domains`,
    );
    for (let index = 0; index < domainSnapshot.length; index += 1) {
      compilerSetAdd(invalidatedDomainSet, domainSnapshot[index]!);
    }
    const invalidatedQueries: string[] = [];
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
      const query = queries[queryIndex]!;
      const queryDomains = compilerSnapshotDenseArray(
        query.domains,
        `Query ${query.query} domains`,
      );
      let overlaps = false;
      for (let domainIndex = 0; domainIndex < queryDomains.length; domainIndex += 1) {
        if (compilerSetHas(invalidatedDomainSet, queryDomains[domainIndex]!)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) invalidatedQueries[invalidatedQueries.length] = query.query;
    }

    if (invalidatedQueries.length > 0) {
      invalidations[mutation.key] = uniqueSorted(invalidatedQueries);
    }
  }

  return invalidations;
}
