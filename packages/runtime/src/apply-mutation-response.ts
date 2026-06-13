import { applyQueryChunksToRuntime, type QueryApplyInterposition } from './query-apply.js';
import type { QueryStore } from './query-store.js';
import { definedProps } from './defined-props.js';
import { applyFragments } from './morph.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';
import type { FragmentChunk, QueryChunk } from './wire-parser.js';
import type { IslandSignalScope } from './handler-context.js';

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
  const chunks = readMutationResponseBodyChunks(body, onError);
  beforeApplyQueries?.(chunks.queries);

  return {
    fragments: chunks.fragments,
    queries: [...applyQueries(chunks.queries)],
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
  const applied = applyFragmentQueryBody(
    options.body,
    (queries) =>
      applyQueryChunksToRuntime(options.store, queries, {
        ...definedProps({
          applyQuery: options.applyQuery,
          queryPlans: options.queryPlans,
          root: options.root,
        }),
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
