import { definedProps } from './defined-props.js';
import type { ListenerTargetLike } from './dom-like.js';
import { reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { applyQueryChunksToRuntime, type QueryApplyInterposition } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryStore } from './query-store.js';
import { readQueryElementChunk } from './wire-parser.js';
import type { QueryChunk, QueryElementChunkLike } from './wire-parser.js';

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
  const listener = (event: InlineQueryEvent) => {
    try {
      const applied = applyInlineQueryEventToRuntime(event, options);
      if (applied.length > 0) options.onAppliedQueries?.(applied);
    } catch (error) {
      reportRuntimeError(options.onError, error);
    }
  };

  options.target.addEventListener('kovo:query', listener);

  return () => {
    options.target.removeEventListener?.('kovo:query', listener);
  };
}

function queryChunksFromInlineEvent(
  event: InlineQueryEvent,
  onError?: RuntimeErrorReporter,
): QueryChunk[] {
  const detail = event.detail;
  if (!isInlineQueryWireEventDetail(detail)) return [];

  const queries = detail.queries ?? detail.qs ?? [];
  const chunks: QueryChunk[] = [];
  for (const query of queries) {
    const chunk = readQueryElementChunk(query, onError);
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function isInlineQueryWireEventDetail(value: unknown): value is InlineQueryEventDetail {
  if (typeof value !== 'object' || value === null) return false;

  const detail = value as Partial<InlineQueryEventDetail>;
  const queries = detail.queries ?? detail.qs;
  return Array.isArray(queries) && queries.every(isQueryElementChunkLike);
}

function isQueryElementChunkLike(value: unknown): value is QueryElementChunkLike {
  if (typeof value !== 'object' || value === null) return false;

  const chunk = value as Partial<QueryElementChunkLike>;
  return typeof chunk.attrs === 'string' && typeof chunk.content === 'string';
}
