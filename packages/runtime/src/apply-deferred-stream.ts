import { definedProps } from './defined-props.js';
import type { MorphRoot } from './morph.js';
import { deferredStreamChunks, readMutationResponseBodyChunks } from './wire-parser.js';
import {
  applyMutationResponseChunksToRuntime,
  type AppliedMutationResponse,
  type AppliedMutationResponseToDom,
  type ApplyMutationResponseChunksToRuntimeOptions,
} from './apply-mutation-response.js';

export type AppliedDeferredStreamResponseWithRoot = AppliedMutationResponseToDom & {
  chunks: AppliedMutationResponseToDom[];
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
  const chunks = deferredStreamChunks(options.body, options.boundary ?? 'jiso-boundary').map(
    (body) =>
      applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body, options.onError), {
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
