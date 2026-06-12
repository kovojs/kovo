import type { QueryStore } from './query-store.js';
import { applyFragments } from './morph.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import { applyCompiledQueryUpdatePlan, supportsQueryBindings } from './query-bindings.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import { readFragmentChunks, readQueryChunks } from './wire-parser.js';
import type { FragmentChunk, QueryChunk } from './wire-parser.js';
import type { IslandSignalScope } from './handlers.js';

export interface AppliedMutationResponse {
  fragments: FragmentChunk[];
  queries: string[];
}

export type ApplyQueryInterposition = (query: QueryChunk) => { value: unknown } | void;

export interface ApplyMutationResponseToStoreOptions {
  applyQuery?: ApplyQueryInterposition;
  beforeApplyQueries?: (queries: readonly QueryChunk[]) => void;
  onError?: (error: unknown) => void;
}

export function applyFragmentQueryBody(
  body: string,
  applyQuery: (query: QueryChunk) => void,
  onError?: (error: unknown) => void,
  beforeApplyQueries?: (queries: readonly QueryChunk[]) => void,
): AppliedMutationResponse {
  const queryChunks = readQueryChunks(body, onError);
  beforeApplyQueries?.(queryChunks);

  for (const query of queryChunks) {
    applyQuery(query);
  }

  return {
    fragments: readFragmentChunks(body, onError),
    queries: queryChunks.map((query) => query.name),
  };
}

export function applyMutationResponseToStore(
  store: QueryStore,
  body: string,
  options: ApplyMutationResponseToStoreOptions = {},
): AppliedMutationResponse {
  return applyFragmentQueryBody(
    body,
    (query) => {
      applyQueryChunkToStore(store, query, options.applyQuery);
    },
    options.onError,
    options.beforeApplyQueries,
  );
}

export interface ApplyMutationResponseToDomOptions {
  applyQuery?: ApplyQueryInterposition;
  beforeApplyQueries?: (queries: readonly QueryChunk[]) => void;
  body: string;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  onError?: (error: unknown) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot;
  store: QueryStore;
}

export type AppliedMutationResponseToDom = AppliedMutationResponse & {
  appliedFragments: string[];
};

export type AppliedMutationResponseToRuntime =
  | AppliedMutationResponse
  | AppliedMutationResponseToDom;

export type ApplyMutationResponseToRuntimeOptions = Omit<
  ApplyMutationResponseToDomOptions,
  'root'
> & {
  root?: MorphRoot;
};

export function applyMutationResponseToRuntime(
  options: ApplyMutationResponseToRuntimeOptions,
): AppliedMutationResponseToRuntime {
  if (!options.root) {
    return applyMutationResponseToStore(options.store, options.body, options);
  }

  return applyMutationResponseToDom({
    ...options,
    root: options.root,
  });
}

export function applyMutationResponseToDom(
  options: ApplyMutationResponseToDomOptions,
): AppliedMutationResponseToDom {
  const applied = applyFragmentQueryBody(
    options.body,
    (query) => {
      const planValue = applyQueryChunkToStore(options.store, query, options.applyQuery);
      applyCompiledQueryUpdatePlanIfSupported(
        options.root,
        query.name,
        planValue,
        options.queryPlans?.[query.name],
      );
    },
    options.onError,
    options.beforeApplyQueries,
  );

  return {
    ...applied,
    appliedFragments: applyFragments(
      options.root,
      applied.fragments,
      options.morph,
      options.islandSignalScope,
    ),
  };
}

export const applyDeferredChunkToDom: typeof applyMutationResponseToDom =
  applyMutationResponseToDom;

function applyQueryChunkToStore(
  store: QueryStore,
  query: QueryChunk,
  interpose?: ApplyQueryInterposition,
): unknown {
  const interposed = interpose?.(query);
  if (interposed) return interposed.value;

  store.set(query.name, query.value, query.key);
  return query.value;
}

function applyCompiledQueryUpdatePlanIfSupported(
  root: MorphRoot,
  queryName: string,
  value: unknown,
  plan = {},
): void {
  if (!supportsQueryBindings(root)) return;

  applyCompiledQueryUpdatePlan(root, queryName, value, plan);
}
