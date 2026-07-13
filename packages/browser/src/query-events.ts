import { definedProps } from './defined-props.js';
import type { ListenerTargetLike } from './dom-like.js';
import { reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { applyQueryChunksToRuntime, type QueryApplyInterposition } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryStore } from './query-store.js';
import { readQueryElementChunk } from './wire-parser.js';
import type { QueryChunk, QueryElementChunkLike } from './wire-parser.js';
import {
  addRuntimeEventListener,
  readRuntimeCustomEventDetail,
  removeRuntimeEventListener,
} from './runtime-dom-security.js';
import {
  securityArrayAppend,
  securityArrayIsArray,
  securityGetOwnPropertyDescriptor,
  securityOwnArrayEntry,
} from './security-witness-intrinsics.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface InlineQueryEventDetail {
  queries: QueryElementChunkLike[];
  qs?: QueryElementChunkLike[];
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface InlineQueryEvent {
  detail?: InlineQueryEventDetail;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface QueryEventHydrationTarget extends ListenerTargetLike<InlineQueryEvent> {}

/** @internal Options for applying an inline `kovo:query` event to the runtime (SPEC §9.4). */
export interface ApplyInlineQueryEventOptions {
  applyQuery?: QueryApplyInterposition;
  onError?: RuntimeErrorReporter;
  queryPlans?: CompiledQueryUpdatePlans;
  root?: unknown;
  store: QueryStore;
}

/** @internal Options for installing the inline `kovo:query` event hydration listener (SPEC §9.4). */
export interface InstallInlineQueryEventHydrationOptions extends ApplyInlineQueryEventOptions {
  onAppliedQueries?: (queries: readonly string[]) => void;
  target: QueryEventHydrationTarget;
}

/** @internal Apply an inline `kovo:query` event's chunks to the query store (SPEC §9.4). */
export function applyInlineQueryEventToRuntime(
  event: InlineQueryEvent,
  options: ApplyInlineQueryEventOptions,
): readonly string[] {
  options = definedProps(options) as ApplyInlineQueryEventOptions;
  const chunks = queryChunksFromInlineEvent(event, options.onError);
  if (chunks.length === 0) return [];

  // SPEC.md §9.1/§9.4: inline enhanced responses, mutation responses, typed
  // reads, and hydrated scripts all converge on the same query apply path.
  return applyQueryChunksToRuntime(options.store, chunks, {
    ...definedProps({
      applyQuery: options.applyQuery,
      onError: options.onError,
      queryPlans: options.queryPlans,
      root: options.root,
    }),
  });
}

/** @internal Install a `kovo:query` listener that hydrates inline query events (SPEC §9.4). */
export function installInlineQueryEventHydration(
  options: InstallInlineQueryEventHydrationOptions,
): () => void {
  options = definedProps(options) as InstallInlineQueryEventHydrationOptions;
  const listener = (event: InlineQueryEvent) => {
    try {
      const applied = applyInlineQueryEventToRuntime(event, options);
      if (applied.length > 0) options.onAppliedQueries?.(applied);
    } catch (error) {
      reportRuntimeError(options.onError, error);
    }
  };

  if (!addRuntimeEventListener(options.target, 'kovo:query', listener)) {
    throw new TypeError('Kovo inline query hydration listener enrollment failed.');
  }

  return () => {
    removeRuntimeEventListener(options.target, 'kovo:query', listener);
  };
}

function queryChunksFromInlineEvent(
  event: InlineQueryEvent,
  onError?: RuntimeErrorReporter,
): QueryChunk[] {
  const queries = snapshotInlineQueryWireElements(readRuntimeCustomEventDetail(event));
  if (queries.length === 0) return [];
  const chunks: QueryChunk[] = [];
  for (let index = 0; index < queries.length; index += 1) {
    const query = securityOwnArrayEntry(queries, index);
    if (!query.ok) throw new TypeError('Kovo inline query event snapshot must be dense.');
    const chunk = readQueryElementChunk(query.value, onError);
    if (chunk) securityArrayAppend(chunks, chunk, 'Kovo parsed inline query event snapshot');
  }
  return chunks;
}

function snapshotInlineQueryWireElements(value: unknown): QueryElementChunkLike[] {
  if (typeof value !== 'object' || value === null) return [];
  const queriesDescriptor = securityGetOwnPropertyDescriptor(value, 'queries');
  const fallbackDescriptor = securityGetOwnPropertyDescriptor(value, 'qs');
  const selected = queriesDescriptor ?? fallbackDescriptor;
  if (!selected || !('value' in selected) || !securityArrayIsArray(selected.value)) return [];
  const length = securityGetOwnPropertyDescriptor(selected.value, 'length');
  if (
    !length ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    length.value < 0 ||
    length.value % 1 !== 0 ||
    length.value > 100_000
  ) {
    throw new TypeError('Kovo inline query event length is invalid.');
  }

  // SPEC §6.6/§9.1: the inline loader's event is a server-query-truth handoff. Snapshot every
  // carrier field as exact own data before parsing so late iterator/Array helpers, accessors, or
  // an apply-error callback cannot substitute a different query batch midway through hydration.
  const snapshot: QueryElementChunkLike[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const entry = securityOwnArrayEntry(selected.value, index);
    if (!entry.ok || typeof entry.value !== 'object' || entry.value === null) {
      throw new TypeError('Kovo inline query event entries must be dense objects.');
    }
    const attrs = securityGetOwnPropertyDescriptor(entry.value, 'attrs');
    const content = securityGetOwnPropertyDescriptor(entry.value, 'content');
    if (
      !attrs ||
      !('value' in attrs) ||
      typeof attrs.value !== 'string' ||
      !content ||
      !('value' in content) ||
      typeof content.value !== 'string'
    ) {
      throw new TypeError('Kovo inline query event chunks must contain own string data.');
    }
    securityArrayAppend(
      snapshot,
      { attrs: attrs.value, content: content.value },
      'Kovo inline query event snapshot',
    );
  }
  return snapshot;
}
