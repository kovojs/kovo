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
import { reportRuntimeError } from './error-policy.js';
import { readAttribute } from './wire-html.js';

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

  // I1 (bugs-part4, SPEC §9.1:810): a streaming mutation applies query truths and fragment
  // morphs progressively, but the terminal `reason` is only known after the whole stream. A
  // non-`complete` <kovo-done reason> (or a stream that ends with no done marker at all — an
  // interruption; a clean server stream ALWAYS terminates with <kovo-done>) means the response
  // is NOT confirmed: the runtime must not present the partial as success. We snapshot the
  // pre-apply value of every touched query the first time it arrives so we can REVERT the query
  // truth, and then throw so the caller marks the submitted form failed and refetches server
  // truth (matching the buffered path's failure handling) instead of returning a success result.
  const queryRevertLog = new Map<string, { key?: string; name: string; previousValue: unknown }>();
  const callerBeforeApplyQueries = applyOptions.beforeApplyQueries;
  const trackingApplyOptions: ApplyMutationResponseChunksToRuntimeOptions = {
    ...applyOptions,
    beforeApplyQueries(queries) {
      for (const query of queries) {
        const storeKey = query.key === undefined ? query.name : `${query.name} ${query.key}`;
        if (!queryRevertLog.has(storeKey)) {
          queryRevertLog.set(storeKey, {
            ...definedProps({ key: query.key }),
            name: query.name,
            previousValue: options.store.get(query.name, query.key),
          });
        }
      }
      callerBeforeApplyQueries?.(queries);
    },
  };

  let pending = '';
  // SPEC §9.1: scan the full streamed body for a terminal <kovo-done reason="..."> marker so the
  // modular path can detect an aborted/failed stream (reason !== 'complete') and mark it failed
  // rather than silently flushing the partial as confirmed (parity with the inline loader).
  let rawForDone = '';
  let aggregate: AppliedMutationResponse | AppliedMutationResponseWithRoot | undefined;

  // L13-3 (bugs-part4, SPEC §9.1:810): a caller-provided abort signal (form unmount, user
  // cancel, navigation) must stop the apply mid-stream — otherwise chunks keep committing and
  // the reader is never cancelled. We watch the caller's `streamText.signal` (the internal
  // controller, created only when the caller passed none, is OUR abort source, not a watch).
  const abortSignal = options.streamText?.signal;

  try {
    while (true) {
      // L13-3: check the abort signal before each read so an abort observed between reads stops
      // applying immediately, cancels the reader, and fails (rather than committing more chunks).
      if (abortSignal?.aborted) {
        await reader.cancel();
        throw abortStreamError(abortSignal);
      }
      const read = await reader.read();
      if (read.done) break;
      // L13-3: an abort that lands while a read was in flight must also halt before we apply
      // the just-read chunk to the store / morph the DOM.
      if (abortSignal?.aborted) {
        await reader.cancel();
        throw abortStreamError(abortSignal);
      }
      const chunk = decoder.decode(read.value, { stream: true });
      rawForDone += chunk;
      pending += chunk;
      const result = flushCompleteMutationResponsePrefix(
        pending,
        applyOptionsWithStreamTextBuffer(trackingApplyOptions, streamTextBuffer),
      );
      pending = result.pending;
      aggregate = mergeAppliedMutationResponses(aggregate, result.applied);
    }

    const tail = decoder.decode();
    rawForDone += tail;
    pending += tail;
    if (pending.length > 0) {
      aggregate = mergeAppliedMutationResponses(
        aggregate,
        applyMutationResponseChunksToRuntime(
          readMutationResponseBodyChunks(pending, options.onError),
          applyOptionsWithStreamTextBuffer(trackingApplyOptions, streamTextBuffer),
        ),
      );
    }

    // I1 (SPEC §9.1:810): a confirmed stream ends with <kovo-done reason="complete"> (the server
    // always emits a terminator). A non-complete reason OR a missing terminator (interrupted
    // connection) is a failure — do not return the partial as success.
    const doneReason = readStreamDoneReason(rawForDone);
    if (doneReason === 'complete') {
      await streamTextBuffer?.flush('completion');
      return aggregate ?? emptyAppliedMutationResponse(options.root);
    }

    // Throw into the unified failure handler below (revert + report + fail).
    throw new Error(
      doneReason === undefined
        ? 'Streaming mutation ended without a <kovo-done> terminator; the partial response is not confirmed.'
        : `Streaming mutation ended with <kovo-done reason="${doneReason}">; the partial response is not confirmed.`,
    );
  } catch (error) {
    // I1 + L13-3 (SPEC §9.1:810): every failure path (non-complete done, interrupted stream,
    // mid-stream abort, reader error) converges here. Revert the partially-applied query truths
    // to their pre-stream values so the store keeps no unconfirmed data, abort the stream-text
    // buffer (marks the stream-text targets failed), report once, and re-throw so the caller
    // marks the submitted form failed and refetches server truth (fragment morphs are reconciled
    // by that form-failure refetch). Never return the partial as a success result.
    streamAbortController?.abort();
    revertAppliedQueries(options.store, queryRevertLog);
    if (streamTextBuffer) {
      // The buffer's `fail` marks stream-text targets failed AND reports via its onError
      // (constructed from options.onError), so reporting once here would double-fire.
      await streamTextBuffer.fail(error);
    } else {
      // No stream-text buffer (rootless apply): report the failure directly so the caller
      // still observes it before the throw.
      reportRuntimeError(options.onError, error);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * L13-3 (bugs-part4, SPEC §9.1:810): the failure thrown when a caller-provided abort signal
 * fires mid-stream. Prefer the signal's `reason` when present (e.g. the caller's own
 * AbortError/Error), else a DOMException `AbortError` (falling back to a plain Error in
 * environments without DOMException).
 */
function abortStreamError(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  try {
    return new DOMException('Streaming mutation aborted; the partial response is not confirmed.', 'AbortError');
  } catch {
    return new Error('Streaming mutation aborted; the partial response is not confirmed.');
  }
}

/**
 * I1 (bugs-part4, SPEC §9.1:810): restore every query touched by an unconfirmed streaming
 * mutation to the value it held before the stream began. A query that had no prior value is
 * deleted so the store reverts to its true pre-stream shape (no fabricated empty truth).
 */
function revertAppliedQueries(
  store: QueryStore,
  revertLog: ReadonlyMap<string, { key?: string; name: string; previousValue: unknown }>,
): void {
  for (const entry of revertLog.values()) {
    if (entry.previousValue === undefined) {
      store.delete(entry.name, entry.key);
    } else {
      store.set(entry.name, entry.previousValue, entry.key);
    }
  }
}

/**
 * Read the reason of the last `<kovo-done reason="...">` terminator in a streamed mutation body
 * (SPEC §9.1). Returns `undefined` when no done marker is present (an interrupted stream), the
 * reason string otherwise. A missing `reason` attribute is treated as `'complete'` (parity with
 * the inline loader's `reason && reason !== 'complete'` check).
 */
function readStreamDoneReason(body: string): string | undefined {
  const pattern = /<kovo-done\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  let reason: string | undefined;
  while ((match = pattern.exec(body)) !== null) {
    reason = readAttribute(match[1] ?? '', 'reason') ?? 'complete';
  }
  return reason;
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
