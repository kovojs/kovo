import type { MutationTouchSite } from './change-record.js';
import { registeredGeneratedMutationTouches } from './generated-mutation-registry.js';
import { queryWithGeneratedReads } from './generated-query-registry.js';
import type { LayoutDeclaration } from './route.js';
import {
  queryHasDerivedKey,
  type QueryDefinition,
  type RegisteredQueryDefinition,
} from './query.js';
import type { MutationRegistry } from './mutation/definition.js';
import type { LiveTargetRenderer } from './mutation-wire.js';

/** @internal Normalized generated/app registry facts consumed by runtime dispatch paths. */
export interface RuntimeRegistryFacts<Request = unknown> {
  liveTargetRenderers: readonly LiveTargetRenderer<Request>[];
  queries: readonly QueryDefinition<string, unknown, unknown, Request>[];
}

/** @internal Query binding facts declared by generated live-target renderers. */
export interface RuntimeLiveTargetQueryBinding {
  args?: (props: Record<string, unknown>) => unknown;
  query: QueryDefinition<string, unknown, unknown, unknown>;
}

type RuntimeMutationDefinition<Mutation> = Mutation & {
  key: string;
  registry?: MutationRegistry;
};

interface RuntimeRegistryFactInput<Request, Mutation> {
  liveTargetRenderers: readonly LiveTargetRenderer<Request>[];
  mutations: readonly RuntimeMutationDefinition<Mutation>[];
  queries: readonly QueryDefinition<string, unknown, unknown, Request>[];
  routes?: readonly { layout?: LayoutDeclaration<any, any, any> }[];
}

/**
 * Normalize generated registry facts once for runtime request paths (SPEC §§4.1, 6.1,
 * 9.1, 10.2, 10.3). Query keys address `/_q`, `kovo-deps`, live-target renderer
 * queries, and mutation reruns, so distinct definitions for one key fail closed.
 */
export function runtimeRegistryFacts<Request, Mutation>(
  input: RuntimeRegistryFactInput<Request, Mutation>,
): RuntimeRegistryFacts<Request> & {
  mutations: readonly RuntimeMutationDefinition<Mutation>[];
} {
  const queries = normalizeRuntimeQueries<Request>(
    { allowStaticInstances: false },
    input.queries,
    liveTargetRendererQueries(input.liveTargetRenderers),
    routeLayoutQueries(input.routes ?? []),
  );
  const mutations = input.mutations.map((definition) =>
    mutationWithRuntimeRegistryFacts(definition, {
      liveTargetRenderers: input.liveTargetRenderers,
      queries,
    }),
  );

  return {
    liveTargetRenderers: input.liveTargetRenderers,
    mutations,
    queries,
  };
}

/** @internal Normalize a standalone mutation for direct/internal mutation endpoint callers. */
export function mutationWithRuntimeRegistryFacts<
  Mutation extends { key: string; registry?: MutationRegistry },
  Request,
>(definition: Mutation, facts: RuntimeRegistryFacts<Request>): Mutation {
  const inferredTouches = registeredGeneratedMutationTouches(definition.key);
  const rendererQueries = liveTargetRendererQueries(facts.liveTargetRenderers);
  const queries = normalizeRuntimeQueries(
    { allowStaticInstances: true },
    (definition.registry?.queries ?? []) as readonly QueryDefinition<
      string,
      unknown,
      unknown,
      Request
    >[],
    facts.queries,
    rendererQueries,
  ) as readonly RegisteredQueryDefinition[];

  if (queries.length === 0 && inferredTouches.length === 0) return definition;

  return {
    ...definition,
    registry: mergeRuntimeMutationRegistry(definition.registry, {
      inferredTouches,
      queries,
    }),
  };
}

/** @internal Resolve generated live-target query bindings against normalized runtime queries. */
export function runtimeLiveTargetQueryBindings<Request>(
  renderer: LiveTargetRenderer<Request>,
  facts: RuntimeRegistryFacts<Request>,
): readonly RuntimeLiveTargetQueryBinding[] {
  const rendererWithBindings = renderer as LiveTargetRenderer<Request> & {
    queryBindings?: readonly RuntimeLiveTargetQueryBinding[];
  };
  if (rendererWithBindings.queryBindings) return rendererWithBindings.queryBindings;
  if (renderer.queryDefinitions) {
    return renderer.queryDefinitions.map((queryDefinition) => ({
      query: normalizeRuntimeQuery(queryDefinition),
    }));
  }

  return (renderer.queries ?? []).flatMap((queryKey) => {
    const queryDefinition = facts.queries.find((candidate) => candidate.key === queryKey);
    return queryDefinition === undefined ? [] : [{ query: queryDefinition }];
  });
}

function normalizeRuntimeQueries<Request>(
  options: { allowStaticInstances: boolean },
  ...groups: readonly (readonly QueryDefinition<string, unknown, unknown, Request>[])[]
): readonly QueryDefinition<string, unknown, unknown, Request>[] {
  const queries = new Map<string, QueryDefinition<string, unknown, unknown, Request>>();
  const originalObjects = new Set<QueryDefinition<string, unknown, unknown, Request>>();

  for (const group of groups) {
    for (const queryDefinition of group) {
      assertQueryKeyAssigned(queryDefinition);
      const normalized = normalizeRuntimeQuery(queryDefinition);
      const identity = runtimeQueryIdentity(normalized, options);
      const existing = queries.get(identity);
      if (existing === undefined) {
        queries.set(identity, normalized);
        originalObjects.add(queryDefinition);
        continue;
      }
      const merged = mergeRuntimeQueryFacts(existing, normalized);
      if (merged !== undefined) {
        queries.set(identity, merged);
        continue;
      }
      if (
        existing === normalized ||
        existing === queryDefinition ||
        originalObjects.has(queryDefinition) ||
        compatibleRuntimeQueries(existing, normalized)
      ) {
        continue;
      }

      throw new Error(
        `Runtime registry facts received two queries with the same key "${normalized.key}". ` +
          'Query keys address one typed read for /_q dispatch, kovo-query hydration, kovo-deps, ' +
          'live-target renderers, and generated query registries (SPEC §4.1, §6.1); duplicate ' +
          'definitions are ambiguous. Rename or move one exported query so its derived key is unique.',
      );
    }
  }

  return [...queries.values()];
}

function mergeRuntimeQueryFacts<Request>(
  left: QueryDefinition<string, unknown, unknown, Request>,
  right: QueryDefinition<string, unknown, unknown, Request>,
): QueryDefinition<string, unknown, unknown, Request> | undefined {
  if (left.key !== right.key || left.load !== right.load || left.instanceKey !== right.instanceKey) {
    return undefined;
  }

  const reads = new Map<string, NonNullable<typeof left.reads>[number]>();
  for (const read of left.reads ?? []) reads.set(read.key, read);
  let added = false;
  for (const read of right.reads ?? []) {
    if (reads.has(read.key)) continue;
    reads.set(read.key, read);
    added = true;
  }

  return added ? { ...left, reads: [...reads.values()] } : left;
}

function runtimeQueryIdentity(
  definition: QueryDefinition<string, unknown, unknown, unknown>,
  options: { allowStaticInstances: boolean },
): string {
  if (!options.allowStaticInstances) return definition.key;
  if (typeof definition.instanceKey === 'string') {
    return `${definition.key}\0${definition.instanceKey}`;
  }
  return definition.key;
}

function compatibleRuntimeQueries(
  left: QueryDefinition<string, unknown, unknown, unknown>,
  right: QueryDefinition<string, unknown, unknown, unknown>,
): boolean {
  return (
    left.key === right.key &&
    left.load === right.load &&
    left.instanceKey === right.instanceKey &&
    runtimeReadKeys(left).join('\0') === runtimeReadKeys(right).join('\0')
  );
}

function runtimeReadKeys(
  definition: QueryDefinition<string, unknown, unknown, unknown>,
): readonly string[] {
  return (definition.reads ?? []).map((read) => read.key).sort();
}

function normalizeRuntimeQuery<Query extends QueryDefinition<string, any, any, any>>(
  definition: Query,
): Query {
  return queryWithGeneratedReads(definition);
}

function mergeRuntimeMutationRegistry(
  registry: MutationRegistry | undefined,
  facts: {
    inferredTouches: readonly MutationTouchSite[];
    queries: readonly RegisteredQueryDefinition[];
  },
): MutationRegistry {
  const queriesByKey = new Map<string, RegisteredQueryDefinition>();

  for (const queryDefinition of registry?.queries ?? []) {
    const generatedQueryDefinition = normalizeRuntimeQuery(queryDefinition);
    queriesByKey.set(
      runtimeQueryIdentity(generatedQueryDefinition, { allowStaticInstances: true }),
      generatedQueryDefinition,
    );
  }
  for (const queryDefinition of facts.queries) {
    const identity = runtimeQueryIdentity(queryDefinition, { allowStaticInstances: true });
    if (!queriesByKey.has(identity)) queriesByKey.set(identity, queryDefinition);
  }

  return {
    ...registry,
    ...(facts.inferredTouches.length === 0 ? {} : { inferredTouches: facts.inferredTouches }),
    queries: [...queriesByKey.values()],
  };
}

function assertQueryKeyAssigned(
  definition: QueryDefinition<string, unknown, unknown, unknown>,
): void {
  if (queryHasDerivedKey(definition)) return;
  throw new Error(
    'createApp() received query({ ... }) before the compiler assigned its source-derived key. ' +
      'Runtime cannot infer module path plus exported binding; compile app-authored exported queries ' +
      'or use the generated/internal query key assignment ABI before registering the query ' +
      '(SPEC §4.1).',
  );
}

function liveTargetRendererQueries<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
): readonly QueryDefinition<string, unknown, unknown, Request>[] {
  return renderers.flatMap((renderer) => renderer.queryDefinitions ?? []);
}

function routeLayoutQueries<Request>(
  routes: readonly { layout?: LayoutDeclaration<any, any, any> }[],
): readonly QueryDefinition<string, unknown, unknown, Request>[] {
  const queries: QueryDefinition<string, unknown, unknown, Request>[] = [];

  for (const routeDeclaration of routes) {
    for (const layoutDeclaration of layoutChain(routeDeclaration.layout)) {
      queries.push(
        ...Object.values(layoutDeclaration.queries ?? {}).map(
          (queryDefinition) =>
            queryDefinition as QueryDefinition<string, unknown, unknown, Request>,
        ),
      );
    }
  }

  return queries;
}

function layoutChain(
  layoutDeclaration: LayoutDeclaration<any, any, any> | undefined,
): LayoutDeclaration<any, any, any>[] {
  const chain: LayoutDeclaration<any, any, any>[] = [];
  const seen = new Set<LayoutDeclaration<any, any, any>>();
  let current = layoutDeclaration;

  while (current) {
    if (seen.has(current)) {
      throw new Error('Cyclic route layout parent chain.');
    }
    seen.add(current);
    chain.unshift(current);
    current = current.parent;
  }

  return chain;
}
