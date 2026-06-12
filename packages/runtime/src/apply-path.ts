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
  return applyMutationResponseBody({
    body,
    ...definedProps({
      applyQuery: options.applyQuery,
      beforeApplyQueries: options.beforeApplyQueries,
      onError: options.onError,
    }),
    store,
  });
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

type ApplyMutationResponseToRuntimeBaseOptions = Omit<ApplyMutationResponseToDomOptions, 'root'>;

export type ApplyMutationResponseToRuntimeStoreOptions =
  ApplyMutationResponseToRuntimeBaseOptions & {
    root?: undefined;
  };

export type ApplyMutationResponseToRuntimeOptions = ApplyMutationResponseToRuntimeBaseOptions & {
  root?: MorphRoot | undefined;
};

function applyMutationResponseBody(
  options: ApplyMutationResponseToRuntimeOptions & { root: MorphRoot },
): AppliedMutationResponseToDom;
function applyMutationResponseBody(
  options: ApplyMutationResponseToRuntimeOptions & { root?: undefined },
): AppliedMutationResponse;
function applyMutationResponseBody(
  options: ApplyMutationResponseToRuntimeOptions,
): AppliedMutationResponseToRuntime;
function applyMutationResponseBody(
  options: ApplyMutationResponseToRuntimeOptions,
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
  options: ApplyMutationResponseToRuntimeOptions & { root: MorphRoot },
): AppliedMutationResponseToDom;
export function applyMutationResponseToRuntime(
  options: ApplyMutationResponseToRuntimeOptions & { root?: undefined },
): AppliedMutationResponse;
export function applyMutationResponseToRuntime(
  options: ApplyMutationResponseToRuntimeOptions,
): AppliedMutationResponseToRuntime;
export function applyMutationResponseToRuntime(
  options: ApplyMutationResponseToRuntimeOptions,
): AppliedMutationResponseToRuntime {
  return applyMutationResponseBody(options);
}

export function applyMutationResponseToDom(
  options: ApplyMutationResponseToDomOptions,
): AppliedMutationResponseToDom {
  return applyMutationResponseBody(options);
}

export type AppliedDeferredStreamResponseToDom = AppliedMutationResponseToDom & {
  chunks: AppliedMutationResponseToDom[];
};

export type AppliedDeferredStreamResponseToRuntimeStore = AppliedMutationResponse & {
  chunks: AppliedMutationResponse[];
};

export type AppliedDeferredStreamResponseToRuntime =
  | AppliedDeferredStreamResponseToRuntimeStore
  | AppliedDeferredStreamResponseToDom;

export type AppliedDeferredStreamResponse = AppliedDeferredStreamResponseToDom;

interface ApplyDeferredStreamResponseToRuntimeBaseOptions extends Omit<
  ApplyMutationResponseToRuntimeOptions,
  'body'
> {
  body: string;
  boundary?: string;
}

export type ApplyDeferredStreamResponseToRuntimeStoreOptions =
  ApplyDeferredStreamResponseToRuntimeBaseOptions & {
    root?: undefined;
  };

export type ApplyDeferredStreamResponseToRuntimeOptions =
  ApplyDeferredStreamResponseToRuntimeBaseOptions & {
    root?: MorphRoot | undefined;
  };

export interface ApplyDeferredStreamResponseToDomOptions extends ApplyDeferredStreamResponseToRuntimeBaseOptions {
  root: MorphRoot;
}

export function applyDeferredStreamResponseToRuntime(
  options: ApplyDeferredStreamResponseToRuntimeOptions & { root: MorphRoot },
): AppliedDeferredStreamResponseToDom;
export function applyDeferredStreamResponseToRuntime(
  options: ApplyDeferredStreamResponseToRuntimeOptions & { root?: undefined },
): AppliedDeferredStreamResponseToRuntimeStore;
export function applyDeferredStreamResponseToRuntime(
  options: ApplyDeferredStreamResponseToRuntimeOptions,
): AppliedDeferredStreamResponseToRuntime;
export function applyDeferredStreamResponseToRuntime(
  options: ApplyDeferredStreamResponseToRuntimeOptions,
): AppliedDeferredStreamResponseToRuntime {
  const chunks = deferredStreamChunks(options.body, options.boundary ?? 'jiso-boundary').map(
    (body) =>
      applyMutationResponseToRuntime({
        body,
        ...definedProps({
          applyQuery: options.applyQuery,
          beforeApplyQueries: options.beforeApplyQueries,
          islandSignalScope: options.islandSignalScope,
          morph: options.morph,
          onError: options.onError,
          queryPlans: options.queryPlans,
        }),
        ...definedProps({ root: options.root }),
        store: options.store,
      }),
  );

  const applied = {
    chunks,
    fragments: chunks.flatMap((chunk) => chunk.fragments),
    queries: chunks.flatMap((chunk) => chunk.queries),
  };
  if (!options.root) return applied;

  return {
    ...applied,
    appliedFragments: chunks.flatMap((chunk) =>
      'appliedFragments' in chunk ? chunk.appliedFragments : [],
    ),
  };
}

export function applyDeferredStreamResponseToDom(
  options: ApplyDeferredStreamResponseToDomOptions,
): AppliedDeferredStreamResponseToDom {
  return applyDeferredStreamResponseToRuntime(options);
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
