import {
  applyQueryChunksToStore,
  type QueryApplyInterposition,
  type QueryStore,
} from './query-store.js';
import { definedProps } from './defined-props.js';
import { applyFragments } from './morph.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import {
  applyCompiledQueryUpdatePlan,
  createQueryBindingIndex,
  supportsQueryBindings,
} from './query-bindings.js';
import type {
  CompiledQueryUpdatePlan,
  CompiledQueryUpdatePlans,
  QueryBindingIndex,
  QueryBindingRoot,
} from './query-bindings.js';
import { deferredStreamChunks, readFragmentChunks, readQueryChunks } from './wire-parser.js';
import type { FragmentChunk, QueryChunk } from './wire-parser.js';
import type { IslandSignalScope } from './handlers.js';

export interface AppliedMutationResponse {
  fragments: FragmentChunk[];
  queries: string[];
}

export interface AppliedDeferredStreamResponse extends AppliedMutationResponse {
  appliedFragments: string[];
  chunks: AppliedMutationResponseToDom[];
}

export type ApplyQueryInterposition = QueryApplyInterposition;

export interface ApplyMutationResponseToStoreOptions {
  applyQuery?: ApplyQueryInterposition;
  beforeApplyQueries?: (queries: readonly QueryChunk[]) => void;
  onError?: (error: unknown) => void;
}

export function applyFragmentQueryBody(
  body: string,
  applyQueries: (queries: readonly QueryChunk[]) => readonly string[],
  onError?: (error: unknown) => void,
  beforeApplyQueries?: (queries: readonly QueryChunk[]) => void,
): AppliedMutationResponse {
  const queryChunks = readQueryChunks(body, onError);
  beforeApplyQueries?.(queryChunks);

  return {
    fragments: readFragmentChunks(body, onError),
    queries: [...applyQueries(queryChunks)],
  };
}

export function applyMutationResponse(
  store: QueryStore,
  body: string,
  options: ApplyMutationResponseToStoreOptions = {},
): AppliedMutationResponse {
  return applyFragmentQueryBody(
    body,
    (queries) =>
      applyQueryChunksToStore(store, queries, definedProps({ applyQuery: options.applyQuery })),
    options.onError,
    options.beforeApplyQueries,
  );
}

export const applyMutationResponseToStore = applyMutationResponse;

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

interface ApplyMutationResponseBodyOptions extends ApplyMutationResponseToRuntimeOptions {}

function applyMutationResponseBody(
  options: ApplyMutationResponseBodyOptions,
): AppliedMutationResponseToRuntime {
  let bindingIndex: QueryBindingIndex | undefined;
  const readBindingIndex = (root: QueryBindingRoot) => {
    bindingIndex ??= createQueryBindingIndex(root);
    return bindingIndex;
  };

  const applied = applyFragmentQueryBody(
    options.body,
    (queries) =>
      applyQueryChunksToStore(options.store, queries, {
        afterApplyQuery(query, planValue) {
          if (!options.root) return;
          applyCompiledQueryUpdatePlanIfSupported(
            options.root,
            query.name,
            planValue,
            options.queryPlans?.[query.name],
            readBindingIndex,
          );
        },
        ...definedProps({ applyQuery: options.applyQuery }),
      }),
    options.onError,
    options.beforeApplyQueries,
  );

  if (!options.root) return applied;

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

export function applyMutationResponseToRuntime(
  options: ApplyMutationResponseToRuntimeOptions,
): AppliedMutationResponseToRuntime {
  return applyMutationResponseBody(options);
}

export function applyMutationResponseToDom(
  options: ApplyMutationResponseToDomOptions,
): AppliedMutationResponseToDom {
  return applyMutationResponseBody(options) as AppliedMutationResponseToDom;
}

export function applyDeferredStreamResponseToDom(options: {
  body: string;
  boundary?: string;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  onError?: (error: unknown) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot;
  store: QueryStore;
}): AppliedDeferredStreamResponse {
  const chunks = deferredStreamChunks(options.body, options.boundary ?? 'jiso-boundary').map(
    (body) =>
      applyMutationResponseToDom({
        body,
        ...definedProps({
          islandSignalScope: options.islandSignalScope,
          morph: options.morph,
          onError: options.onError,
          queryPlans: options.queryPlans,
        }),
        root: options.root,
        store: options.store,
      }),
  );

  return {
    appliedFragments: chunks.flatMap((chunk) => chunk.appliedFragments),
    chunks,
    fragments: chunks.flatMap((chunk) => chunk.fragments),
    queries: chunks.flatMap((chunk) => chunk.queries),
  };
}

function applyCompiledQueryUpdatePlanIfSupported(
  root: MorphRoot,
  queryName: string,
  value: unknown,
  plan: CompiledQueryUpdatePlan = {},
  readBindingIndex?: (root: QueryBindingRoot) => QueryBindingIndex,
): void {
  if (!supportsQueryBindings(root)) return;

  const options =
    plan.bindings === false || !readBindingIndex ? {} : { bindingIndex: readBindingIndex(root) };
  applyCompiledQueryUpdatePlan(root, queryName, value, plan, options);
}
