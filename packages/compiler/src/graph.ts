import { kebabCase } from './shared.js';
import {
  componentOptionObjectEntries,
  componentOptionObjectKeys,
  componentOptionStaticValue,
  firstComponentModel,
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

  return {
    graph,
    registryFacts: deriveRegistryFactsFromGraph(graph, options.registryTypes),
  };
}

export function findFragmentTargetFacts(
  componentName: string,
  model: ComponentModuleModel,
): FragmentTargetFact[] {
  if (componentOptionStaticValue(model, 'fragmentTarget') !== true) return [];

  const explicitName = firstComponentModel(model)?.explicitName;
  return [
    {
      propsType: fragmentTargetPropsType(model),
      target: explicitName ?? kebabCase(componentName),
    },
  ];
}

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

export function deriveRegistryFactsFromGraph(
  graph: RegistryGraphInput,
  options: RegistryTypeFactOptions = {},
): RegistryFacts {
  const components = deriveComponentFactsFromGraph(graph);

  return {
    ...(components.length > 0 ? { components } : {}),
    domainKeys: deriveDomainKeysFromGraph(graph),
    invalidations: deriveInvalidationFactsFromGraph(graph),
    ...(Object.keys(options.mutations ?? {}).length > 0 ? { mutations: options.mutations } : {}),
    ...(Object.keys(options.queries ?? {}).length > 0 ? { queries: options.queries } : {}),
    routes: [...new Set((graph.pages ?? []).map((page) => page.route))].sort(),
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
  return [...new Set((graph.components ?? []).map((component) => kebabCase(component.name)))].sort(
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
