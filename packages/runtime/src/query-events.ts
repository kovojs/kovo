import { definedProps } from './defined-props.js';
import type { ListenerTargetLike } from './dom-like.js';
import { reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { applyQueryChunksToRuntime, type QueryApplyInterposition } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryStore } from './query-store.js';
import { readQueryElementChunk } from './wire-parser.js';
import type { QueryChunk, QueryElementChunkLike } from './wire-parser.js';

export interface InlineQueryEventDetail {
  queries?: unknown;
}

export interface InlineQueryEvent {
  detail?: unknown;
}

export interface QueryEventHydrationTarget extends ListenerTargetLike<InlineQueryEvent> {}

interface InlineQueryWireEventDetail {
  queries: QueryElementChunkLike[];
}

export interface ApplyInlineQueryEventOptions {
  applyQuery?: QueryApplyInterposition;
  onError?: RuntimeErrorReporter;
  queryPlans?: CompiledQueryUpdatePlans;
  root?: unknown;
  store: QueryStore;
}

export interface InstallInlineQueryEventHydrationOptions extends ApplyInlineQueryEventOptions {
  onAppliedQueries?: (queries: readonly string[]) => void;
  target: QueryEventHydrationTarget;
}

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
      queryPlans: options.queryPlans,
      root: options.root,
    }),
  });
}

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

  options.target.addEventListener('jiso:query', listener);

  return () => {
    options.target.removeEventListener?.('jiso:query', listener);
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

function isInlineQueryWireEventDetail(value: unknown): value is InlineQueryWireEventDetail {
  if (typeof value !== 'object' || value === null) return false;

  const detail = value as InlineQueryEventDetail;
  return Array.isArray(detail.queries) && detail.queries.every(isQueryElementChunkLike);
}

function isQueryElementChunkLike(value: unknown): value is QueryElementChunkLike {
  if (typeof value !== 'object' || value === null) return false;

  const chunk = value as Partial<QueryElementChunkLike>;
  return typeof chunk.attrs === 'string' && typeof chunk.content === 'string';
}
