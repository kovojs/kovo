import { definedProps } from './defined-props.js';
import type { ListenerTargetLike } from './dom-like.js';
import { reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { applyQueryChunksToRuntime, type QueryApplyInterposition } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryStore } from './query-store.js';
import { readQueryElementChunk } from './wire-parser.js';
import type { QueryChunk, QueryElementChunkLike } from './wire-parser.js';

/** @internal */
export interface InlineQueryEventDetail {
  queries: QueryElementChunkLike[];
}

/** @internal */
export interface InlineQueryEvent {
  detail?: InlineQueryEventDetail;
}

/** @internal */
export interface QueryEventHydrationTarget extends ListenerTargetLike<InlineQueryEvent> {}

/** @internal */
export interface ApplyInlineQueryEventOptions {
  applyQuery?: QueryApplyInterposition;
  onError?: RuntimeErrorReporter;
  queryPlans?: CompiledQueryUpdatePlans;
  root?: unknown;
  store: QueryStore;
}

/** @internal */
export interface InstallInlineQueryEventHydrationOptions extends ApplyInlineQueryEventOptions {
  onAppliedQueries?: (queries: readonly string[]) => void;
  target: QueryEventHydrationTarget;
}

/** @internal */
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

/** @internal */
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

  const chunks: QueryChunk[] = [];
  for (const query of detail.queries) {
    const chunk = readQueryElementChunk(query, onError);
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function isInlineQueryWireEventDetail(value: unknown): value is InlineQueryEventDetail {
  if (typeof value !== 'object' || value === null) return false;

  const detail = value as InlineQueryEventDetail;
  return Array.isArray(detail.queries) && detail.queries.every(isQueryElementChunkLike);
}

function isQueryElementChunkLike(value: unknown): value is QueryElementChunkLike {
  if (typeof value !== 'object' || value === null) return false;

  const chunk = value as Partial<QueryElementChunkLike>;
  return typeof chunk.attrs === 'string' && typeof chunk.content === 'string';
}
