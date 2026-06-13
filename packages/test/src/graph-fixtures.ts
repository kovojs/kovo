export interface JisoGraphComponentFact {
  fragments?: readonly string[];
  name: string;
  queries?: readonly string[];
}

export interface JisoGraphMutationFact {
  invalidates?: readonly string[];
  key: string;
}

export interface JisoGraphOptimisticFact {
  mutation: string;
  query: string;
  status: string;
}

export interface JisoGraphPageFact {
  queries?: readonly string[];
  route: string;
  [key: string]: unknown;
}

export interface JisoGraphQueryFact {
  domains?: readonly string[];
  query: string;
}

export interface JisoGraphFixture {
  components?: readonly JisoGraphComponentFact[];
  mutations?: readonly JisoGraphMutationFact[];
  optimistic?: readonly JisoGraphOptimisticFact[];
  pages?: readonly JisoGraphPageFact[];
  queries?: readonly JisoGraphQueryFact[];
}

export interface GraphQueryConsumerFact {
  consumers: string[];
  query: string;
}

export type GraphInvalidationMatrix = Record<string, Record<string, string>>;

export function graphPageFact(graph: JisoGraphFixture, route: string): JisoGraphPageFact {
  const page = graph.pages?.find((item) => item.route === route);
  if (!page) throw new Error(`Graph includes page route ${route}`);
  return page;
}

export function graphMutationFact(graph: JisoGraphFixture, key: string): JisoGraphMutationFact {
  const mutation = graph.mutations?.find((item) => item.key === key);
  if (!mutation) throw new Error(`Graph includes mutation ${key}`);
  return mutation;
}

export function graphFragmentTargetForQuery(graph: JisoGraphFixture, query: string): string {
  const component = graph.components?.find((item) => item.queries?.includes(query));
  const fragment = component?.fragments?.[0];
  if (!fragment) throw new Error(`Graph includes a fragment target for query ${query}`);
  return fragment;
}

export function graphQueryConsumers(graph: JisoGraphFixture): GraphQueryConsumerFact[] {
  return (graph.queries ?? []).map((query) => {
    const consumers = [
      ...(graph.components ?? [])
        .filter((component) => component.queries?.includes(query.query))
        .map((component) => `component:${component.name}`),
      ...(graph.pages ?? [])
        .filter((page) => page.queries?.includes(query.query))
        .map((page) => `page:${page.route}`),
    ];

    return { consumers, query: query.query };
  });
}

export function graphQueryConsumerMap(graph: JisoGraphFixture): Map<string, string[]> {
  return new Map(graphQueryConsumers(graph).map((fact) => [fact.query, fact.consumers]));
}

export function graphInvalidatedQueries(graph: JisoGraphFixture, mutationKey: string): string[] {
  const mutation = graphMutationFact(graph, mutationKey);
  const invalidatedDomains = new Set(mutation.invalidates ?? []);

  return (graph.queries ?? [])
    .filter((query) => query.domains?.some((domain) => invalidatedDomains.has(domain)))
    .map((query) => query.query)
    .sort((left, right) => left.localeCompare(right));
}

export function graphMutationUpdateConsumers(
  graph: JisoGraphFixture,
  mutationKey: string,
): GraphQueryConsumerFact[] {
  const consumersByQuery = graphQueryConsumerMap(graph);

  return graphInvalidatedQueries(graph, mutationKey).map((query) => ({
    consumers: consumersByQuery.get(query) ?? [],
    query,
  }));
}

export function graphInvalidatedByQueries(graph: JisoGraphFixture): Map<string, string[]> {
  const invalidatedBy = new Map(
    (graph.queries ?? []).map((query) => [query.query, [] as string[]]),
  );

  for (const mutation of graph.mutations ?? []) {
    for (const query of graphInvalidatedQueries(graph, mutation.key)) {
      invalidatedBy.get(query)?.push(mutation.key);
    }
  }

  return invalidatedBy;
}

export function graphOptimisticStatusMatrix(graph: JisoGraphFixture): GraphInvalidationMatrix {
  const statusByMutationQuery = new Map(
    (graph.optimistic ?? []).map((entry) => [`${entry.mutation}\0${entry.query}`, entry.status]),
  );
  const matrix: GraphInvalidationMatrix = {};

  for (const mutation of graph.mutations ?? []) {
    const invalidatedQueries = new Set(graphInvalidatedQueries(graph, mutation.key));
    const mutationMatrix: Record<string, string> = {};
    matrix[mutation.key] = mutationMatrix;

    for (const query of graph.queries ?? []) {
      mutationMatrix[query.query] = invalidatedQueries.has(query.query)
        ? (statusByMutationQuery.get(`${mutation.key}\0${query.query}`) ?? 'UNHANDLED')
        : 'no-invalidation';
    }
  }

  return matrix;
}
