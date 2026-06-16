import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ComponentExplain, KovoCheckInput, KovoExplainInput } from '@kovojs/core';

import { projectJsonFile } from './source-fixtures.ts';
import {
  touchGraphProvenanceHonestyFact,
  touchGraphProvenanceFact,
  type TouchGraphFixture,
  type TouchGraphProvenanceEntryFact,
  type TouchGraphProvenanceHonestyFact,
  type TouchGraphProvenanceFact,
} from './touch-graph-fixtures.ts';
import {
  kovoCheckOkAssertionFact,
  kovoCheckCoverageAssertionFacts,
  kovoCheckDiagnosticAssertionFacts,
  type KovoCheckCoverageAssertionFact,
  type KovoCheckDiagnosticAssertionFact,
  type KovoCheckOkAssertionFact,
  type KovoCheckResultLike,
} from './kovo-check-fixtures.ts';
import {
  kovoExplainMutationAssertionFact,
  kovoExplainMutationQueryMatrixFact,
  kovoExplainQueryAssertionFact,
  type KovoExplainMutationAssertionFact,
  type KovoExplainMutationQueryMatrixFact,
  type KovoExplainQueryAssertionFact,
  type KovoExplainResultLike,
} from './kovo-explain-fixtures.ts';

const execFileAsync = promisify(execFile);

export interface KovoGraphComponentFact {
  fragments?: readonly string[];
  name: string;
  queries?: readonly string[];
}

export interface KovoGraphMutationFact {
  invalidates?: readonly string[];
  key: string;
  writes?: readonly string[];
}

export interface KovoGraphOptimisticFact {
  mutation: string;
  query: string;
  status: string;
}

export interface KovoGraphPageFact {
  queries?: readonly string[];
  route: string;
  [key: string]: unknown;
}

export interface KovoGraphQueryFact {
  domains?: readonly string[];
  query: string;
}

export interface KovoGraphFixture {
  components?: readonly KovoGraphComponentFact[];
  mutations?: readonly KovoGraphMutationFact[];
  optimistic?: readonly KovoGraphOptimisticFact[];
  pages?: readonly KovoGraphPageFact[];
  queries?: readonly KovoGraphQueryFact[];
  touchGraph?: TouchGraphFixture;
}

export type ProjectGraphFixture = KovoGraphFixture & Record<string, unknown>;

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
  optimistic: KovoGraphOptimisticFact[];
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
  kovoCheck: KovoCheckOkAssertionFact;
  staticBehavior: GraphStaticBehaviorFact;
  summary: GeneratedGraphArtifactHonestySummaryFact;
}

export interface GeneratedGraphArtifactAcceptanceEvidenceFact {
  authoredGraphMatchesArtifact?: boolean;
  emitCheck: {
    clean: boolean;
  };
  kovoCheck: KovoCheckOkAssertionFact;
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

export interface GeneratedGraphArtifactAcceptanceChecklistFact {
  authoredGraphMatchesArtifact?: boolean;
  emitCheckClean: boolean;
  kovoCheckOk: boolean;
  invalidationKeys: string[];
  staticBehavior: GraphStaticBehaviorFact;
  touchGraph: {
    entryKeys: string[];
    sourceLineMismatchCount: number;
    sourceSitePaths: string[];
    sourceSitesHavePositiveLines: boolean;
    touchCountsByMutation: Record<string, number>;
    unresolvedMutations: string[];
  };
}

export interface GeneratedGraphArtifactAcceptanceProjectFact<T extends ProjectGraphFixture> {
  artifactGraph: T;
  checklist: GeneratedGraphArtifactAcceptanceChecklistFact;
  emitCheck: GeneratedGraphEmitCheckResult;
}

export interface GeneratedGraphArtifactAcceptanceProjectOptions<T extends ProjectGraphFixture> {
  artifactPath: string;
  authoredGraph?: KovoGraphFixture;
  emitCheck: {
    args?: readonly string[];
    command: string;
    cwd?: string;
    env?: Record<string, string | undefined>;
  };
  kovoCheck: (graph: T) => KovoCheckOkAssertionFact | KovoCheckResultLike;
  rootPath: string;
}

export type CommerceGraphComponentGraphFact = Pick<
  ComponentExplain,
  'fragments' | 'name' | 'queries'
>;

export interface CommerceGraphCompilerComponentFact {
  componentGraphFacts: readonly CommerceGraphComponentGraphFact[];
}

export interface CommerceGraphCompilerRegistryFact {
  registryFacts: unknown;
}

export interface CommerceGraphBehaviorFact {
  cartAddExplain: KovoExplainMutationAssertionFact;
  cartQueryExplain: KovoExplainQueryAssertionFact;
  componentGraphFacts: readonly unknown[];
  coverage: {
    coverage: KovoCheckCoverageAssertionFact[];
    diagnostics: KovoCheckDiagnosticAssertionFact[];
  };
  kovoCheck: KovoCheckOkAssertionFact;
  matrix: KovoExplainMutationQueryMatrixFact;
  orderReceiptExplain: KovoExplainMutationAssertionFact;
  registryFacts: unknown;
  staticBehavior: GraphStaticBehaviorFact;
  touchGraphKeys: string[];
}

export interface CommerceGraphBehaviorOptions<T extends ProjectGraphFixture> {
  compileComponentModule: (options: {
    fileName: string;
    source: string;
  }) => CommerceGraphCompilerComponentFact;
  deriveAppGraph: (options: {
    components: readonly CommerceGraphCompilerComponentFact[];
    graph: Pick<
      KovoExplainInput,
      'components' | 'mutations' | 'packageComponentPrefixes' | 'pages' | 'queries'
    >;
  }) => CommerceGraphCompilerRegistryFact;
  kovoCheck: (graph: KovoCheckInput, options?: { family?: 'all' }) => KovoCheckResultLike;
  kovoExplain: (
    graph: KovoExplainInput,
    options:
      | { kind: 'mutation'; optimistic?: boolean; target: string }
      | { kind: 'query'; target: string },
  ) => KovoExplainResultLike;
  graph: T & KovoExplainInput;
}

export function graphPageFact(graph: KovoGraphFixture, route: string): KovoGraphPageFact {
  const page = graph.pages?.find((item) => item.route === route);
  if (!page) throw new Error(`Graph includes page route ${route}`);
  return page;
}

export function graphMutationFact(graph: KovoGraphFixture, key: string): KovoGraphMutationFact {
  const mutation = graph.mutations?.find((item) => item.key === key);
  if (!mutation) throw new Error(`Graph includes mutation ${key}`);
  return mutation;
}

export function graphFragmentTargetForQuery(graph: KovoGraphFixture, query: string): string {
  const component = graph.components?.find((item) => item.queries?.includes(query));
  const fragment = component?.fragments?.[0];
  if (!fragment) throw new Error(`Graph includes a fragment target for query ${query}`);
  return fragment;
}

export function graphComponentTargetFacts(graph: KovoGraphFixture): GraphComponentTargetFact[] {
  return (graph.components ?? []).map((component) => ({
    fragments: [...(component.fragments ?? [])],
    name: component.name,
    queries: [...(component.queries ?? [])],
  }));
}

export function graphMutationKeys(graph: KovoGraphFixture): string[] {
  return (graph.mutations ?? [])
    .map((mutation) => mutation.key)
    .sort((left, right) => left.localeCompare(right));
}

export function graphRouteFacts(graph: KovoGraphFixture): string[] {
  return (graph.pages ?? [])
    .map((page) => page.route)
    .sort((left, right) => left.localeCompare(right));
}

export function graphDomainFacts(graph: KovoGraphFixture): string[] {
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
  graph: KovoGraphFixture,
  onlyKeys?: readonly string[],
): string[] {
  const allowed = onlyKeys === undefined ? undefined : new Set(onlyKeys);

  return Object.keys(graph.touchGraph ?? {})
    .filter((key) => allowed?.has(key) ?? true)
    .sort((left, right) => left.localeCompare(right));
}

export function graphQueryConsumers(graph: KovoGraphFixture): GraphQueryConsumerFact[] {
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

export function graphQueryConsumerMap(graph: KovoGraphFixture): Map<string, string[]> {
  return new Map(graphQueryConsumers(graph).map((fact) => [fact.query, fact.consumers]));
}

export function graphInvalidatedQueries(graph: KovoGraphFixture, mutationKey: string): string[] {
  const mutation = graphMutationFact(graph, mutationKey);
  const invalidatedDomains = new Set(mutation.invalidates ?? []);

  return (graph.queries ?? [])
    .filter((query) => query.domains?.some((domain) => invalidatedDomains.has(domain)))
    .map((query) => query.query)
    .sort((left, right) => left.localeCompare(right));
}

export function graphMutationUpdateConsumers(
  graph: KovoGraphFixture,
  mutationKey: string,
): GraphQueryConsumerFact[] {
  const consumersByQuery = graphQueryConsumerMap(graph);

  return graphInvalidatedQueries(graph, mutationKey).map((query) => ({
    consumers: consumersByQuery.get(query) ?? [],
    query,
  }));
}

export function graphInvalidatedByQueries(graph: KovoGraphFixture): Map<string, string[]> {
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

export function graphOptimisticStatusMatrix(graph: KovoGraphFixture): GraphInvalidationMatrix {
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

export function graphOptimisticFacts(graph: KovoGraphFixture): KovoGraphOptimisticFact[] {
  // Project to the declared coverage shape (mutation/query/status). v2 derivation
  // metadata lives in graph.json for `kovo explain --optimistic`; this fact is the
  // status-only coverage snapshot, so it stays stable across v1/v2 (SPEC.md §10.6).
  return [...(graph.optimistic ?? [])]
    .map((entry) => ({ mutation: entry.mutation, query: entry.query, status: entry.status }))
    .sort((left, right) =>
      `${left.mutation}\0${left.query}`.localeCompare(`${right.mutation}\0${right.query}`),
    );
}

export function graphInvalidationFacts(graph: KovoGraphFixture): Record<string, string[]> {
  const invalidations: Record<string, string[]> = {};

  for (const mutation of graph.mutations ?? []) {
    const queries = graphInvalidatedQueries(graph, mutation.key);
    if (queries.length > 0) invalidations[mutation.key] = queries;
  }

  return invalidations;
}

export function graphStaticBehaviorFact(graph: KovoGraphFixture): GraphStaticBehaviorFact {
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

export function commerceGraphBehaviorFact<T extends ProjectGraphFixture>(
  options: CommerceGraphBehaviorOptions<T>,
): CommerceGraphBehaviorFact {
  const cartQueryExplain = options.kovoExplain(options.graph, { kind: 'query', target: 'cart' });
  const cartAddExplain = options.kovoExplain(options.graph, {
    kind: 'mutation',
    optimistic: true,
    target: 'cart/add',
  });
  const orderReceiptExplain = options.kovoExplain(options.graph, {
    kind: 'mutation',
    optimistic: true,
    target: 'order/receipt',
  });
  const invalidatedBy = graphInvalidatedByQueries(options.graph);
  const coverageCheck = options.kovoCheck(
    {
      mutations: [{ key: 'cart/add', writes: ['cart'] }],
      optimistic: [{ mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' }],
      queries: [
        { domains: ['cart'], query: 'cart' },
        { domains: ['order'], query: 'orderHistory' },
      ],
      touchGraph: {
        'order.write': {
          touches: [{ domain: 'order', keys: null, site: 'order.ts:1', via: 'orders' }],
          unresolved: [],
        },
      },
      updateCoverage: [
        {
          component: 'CartBadge',
          position: 'undefined',
          query: 'cart.discount',
          status: 'UNHANDLED',
        },
        {
          component: 'OrderHistory',
          position: 'undefined',
          query: 'orderHistory',
          status: 'fragment',
        },
      ],
    },
    { family: 'all' },
  );
  const cartBadge = options.compileComponentModule({
    fileName: 'cart-badge.tsx',
    source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge><span data-bind="cart.count">{cart.count}</span></cart-badge>,
});
`,
  });
  const registry = options.deriveAppGraph({
    components: [cartBadge],
    graph: { queries: [{ domains: ['cart'], query: 'cart' }] },
  });

  return {
    cartAddExplain: kovoExplainMutationAssertionFact(cartAddExplain),
    cartQueryExplain: kovoExplainQueryAssertionFact(cartQueryExplain),
    componentGraphFacts: cartBadge.componentGraphFacts,
    coverage: {
      coverage: kovoCheckCoverageAssertionFacts(coverageCheck.output),
      diagnostics: kovoCheckDiagnosticAssertionFacts(coverageCheck.output),
    },
    kovoCheck: kovoCheckOkAssertionFact(options.kovoCheck(options.graph)),
    matrix: kovoExplainMutationQueryMatrixFact({
      explainMutation: (mutationKey) =>
        options.kovoExplain(options.graph, {
          kind: 'mutation',
          optimistic: true,
          target: mutationKey,
        }),
      graph: options.graph,
      invalidatedBy,
    }),
    orderReceiptExplain: kovoExplainMutationAssertionFact(orderReceiptExplain),
    registryFacts: registry.registryFacts,
    staticBehavior: graphStaticBehaviorFact(options.graph),
    touchGraphKeys: graphTouchGraphKeys(options.graph, [
      'cart.addItem',
      'order.receipt',
      'payment.webhook',
    ]),
  };
}

export function generatedGraphArtifactHonestyFact(options: {
  emitCheck: GeneratedGraphEmitCheckResult;
  graph: KovoGraphFixture;
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
  graph: KovoGraphFixture;
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
  artifactGraph: KovoGraphFixture;
  authoredGraph?: KovoGraphFixture;
  emitCheck: GeneratedGraphEmitCheckResult;
  kovoCheck: KovoCheckOkAssertionFact;
  provenance: TouchGraphProvenanceFact;
}): GeneratedGraphArtifactAcceptanceFact {
  return {
    ...(options.authoredGraph
      ? {
          authoredGraphMatchesArtifact:
            stableGraphJson(options.artifactGraph) === stableGraphJson(options.authoredGraph),
        }
      : {}),
    kovoCheck: options.kovoCheck,
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
    kovoCheck: fact.kovoCheck,
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

export function generatedGraphArtifactAcceptanceChecklistFact(
  fact: GeneratedGraphArtifactAcceptanceFact,
): GeneratedGraphArtifactAcceptanceChecklistFact {
  const evidence = generatedGraphArtifactAcceptanceEvidenceFact(fact);

  return {
    ...(evidence.authoredGraphMatchesArtifact !== undefined
      ? { authoredGraphMatchesArtifact: evidence.authoredGraphMatchesArtifact }
      : {}),
    emitCheckClean: evidence.emitCheck.clean,
    kovoCheckOk: evidence.kovoCheck.status === 'ok' && evidence.kovoCheck.issueCount === 0,
    invalidationKeys: Object.keys(evidence.invalidations).sort((left, right) =>
      left.localeCompare(right),
    ),
    staticBehavior: evidence.staticBehavior,
    touchGraph: {
      entryKeys: evidence.touchGraph.entryKeys,
      sourceLineMismatchCount: evidence.touchGraph.sourceLineMismatches.length,
      sourceSitePaths: evidence.touchGraph.sourceSites.paths,
      sourceSitesHavePositiveLines: evidence.touchGraph.sourceSites.linesArePositive,
      touchCountsByMutation: evidence.touchGraph.touchCountsByMutation,
      unresolvedMutations: evidence.touchGraph.unresolvedMutations,
    },
  };
}

export async function graphFixtureFile<T extends ProjectGraphFixture = ProjectGraphFixture>(
  rootPath: string,
  path: string,
): Promise<T> {
  return projectJsonFile<T>(rootPath, path);
}

export async function generatedGraphArtifactAcceptanceProjectFact<
  T extends ProjectGraphFixture = ProjectGraphFixture,
>(
  options: GeneratedGraphArtifactAcceptanceProjectOptions<T>,
): Promise<GeneratedGraphArtifactAcceptanceProjectFact<T>> {
  const artifactGraph = await graphFixtureFile<T>(options.rootPath, options.artifactPath);
  const emitCheck = await execFileAsync(
    options.emitCheck.command,
    [...(options.emitCheck.args ?? [])],
    {
      ...(options.emitCheck.cwd !== undefined ? { cwd: options.emitCheck.cwd } : {}),
      ...(options.emitCheck.env !== undefined ? { env: options.emitCheck.env } : {}),
    },
  );
  const kovoCheckResult = options.kovoCheck(artifactGraph);
  const kovoCheck =
    'issueCount' in kovoCheckResult ? kovoCheckResult : kovoCheckOkAssertionFact(kovoCheckResult);
  const provenance = await touchGraphProvenanceFact(
    options.rootPath,
    artifactGraph.touchGraph ?? {},
  );
  const fact = generatedGraphArtifactAcceptanceFact({
    artifactGraph,
    ...(options.authoredGraph !== undefined ? { authoredGraph: options.authoredGraph } : {}),
    emitCheck: {
      stderr: String(emitCheck.stderr),
      stdout: String(emitCheck.stdout),
    },
    kovoCheck,
    provenance,
  });

  return {
    artifactGraph,
    checklist: generatedGraphArtifactAcceptanceChecklistFact(fact),
    emitCheck: {
      stderr: String(emitCheck.stderr),
      stdout: String(emitCheck.stdout),
    },
  };
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
