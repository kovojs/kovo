import { diagnosticDefinitions } from '@kovojs/core';

import type { CompilerDiagnostic } from './diagnostics.js';
import {
  componentOptionObjectEntries,
  componentOptionObjectKeys,
  componentOptionStaticValue,
  type ComponentModuleModel,
} from './scan/parse.js';
import type {
  CompileAppGraphOptions,
  CompileAppGraphResult,
  ComponentGraphFact,
  FragmentTargetFact,
  RegistryFacts,
  RegistryGraphInput,
  RegistryTypeFactOptions,
} from './types.js';

/**
 * Derive an app-level component/registry graph from the per-component facts produced by
 * compileComponentModule, returning the merged graph plus the registry facts (component
 * list, domain keys, invalidations, routes) the server runtime indexes.
 *
 * Public entry point of `@kovojs/compiler` (also reachable via the `@kovojs/compiler/graph`
 * subpath). `create-kovo` templates and the example apps call it from their graph-emit
 * scripts to derive `generated/` registries (SPEC.md §5.2).
 */
export function deriveAppGraph(options: CompileAppGraphOptions): CompileAppGraphResult {
  const packageComponentPrefixes = [
    ...(options.graph?.packageComponentPrefixes ?? []),
    ...(options.packageComponentPrefixes ?? []),
  ];
  const graph: RegistryGraphInput = {
    ...options.graph,
    components: [
      ...(options.graph?.components ?? []),
      ...(options.components ?? []).flatMap((component) => component.componentGraphFacts),
    ],
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
 * @internal Extract the fragment-target facts a component declares via its
 * `fragmentTarget` option, used internally by {@link compileComponentModule} when building
 * component graph facts. Exported for in-repo callers only (SPEC.md §5.2).
 */
export function findFragmentTargetFacts(
  registryComponentName: string,
  model: ComponentModuleModel,
): FragmentTargetFact[] {
  if (componentOptionStaticValue(model, 'fragmentTarget') !== true) return [];

  return [
    {
      propsType: fragmentTargetPropsType(model),
      target: registryComponentName,
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
  model: ComponentModuleModel,
  fragmentTargets: readonly string[],
): ComponentGraphFact {
  const queries = componentQueryNames(model);

  return {
    ...(fragmentTargets.length === 0 ? {} : { fragments: fragmentTargets }),
    name: componentName,
    ...(queries.length === 0 ? {} : { queries }),
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
  return [...new Set((graph.components ?? []).map((component) => component.name))].sort((left, right) =>
    left.localeCompare(right),
  );
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

function componentQueryNames(model: ComponentModuleModel): string[] {
  return componentOptionObjectKeys(model, 'queries');
}

function fragmentTargetPropsType(model: ComponentModuleModel): string {
  const props = componentOptionObjectEntries(model, 'props').map((entry) => ({
    key: entry.key,
    type: entry.staticConstructorType ?? 'unknown',
  }));

  if (props.length === 0) return '{}';

  return `{ ${props.map((prop) => `${prop.key}: ${prop.type}`).join('; ')} }`;
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
