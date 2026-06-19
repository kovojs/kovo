import {
  applyQueryChunksToRuntime,
  type OnDeltaMiss,
  type QueryApplyInterposition,
} from './query-apply.js';
import type { QueryStore } from './query-store.js';
import { definedProps } from './defined-props.js';
import { applyFragments } from './morph.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { MutationResponseBodyChunks, QueryChunk } from './wire-parser.js';
import {
  readMutationResponseBodyChunks,
  readMutationResponseBodyPrefixChunks,
} from './wire-parser.js';
import type { FragmentChunk, StreamTextChunk } from './wire-response-scanner.js';
import type { IslandSignalScope } from './handler-context.js';
import {
  applyStreamTextChunks,
  StreamTextBuffer,
  type StreamTextBufferOptions,
  type StreamTextRoot,
} from './stream-text.js';
import type { ImportHandlerModule } from './handlers.js';

type RuntimeStreamTextOptions = StreamTextBufferOptions & {
  buffer?: StreamTextBuffer;
};

/** @generated Facts about an applied mutation response: the `fragments` and `queries` it touched (SPEC §9.1). */
export interface AppliedMutationResponse {
  fragments: FragmentChunk[];
  queries: string[];
  streams?: string[];
  texts?: StreamTextChunk[];
}

export interface ApplyMutationResponseChunksToRuntimeOptions {
  applyQuery?: QueryApplyInterposition;
  beforeApplyQueries?: (queries: readonly QueryChunk[]) => void;
  islandSignalScope?: IslandSignalScope;
  importModule?: ImportHandlerModule;
  morph?: MorphFragment;
  /** Invoked for each delta chunk whose base is missing or stale (SPEC §9.1.1). */
  onDeltaMiss?: OnDeltaMiss;
  onError?: (error: unknown) => void;
  queryRoot?: unknown;
  queryPlans?: CompiledQueryUpdatePlans;
  /** Build token from the response `Kovo-Build` header (SPEC §9.1.1). When set
   * and `expectedBuildToken` differs, all delta chunks in this response are
   * treated as misses; full chunks still apply normally. */
  responseBuildToken?: string;
  /** The page-level build token, read once from `<meta name="kovo-build">`. */
  expectedBuildToken?: string;
  root?: MorphRoot | undefined;
  store: QueryStore;
  streamText?: RuntimeStreamTextOptions;
}

export type ApplyMutationResponseBodyToRuntimeOptions =
  ApplyMutationResponseChunksToRuntimeOptions & {
    body: string;
  };

export type ApplyStreamingMutationResponseBodyToRuntimeOptions =
  ApplyMutationResponseChunksToRuntimeOptions & {
    body: ReadableStream<Uint8Array>;
  };

/** @generated An {@link AppliedMutationResponse} plus the `appliedFragments` morphed into a root (SPEC §9.1). */
export type AppliedMutationResponseWithRoot = AppliedMutationResponse & {
  appliedFragments: string[];
};

export function applyMutationResponseChunksToRuntime(
  chunks: MutationResponseBodyChunks,
  options: ApplyMutationResponseChunksToRuntimeOptions & { root: MorphRoot },
): AppliedMutationResponseWithRoot;
export function applyMutationResponseChunksToRuntime(
  chunks: MutationResponseBodyChunks,
  options: ApplyMutationResponseChunksToRuntimeOptions & { root?: undefined },
): AppliedMutationResponse;
export function applyMutationResponseChunksToRuntime(
  chunks: MutationResponseBodyChunks,
  options: ApplyMutationResponseChunksToRuntimeOptions,
): AppliedMutationResponse | AppliedMutationResponseWithRoot;
export function applyMutationResponseChunksToRuntime(
  chunks: MutationResponseBodyChunks,
  options: ApplyMutationResponseChunksToRuntimeOptions,
): AppliedMutationResponse | AppliedMutationResponseWithRoot {
  // SPEC.md §9.1: mutation, deferred, broadcast, and typed-read responses all
  // converge here after their transport-specific parser has decoded wire chunks.

  // SPEC §9.1.1: build-token mismatch — when the response carries a different
  // build token than the page's, treat ALL delta chunks as misses so we never
  // apply a delta against a base from a different build. Full chunks are unaffected.
  const buildTokenMismatch =
    options.responseBuildToken !== undefined &&
    options.expectedBuildToken !== undefined &&
    options.responseBuildToken !== options.expectedBuildToken;

  // When a build-token mismatch is detected, wrap onDeltaMiss so it fires even
  // for delta chunks that would otherwise succeed; we never attempt applyQueryDelta
  // against a stale base in that case. We do this by pre-converting all delta
  // chunks to misses before they reach applyQueryChunk.
  let effectiveChunks = chunks;
  if (buildTokenMismatch && options.onDeltaMiss) {
    // Route all delta chunks directly to onDeltaMiss, keep full chunks as-is.
    const missedQueries: typeof chunks.queries = [];
    for (const q of chunks.queries) {
      if (q.delta) {
        options.onDeltaMiss(q.name, q.key);
      } else {
        missedQueries.push(q);
      }
    }
    effectiveChunks = {
      fragments: chunks.fragments,
      queries: missedQueries,
      ...(chunks.texts === undefined ? {} : { texts: chunks.texts }),
    };
  } else if (buildTokenMismatch) {
    // No onDeltaMiss, but still skip applying deltas (drop them silently).
    effectiveChunks = {
      fragments: chunks.fragments,
      queries: chunks.queries.filter((q) => !q.delta),
      ...(chunks.texts === undefined ? {} : { texts: chunks.texts }),
    };
  }

  options.beforeApplyQueries?.(effectiveChunks.queries);
  const applied: AppliedMutationResponse = {
    fragments: effectiveChunks.fragments,
    queries: [
      ...applyQueryChunksToRuntime(options.store, effectiveChunks.queries, {
        ...definedProps({
          applyQuery: options.applyQuery,
          onDeltaMiss: options.onDeltaMiss,
          onError: options.onError,
          queryPlans: options.queryPlans,
          root: options.queryRoot ?? options.root,
        }),
      }),
    ],
    ...(effectiveChunks.texts === undefined ? {} : { texts: effectiveChunks.texts }),
  };

  const streams = applyStreamTextChunks(
    options.root as StreamTextRoot | undefined,
    effectiveChunks.texts,
    definedProps({ buffer: options.streamText?.buffer, onError: options.onError }),
  );
  if (streams.length > 0) applied.streams = streams;

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
): AppliedMutationResponseWithRoot;
export function applyMutationResponseBodyToRuntime(
  options: ApplyMutationResponseBodyToRuntimeOptions & { root?: undefined },
): AppliedMutationResponse;
export function applyMutationResponseBodyToRuntime(
  options: ApplyMutationResponseBodyToRuntimeOptions,
): AppliedMutationResponse | AppliedMutationResponseWithRoot;
export function applyMutationResponseBodyToRuntime(
  options: ApplyMutationResponseBodyToRuntimeOptions,
): AppliedMutationResponse | AppliedMutationResponseWithRoot {
  const { body, ...applyOptions } = options;

  // SPEC.md §9.1: mutation-body transport callers share the parser/apply seam
  // so enhanced submit, broadcast replay, and deferred chunks cannot drift.
  return applyMutationResponseChunksToRuntime(
    readMutationResponseBodyChunks(body, options.onError),
    applyOptions,
  );
}

export async function applyStreamingMutationResponseBodyToRuntime(
  options: ApplyStreamingMutationResponseBodyToRuntimeOptions & { root: MorphRoot },
): Promise<AppliedMutationResponseWithRoot>;
export async function applyStreamingMutationResponseBodyToRuntime(
  options: ApplyStreamingMutationResponseBodyToRuntimeOptions & { root?: undefined },
): Promise<AppliedMutationResponse>;
export async function applyStreamingMutationResponseBodyToRuntime(
  options: ApplyStreamingMutationResponseBodyToRuntimeOptions,
): Promise<AppliedMutationResponse | AppliedMutationResponseWithRoot>;
export async function applyStreamingMutationResponseBodyToRuntime(
  options: ApplyStreamingMutationResponseBodyToRuntimeOptions,
): Promise<AppliedMutationResponse | AppliedMutationResponseWithRoot> {
  const { body, ...applyOptions } = options;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const streamAbortController =
    options.streamText?.signal === undefined ? new AbortController() : undefined;
  const streamTextBuffer =
    options.root && !options.streamText?.buffer
      ? new StreamTextBuffer({
          ...definedProps({
            flushDelayMs: options.streamText?.flushDelayMs,
            flushThreshold: options.streamText?.flushThreshold,
            importModule: options.importModule ?? options.streamText?.importModule,
            onError: options.onError ?? options.streamText?.onError,
            signal: options.streamText?.signal ?? streamAbortController?.signal,
          }),
        })
      : options.streamText?.buffer;
  let pending = '';
  let aggregate: AppliedMutationResponse | AppliedMutationResponseWithRoot | undefined;

  try {
    while (true) {
      const read = await reader.read();
      if (read.done) break;
      pending += decoder.decode(read.value, { stream: true });
      const result = flushCompleteMutationResponsePrefix(
        pending,
        applyOptionsWithStreamTextBuffer(applyOptions, streamTextBuffer),
      );
      pending = result.pending;
      aggregate = mergeAppliedMutationResponses(aggregate, result.applied);
    }

    pending += decoder.decode();
    if (pending.length > 0) {
      aggregate = mergeAppliedMutationResponses(
        aggregate,
        applyMutationResponseChunksToRuntime(
          readMutationResponseBodyChunks(pending, options.onError),
          applyOptionsWithStreamTextBuffer(applyOptions, streamTextBuffer),
        ),
      );
    }
    await streamTextBuffer?.flush('completion');
  } catch (error) {
    streamAbortController?.abort();
    await streamTextBuffer?.fail(error);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return aggregate ?? emptyAppliedMutationResponse(options.root);
}

function applyOptionsWithStreamTextBuffer(
  options: ApplyMutationResponseChunksToRuntimeOptions,
  buffer: StreamTextBuffer | undefined,
): ApplyMutationResponseChunksToRuntimeOptions {
  return {
    ...options,
    ...definedProps({
      streamText: {
        ...options.streamText,
        ...definedProps({ buffer }),
      },
    }),
  };
}

function flushCompleteMutationResponsePrefix(
  pending: string,
  options: ApplyMutationResponseChunksToRuntimeOptions,
): {
  applied?: AppliedMutationResponse | AppliedMutationResponseWithRoot;
  pending: string;
} {
  const { chunks, consumed } = readMutationResponseBodyPrefixChunks(pending, options.onError);
  if (consumed === 0) return { pending };

  return {
    applied: applyMutationResponseChunksToRuntime(chunks, options),
    pending: pending.slice(consumed),
  };
}

function mergeAppliedMutationResponses(
  current: AppliedMutationResponse | AppliedMutationResponseWithRoot | undefined,
  next: AppliedMutationResponse | AppliedMutationResponseWithRoot | undefined,
): AppliedMutationResponse | AppliedMutationResponseWithRoot | undefined {
  if (!next) return current;
  if (!current) return next;

  const merged: AppliedMutationResponse | AppliedMutationResponseWithRoot = {
    fragments: [...current.fragments, ...next.fragments],
    queries: [...current.queries, ...next.queries],
    ...('appliedFragments' in current || 'appliedFragments' in next
      ? {
          appliedFragments: [
            ...('appliedFragments' in current ? current.appliedFragments : []),
            ...('appliedFragments' in next ? next.appliedFragments : []),
          ],
        }
      : {}),
    ...(current.streams || next.streams
      ? { streams: [...(current.streams ?? []), ...(next.streams ?? [])] }
      : {}),
    ...(current.texts || next.texts
      ? { texts: [...(current.texts ?? []), ...(next.texts ?? [])] }
      : {}),
  };
  return merged;
}

function emptyAppliedMutationResponse(
  root: MorphRoot | undefined,
): AppliedMutationResponse | AppliedMutationResponseWithRoot {
  return root
    ? { appliedFragments: [], fragments: [], queries: [] }
    : { fragments: [], queries: [] };
}
