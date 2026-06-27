import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { deriveAccessExplainFacts } from '@kovojs/core/internal/graph';
import type * as CoreGraph from '@kovojs/core/internal/graph';

import type { CompilerDiagnostic } from './diagnostics.js';
import { factHash } from './fact-hash.js';
import {
  componentOptionObjectEntries,
  componentOptionObjectKeys,
  componentDeclaresMutableLocalState,
  componentHasInferredServerRefreshTarget,
  type ComponentModuleModel,
  type ObjectLiteralEntry,
} from './scan/parse.js';
import { queryBindingFromExpression } from './scan/query-binding.js';
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
  const packageComponentPrefixes = [
    ...(options.graph?.packageComponentPrefixes ?? []),
    ...(options.packageComponentPrefixes ?? []),
  ];
  const components = disambiguateComponentDomNames([
    ...(options.graph?.components ?? []),
    ...(options.components ?? []).flatMap((component) => component.componentGraphFacts),
  ]);
  const routePages = (options.routePages ?? []).flatMap((routePage) => routePage.routePageFacts);
  const publishToClientCapabilities = (options.components ?? []).flatMap((component) =>
    publishToClientCapabilitiesFromFacts(component.publishToClientFacts ?? []),
  );
  const capabilities = [
    ...(options.graph?.capabilities ?? []),
    ...publishToClientCapabilities,
  ].sort(compareCapabilityFacts);
  const derivedRoutePages = derivedPageFactsFromRoutePages(routePages, components);
  const mergedPages =
    derivedRoutePages.length > 0 || (options.graph?.pages?.length ?? 0) > 0
      ? mergeGraphPages(options.graph?.pages ?? [], derivedRoutePages)
      : undefined;
  // SPEC.md §10.2/§6.6: classify every query/mutation/route-page/endpoint/webhook
  // surface into a default-deny access fact and populate `graph.access` so the
  // KV436 consumer (`kovo check`) fires on any surface with no explicit decision,
  // guard, or machine-auth posture. By-construction: the proof is this static graph
  // fact, not a TS brand. KV436 proves a decision EXISTS, never that it is correct.
  const pagesForAccess = mergedPages ?? options.graph?.pages;
  const derivedAccess = deriveAccessExplainFacts({
    ...(options.graph?.endpoints === undefined ? {} : { endpoints: options.graph.endpoints }),
    ...(options.graph?.mutations === undefined ? {} : { mutations: options.graph.mutations }),
    ...(pagesForAccess === undefined ? {} : { pages: pagesForAccess }),
    ...(options.graph?.queries === undefined ? {} : { queries: options.graph.queries }),
  });
  const access = mergeAccessExplainFacts(options.graph?.access ?? [], derivedAccess);
  const graph: RegistryGraphInput = {
    ...options.graph,
    ...(access.length > 0 ? { access } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    components,
    ...(mergedPages === undefined ? {} : { pages: mergedPages }),
    ...(packageComponentPrefixes.length > 0 ? { packageComponentPrefixes } : {}),
    // SPEC §10.2/§11.2: preserve KV422 SQL-safety diagnostics from `compile drizzle-static`
    // (analyzeSqlSafetyFromProject) so the build→graph.json the `kovo check` consumer reads carries
    // them and the check fails end-to-end. By-construction at `kovo check`: an error-severity finding
    // here means request-derived text could reach executable SQL on a managed handle. (The spread
    // above already retains the field at runtime; this is the explicit, load-bearing thread.)
    ...(options.graph?.sqlSafetyDiagnostics === undefined
      ? {}
      : { sqlSafetyDiagnostics: options.graph.sqlSafetyDiagnostics }),
    // SPEC §6.6: preserve KV426 trust escapes (`kovo explain --trust`, audit-only) and KV424
    // app dangerous-sink facts (`kovo check` error gate) from `compile drizzle-static` so the
    // build→graph.json carries the trust surface and the imperative-DOM sink findings.
    ...(options.graph?.trustEscapes === undefined
      ? {}
      : { trustEscapes: options.graph.trustEscapes }),
    ...(options.graph?.unregisteredSinks === undefined
      ? {}
      : { unregisteredSinks: options.graph.unregisteredSinks }),
  };

  const registryFacts = deriveRegistryFactsFromGraph(graph, {
    ...options.registryTypes,
    ...(options.previousRegistryFacts === undefined
      ? {}
      : { previousRegistryFacts: options.previousRegistryFacts }),
  });

  return {
    diagnostics: registryFacts.diagnostics ?? [],
    graph,
    registryFacts,
  };
}

function mergeAccessExplainFacts(
  callerFacts: readonly CoreGraph.AccessExplainFact[],
  derivedFacts: readonly CoreGraph.AccessExplainFact[],
): CoreGraph.AccessExplainFact[] {
  const facts = [...callerFacts];
  const existing = new Set(callerFacts.map(accessExplainFactKey));
  for (const fact of derivedFacts) {
    const key = accessExplainFactKey(fact);
    if (existing.has(key)) continue;
    facts.push(fact);
    existing.add(key);
  }
  return facts.sort(compareAccessFacts);
}

function accessExplainFactKey(fact: CoreGraph.AccessExplainFact): string {
  return `${fact.kind}\0${fact.name}`;
}

function compareAccessFacts(
  left: CoreGraph.AccessExplainFact,
  right: CoreGraph.AccessExplainFact,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.decision.localeCompare(right.decision)
  );
}

/** @internal Process-lifetime cache for app graph derivation keyed by contribution fingerprints. */
export class IncrementalAppGraphCache {
  readonly #results = new Map<string, CompileAppGraphResult>();

  derive(options: CompileAppGraphOptions): CompileAppGraphResult {
    const key = appGraphContributionHash(options);
    const cached = this.#results.get(key);
    if (cached) return cached;

    const result = deriveAppGraph(options);
    this.#results.set(key, result);
    return result;
  }
}

/** @internal Stable multiset hash of the facts that contribute to {@link deriveAppGraph}. */
export function appGraphContributionHash(options: CompileAppGraphOptions): string {
  const componentHashes = (options.components ?? [])
    .flatMap((component) => component.componentGraphFacts)
    .map((fact) => factHash(fact))
    .sort();
  const routeHashes = (options.routePages ?? [])
    .flatMap((routePage) => routePage.routePageFacts)
    .map((fact) => factHash(fact))
    .sort();

  return factHash({
    components: componentHashes,
    graph: options.graph ?? null,
    packageComponentPrefixes: options.packageComponentPrefixes ?? null,
    previousRegistryFacts: options.previousRegistryFacts ?? null,
    registryTypes: options.registryTypes ?? null,
    routes: routeHashes,
    publishToClientFacts: (options.components ?? [])
      .flatMap((component) => component.publishToClientFacts ?? [])
      .map((fact) => factHash(fact))
      .sort(),
  });
}

function publishToClientCapabilitiesFromFacts(
  facts: readonly PublishToClientFact[],
): CoreGraph.CapabilityExplain[] {
  return facts.map((fact) => ({
    justification: fact.reason,
    kind: 'publishToClient',
    moduleSpecifier: fact.moduleSpecifier,
    site: fact.site,
    target: fact.localName,
  }));
}

function compareCapabilityFacts(
  left: CoreGraph.CapabilityExplain,
  right: CoreGraph.CapabilityExplain,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.site.localeCompare(right.site) ||
    (left.moduleSpecifier ?? '').localeCompare(right.moduleSpecifier ?? '') ||
    (left.target ?? '').localeCompare(right.target ?? '')
  );
}

/**
 * @internal Extract the inferred fragment-target facts for a query-backed component,
 * used internally by {@link compileComponentModule} when building component graph facts.
 * Exported for in-repo callers only (SPEC.md §5.2).
 */
export function findFragmentTargetFacts(
  registryComponentName: string,
  model: ComponentModuleModel,
): FragmentTargetFact[] {
  if (!componentHasInferredServerRefreshTarget(model)) return [];

  return [
    {
      propsType: fragmentTargetPropsType(model),
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
): LiveTargetFact[] {
  if (!componentHasInferredServerRefreshTarget(model)) return [];

  return [
    {
      component: registryComponentName,
      coverage: liveTargetCoverageFacts(updateCoverage),
      identityProps: componentPropNames(model),
      propsType: fragmentTargetPropsType(model),
      queryBindings: componentQueryBindingFacts(model),
      queries: componentQueryNames(model),
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
): ComponentGraphFact {
  const queries = componentQueryNames(model);
  const clocks = componentClockExplainFacts(model);

  return {
    ...(clocks.length === 0 ? {} : { clocks }),
    domName,
    ...(exportName === undefined ? {} : { exportName }),
    ...(fragmentTargets.length === 0 ? {} : { fragments: fragmentTargets }),
    ...(mutationForms.length === 0 ? {} : { mutationForms }),
    ...(firstComponentDeclaresMutableLocalState(model) ? { mutableLocalState: true } : {}),
    name: componentName,
    ...(queries.length === 0 ? {} : { queries }),
    ...(styleRuleUsages.length === 0
      ? {}
      : {
          styleRules: styleRuleUsages.map(({ className, source, styleRef }) => ({
            className,
            source,
            styleRef,
          })),
        }),
  };
}

function componentClockExplainFacts(model: ComponentModuleModel): CoreGraph.ClockExplain[] {
  return componentOptionObjectEntries(model, 'clocks').flatMap((entry) =>
    entry.value ? [{ cadence: clockCadenceSummary(entry), name: entry.key }] : [],
  );
}

function firstComponentDeclaresMutableLocalState(model: ComponentModuleModel): boolean {
  const component = model.components[0];
  return component ? componentDeclaresMutableLocalState(component, model) : false;
}

function clockCadenceSummary(entry: Pick<ObjectLiteralEntry, 'objectEntries'>): string {
  const fields = entry.objectEntries ?? [];
  if (fields.some((field) => field.key === 'renderOnce' && field.value === 'true')) {
    return 'renderOnce';
  }

  const parts = ['every', 'at', 'until'].flatMap((key) => {
    const value = fields.find((field) => field.key === key)?.value;
    return value ? [`${key}=${value.trim().replace(/\s+/g, ' ')}`] : [];
  });
  return parts.length > 0 ? parts.join(',') : 'manual';
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
  const components = deriveComponentFactsFromGraph(graph);
  const diagnostics = [
    ...routeFactDiagnostics(graph),
    ...queryReadSetFactDiagnostics(graph),
    ...mutationFactDiagnostics(graph),
    ...registryTypeDriftDiagnostics('mutation', options.mutations, options.previousRegistryFacts),
    ...registryTypeDriftDiagnostics('query', options.queries, options.previousRegistryFacts),
  ];
  const fragmentTargets = deriveFragmentTargetsFromGraph(graph);
  const statefulComponents = deriveStatefulComponentsFromGraph(graph);
  const viewTransitions = deriveViewTransitionsFromGraph(graph);

  return {
    ...(components.length > 0 ? { components } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    domainKeys: deriveDomainKeysFromGraph(graph),
    ...(fragmentTargets.length > 0 ? { fragmentTargets } : {}),
    invalidations: deriveInvalidationFactsFromGraph(graph),
    ...(Object.keys(options.mutations ?? {}).length > 0 ? { mutations: options.mutations } : {}),
    ...(Object.keys(options.queries ?? {}).length > 0 ? { queries: options.queries } : {}),
    routes: [...new Set((graph.pages ?? []).map((page) => page.route))].sort(),
    ...(statefulComponents.length > 0 ? { statefulComponents } : {}),
    ...(viewTransitions.length > 0 ? { viewTransitions } : {}),
  };
}

/**
 * @internal Report exact duplicate route facts before registry generation dedupes them.
 * SPEC §9.5 makes route-table ambiguity KV228; exact duplicates are ambiguous graph
 * authorship even though the runtime matcher would collapse them to one path.
 */
export function routeFactDiagnostics(graph: RegistryGraphInput): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const routeCounts = new Map<string, number>();

  for (const page of graph.pages ?? []) {
    routeCounts.set(page.route, (routeCounts.get(page.route) ?? 0) + 1);
  }

  for (const [route, count] of [...routeCounts].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (count < 2) continue;
    diagnostics.push({
      code: 'KV228',
      fileName: 'app graph route table',
      help: diagnosticDefinitions.KV228.help,
      message: `${diagnosticDefinitions.KV228.message} duplicate route path "${route}" appears ${count} times in graph pages.`,
      severity: diagnosticDefinitions.KV228.severity,
    });
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
  const keyCounts = new Map<string, number>();

  for (const mutation of graph.mutations ?? []) {
    keyCounts.set(mutation.key, (keyCounts.get(mutation.key) ?? 0) + 1);
  }

  for (const [key, count] of [...keyCounts].sort(([left], [right]) => left.localeCompare(right))) {
    if (count < 2) continue;
    diagnostics.push({
      code: 'KV421',
      fileName: 'app graph mutation table',
      help: diagnosticDefinitions.KV421.help,
      message: `${diagnosticDefinitions.KV421.message} mutation key "${key}" appears ${count} times in graph mutations.`,
      severity: diagnosticDefinitions.KV421.severity,
    });
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
  const queryCounts = new Map<string, number>();

  for (const query of graph.queries ?? []) {
    queryCounts.set(query.query, (queryCounts.get(query.query) ?? 0) + 1);
  }

  for (const [query, count] of [...queryCounts].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (count < 2) continue;
    diagnostics.push({
      code: 'KV240',
      fileName: 'app graph query table',
      help: [
        'Would lower to: one query read-set fact per source-derived query key for the generated query registry, /_q dispatch, kovo-query hydration, kovo-deps, and mutation invalidation graph.',
        'Blocked reason: two query declarations share one key, so graph indexing can silently collapse read sets and generated wire artifacts before the server read endpoint sees the ambiguity.',
        'Fixes: emit exactly one query fact per query key, or rename/move one exported query so its source-derived key is unique across the app graph.',
        'SPEC §4.1 derives query registry identities from source, §10.2 makes each query key a typed read surface, and §10.3 relies on those stable query identities when mutations compute invalidated reads.',
      ].join('\n'),
      message: `Duplicate query key. query key "${query}" appears ${count} times in graph queries.`,
      severity: diagnosticDefinitions.KV240.severity,
    });
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

  const previousByType = new Map<string, string[]>();
  for (const [key, typeSource] of Object.entries(previous)) {
    const keys = previousByType.get(typeSource) ?? [];
    keys.push(key);
    previousByType.set(typeSource, keys);
  }

  const diagnostics: CompilerDiagnostic[] = [];
  for (const [currentKey, typeSource] of Object.entries(current).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const previousKeys = (previousByType.get(typeSource) ?? [])
      .filter((previousKey) => previousKey !== currentKey)
      .sort((left, right) => left.localeCompare(right));
    if (previousKeys.length !== 1 || previous[currentKey] === typeSource) continue;

    diagnostics.push(registryTypeDriftDiagnostic(kind, previousKeys[0]!, currentKey, typeSource));
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
    help: [
      definition.help,
      `Previous registry key: ${previousKey}`,
      `Current registry key: ${currentKey}`,
      `Registry type: ${typeSource}`,
      `Registry writer: previousRegistryFacts.${kind === 'mutation' ? 'mutations' : 'queries'}`,
    ].join('\n'),
    message: `${definition.message} ${previousKey} -> ${currentKey}.`,
    severity: definition.severity,
  };
}

function deriveDomainKeysFromGraph(graph: RegistryGraphInput): string[] {
  return [
    ...(graph.queries ?? []).flatMap((query) => query.domains),
    ...(graph.mutations ?? []).flatMap((mutation) => mutation.writes ?? []),
    ...(graph.mutations ?? []).flatMap((mutation) => mutation.invalidates ?? []),
  ]
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort((left, right) => left.localeCompare(right));
}

function deriveComponentFactsFromGraph(graph: RegistryGraphInput): string[] {
  return [...new Set((graph.components ?? []).map((component) => component.name))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function disambiguateComponentDomNames(
  components: readonly ComponentGraphFact[],
): ComponentGraphFact[] {
  const counts = new Map<string, number>();
  for (const component of components) {
    const domName = component.domName;
    if (!domName) continue;
    counts.set(domName, (counts.get(domName) ?? 0) + 1);
  }

  return components.map((component) => {
    const domName = component.domName;
    if (!domName || (counts.get(domName) ?? 0) < 2) return component;
    if (component.disambiguatedDomName === component.name) return component;

    return {
      ...component,
      disambiguatedDomName: component.name,
    };
  });
}

function deriveFragmentTargetsFromGraph(graph: RegistryGraphInput): string[] {
  return [
    ...new Set((graph.components ?? []).flatMap((component) => component.fragments ?? [])),
  ].sort((left, right) => left.localeCompare(right));
}

function deriveStatefulComponentsFromGraph(graph: RegistryGraphInput): string[] {
  return [
    ...new Set(
      (graph.components ?? [])
        .filter((component) => component.mutableLocalState === true)
        .map((component) => component.name),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function deriveViewTransitionsFromGraph(graph: RegistryGraphInput): string[] {
  return [...new Set((graph.pages ?? []).flatMap((page) => page.viewTransitions ?? []))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function derivedPageFactsFromRoutePages(
  routePages: readonly RoutePageFact[],
  components: readonly ComponentGraphFact[],
): CoreGraph.PageExplain[] {
  const componentQueriesByExportName = componentQueryMap(components);

  return routePages.map((page) => {
    const queries = pageComponentQueries(page, componentQueriesByExportName);
    const componentQueryNamesByLocalName = routePageComponentQueryNamesByLocalName(
      page,
      componentQueriesByExportName,
    );
    const navigationSegments = (page.navigationSegments ?? []).map((segment) => {
      const segmentQueries =
        segment.kind === 'page'
          ? uniqueSorted(
              (segment.components ?? []).flatMap(
                (component) => componentQueryNamesByLocalName.get(component) ?? [],
              ),
            )
          : (segment.queries ?? []);

      return {
        ...(segment.components === undefined ? {} : { components: segment.components }),
        id: segment.id,
        kind: segment.kind,
        name: segment.localName,
        ...(segmentQueries.length === 0 ? {} : { queries: segmentQueries }),
      };
    });

    return {
      ...(page.access === undefined ? {} : { access: page.access }),
      ...(page.guards === undefined || page.guards.length === 0 ? {} : { guards: page.guards }),
      ...(page.layouts && page.layouts.length > 0
        ? {
            layouts: page.layouts.map((layout) => ({
              name: layout.localName,
              queries: layout.queries,
            })),
          }
        : {}),
      ...(navigationSegments.length > 0 ? { navigationSegments } : {}),
      ...(queries.length === 0 ? {} : { queries }),
      route: page.route,
    };
  });
}

function mergeGraphPages(
  authoredPages: readonly CoreGraph.PageExplain[],
  routePages: readonly CoreGraph.PageExplain[],
): CoreGraph.PageExplain[] {
  const result = [...authoredPages];
  const routeCounts = new Map<string, number>();
  for (const page of routePages)
    routeCounts.set(page.route, (routeCounts.get(page.route) ?? 0) + 1);

  for (const page of routePages) {
    const authoredMatches = result
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.route === page.route);
    if ((routeCounts.get(page.route) ?? 0) === 1 && authoredMatches.length === 1) {
      const [match] = authoredMatches;
      if (!match) continue;
      result[match.index] = mergeGraphPage(match.candidate, page);
    } else {
      result.push(page);
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
          queries: uniqueSorted([...(authoredPage.queries ?? []), ...(derivedPage.queries ?? [])]),
        }),
  };
}

function componentQueryMap(
  components: readonly ComponentGraphFact[],
): ReadonlyMap<string, readonly string[]> {
  const queriesByExportName = new Map<string, string[]>();

  for (const component of components) {
    const exportName = component.exportName;
    if (!exportName) continue;
    queriesByExportName.set(exportName, uniqueSorted(component.queries ?? []));
  }

  return queriesByExportName;
}

function pageComponentQueries(
  page: RoutePageFact,
  componentQueriesByExportName: ReadonlyMap<string, readonly string[]>,
): string[] {
  return uniqueSorted(
    page.components.flatMap(
      (component) =>
        componentQueriesByExportName.get(routePageComponentExportName(component)) ?? [],
    ),
  );
}

function routePageComponentQueryNamesByLocalName(
  page: RoutePageFact,
  componentQueriesByExportName: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, readonly string[]>();

  for (const component of page.components) {
    result.set(
      component.localName,
      componentQueriesByExportName.get(routePageComponentExportName(component)) ?? [],
    );
  }

  return result;
}

function routePageComponentExportName(component: RoutePageFact['components'][number]): string {
  return component.exportName ?? component.localName;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function componentQueryNames(model: ComponentModuleModel): string[] {
  return componentOptionObjectKeys(model, 'queries');
}

function componentPropNames(model: ComponentModuleModel): string[] {
  return componentOptionObjectEntries(model, 'props').map((entry) => entry.key);
}

function componentQueryBindingFacts(model: ComponentModuleModel): LiveTargetQueryBindingFact[] {
  return componentOptionObjectEntries(model, 'queries').map((entry) => {
    const parsed = entry.value ? queryBindingFromExpression(entry.value) : null;
    return {
      name: entry.key,
      ...(parsed ?? { queryExpression: entry.value ?? entry.key }),
    };
  });
}

function fragmentTargetPropsType(model: ComponentModuleModel): string {
  const props = componentOptionObjectEntries(model, 'props').map((entry) => ({
    key: entry.key,
    type: entry.staticConstructorType ?? 'unknown',
  }));

  if (props.length === 0) return '{}';

  return `{ ${props.map((prop) => `${prop.key}: ${prop.type}`).join('; ')} }`;
}

function liveTargetCoverageFacts(
  coverage: readonly QueryUpdateCoverageFact[],
): LiveTargetCoverageFact[] {
  return coverage.map((fact) => ({
    position: fact.position,
    query: fact.query,
    status: fact.status,
  }));
}

function deriveInvalidationFactsFromGraph(
  graph: RegistryGraphInput,
): Readonly<Record<string, readonly string[]>> {
  const queries = graph.queries ?? [];
  const invalidations: Record<string, string[]> = {};

  for (const mutation of graph.mutations ?? []) {
    const invalidatedDomains = mutation.invalidates ?? mutation.writes ?? [];
    const invalidatedQueries = queries
      .filter((query) => query.domains.some((domain) => invalidatedDomains.includes(domain)))
      .map((query) => query.query);

    if (invalidatedQueries.length > 0) {
      invalidations[mutation.key] = [...new Set(invalidatedQueries)].sort();
    }
  }

  return invalidations;
}
