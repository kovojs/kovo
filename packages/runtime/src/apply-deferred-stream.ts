import { definedProps } from './defined-props.js';
import type { MorphRoot } from './morph.js';
import { deferredStreamChunks } from './wire-parser.js';
import {
  applyMutationResponseToRuntime,
  type AppliedMutationResponse,
  type AppliedMutationResponseToDom,
  type ApplyMutationResponseToRuntimeOptions,
} from './apply-mutation-response.js';

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
