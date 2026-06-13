import { projectJsonFile } from './source-fixtures.ts';
import {
  touchGraphProvenanceHonestyFact,
  type TouchGraphProvenanceEntryFact,
  type TouchGraphProvenanceHonestyFact,
  type TouchGraphProvenanceFact,
} from './touch-graph-fixtures.ts';
import type { FwCheckOkAssertionFact } from './fw-check-fixtures.ts';

export interface JisoGraphComponentFact {
  fragments?: readonly string[];
  name: string;
  queries?: readonly string[];
}

export interface JisoGraphMutationFact {
  invalidates?: readonly string[];
  key: string;
  writes?: readonly string[];
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
  touchGraph?: Record<string, unknown>;
}

export type ProjectGraphFixture = JisoGraphFixture & Record<string, unknown>;

export interface GraphQueryConsumerFact {
  consumers: string[];
  query: string;
}

export type GraphInvalidationMatrix = Record<string, Record<string, string>>;

export interface GraphComponentTargetFact {
  fragments: string[];
  name: string;
  queries: string[];
}

export interface GraphStaticBehaviorFact {
  components: GraphComponentTargetFact[];
  domains: string[];
  invalidations: Record<string, string[]>;
  mutations: string[];
  optimistic: JisoGraphOptimisticFact[];
  routes: string[];
  touchGraphKeys: string[];
}

export interface GeneratedGraphEmitCheckResult {
  stderr: string;
  stdout: string;
}

export interface GeneratedGraphArtifactHonestyFact {
  emitCheck: {
    clean: boolean;
    stderr: string;
    stdout: string;
  };
  invalidations: Record<string, string[]>;
  touchGraph: {
    entries: Record<string, TouchGraphProvenanceEntryFact>;
    honesty: TouchGraphProvenanceHonestyFact;
  };
}

export interface GeneratedGraphTouchEntrySummaryFact {
  reads: number;
  touches: {
    domain: string;
    keys?: string | null;
    predicate?: string;
    sitePath: string;
    via: string;
  }[];
  unresolved: number;
}

export interface GeneratedGraphArtifactHonestySummaryFact {
  emitCheck: {
    clean: boolean;
  };
  invalidations: Record<string, string[]>;
  touchGraph: {
    entries: Record<string, GeneratedGraphTouchEntrySummaryFact>;
    honesty: TouchGraphProvenanceHonestyFact;
  };
}

export interface GeneratedGraphArtifactAcceptanceFact {
  authoredGraphMatchesArtifact?: boolean;
  fwCheck: FwCheckOkAssertionFact;
  staticBehavior: GraphStaticBehaviorFact;
  summary: GeneratedGraphArtifactHonestySummaryFact;
}

export interface GeneratedGraphArtifactAcceptanceEvidenceFact {
  authoredGraphMatchesArtifact?: boolean;
  emitCheck: {
    clean: boolean;
  };
  fwCheck: FwCheckOkAssertionFact;
  invalidations: Record<string, string[]>;
  staticBehavior: GraphStaticBehaviorFact;
  touchGraph: {
    entryKeys: string[];
    sourceLineMismatches: string[];
    sourceSites: TouchGraphProvenanceHonestyFact['sourceSites'];
    touchCountsByMutation: Record<string, number>;
    touchesByMutation: Record<string, GeneratedGraphTouchEntrySummaryFact['touches']>;
    unresolvedMutations: string[];
  };
}

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

export function graphComponentTargetFacts(graph: JisoGraphFixture): GraphComponentTargetFact[] {
  return (graph.components ?? []).map((component) => ({
    fragments: [...(component.fragments ?? [])],
    name: component.name,
    queries: [...(component.queries ?? [])],
  }));
}

export function graphMutationKeys(graph: JisoGraphFixture): string[] {
  return (graph.mutations ?? [])
    .map((mutation) => mutation.key)
    .sort((left, right) => left.localeCompare(right));
}

export function graphRouteFacts(graph: JisoGraphFixture): string[] {
  return (graph.pages ?? [])
    .map((page) => page.route)
    .sort((left, right) => left.localeCompare(right));
}

export function graphDomainFacts(graph: JisoGraphFixture): string[] {
  const domains = new Set<string>();

  for (const query of graph.queries ?? []) {
    for (const domain of query.domains ?? []) domains.add(domain);
  }

  for (const mutation of graph.mutations ?? []) {
    for (const domain of mutation.invalidates ?? []) domains.add(domain);
    for (const domain of mutation.writes ?? []) domains.add(domain);
  }

  return [...domains].sort((left, right) => left.localeCompare(right));
}

export function graphTouchGraphKeys(
  graph: JisoGraphFixture,
  onlyKeys?: readonly string[],
): string[] {
  const allowed = onlyKeys === undefined ? undefined : new Set(onlyKeys);

  return Object.keys(graph.touchGraph ?? {})
    .filter((key) => allowed?.has(key) ?? true)
    .sort((left, right) => left.localeCompare(right));
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

export function graphOptimisticFacts(graph: JisoGraphFixture): JisoGraphOptimisticFact[] {
  return [...(graph.optimistic ?? [])].sort((left, right) =>
    `${left.mutation}\0${left.query}`.localeCompare(`${right.mutation}\0${right.query}`),
  );
}

export function graphInvalidationFacts(graph: JisoGraphFixture): Record<string, string[]> {
  const invalidations: Record<string, string[]> = {};

  for (const mutation of graph.mutations ?? []) {
    const queries = graphInvalidatedQueries(graph, mutation.key);
    if (queries.length > 0) invalidations[mutation.key] = queries;
  }

  return invalidations;
}

export function graphStaticBehaviorFact(graph: JisoGraphFixture): GraphStaticBehaviorFact {
  return {
    components: graphComponentTargetFacts(graph),
    domains: graphDomainFacts(graph),
    invalidations: graphInvalidationFacts(graph),
    mutations: graphMutationKeys(graph),
    optimistic: graphOptimisticFacts(graph),
    routes: graphRouteFacts(graph),
    touchGraphKeys: graphTouchGraphKeys(graph),
  };
}

export function generatedGraphArtifactHonestyFact(options: {
  emitCheck: GeneratedGraphEmitCheckResult;
  graph: JisoGraphFixture;
  provenance: TouchGraphProvenanceFact;
}): GeneratedGraphArtifactHonestyFact {
  return {
    emitCheck: {
      clean: options.emitCheck.stderr === '' && options.emitCheck.stdout === '',
      stderr: options.emitCheck.stderr,
      stdout: options.emitCheck.stdout,
    },
    invalidations: graphInvalidationFacts(options.graph),
    touchGraph: {
      entries: options.provenance.entries,
      honesty: touchGraphProvenanceHonestyFact(options.provenance),
    },
  };
}

export function generatedGraphArtifactHonestySummaryFact(options: {
  emitCheck: GeneratedGraphEmitCheckResult;
  graph: JisoGraphFixture;
  provenance: TouchGraphProvenanceFact;
}): GeneratedGraphArtifactHonestySummaryFact {
  const summarizedEntries: Record<string, GeneratedGraphTouchEntrySummaryFact> = Object.fromEntries(
    Object.entries(options.provenance.entries).map(([key, entry]) => {
      const touches = entry.touches.map((touch) => ({
        domain: touch.domain,
        ...(touch.keys !== undefined ? { keys: touch.keys } : {}),
        ...(touch.predicate !== undefined ? { predicate: touch.predicate } : {}),
        sitePath: touch.sitePath,
        via: touch.via,
      }));

      return [
        key,
        {
          reads: entry.reads.length,
          touches,
          unresolved: entry.unresolved.length,
        },
      ];
    }),
  );

  return {
    emitCheck: {
      clean: options.emitCheck.stderr === '' && options.emitCheck.stdout === '',
    },
    invalidations: graphInvalidationFacts(options.graph),
    touchGraph: {
      entries: summarizedEntries,
      honesty: touchGraphProvenanceHonestyFact(options.provenance),
    },
  };
}

export function generatedGraphArtifactAcceptanceFact(options: {
  artifactGraph: JisoGraphFixture;
  authoredGraph?: JisoGraphFixture;
  emitCheck: GeneratedGraphEmitCheckResult;
  fwCheck: FwCheckOkAssertionFact;
  provenance: TouchGraphProvenanceFact;
}): GeneratedGraphArtifactAcceptanceFact {
  return {
    ...(options.authoredGraph
      ? {
          authoredGraphMatchesArtifact:
            stableGraphJson(options.artifactGraph) === stableGraphJson(options.authoredGraph),
        }
      : {}),
    fwCheck: options.fwCheck,
    staticBehavior: graphStaticBehaviorFact(options.artifactGraph),
    summary: generatedGraphArtifactHonestySummaryFact({
      emitCheck: options.emitCheck,
      graph: options.artifactGraph,
      provenance: options.provenance,
    }),
  };
}

export function generatedGraphArtifactAcceptanceEvidenceFact(
  fact: GeneratedGraphArtifactAcceptanceFact,
): GeneratedGraphArtifactAcceptanceEvidenceFact {
  return {
    ...(fact.authoredGraphMatchesArtifact !== undefined
      ? { authoredGraphMatchesArtifact: fact.authoredGraphMatchesArtifact }
      : {}),
    emitCheck: fact.summary.emitCheck,
    fwCheck: fact.fwCheck,
    invalidations: fact.summary.invalidations,
    staticBehavior: fact.staticBehavior,
    touchGraph: {
      entryKeys: fact.summary.touchGraph.honesty.entryKeys,
      sourceLineMismatches: fact.summary.touchGraph.honesty.sourceLineMismatches,
      sourceSites: fact.summary.touchGraph.honesty.sourceSites,
      touchCountsByMutation: fact.summary.touchGraph.honesty.touchCountsByMutation,
      touchesByMutation: Object.fromEntries(
        Object.entries(fact.summary.touchGraph.entries).map(([key, entry]) => [key, entry.touches]),
      ),
      unresolvedMutations: fact.summary.touchGraph.honesty.unresolvedMutations,
    },
  };
}

export async function graphFixtureFile<T extends ProjectGraphFixture = ProjectGraphFixture>(
  rootPath: string,
  path: string,
): Promise<T> {
  return projectJsonFile<T>(rootPath, path);
}

function stableGraphJson(value: unknown): string {
  return JSON.stringify(sortGraphValue(value));
}

function sortGraphValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortGraphValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortGraphValue(entry)]),
  );
}
