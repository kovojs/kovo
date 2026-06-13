import { applyQueryChunksToRuntime, type QueryApplyInterposition } from './query-apply.js';
import type { QueryStore } from './query-store.js';
import { definedProps } from './defined-props.js';
import { applyFragments } from './morph.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';
import type { FragmentChunk, MutationResponseBodyChunks, QueryChunk } from './wire-parser.js';
import type { IslandSignalScope } from './handler-context.js';

export interface AppliedMutationResponse {
  fragments: FragmentChunk[];
  queries: string[];
}

export type ApplyQueryInterposition = QueryApplyInterposition;

export interface ApplyMutationResponseToDomOptions {
  applyQuery?: ApplyQueryInterposition;
  beforeApplyQueries?: (queries: readonly QueryChunk[]) => void;
  body: string;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  onError?: (error: unknown) => void;
  queryRoot?: unknown;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot;
  store: QueryStore;
}

export type AppliedMutationResponseToDom = AppliedMutationResponse & {
  appliedFragments: string[];
};

type ApplyMutationResponseChunksToRuntimeBaseOptions = Omit<
  ApplyMutationResponseToDomOptions,
  'body' | 'root'
> & { root?: MorphRoot | undefined };

export type ApplyMutationResponseChunksToRuntimeOptions =
  ApplyMutationResponseChunksToRuntimeBaseOptions;

export type ApplyMutationResponseBodyToRuntimeOptions =
  ApplyMutationResponseChunksToRuntimeBaseOptions & {
    body: string;
  };

export function applyMutationResponseChunksToRuntime(
  chunks: MutationResponseBodyChunks,
  options: ApplyMutationResponseChunksToRuntimeOptions & { root: MorphRoot },
): AppliedMutationResponseToDom;
export function applyMutationResponseChunksToRuntime(
  chunks: MutationResponseBodyChunks,
  options: ApplyMutationResponseChunksToRuntimeOptions & { root?: undefined },
): AppliedMutationResponse;
export function applyMutationResponseChunksToRuntime(
  chunks: MutationResponseBodyChunks,
  options: ApplyMutationResponseChunksToRuntimeOptions,
): AppliedMutationResponse | AppliedMutationResponseToDom;
export function applyMutationResponseChunksToRuntime(
  chunks: MutationResponseBodyChunks,
  options: ApplyMutationResponseChunksToRuntimeOptions,
): AppliedMutationResponse | AppliedMutationResponseToDom {
  // SPEC.md §9.1: mutation, deferred, broadcast, and typed-read responses all
  // converge here after their transport-specific parser has decoded wire chunks.
  options.beforeApplyQueries?.(chunks.queries);
  const applied: AppliedMutationResponse = {
    fragments: chunks.fragments,
    queries: [
      ...applyQueryChunksToRuntime(options.store, chunks.queries, {
        ...definedProps({
          applyQuery: options.applyQuery,
          queryPlans: options.queryPlans,
          root: options.queryRoot ?? options.root,
        }),
      }),
    ],
  };

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

export function applyMutationResponseBodyToRuntime(
  options: ApplyMutationResponseBodyToRuntimeOptions & { root: MorphRoot },
): AppliedMutationResponseToDom;
export function applyMutationResponseBodyToRuntime(
  options: ApplyMutationResponseBodyToRuntimeOptions & { root?: undefined },
): AppliedMutationResponse;
export function applyMutationResponseBodyToRuntime(
  options: ApplyMutationResponseBodyToRuntimeOptions,
): AppliedMutationResponse | AppliedMutationResponseToDom;
export function applyMutationResponseBodyToRuntime(
  options: ApplyMutationResponseBodyToRuntimeOptions,
): AppliedMutationResponse | AppliedMutationResponseToDom {
  const { body, ...applyOptions } = options;
  return applyMutationResponseChunksToRuntime(
    readMutationResponseBodyChunks(body, options.onError),
    applyOptions,
  );
}

export function applyMutationResponseToDom(
  options: ApplyMutationResponseToDomOptions,
): AppliedMutationResponseToDom {
  return applyMutationResponseBodyToRuntime(options);
}
