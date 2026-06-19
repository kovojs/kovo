import { definedProps } from './defined-props.js';
import type { MorphRoot } from './morph.js';
import { deferredStreamChunks } from './wire-parser.js';
import {
  applyMutationResponseBodyToRuntime,
  type AppliedMutationResponse,
  type AppliedMutationResponseWithRoot,
  type ApplyMutationResponseChunksToRuntimeOptions,
} from './apply-mutation-response.js';

/** @generated Applied deferred-stream result when a root morphed fragments in place (SPEC §5.2, §9.1). */
export type AppliedDeferredStreamResponseWithRoot = AppliedMutationResponseWithRoot & {
  chunks: AppliedMutationResponseWithRoot[];
};

/** @generated Applied deferred-stream result: rootless chunk facts, or {@link AppliedDeferredStreamResponseWithRoot} (SPEC §5.2, §9.1). */
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

/** @generated Options for {@link applyDeferredStreamResponseToRuntime} (SPEC §5.2, §9.1). */
export type ApplyDeferredStreamResponseToRuntimeOptions =
  ApplyDeferredStreamResponseToRuntimeBaseOptions & {
    root?: MorphRoot | undefined;
  };

/**
 * @generated Apply a multipart deferred-stream mutation response body to the
 * runtime: split it on the boundary and apply each chunk's fragments and queries
 * (SPEC §5.2, §9.1). Compiler-emitted bootstrap calls this; not app-authored.
 */
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
