import { definedProps } from './defined-props.js';
import type { MorphRoot } from './morph.js';
import { deferredStreamChunks } from './wire-parser.js';
import {
  applyMutationResponseBodyToRuntime,
  type AppliedMutationResponse,
  type AppliedMutationResponseWithRoot,
  type ApplyMutationResponseChunksToRuntimeOptions,
} from './apply-mutation-response.js';

export type AppliedDeferredStreamResponseWithRoot = AppliedMutationResponseWithRoot & {
  chunks: AppliedMutationResponseWithRoot[];
};

export type AppliedDeferredStreamResponseToRuntime =
  | (AppliedMutationResponse & { chunks: AppliedMutationResponse[] })
  | AppliedDeferredStreamResponseWithRoot;

interface ApplyDeferredStreamResponseToRuntimeBaseOptions extends Omit<
  ApplyMutationResponseChunksToRuntimeOptions,
  'root'
> {
  body: string;
  boundary?: string;
}

export type ApplyDeferredStreamResponseToRuntimeOptions =
  ApplyDeferredStreamResponseToRuntimeBaseOptions & {
    root?: MorphRoot | undefined;
  };

export function applyDeferredStreamResponseToRuntime(
  options: ApplyDeferredStreamResponseToRuntimeOptions & { root: MorphRoot },
): AppliedDeferredStreamResponseWithRoot;
export function applyDeferredStreamResponseToRuntime(
  options: ApplyDeferredStreamResponseToRuntimeOptions & { root?: undefined },
): AppliedMutationResponse & { chunks: AppliedMutationResponse[] };
export function applyDeferredStreamResponseToRuntime(
  options: ApplyDeferredStreamResponseToRuntimeOptions,
): AppliedDeferredStreamResponseToRuntime;
export function applyDeferredStreamResponseToRuntime(
  options: ApplyDeferredStreamResponseToRuntimeOptions,
): AppliedDeferredStreamResponseToRuntime {
  const chunks = deferredStreamChunks(options.body, options.boundary ?? 'kovo-boundary').map(
    (body) =>
      applyMutationResponseBodyToRuntime({
        ...definedProps({
          applyQuery: options.applyQuery,
          beforeApplyQueries: options.beforeApplyQueries,
          islandSignalScope: options.islandSignalScope,
          morph: options.morph,
          onError: options.onError,
          queryRoot: options.queryRoot,
          queryPlans: options.queryPlans,
          root: options.root,
        }),
        body,
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
