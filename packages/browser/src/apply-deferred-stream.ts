import { definedProps } from './defined-props.js';
import type { MorphRoot } from './morph.js';
import { deferredStreamChunks } from './wire-parser.js';
import {
  applyMutationResponseBodyToRuntime,
  type AppliedMutationResponse,
  type AppliedMutationResponseWithRoot,
  type ApplyMutationResponseChunksToRuntimeOptions,
} from './apply-mutation-response.js';
import {
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityOwnArrayEntry,
} from './security-witness-intrinsics.js';

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
  const chunks: AppliedMutationResponse[] = [];
  const bodies = deferredStreamChunks(options.body, options.boundary ?? 'kovo-boundary');
  for (let index = 0; index < bodies.length; index += 1) {
    const body = securityOwnArrayEntry(bodies, index);
    if (!body.ok) throw new TypeError('Kovo deferred stream chunks must be dense.');
    securityArrayAppend(
      chunks,
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
        body: body.value,
        store: options.store,
      }),
      'Browser deferred stream applied chunks',
    );
  }

  const fragments: AppliedMutationResponse['fragments'][number][] = [];
  const queries: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = securityOwnArrayEntry(chunks, index);
    if (!chunk.ok) throw new TypeError('Kovo applied deferred stream chunks must be dense.');
    appendDenseValues(fragments, chunk.value.fragments, 'Browser deferred stream fragments');
    appendDenseValues(queries, chunk.value.queries, 'Browser deferred stream query keys');
  }
  const applied = {
    chunks,
    fragments,
    queries,
  };
  if (!options.root) return applied;

  const appliedFragments: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = securityOwnArrayEntry(chunks, index);
    if (!chunk.ok) throw new TypeError('Kovo applied deferred stream chunks must be dense.');
    const descriptor = securityGetOwnPropertyDescriptor(chunk.value, 'appliedFragments');
    if (
      !descriptor ||
      !('value' in descriptor) ||
      descriptor.value === null ||
      typeof descriptor.value !== 'object'
    ) {
      throw new TypeError('Kovo rooted deferred stream result is invalid.');
    }
    appendDenseValues(
      appliedFragments,
      descriptor.value as readonly string[],
      'Browser deferred stream applied fragment targets',
    );
  }
  return {
    ...applied,
    appliedFragments,
  };
}

function appendDenseValues<Value>(target: Value[], source: readonly Value[], label: string): void {
  for (let index = 0; index < source.length; index += 1) {
    const entry = securityOwnArrayEntry(source, index);
    if (!entry.ok) throw new TypeError(`${label} must be dense.`);
    securityArrayAppend(target, entry.value, label);
  }
}
