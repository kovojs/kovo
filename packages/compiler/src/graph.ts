import { kebabCase } from './shared.ts';

export interface ComponentGraphFact {
  fragments?: readonly string[];
  name: string;
  queries?: readonly string[];
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

export interface RegistryGraphInput {
  components?: readonly ComponentGraphFact[];
  mutations?: readonly {
    invalidates?: readonly string[];
    key: string;
    writes?: readonly string[];
  }[];
  pages?: readonly {
    route: string;
  }[];
  queries?: readonly {
    domains: readonly string[];
    query: string;
  }[];
}

interface CompileGraphComponentInput {
  componentGraphFacts: readonly ComponentGraphFact[];
}

export interface RegistryTypeFactOptions {
  mutations?: RegistryTypeFacts;
  queries?: RegistryTypeFacts;
}

export interface CompileAppGraphOptions {
  components?: readonly CompileGraphComponentInput[];
  graph?: RegistryGraphInput;
  registryTypes?: RegistryTypeFactOptions;
}

export interface CompileAppGraphResult {
  graph: RegistryGraphInput;
  registryFacts: RegistryFacts;
}

export function deriveAppGraph(options: CompileAppGraphOptions): CompileAppGraphResult {
  const graph: RegistryGraphInput = {
    ...options.graph,
    components: [
      ...(options.graph?.components ?? []),
      ...(options.components ?? []).flatMap((component) => component.componentGraphFacts),
    ],
  };

  return {
    graph,
    registryFacts: deriveRegistryFactsFromGraph(graph, options.registryTypes),
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
