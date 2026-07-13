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
import {
  appendDenseOwnArrayValue,
  denseOwnArrayForEach,
  denseOwnRegistryEntryByExactKey,
} from './registry-lookup.js';
import {
  createWitnessMap,
  createWitnessSet,
  witnessGetOwnPropertyDescriptor,
  witnessMapForEach,
  witnessMapGet,
  witnessMapHas,
  witnessMapSet,
  witnessSetAdd,
  witnessSetHas,
  witnessObjectKeys,
  witnessSortStrings,
} from './security-witness-intrinsics.js';

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
  const mutations: RuntimeMutationDefinition<Mutation>[] = [];
  denseOwnArrayForEach(
    input.mutations,
    (definition) => {
      appendDenseOwnArrayValue(
        mutations,
        mutationWithRuntimeRegistryFacts(definition, {
          liveTargetRenderers: input.liveTargetRenderers,
          queries,
        }),
      );
    },
    'App mutation registry facts',
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
    const bindings: RuntimeLiveTargetQueryBinding[] = [];
    denseOwnArrayForEach(
      renderer.queryDefinitions,
      (queryDefinition) => {
        appendDenseOwnArrayValue(bindings, { query: normalizeRuntimeQuery(queryDefinition) });
      },
      'Live-target query definitions',
    );
    return bindings;
  }

  const bindings: RuntimeLiveTargetQueryBinding[] = [];
  denseOwnArrayForEach(
    renderer.queries ?? [],
    (queryKey) => {
      if (typeof queryKey !== 'string') {
        throw new TypeError('Live-target query keys must be stable strings.');
      }
      const queryDefinition = denseOwnRegistryEntryByExactKey(
        facts.queries,
        queryKey,
        'Runtime query registry',
      );
      if (queryDefinition !== undefined)
        appendDenseOwnArrayValue(bindings, { query: queryDefinition });
    },
    'Live-target query keys',
  );
  return bindings;
}

function normalizeRuntimeQueries<Request>(
  options: { allowStaticInstances: boolean },
  ...groups: readonly (readonly QueryDefinition<string, unknown, unknown, Request>[])[]
): readonly QueryDefinition<string, unknown, unknown, Request>[] {
  const queries = createWitnessMap<string, QueryDefinition<string, unknown, unknown, Request>>();
  const originalObjects = createWitnessSet<QueryDefinition<string, unknown, unknown, Request>>();

  denseOwnArrayForEach(
    groups,
    (group) => {
      denseOwnArrayForEach(
        group,
        (queryDefinition) => {
          assertQueryKeyAssigned(queryDefinition);
          const normalized = normalizeRuntimeQuery(queryDefinition);
          const identity = runtimeQueryIdentity(normalized, options);
          const existing = witnessMapGet(queries, identity);
          if (existing === undefined) {
            witnessMapSet(queries, identity, normalized);
            witnessSetAdd(originalObjects, queryDefinition);
            return;
          }
          const merged = mergeRuntimeQueryFacts(existing, normalized);
          if (merged !== undefined) {
            witnessMapSet(queries, identity, merged);
            return;
          }
          if (
            existing === normalized ||
            existing === queryDefinition ||
            witnessSetHas(originalObjects, queryDefinition) ||
            compatibleRuntimeQueries(existing, normalized)
          ) {
            return;
          }

          throw new Error(
            `Runtime registry facts received two queries with the same key "${normalized.key}". ` +
              'Query keys address one typed read for /_q dispatch, kovo-query hydration, kovo-deps, ' +
              'live-target renderers, and generated query registries (SPEC §4.1, §6.1); duplicate ' +
              'definitions are ambiguous. Rename or move one exported query so its derived key is unique.',
          );
        },
        'Runtime query fact group',
      );
    },
    'Runtime query fact groups',
  );

  return witnessMapValues(queries);
}

function mergeRuntimeQueryFacts<Request>(
  left: QueryDefinition<string, unknown, unknown, Request>,
  right: QueryDefinition<string, unknown, unknown, Request>,
): QueryDefinition<string, unknown, unknown, Request> | undefined {
  if (
    left.key !== right.key ||
    left.load !== right.load ||
    left.instanceKey !== right.instanceKey
  ) {
    return undefined;
  }

  const reads = createWitnessMap<string, NonNullable<typeof left.reads>[number]>();
  denseOwnArrayForEach(
    left.reads ?? [],
    (read) => witnessMapSet(reads, read.key, read),
    'Runtime query read facts',
  );
  let added = false;
  denseOwnArrayForEach(
    right.reads ?? [],
    (read) => {
      if (witnessMapHas(reads, read.key)) return;
      witnessMapSet(reads, read.key, read);
      added = true;
    },
    'Runtime query read facts',
  );

  return added ? { ...left, reads: witnessMapValues(reads) } : left;
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
  if (
    left.key !== right.key ||
    left.load !== right.load ||
    left.instanceKey !== right.instanceKey
  ) {
    return false;
  }
  const leftReadKeys = runtimeReadKeys(left);
  const rightReadKeys = runtimeReadKeys(right);
  if (leftReadKeys.length !== rightReadKeys.length) return false;
  for (let index = 0; index < leftReadKeys.length; index += 1) {
    if (leftReadKeys[index] !== rightReadKeys[index]) return false;
  }
  return true;
}

function runtimeReadKeys(
  definition: QueryDefinition<string, unknown, unknown, unknown>,
): readonly string[] {
  const keys: string[] = [];
  denseOwnArrayForEach(
    definition.reads ?? [],
    (read) => appendDenseOwnArrayValue(keys, read.key),
    'Runtime query read facts',
  );
  witnessSortStrings(keys);
  return keys;
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
  const queriesByKey = createWitnessMap<string, RegisteredQueryDefinition>();

  denseOwnArrayForEach(
    registry?.queries ?? [],
    (queryDefinition) => {
      const generatedQueryDefinition = normalizeRuntimeQuery(queryDefinition);
      witnessMapSet(
        queriesByKey,
        runtimeQueryIdentity(generatedQueryDefinition, { allowStaticInstances: true }),
        generatedQueryDefinition,
      );
    },
    'Mutation query registry',
  );
  denseOwnArrayForEach(
    facts.queries,
    (queryDefinition) => {
      const identity = runtimeQueryIdentity(queryDefinition, { allowStaticInstances: true });
      if (!witnessMapHas(queriesByKey, identity)) {
        witnessMapSet(queriesByKey, identity, queryDefinition);
      }
    },
    'Runtime query registry',
  );

  return {
    ...registry,
    ...(facts.inferredTouches.length === 0 ? {} : { inferredTouches: facts.inferredTouches }),
    queries: witnessMapValues(queriesByKey),
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
  const queries: QueryDefinition<string, unknown, unknown, Request>[] = [];
  denseOwnArrayForEach(
    renderers,
    (renderer) => {
      denseOwnArrayForEach(
        renderer.queryDefinitions ?? [],
        (queryDefinition) => appendDenseOwnArrayValue(queries, queryDefinition),
        'Live-target query definitions',
      );
    },
    'Live-target renderer registry',
  );
  return queries;
}

function routeLayoutQueries<Request>(
  routes: readonly { layout?: LayoutDeclaration<any, any, any> }[],
): readonly QueryDefinition<string, unknown, unknown, Request>[] {
  const queries: QueryDefinition<string, unknown, unknown, Request>[] = [];

  denseOwnArrayForEach(
    routes,
    (routeDeclaration) => {
      denseOwnArrayForEach(
        layoutChain(routeDeclaration.layout),
        (layoutDeclaration) => {
          const layoutQueries = layoutDeclaration.queries;
          if (layoutQueries === undefined) return;
          const names = witnessObjectKeys(layoutQueries);
          denseOwnArrayForEach(
            names,
            (name) => {
              const descriptor = witnessGetOwnPropertyDescriptor(layoutQueries, name);
              if (descriptor === undefined || !('value' in descriptor)) {
                throw new TypeError('Route layout queries must be stable own data properties.');
              }
              appendDenseOwnArrayValue(
                queries,
                descriptor.value as QueryDefinition<string, unknown, unknown, Request>,
              );
            },
            'Route layout query names',
          );
        },
        'Route layout chain',
      );
    },
    'Route registry layout facts',
  );

  return queries;
}

function layoutChain(
  layoutDeclaration: LayoutDeclaration<any, any, any> | undefined,
): LayoutDeclaration<any, any, any>[] {
  const reversed: LayoutDeclaration<any, any, any>[] = [];
  const seen = createWitnessSet<LayoutDeclaration<any, any, any>>();
  let current = layoutDeclaration;

  while (current) {
    if (witnessSetHas(seen, current)) {
      throw new Error('Cyclic route layout parent chain.');
    }
    witnessSetAdd(seen, current);
    appendDenseOwnArrayValue(reversed, current);
    current = current.parent;
  }

  const chain: LayoutDeclaration<any, any, any>[] = [];
  for (let index = reversed.length - 1; index >= 0; index -= 1) {
    appendDenseOwnArrayValue(chain, reversed[index]!);
  }
  return chain;
}

function witnessMapValues<Key, Value>(map: Map<Key, Value>): Value[] {
  const values: Value[] = [];
  witnessMapForEach(map, (value) => appendDenseOwnArrayValue(values, value));
  return values;
}
