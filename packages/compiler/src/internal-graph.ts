import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import ts from 'typescript';

import type { CompilerDiagnostic } from './diagnostics.js';
import {
  componentOptionObjectEntries,
  componentOptionObjectKeys,
  componentHasInferredServerRefreshTarget,
  type ComponentModuleModel,
} from './scan/parse.js';
import type {
  CompileAppGraphOptions,
  CompileAppGraphResult,
  ComponentGraphFact,
  FragmentTargetFact,
  LiveTargetFact,
  LiveTargetCoverageFact,
  LiveTargetQueryBindingFact,
  QueryUpdateCoverageFact,
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
  const derivedRoutePages = derivedPageFactsFromRoutePages(routePages, components);
  const graph: RegistryGraphInput = {
    ...options.graph,
    components,
    ...(derivedRoutePages.length > 0 || (options.graph?.pages?.length ?? 0) > 0
      ? { pages: mergeGraphPages(options.graph?.pages ?? [], derivedRoutePages) }
      : {}),
    ...(packageComponentPrefixes.length > 0 ? { packageComponentPrefixes } : {}),
  };

  const registryFacts = deriveRegistryFactsFromGraph(graph, options.registryTypes);

  return {
    diagnostics: registryFacts.diagnostics ?? [],
    graph,
    registryFacts,
  };
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

  return {
    domName,
    ...(exportName === undefined ? {} : { exportName }),
    ...(fragmentTargets.length === 0 ? {} : { fragments: fragmentTargets }),
    ...(mutationForms.length === 0 ? {} : { mutationForms }),
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
  const diagnostics = routeFactDiagnostics(graph);
  const fragmentTargets = deriveFragmentTargetsFromGraph(graph);
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
    const navigationSegments = (page.navigationSegments ?? []).map((segment) => {
      const segmentQueries =
        segment.kind === 'page'
          ? uniqueSorted(
              (segment.components ?? []).flatMap(
                (component) => componentQueriesByExportName.get(component) ?? [],
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
  for (const page of routePages) routeCounts.set(page.route, (routeCounts.get(page.route) ?? 0) + 1);

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
      (component) => componentQueriesByExportName.get(component.localName) ?? [],
    ),
  );
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

function queryBindingFromExpression(
  expressionSource: string,
): Omit<LiveTargetQueryBindingFact, 'name'> | null {
  const sourceFile = ts.createSourceFile(
    'query-binding.tsx',
    `const __binding = ${expressionSource};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const statement = sourceFile.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) return null;
  const expression = statement.declarationList.declarations[0]?.initializer;
  if (!expression) return null;

  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === 'args'
  ) {
    const [mapper] = expression.arguments;
    const arrow = mapper && ts.isArrowFunction(mapper) ? mapper : null;
    return {
      ...(arrow ? queryArgsArrowFacts(sourceFile, arrow) : {}),
      queryExpression: expression.expression.expression.getText(sourceFile),
    };
  }

  return {
    queryExpression: expression.getText(sourceFile),
  };
}

function queryArgsArrowFacts(
  sourceFile: ts.SourceFile,
  arrow: ts.ArrowFunction,
): Pick<
  LiveTargetQueryBindingFact,
  'argsExpression' | 'argsParam' | 'argsPropertyAccesses'
> {
  const param = arrow.parameters[0];
  const argsParam = param && ts.isIdentifier(param.name) ? param.name.text : undefined;
  const body = arrow.body;
  const argsExpression = body.getText(sourceFile);
  const propertyAccesses = propertyAccessPaths(body);

  return {
    argsExpression,
    ...(argsParam === undefined ? {} : { argsParam }),
    ...(propertyAccesses.length === 0 ? {} : { argsPropertyAccesses: propertyAccesses }),
  };
}

function propertyAccessPaths(node: ts.Node): string[] {
  const paths: string[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isPropertyAccessExpression(current)) {
      const path = propertyAccessPath(current);
      if (path) paths.push(path);
    }
    ts.forEachChild(current, visit);
  };

  visit(node);
  return [...new Set(paths)];
}

function propertyAccessPath(expression: ts.PropertyAccessExpression): string | null {
  const receiver = propertyAccessReceiverSegments(expression.expression);
  if (!receiver) return null;
  return [...receiver, expression.name.text].join('.');
}

function propertyAccessReceiverSegments(expression: ts.Expression): string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const path = propertyAccessPath(expression);
  return path ? path.split('.') : null;
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
