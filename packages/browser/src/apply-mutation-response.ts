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
import { readElementChunks } from './wire-response-scanner.js';
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
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { reloadSessionTransitionDocument } from './session-transition.js';
import {
  securityArrayAppend,
  securityArrayIsArray,
  securityGetOwnPropertyDescriptor,
  securityMap,
  securityMapForEach,
  securityMapHas,
  securityMapSet,
  securityOwnArrayEntry,
} from './security-witness-intrinsics.js';

// SPEC §6.6/§9.1: streaming response bytes remain server truth only when stream
// acquisition, reader read/cancel/release, byte copying, and decoder construction/
// decode are captured and witnessed during framework module initialization before
// any authored client module can replace browser-realm intrinsics.
const mutationResponseSecurity = createBrowserNavigationSecurityControls();

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
  /** Build token from the response `Kovo-Build` header (SPEC §9.1.1). When the
   * page has a token, a missing or mismatched response token is a whole-response
   * miss: no query, fragment, or stream-text chunk is applied. */
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
  options = definedProps(options) as ApplyMutationResponseChunksToRuntimeOptions;
  // SPEC.md §9.1: mutation, deferred, broadcast, and typed-read responses all
  // converge here after their transport-specific parser has decoded wire chunks.

  if (isWholeResponseBuildTokenMiss(options)) {
    for (let index = 0; index < chunks.queries.length; index += 1) {
      const query = securityOwnArrayEntry(chunks.queries, index);
      if (!query.ok) throw new TypeError('Kovo mutation response queries must be dense.');
      options.onDeltaMiss?.(query.value.name, query.value.key);
    }
    return emptyAppliedMutationResponse(options.root);
  }

  const effectiveChunks = chunks;

  options.beforeApplyQueries?.(effectiveChunks.queries);
  const appliedQueries = applyQueryChunksToRuntime(options.store, effectiveChunks.queries, {
    ...definedProps({
      applyQuery: options.applyQuery,
      onDeltaMiss: options.onDeltaMiss,
      onError: options.onError,
      queryPlans: options.queryPlans,
      root: options.queryRoot ?? options.root,
    }),
  });
  const queryFacts: string[] = [];
  appendDenseSecurityValues(queryFacts, appliedQueries, 'Browser applied mutation query facts');
  const applied: AppliedMutationResponse = {
    fragments: effectiveChunks.fragments,
    queries: queryFacts,
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
  options = definedProps(options) as ApplyMutationResponseBodyToRuntimeOptions;
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
  options = definedProps(options) as ApplyStreamingMutationResponseBodyToRuntimeOptions;
  const { body, ...applyOptions } = options;
  if (isWholeResponseBuildTokenMiss(applyOptions)) {
    await mutationResponseSecurity.cancelReadableStream(body);
    return emptyAppliedMutationResponse(options.root);
  }
  const readerPlan = await mutationResponseSecurity.acquireStreamReader(body);
  const decoder = mutationResponseSecurity.createTextDecoder();
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
  // truth, hard-reload server authority, and then reject instead of returning a success result.
  const queryRevertLog = securityMap<
    string,
    { key?: string; name: string; previousValue: unknown }
  >();
  const callerBeforeApplyQueries = applyOptions.beforeApplyQueries;
  const trackingApplyOptions: ApplyMutationResponseChunksToRuntimeOptions = {
    ...applyOptions,
    beforeApplyQueries(queries) {
      for (let index = 0; index < queries.length; index += 1) {
        const queryEntry = securityOwnArrayEntry(queries, index);
        if (!queryEntry.ok) {
          throw new TypeError('Kovo streamed query rollback facts must be dense.');
        }
        const query = snapshotQueryIdentity(queryEntry.value);
        const storeKey = query.key === undefined ? query.name : `${query.name} ${query.key}`;
        if (!securityMapHas(queryRevertLog, storeKey)) {
          securityMapSet(queryRevertLog, storeKey, {
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
        await mutationResponseSecurity.cancelStreamReader(readerPlan);
        throw abortStreamError(abortSignal);
      }
      const read = await mutationResponseSecurity.readStreamChunk(readerPlan);
      if (read.done) break;
      // L13-3: an abort that lands while a read was in flight must also halt before we apply
      // the just-read chunk to the store / morph the DOM.
      if (abortSignal?.aborted) {
        await mutationResponseSecurity.cancelStreamReader(readerPlan);
        throw abortStreamError(abortSignal);
      }
      const chunk = mutationResponseSecurity.decodeText(decoder, read.value, { stream: true });
      rawForDone += chunk;
      pending += chunk;
      const result = flushCompleteMutationResponsePrefix(
        pending,
        applyOptionsWithStreamTextBuffer(trackingApplyOptions, streamTextBuffer),
      );
      pending = result.pending;
      aggregate = mergeAppliedMutationResponses(aggregate, result.applied);
    }

    const tail = mutationResponseSecurity.decodeText(decoder);
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
    // buffer (marks the stream-text targets failed), report once, hard-reload authoritative server
    // truth, and re-throw. Never return the partial as a success result.
    streamAbortController?.abort();
    revertAppliedQueries(options.store, queryRevertLog);
    try {
      if (streamTextBuffer) {
        // The buffer's `fail` marks stream-text targets failed AND reports via its onError
        // (constructed from options.onError), so reporting once here would double-fire.
        await streamTextBuffer.fail(error);
      } else {
        // No stream-text buffer (rootless apply): report the failure directly so the caller
        // still observes it before the throw.
        reportRuntimeError(options.onError, error);
      }
    } finally {
      // bugz-26 M3 / SPEC §9.1: fragments are applied progressively and a post-commit stream
      // failure cannot soundly restore an old DOM snapshot as current server truth. Recovery is
      // therefore framework-owned and mandatory: start and await a hard reload before rejecting.
      // This lives below submit/onError so an app error hook cannot accidentally suppress it.
      await recoverUnconfirmedStreamingMutation();
    }
    throw error;
  } finally {
    mutationResponseSecurity.releaseStreamReader(readerPlan);
  }
}

/**
 * bugz-26 M3 / SPEC §9.1: retire any progressively-applied stream fragments by hard-reloading
 * authoritative server truth. The structural return type admits an async test/host seam while the
 * browser Location API remains synchronous; awaiting it keeps the failure boundary ordered.
 */
async function recoverUnconfirmedStreamingMutation(): Promise<void> {
  await reloadSessionTransitionDocument();
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
    return new DOMException(
      'Streaming mutation aborted; the partial response is not confirmed.',
      'AbortError',
    );
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
  securityMapForEach(revertLog, (entry) => {
    if (entry.previousValue === undefined) {
      store.delete(entry.name, entry.key);
    } else {
      store.set(entry.name, entry.previousValue, entry.key);
    }
  });
}

/**
 * Read the confirmation posture of every `<kovo-done reason="...">` terminator in a streamed
 * mutation body (SPEC §9.1). Any non-complete reason wins permanently: a later `complete` marker
 * cannot launder an already-failed stream. Returns `undefined` when no done marker is present (an
 * interrupted stream). A missing `reason` attribute is treated as `'complete'`.
 */
function readStreamDoneReason(body: string): string | undefined {
  // SPEC §6.6/§9.1: the completion marker is server truth. Parse it with the shared primitive
  // wire scanner rather than late RegExp.prototype dispatch, and enforce the same terminal-order
  // invariant as the generated inline runtime: no query/fragment/text or non-whitespace bytes may
  // follow the first done marker.
  const dones = readElementChunks(body, 'kovo-done');
  if (dones.length === 0) return undefined;
  let firstDoneStart = Number.POSITIVE_INFINITY;
  let firstDoneEnd = 0;
  let failureReason: string | undefined;
  for (let index = 0; index < dones.length; index += 1) {
    const done = securityOwnArrayEntry(dones, index);
    if (!done.ok) throw new TypeError('Kovo streamed completion facts must be dense.');
    if (done.value.start < firstDoneStart) {
      firstDoneStart = done.value.start;
      firstDoneEnd = done.value.end;
    }
    const reason = readAttribute(done.value.attrs, 'reason') ?? 'complete';
    if (reason !== 'complete' && failureReason === undefined) failureReason = reason;
  }

  if (mutationResponseSecurity.trim(mutationResponseSecurity.slice(body, firstDoneEnd)) !== '') {
    return failureReason ?? 'invalid';
  }
  return failureReason ?? 'complete';
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
    // SPEC §6.6/§9.1: this remainder is still unclassified server transport bytes. A late
    // String.prototype.slice replacement must not substitute a different query/fragment stream.
    pending: mutationResponseSecurity.slice(pending, consumed),
  };
}

function mergeAppliedMutationResponses(
  current: AppliedMutationResponse | AppliedMutationResponseWithRoot | undefined,
  next: AppliedMutationResponse | AppliedMutationResponseWithRoot | undefined,
): AppliedMutationResponse | AppliedMutationResponseWithRoot | undefined {
  if (!next) return current;
  if (!current) return next;

  const fragments: FragmentChunk[] = [];
  const queries: string[] = [];
  appendDenseSecurityValues(fragments, current.fragments, 'Browser merged mutation fragments');
  appendDenseSecurityValues(fragments, next.fragments, 'Browser merged mutation fragments');
  appendDenseSecurityValues(queries, current.queries, 'Browser merged mutation queries');
  appendDenseSecurityValues(queries, next.queries, 'Browser merged mutation queries');
  const merged: AppliedMutationResponse & { appliedFragments?: string[] } = {
    fragments,
    queries,
  };
  const currentAppliedFragments = ownOptionalArray<string>(current, 'appliedFragments');
  const nextAppliedFragments = ownOptionalArray<string>(next, 'appliedFragments');
  if (currentAppliedFragments || nextAppliedFragments) {
    const appliedFragments: string[] = [];
    if (currentAppliedFragments)
      appendDenseSecurityValues(
        appliedFragments,
        currentAppliedFragments,
        'Browser merged applied fragment facts',
      );
    if (nextAppliedFragments)
      appendDenseSecurityValues(
        appliedFragments,
        nextAppliedFragments,
        'Browser merged applied fragment facts',
      );
    merged.appliedFragments = appliedFragments;
  }
  const currentStreams = ownOptionalArray<string>(current, 'streams');
  const nextStreams = ownOptionalArray<string>(next, 'streams');
  if (currentStreams || nextStreams) {
    const streams: string[] = [];
    if (currentStreams)
      appendDenseSecurityValues(streams, currentStreams, 'Browser merged stream facts');
    if (nextStreams) appendDenseSecurityValues(streams, nextStreams, 'Browser merged stream facts');
    merged.streams = streams;
  }
  const currentTexts = ownOptionalArray<StreamTextChunk>(current, 'texts');
  const nextTexts = ownOptionalArray<StreamTextChunk>(next, 'texts');
  if (currentTexts || nextTexts) {
    const texts: StreamTextChunk[] = [];
    if (currentTexts)
      appendDenseSecurityValues(texts, currentTexts, 'Browser merged stream text facts');
    if (nextTexts) appendDenseSecurityValues(texts, nextTexts, 'Browser merged stream text facts');
    merged.texts = texts;
  }
  return merged;
}

function snapshotQueryIdentity(query: QueryChunk): { key?: string; name: string } {
  const name = securityGetOwnPropertyDescriptor(query, 'name');
  const key = securityGetOwnPropertyDescriptor(query, 'key');
  if (!name || !('value' in name) || typeof name.value !== 'string') {
    throw new TypeError('Kovo streamed query name must be own string data.');
  }
  if (key && (!('value' in key) || (key.value !== undefined && typeof key.value !== 'string'))) {
    throw new TypeError('Kovo streamed query key must be own string data.');
  }
  return key && 'value' in key && typeof key.value === 'string'
    ? { key: key.value, name: name.value }
    : { name: name.value };
}

function ownOptionalArray<Value>(
  value: object,
  property: PropertyKey,
): readonly Value[] | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(value, property);
  if (!descriptor) return undefined;
  if (!('value' in descriptor) || !securityArrayIsArray(descriptor.value)) {
    throw new TypeError(`Kovo mutation result ${String(property)} must be own array data.`);
  }
  return descriptor.value as readonly Value[];
}

function appendDenseSecurityValues<Value>(
  target: Value[],
  source: readonly Value[],
  label: string,
): void {
  if (!securityArrayIsArray(source)) throw new TypeError(`${label} must be an array.`);
  const length = securityGetOwnPropertyDescriptor(source, 'length');
  if (
    !length ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    length.value < 0 ||
    length.value % 1 !== 0 ||
    length.value > 100_000
  ) {
    throw new TypeError(`${label} length is invalid.`);
  }
  for (let index = 0; index < length.value; index += 1) {
    const entry = securityOwnArrayEntry(source, index);
    if (!entry.ok) throw new TypeError(`${label} must be dense own data.`);
    securityArrayAppend(target, entry.value, label);
  }
}

function emptyAppliedMutationResponse(
  root: MorphRoot | undefined,
): AppliedMutationResponse | AppliedMutationResponseWithRoot {
  return root
    ? { appliedFragments: [], fragments: [], queries: [] }
    : { fragments: [], queries: [] };
}

function isWholeResponseBuildTokenMiss(
  options: ApplyMutationResponseChunksToRuntimeOptions,
): boolean {
  return (
    options.expectedBuildToken !== undefined &&
    (options.responseBuildToken === undefined ||
      options.responseBuildToken !== options.expectedBuildToken)
  );
}
